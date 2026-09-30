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
import { formaterUSD } from "@/lib/montant";

type Tx = Prisma.TransactionClient;

const AUJ = () => new Date().toISOString().slice(0, 10);

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

/** Ce qui a été réglé — de quoi dire « Facture n° 12 de SENEVE payée le … — 120,00 $ ». */
export type ReglementEcrit = {
  factureId: string; fournisseurNom: string; numero: string | null;
  montant: number; type: "PAIEMENT" | "AVOIR"; date: string; solde: boolean; reste: number;
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
  return { factureId: id, fournisseurNom: f.fournisseurNom, numero: f.numero, montant: p.montant, type, date: dateStr, solde, reste: nouveauReste };
}

/**
 * Règle plusieurs factures d'un coup (réglé = montant, reste = 0), toutes à la même date. Les
 * factures encore à régler sont relues SOUS VERROU ; si l'une a une date de facture postérieure à
 * la date choisie, le lot ENTIER est refusé en la nommant. Ce qui n'est déjà plus à régler est
 * exclu (jamais réglé deux fois) : l'appelant compare le nombre réglé au nombre demandé.
 */
export async function reglerLotTx(tx: Tx, userId: string, ids: string[], dateStr: string | undefined, note: string): Promise<ReglementEcrit[]> {
  const maintenant = new Date();
  const facs = await tx.$queryRaw<{ id: string; date: Date | null; fournisseurNom: string; numero: string | null; resteAPayerUSD: Prisma.Decimal }[]>`
    SELECT "id", "date", "fournisseurNom", "numero", "resteAPayerUSD"
    FROM "stock"."FactureFournisseur"
    WHERE "id" IN (${Prisma.join(ids)}) AND "statut" <> 'REGLEE' AND "resteAPayerUSD" > 0
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

  await tx.$executeRaw`
    INSERT INTO "stock"."Paiement" ("id", "factureId", "date", "montantUSD", "modePaiement", "note", "creeParId")
    SELECT gen_random_uuid(), "id", ${date}, "resteAPayerUSD", "modePaiement", ${note}, ${userId}
    FROM "stock"."FactureFournisseur"
    WHERE "id" IN (${Prisma.join(facIds)})`;
  await tx.$executeRaw`
    UPDATE "stock"."FactureFournisseur"
    SET "montantRegleUSD" = "montantUSD", "resteAPayerUSD" = 0, "statut" = 'REGLEE', "datePaiement" = ${date}
    WHERE "id" IN (${Prisma.join(facIds)})`;
  await journaliser(tx, { entite: "FactureFournisseur", entiteId: "lot", champ: "statut", nouvelleValeur: `${facIds.length} facture(s) réglée(s)`, userId });
  return facs.map((f) => ({ factureId: f.id, fournisseurNom: f.fournisseurNom, numero: f.numero, montant: Number(f.resteAPayerUSD), type: "PAIEMENT" as const, date: dateISO, solde: true, reste: 0 }));
}

// ── Notification « facture payée » ──────────────────────────────────────────
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** « facture n° 12 de SENEVE » (minuscule : placé au milieu d'une phrase, ou capitalisé en tête). */
const nomFacture = (r: { numero: string | null; fournisseurNom: string }) =>
  `${r.numero ? `facture n° ${r.numero}` : "facture sans numéro"} de ${r.fournisseurNom}`;
const capitale = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Texte de la notification d'un règlement effectif (pur, testé). */
export function messageReglements(regs: ReglementEcrit[]): string {
  if (regs.length === 1) {
    const r = regs[0];
    if (r.type === "AVOIR") return `Avoir de ${formaterUSD(r.montant)} sur la ${nomFacture(r)} le ${dateFr(r.date)} — ${r.solde ? "facture soldée" : `reste ${formaterUSD(r.reste)}`}`;
    if (r.solde) return `${capitale(nomFacture(r))} payée le ${dateFr(r.date)} — ${formaterUSD(r.montant)}`;
    return `Paiement partiel de ${formaterUSD(r.montant)} sur la ${nomFacture(r)} le ${dateFr(r.date)} — reste ${formaterUSD(r.reste)}`;
  }
  const total = regs.reduce((t, r) => t + r.montant, 0);
  const noms = regs.map((r) => (r.numero ? `${r.fournisseurNom} n° ${r.numero}` : r.fournisseurNom)).join(", ");
  return `${regs.length} factures payées le ${dateFr(regs[0].date)} — ${formaterUSD(total)} (${noms})`.slice(0, 480);
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
