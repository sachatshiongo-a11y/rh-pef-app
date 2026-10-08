import "server-only";

// CŒUR DES RÈGLEMENTS DE FACTURES FOURNISSEURS — un seul chemin d'écriture pour le geste direct de
// la Direction (« Marquer payée », « Marquer payées », « + Paiement / Avoir ») ET pour la validation
// d'une demande de paiement : c'est ce qui garantit qu'une demande validée paie EXACTEMENT comme la
// Direction l'aurait fait elle-même.
//
// Ces fonctions reçoivent le client de TRANSACTION : l'appelant décide de ce qui est atomique avec le
// règlement (la validation y ajoute le changement de statut de la demande). Elles vivent ici, hors
// d'un fichier « use server » : exportées depuis `factures/actions.ts`, elles deviendraient des
// actions serveur appelables par n'importe quel compte, sans garde.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import { lireDatePaiement } from "@/lib/date-paiement";
import { envoyerPush } from "@/lib/push";
import { formaterFC, formaterNombre, formaterUSD } from "@/lib/montant";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { francsEnDollars, francsPourReste } from "./conversion-francs";

type Tx = Prisma.TransactionClient;

const AUJ = () => jourCourantKinshasaISO();

/** Statut d'une facture d'après son reste à payer et son échéance. */
export function statutDe(reste: number, echeanceISO: string | null): "REGLEE" | "A_REGLER" | "ECHUE_NON_REGLEE" {
  if (reste <= 0.001) return "REGLEE";
  if (echeanceISO && echeanceISO < AUJ()) return "ECHUE_NON_REGLEE";
  return "A_REGLER";
}

export type ParamsReglement = {
  montant: number; montantCDF?: number | null; taux?: number | null;
  dateStr?: string; mode?: string | null; note?: string | null; type?: "PAIEMENT" | "AVOIR";
};

/**
 * Conversion d'un règlement en FRANCS, au taux des Paramètres LU MAINTENANT — la règle du paiement
 * direct, reprise telle quelle à la validation d'une demande (décision de la Direction, 2026-10-01 :
 * le taux appliqué est celui du jour où le paiement est enregistré, pas celui du jour de la demande).
 */
export async function convertirFrancs(client: Tx | typeof prisma, montantCDF: number): Promise<{ montant: number; taux: number }> {
  const taux = await lireTauxReglement(client);
  return { montant: francsEnDollars(montantCDF, taux), taux };
}

/** Taux des Paramètres LU MAINTENANT ; absent ou nul : refus lisible (jamais un taux supposé). */
export async function lireTauxReglement(client: Tx | typeof prisma): Promise<number> {
  const config = await client.config.findUnique({ where: { id: "singleton" } });
  const taux = Number(config?.tauxChangeCDF ?? 0);
  if (!taux) throw new Error("Taux de change non configuré (Paramètres RH).");
  return taux;
}

// LA conversion (francs ÷ taux, au centime) et les francs proposés pour un reste : conversion-francs.ts.
export { francsEnDollars, francsPourReste };

/** Ce qui a été réglé — de quoi dire « Facture n° 12 de SENEVE payée le … — 120,00 $ ». */
export type ReglementEcrit = {
  factureId: string; fournisseurNom: string; numero: string | null;
  montant: number; type: "PAIEMENT" | "AVOIR"; date: string; solde: boolean; reste: number;
  /** Payé en francs : les francs versés et le taux qui les a convertis (absents = payé en dollars). */
  montantCDF?: number | null; taux?: number | null;
};

