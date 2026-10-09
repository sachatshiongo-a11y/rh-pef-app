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
import { ajouterAuTotal, formaterMontantFacture, libelleTotal, montantsFacture, totalVide, type DeviseFacture } from "@/lib/facture-devise";
import { dollarsPourReste, francsEnDollars, francsPourReste, imputation } from "./conversion-francs";

type Tx = Prisma.TransactionClient;

const AUJ = () => jourCourantKinshasaISO();

/** Statut d'une facture d'après son reste à payer et son échéance. */
export function statutDe(reste: number, echeanceISO: string | null): "REGLEE" | "A_REGLER" | "ECHUE_NON_REGLEE" {
  if (reste <= 0.001) return "REGLEE";
  if (echeanceISO && echeanceISO < AUJ()) return "ECHUE_NON_REGLEE";
  return "A_REGLER";
}

/**
 * Ce qui est VERSÉ, dans SA devise (« 280 000 FC », « 35,71 $ »). Absent = le reste de la facture,
 * dans la devise de la facture (« Marquer payée »). La conversion vers la devise de la facture se
 * fait ICI, au taux des Paramètres lu dans la transaction du paiement (`imputation`).
 */
export type Verse = { devise: DeviseFacture; montant: number };
export type ParamsReglement = {
  verse?: Verse;
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
export { francsEnDollars, francsPourReste, dollarsPourReste };

/** Ce qui a été réglé — de quoi dire « Facture n° 12 de SENEVE payée le … — 120,00 $ ». */
export type ReglementEcrit = {
  factureId: string; fournisseurNom: string; numero: string | null;
  /** Devise de la facture : `montant` (imputé) et `reste` sont dans cette devise. Absent = USD. */
  devise?: DeviseFacture;
  montant: number; type: "PAIEMENT" | "AVOIR"; date: string; solde: boolean; reste: number;
  /** Facture en dollars payée en francs : les francs versés et le taux qui les a convertis. */
  montantCDF?: number | null; taux?: number | null;
  /** Facture en francs payée en dollars : les dollars versés (et `taux`). */
  montantUSD?: number | null;
};

/** Verrouille la facture (`FOR UPDATE`) jusqu'à la fin de la transaction, puis la relit. */
export async function verrouillerFacture(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "stock"."FactureFournisseur" WHERE "id" = ${id} FOR UPDATE`;
  return tx.factureFournisseur.findUniqueOrThrow({ where: { id } });
}

const montantTexte = (n: number, d: DeviseFacture) => (d === "USD" ? `${n.toFixed(2)} $` : formaterMontantFacture(n, "CDF"));

/**
 * Applique un paiement/avoir sur une facture (trace datée, cumul réglé/reste, statut recalculé), DANS
 * LA DEVISE DE LA FACTURE. Versé dans la même devise : imputé tel quel. Versé dans l'autre devise :
 * converti au taux des Paramètres lu MAINTENANT (`imputation` : francs ÷ taux sur une facture en
 * dollars, dollars × taux sur une facture en francs) ; taux absent : refus lisible, rien d'écrit.
 * Plus que le reste : refusé. Règle unique de la date (src/lib/date-paiement.ts) : absente ⇒
 * aujourd'hui à Kinshasa ; refuse une date future ou antérieure à la date de LA FACTURE. Lecture
 * faite SOUS VERROU.
 */
export async function reglerFactureTx(tx: Tx, userId: string, id: string, p: ParamsReglement): Promise<ReglementEcrit> {
  const type = p.type ?? "PAIEMENT";
  const f = await verrouillerFacture(tx, id);
  const dateStr = lireDatePaiement(p.dateStr, f.date, new Date());
  const m = montantsFacture(f);
  const dev = m.devise;
  const verse: Verse = p.verse ?? { devise: dev, montant: m.reste };
  if (!(verse.montant > 0)) throw new Error("Le montant doit être supérieur à 0.");
  const taux = verse.devise !== dev ? await lireTauxReglement(tx) : null;
  const imp = imputation(dev, verse, taux, m.reste)!; // taux lu (ou refusé) ci-dessus quand il faut convertir
  if (imp.depasse) throw new Error(`Le ${type === "AVOIR" ? "montant de l'avoir" : "paiement"} (${montantTexte(imp.impute, dev)}) dépasse le reste à payer (${montantTexte(m.reste, dev)}).`);

  const nouveauRegle = Math.round((m.regle + imp.impute) * 100) / 100;
  const nouveauReste = Math.max(0, Math.round((m.montant - nouveauRegle) * 100) / 100);
  const solde = nouveauReste <= 0.001;
  const echeanceISO = f.dateEcheance ? new Date(f.dateEcheance).toISOString().slice(0, 10) : null;

  // Le montant IMPUTÉ dans la devise de la facture ; l'autre, s'il y a eu conversion, est le montant versé.
  const montantUSD = dev === "USD" ? imp.impute : verse.devise === "USD" ? verse.montant : null;
  const montantCDF = dev === "CDF" ? imp.impute : verse.devise === "CDF" ? verse.montant : null;
  await tx.paiement.create({ data: { factureId: id, type, devise: dev, date: new Date(dateStr), montantUSD, montantCDF, tauxChangeUtilise: taux, modePaiement: p.mode ?? f.modePaiement, note: p.note ?? null, creeParId: userId } });
  await tx.factureFournisseur.update({
    where: { id },
    data: {
      ...(dev === "USD" ? { montantRegleUSD: nouveauRegle, resteAPayerUSD: nouveauReste } : { montantRegleCDF: nouveauRegle, resteAPayerCDF: nouveauReste }),
      statut: statutDe(nouveauReste, echeanceISO),
      ...(solde ? { datePaiement: new Date(dateStr) } : {}),
    },
  });
  const versement = dev === "USD"
    ? `${imp.impute.toFixed(2)} $${montantCDF !== null ? ` (${montantCDF.toLocaleString("fr-FR")} FC)` : ""}`
    : `${formaterMontantFacture(imp.impute, "CDF")}${montantUSD !== null ? ` (${formaterUSD(montantUSD)} au taux de ${formaterNombre(taux!)})` : ""}`;
  await journaliser(tx, { entite: "FactureFournisseur", entiteId: id, champ: type === "AVOIR" ? "avoir" : "paiement", nouvelleValeur: `${versement} (${solde ? "soldée" : `reste ${montantTexte(nouveauReste, dev)}`})`, userId });
  return {
    factureId: id, fournisseurNom: f.fournisseurNom, numero: f.numero, ...(dev === "CDF" ? { devise: "CDF" as const } : {}),
    montant: imp.impute, type, date: dateStr, solde, reste: nouveauReste,
    ...(dev === "USD" && montantCDF !== null ? { montantCDF, taux } : {}),
    ...(dev === "CDF" && montantUSD !== null ? { montantUSD, taux } : {}),
  };
}

/**
 * Ce qui est versé pour un LOT : en dollars (défaut, comme avant), en francs, ou chaque facture dans
 * SA devise (aucune conversion). Une facture dans une autre devise que le versement est soldée au
 * taux des Paramètres lu maintenant.
 */
export type VerseLot = "USD" | "CDF" | "SA_DEVISE";

/**
 * Règle plusieurs factures d'un coup (réglé = montant, reste = 0, dans la devise de chacune), toutes
 * à la même date. Les factures encore à régler sont relues SOUS VERROU ; si l'une a une date de
 * facture postérieure à la date choisie, le lot ENTIER est refusé en la nommant. Ce qui n'est déjà
 * plus à régler est exclu (jamais réglé deux fois) : l'appelant compare le nombre réglé au nombre
 * demandé. `enFrancs` : ancien nom de `verse: "CDF"`.
 */
export async function reglerLotTx(tx: Tx, userId: string, ids: string[], dateStr: string | undefined, note: string, opts: { enFrancs?: boolean; verse?: VerseLot } = {}): Promise<ReglementEcrit[]> {
  const maintenant = new Date();
  const verseLot: VerseLot = opts.verse ?? (opts.enFrancs ? "CDF" : "USD");
  const facs = await tx.$queryRaw<{ id: string; date: Date | null; fournisseurNom: string; numero: string | null; devise: DeviseFacture; resteAPayerUSD: Prisma.Decimal | null; resteAPayerCDF: Prisma.Decimal | null; modePaiement: string | null }[]>`
    SELECT "id", "date", "fournisseurNom", "numero", "devise"::text AS "devise", "resteAPayerUSD", "resteAPayerCDF", "modePaiement"
    FROM "stock"."FactureFournisseur"
    WHERE "id" IN (${Prisma.join(ids)}) AND "statut" <> 'REGLEE' AND ("resteAPayerUSD" > 0 OR "resteAPayerCDF" > 0)
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

  // Devise versée pour chaque facture ; un taux n'est lu (refus lisible s'il manque) que si une
  // facture est payée dans l'autre devise — AVANT toute écriture.
  const verseDe = (d: DeviseFacture): DeviseFacture => (verseLot === "SA_DEVISE" ? d : verseLot);
  const taux = facs.some((f) => verseDe(f.devise) !== f.devise) ? await lireTauxReglement(tx) : null;

  // Chaque facture soldée par SON reste, dans sa devise. Versé dans l'autre devise : en francs,
  // reste × taux au franc, reconvertis par LA conversion des règlements (ce qui redonne le reste au
  // centime) ; en dollars, reste ÷ taux au centime, qui soldent à un demi-centime près (`imputation`).
  const lignes = facs.map((f) => {
    const reste = Number(f.devise === "CDF" ? f.resteAPayerCDF : f.resteAPayerUSD);
    const v = verseDe(f.devise);
    let autre: number | null = null;
    if (v !== f.devise) {
      if (f.devise === "USD") {
        autre = francsPourReste(reste, taux!);
        if (Math.abs(francsEnDollars(autre, taux!) - reste) > 0.001) throw new Error(`Taux de change de ${taux} FC pour 1 $ : le reste de ${reste.toFixed(2)} $ ne se paie pas exactement en francs — vérifiez le taux (Paramètres).`);
      } else {
        autre = dollarsPourReste(reste, taux!);
        const imp = imputation("CDF", { devise: "USD", montant: autre }, taux, reste);
        if (!(autre > 0) || !imp || imp.impute !== reste) throw new Error(`Taux de change de ${taux} FC pour 1 $ : le reste de ${formaterMontantFacture(reste, "CDF")} (${f.numero ? `${f.fournisseurNom} n° ${f.numero}` : f.fournisseurNom}) ne se paie pas en dollars — payez-le en francs.`);
      }
    }
    return { f, reste, autre };
  });

  await tx.paiement.createMany({
    data: lignes.map(({ f, autre }) => ({
      factureId: f.id, type: "PAIEMENT", devise: f.devise, date,
      // Le reste EXACT (texte décimal relu sous verrou), dans la devise de la facture.
      montantUSD: f.devise === "USD" ? f.resteAPayerUSD! : autre,
      montantCDF: f.devise === "CDF" ? f.resteAPayerCDF! : autre,
      tauxChangeUtilise: autre !== null ? taux : null,
      modePaiement: f.modePaiement, note, creeParId: userId,
    })),
  });
  const idsUSD = facs.filter((f) => f.devise === "USD").map((f) => f.id);
  const idsCDF = facs.filter((f) => f.devise === "CDF").map((f) => f.id);
  if (idsUSD.length > 0) {
    await tx.$executeRaw`
      UPDATE "stock"."FactureFournisseur"
      SET "montantRegleUSD" = "montantUSD", "resteAPayerUSD" = 0, "statut" = 'REGLEE', "datePaiement" = ${date}
      WHERE "id" IN (${Prisma.join(idsUSD)})`;
  }
  if (idsCDF.length > 0) {
    await tx.$executeRaw`
      UPDATE "stock"."FactureFournisseur"
      SET "montantRegleCDF" = "montantCDF", "resteAPayerCDF" = 0, "statut" = 'REGLEE', "datePaiement" = ${date}
      WHERE "id" IN (${Prisma.join(idsCDF)})`;
  }
  // Journal : texte d'avant pour un lot de factures en dollars ; sinon, les totaux par devise.
  const toutUSD = idsCDF.length === 0;
  const totalCDFVerse = lignes.filter((l) => l.f.devise === "USD" && l.autre !== null).reduce((t, l) => t + l.autre!, 0);
  const detail = toutUSD
    ? (verseLot === "CDF" ? ` en francs (${totalCDFVerse.toLocaleString("fr-FR")} FC au taux de ${taux})` : "")
    : ` — ${libelleTotal(lignes.reduce((t, l) => ajouterAuTotal(t, l.f.devise, l.reste), totalVide()))}${taux !== null ? ` (conversions au taux de ${taux})` : ""}`;
  await journaliser(tx, { entite: "FactureFournisseur", entiteId: "lot", champ: "statut", nouvelleValeur: `${facs.length} facture(s) réglée(s)${detail}`, userId });
  return lignes.map(({ f, reste, autre }) => ({
    factureId: f.id, fournisseurNom: f.fournisseurNom, numero: f.numero, ...(f.devise === "CDF" ? { devise: "CDF" as const } : {}),
    montant: reste, type: "PAIEMENT" as const, date: dateISO, solde: true, reste: 0,
    ...(autre !== null ? (f.devise === "USD" ? { montantCDF: autre, taux } : { montantUSD: autre, taux }) : {}),
  }));
}

// ── Notification « facture payée » ──────────────────────────────────────────
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** « facture n° 12 de SENEVE » (minuscule : placé au milieu d'une phrase, ou capitalisé en tête). */
const nomFacture = (r: { numero: string | null; fournisseurNom: string }) =>
  `${r.numero ? `facture n° ${r.numero}` : "facture sans numéro"} de ${r.fournisseurNom}`;
const capitale = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Texte de la notification d'un règlement effectif (pur, testé). */
export function messageReglements(regs: ReglementEcrit[]): string {
  // Montant dans la devise de la facture ; versé dans l'autre devise : « (280 000 FC au taux de
  // 2 800) » sur une facture en dollars, « (35,71 $ au taux de 2 800) » sur une facture en francs.
  const fm = (r: ReglementEcrit, n: number) => formaterMontantFacture(n, r.devise ?? "USD");
  const verse = (r: ReglementEcrit) => {
    const autre = (r.devise ?? "USD") === "USD" ? (r.montantCDF ? formaterFC(r.montantCDF) : null) : (r.montantUSD ? formaterUSD(r.montantUSD) : null);
    return autre ? ` (${autre}${r.taux ? ` au taux de ${formaterNombre(r.taux)}` : ""})` : "";
  };
  if (regs.length === 1) {
    const r = regs[0];
    const v = verse(r);
    if (r.type === "AVOIR") return `Avoir de ${fm(r, r.montant)}${v} sur la ${nomFacture(r)} le ${dateFr(r.date)} — ${r.solde ? "facture soldée" : `reste ${fm(r, r.reste)}`}`;
    if (r.solde) return `${capitale(nomFacture(r))} payée le ${dateFr(r.date)} — ${fm(r, r.montant)}${v}`;
    return `Paiement partiel de ${fm(r, r.montant)}${v} sur la ${nomFacture(r)} le ${dateFr(r.date)} — reste ${fm(r, r.reste)}`;
  }
  const noms = regs.map((r) => (r.numero ? `${r.fournisseurNom} n° ${r.numero}` : r.fournisseurNom)).join(", ");
  if (regs.every((r) => (r.devise ?? "USD") === "USD")) {
    // Lot de factures en dollars : le message d'avant, à l'identique.
    const total = regs.reduce((t, r) => t + r.montant, 0);
    const totalCDF = regs.every((r) => r.montantCDF) ? regs.reduce((t, r) => t + (r.montantCDF ?? 0), 0) : null;
    const enFC = totalCDF ? ` (${formaterFC(totalCDF)}${regs[0].taux ? ` au taux de ${formaterNombre(regs[0].taux)}` : ""})` : "";
    return `${regs.length} factures payées le ${dateFr(regs[0].date)} — ${formaterUSD(total)}${enFC} (${noms})`.slice(0, 480);
  }
  // Lot qui compte des factures en francs : total par devise, jamais additionné d'une devise à l'autre.
  const total = regs.reduce((t, r) => ajouterAuTotal(t, r.devise ?? "USD", r.montant), totalVide());
  const taux = regs.find((r) => r.taux)?.taux;
  return `${regs.length} factures payées le ${dateFr(regs[0].date)} — ${libelleTotal(total)}${taux ? ` (conversions au taux de ${formaterNombre(taux)})` : ""} (${noms})`.slice(0, 480);
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