/** Verrouille la facture (`FOR UPDATE`) jusqu'à la fin de la transaction, puis la relit. */
export async function verrouillerFacture(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "stock"."FactureFournisseur" WHERE "id" = ${id} FOR UPDATE`;
  return tx.factureFournisseur.findUniqueOrThrow({ where: { id } });
}

/**
 * Applique un paiement/avoir sur une facture (trace datée, cumul réglé/reste, statut recalculé).
 * Règle unique de la date (src/lib/date-paiement.ts) : absente ⇒ aujourd'hui à Kinshasa ; refuse
 * une date future ou antérieure à la date de LA FACTURE. Lecture faite SOUS VERROU.
 */
export async function reglerFactureTx(tx: Tx, userId: string, id: string, p: ParamsReglement): Promise<ReglementEcrit> {
  const type = p.type ?? "PAIEMENT";
  const f = await verrouillerFacture(tx, id);
  const dateStr = lireDatePaiement(p.dateStr, f.date, new Date());
  const reste = Number(f.resteAPayerUSD);
  if (p.montant <= 0) throw new Error("Le montant doit être supérieur à 0.");
  if (p.montant > reste + 0.009) throw new Error(`Le ${type === "AVOIR" ? "montant de l'avoir" : "paiement"} (${p.montant.toFixed(2)} $) dépasse le reste à payer (${reste.toFixed(2)} $).`);

  const nouveauRegle = Number(f.montantRegleUSD) + p.montant;
  const nouveauReste = Math.max(0, Number(f.montantUSD) - nouveauRegle);
  const solde = nouveauReste <= 0.001;
  const echeanceISO = f.dateEcheance ? new Date(f.dateEcheance).toISOString().slice(0, 10) : null;

  await tx.paiement.create({ data: { factureId: id, type, date: new Date(dateStr), montantUSD: p.montant, montantCDF: p.montantCDF ?? null, tauxChangeUtilise: p.taux ?? null, modePaiement: p.mode ?? f.modePaiement, note: p.note ?? null, creeParId: userId } });
  await tx.factureFournisseur.update({
    where: { id },
    data: {
      montantRegleUSD: nouveauRegle,
      resteAPayerUSD: nouveauReste,
      statut: statutDe(nouveauReste, echeanceISO),
      ...(solde ? { datePaiement: new Date(dateStr) } : {}),
    },
  });
  await journaliser(tx, { entite: "FactureFournisseur", entiteId: id, champ: type === "AVOIR" ? "avoir" : "paiement", nouvelleValeur: `${p.montant.toFixed(2)} $${p.montantCDF ? ` (${p.montantCDF.toLocaleString("fr-FR")} FC)` : ""} (${solde ? "soldée" : `reste ${nouveauReste.toFixed(2)} $`})`, userId });
  return { factureId: id, fournisseurNom: f.fournisseurNom, numero: f.numero, montant: p.montant, type, date: dateStr, solde, reste: nouveauReste, ...(p.montantCDF ? { montantCDF: p.montantCDF, taux: p.taux ?? null } : {}) };
}

/**
 * Règle plusieurs factures d'un coup (réglé = montant, reste = 0), toutes à la même date. Les
 * factures encore à régler sont relues SOUS VERROU ; si l'une a une date de facture postérieure à
 * la date choisie, le lot ENTIER est refusé en la nommant. Ce qui n'est déjà plus à régler est
 * exclu (jamais réglé deux fois) : l'appelant compare le nombre réglé au nombre demandé.
 */
export async function reglerLotTx(tx: Tx, userId: string, ids: string[], dateStr: string | undefined, note: string, opts: { enFrancs?: boolean } = {}): Promise<ReglementEcrit[]> {
  const maintenant = new Date();
  // Lot payé en FRANCS (2026-10-08) : taux des Paramètres lu MAINTENANT (refus lisible s'il manque),
  // avant toute écriture.
  const taux = opts.enFrancs ? await lireTauxReglement(tx) : null;
  const facs = await tx.$queryRaw<{ id: string; date: Date | null; fournisseurNom: string; numero: string | null; resteAPayerUSD: Prisma.Decimal }[]>`
    SELECT "id", "date", "fournisseurNom", "numero", "resteAPayerUSD"
    FROM "stock"."FactureFournisseur"
    WHERE "id" IN (${Prisma.join(ids)}) AND "statut" <> 'REGLEE' AND "resteAPayerUSD" > 0
    ORDER BY "id"
    FOR UPDATE`;
  if (facs.length === 0) return [];
  // Ordre de la sélection, jamais l'ordre physique de la base (notification et journal stables).
  facs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  for (const f of facs) {
    try {
      lireDatePaiement(dateStr, f.date, maintenant);
    } catch (e) {
      const nom = f.numero ? `${f.fournisseurNom} (n° ${f.numero})` : f.fournisseurNom;
      throw new Error(`${nom} : ${e instanceof Error ? e.message : "date de paiement invalide"}`);
    }
  }
  const dateISO = lireDatePaiement(dateStr, null, maintenant);
  const date = new Date(dateISO);
  const facIds = facs.map((f) => f.id);

  // En francs : chaque facture est soldée par reste × taux francs (au franc), reconvertis par LA
  // conversion des règlements (`francsEnDollars`) — ce qui redonne le reste au centime. Le paiement
  // garde les francs versés et le taux ; la facture reste tenue en dollars.
  const francs = new Map<string, number>();
  if (taux !== null) {
    for (const f of facs) {
      const reste = Number(f.resteAPayerUSD);
      const fc = francsPourReste(reste, taux);
      if (Math.abs(francsEnDollars(fc, taux) - reste) > 0.001) throw new Error(`Taux de change de ${taux} FC pour 1 $ : le reste de ${reste.toFixed(2)} $ ne se paie pas exactement en francs — vérifiez le taux (Paramètres).`);
      francs.set(f.id, fc);
    }
  }
  if (taux === null) {
    await tx.$executeRaw`
      INSERT INTO "stock"."Paiement" ("id", "factureId", "date", "montantUSD", "modePaiement", "note", "creeParId")
      SELECT gen_random_uuid(), "id", ${date}, "resteAPayerUSD", "modePaiement", ${note}, ${userId}
      FROM "stock"."FactureFournisseur"
      WHERE "id" IN (${Prisma.join(facIds)})`;
  } else {
    await tx.$executeRaw`
      INSERT INTO "stock"."Paiement" ("id", "factureId", "date", "montantUSD", "montantCDF", "tauxChangeUtilise", "modePaiement", "note", "creeParId")
      SELECT gen_random_uuid(), f."id", ${date}, f."resteAPayerUSD", v."cdf", ${taux}::numeric, f."modePaiement", ${note}, ${userId}
      FROM "stock"."FactureFournisseur" f
      JOIN (VALUES ${Prisma.join(facs.map((x) => Prisma.sql`(${x.id}, ${francs.get(x.id)!}::numeric)`))}) AS v("id", "cdf") ON v."id" = f."id"`;
  }
  await tx.$executeRaw`
    UPDATE "stock"."FactureFournisseur"
    SET "montantRegleUSD" = "montantUSD", "resteAPayerUSD" = 0, "statut" = 'REGLEE', "datePaiement" = ${date}
    WHERE "id" IN (${Prisma.join(facIds)})`;
  const totalCDF = [...francs.values()].reduce((t, x) => t + x, 0);
  await journaliser(tx, { entite: "FactureFournisseur", entiteId: "lot", champ: "statut", nouvelleValeur: `${facIds.length} facture(s) réglée(s)${taux !== null ? ` en francs (${totalCDF.toLocaleString("fr-FR")} FC au taux de ${taux})` : ""}`, userId });
  return facs.map((f) => ({ factureId: f.id, fournisseurNom: f.fournisseurNom, numero: f.numero, montant: Number(f.resteAPayerUSD), type: "PAIEMENT" as const, date: dateISO, solde: true, reste: 0, ...(taux !== null ? { montantCDF: francs.get(f.id)!, taux } : {}) }));
}

// ── Notification « facture payée » ──────────────────────────────────────────
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** « facture n° 12 de SENEVE » (minuscule : placé au milieu d'une phrase, ou capitalisé en tête). */
const nomFacture = (r: { numero: string | null; fournisseurNom: string }) =>
  `${r.numero ? `facture n° ${r.numero}` : "facture sans numéro"} de ${r.fournisseurNom}`;
const capitale = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Texte de la notification d'un règlement effectif (pur, testé). */
export function messageReglements(regs: ReglementEcrit[]): string {
  // Payé en francs : « 280 000 FC au taux de 2 800 » à côté du montant en dollars.
  const enFC = (montantCDF: number | null | undefined, taux: number | null | undefined) => (montantCDF ? ` (${formaterFC(montantCDF)}${taux ? ` au taux de ${formaterNombre(taux)}` : ""})` : "");
  if (regs.length === 1) {
    const r = regs[0];
    const fc = enFC(r.montantCDF, r.taux);
    if (r.type === "AVOIR") return `Avoir de ${formaterUSD(r.montant)}${fc} sur la ${nomFacture(r)} le ${dateFr(r.date)} — ${r.solde ? "facture soldée" : `reste ${formaterUSD(r.reste)}`}`;
    if (r.solde) return `${capitale(nomFacture(r))} payée le ${dateFr(r.date)} — ${formaterUSD(r.montant)}${fc}`;
    return `Paiement partiel de ${formaterUSD(r.montant)}${fc} sur la ${nomFacture(r)} le ${dateFr(r.date)} — reste ${formaterUSD(r.reste)}`;
  }
  const total = regs.reduce((t, r) => t + r.montant, 0);
  const totalCDF = regs.every((r) => r.montantCDF) ? regs.reduce((t, r) => t + (r.montantCDF ?? 0), 0) : null;
  const noms = regs.map((r) => (r.numero ? `${r.fournisseurNom} n° ${r.numero}` : r.fournisseurNom)).join(", ");
  return `${regs.length} factures payées le ${dateFr(regs[0].date)} — ${formaterUSD(total)}${enFC(totalCDF, regs[0].taux)} (${noms})`.slice(0, 480);
}

/**
 * Après un règlement EFFECTIF (jamais avant la fin de la transaction : une notification ne doit pas
 * annoncer un paiement annulé) : cloche de l'espace Stock + push à la Direction, aux comptes Stock et
 * au demandeur éventuel.
 */
export async function notifierReglements(regs: ReglementEcrit[], demandeurId: string | null = null) {
  if (regs.length === 0) return;
  const message = messageReglements(regs);
  const lien = regs.length === 1 ? `/stock/factures/${regs[0].factureId}` : "/stock/factures";
  await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message, lien, refId: regs.length === 1 ? `reglement:${regs[0].factureId}` : null } });
  const cibles = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "STOCK"] }, actif: true }, select: { id: true } });
  const ids = new Set(cibles.map((c) => c.id));
  if (demandeurId) ids.add(demandeurId);
  await envoyerPush([...ids], { title: regs.length === 1 && regs[0].type === "AVOIR" ? "Avoir enregistré" : "Facture payée", body: message.slice(0, 180), url: lien, tag: `reglement-${regs[0].factureId}` });
}
