import "server-only";

// DEMANDES À VALIDER PAR LA DIRECTION (espace Stock) — création, validation, refus, retrait.
//
// Règle de Sacha (2026-09-30) : un compte qui n'est pas la Direction (ADMIN) ne paie pas une
// facture, ne réconcilie pas le stock et ne modifie pas un article : son geste crée une DEMANDE, la
// Direction la valide ou la refuse (motif). Le geste direct de la Direction, lui, n'a pas changé.
//
//  - Valider exécute le MÊME cœur d'écriture que le geste direct (reglement.ts, comptage.ts,
//    article.ts), dans UNE transaction avec le passage de la demande à VALIDEE : soit tout est
//    écrit, soit rien.
//  - Une demande périmée (facture payée entre-temps, article modifié, stock changé sans mouvement
//    qui l'explique) n'est JAMAIS exécutée « quand même » : la validation lève `ConflitDemande`, rien
//    n'est écrit, la demande reste en attente et la Direction la refuse.
//  - Les notifications partent APRÈS la transaction : jamais d'annonce d'un effet annulé.
//
// Les gardes « Direction seulement » sont ICI (défense en profondeur) ET dans les actions serveur.

import { Prisma, type Role } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import { creerNotification, supprimerNotificationsPour } from "@/lib/notifications";
import { envoyerPush } from "@/lib/push";
import { formaterFC, formaterNombre, formaterUSD } from "@/lib/montant";
import { jourKinshasaISO, lireDatePaiement } from "@/lib/date-paiement";
import {
  CHAMPS_ARTICLE, NATURE_LIBELLE, cleMouvement, type ChampArticle, type ChargeMouvement, cleArticle, cleComptage, cleFacture, fusionnerChangements, libelleValeur, lireCharge, texteDecimal, valeursEgales,
  type ArticleDemande, type ChargeArticle, type ChargeComptage, type ChargePaiement, type NatureDemande, type ReglementDemande,
} from "./charge";
import { lireTauxReglement, reglerFactureTx, reglerLotTx, notifierReglements, verrouillerFacture, type ReglementEcrit, type VerseLot } from "./reglement";
import { imputation } from "./conversion-francs";
import { deviseFacture, formaterMontantFacture, libelleTotal, montantsFacture, resteFacture, totalFactures, type DeviseFacture } from "@/lib/facture-devise";
import { apresMouvements, ecrireMouvementsTx, type MouvementSaisi } from "./mouvement";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { prixArticleEnUSDTexte } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { MESSAGE_RAISON_PERTE, estMotifSortie, origineDuMotif, type MotifSortieObligatoire } from "@/lib/motif-sortie";
import {
  aUnEcart, apresComptage, calculerLignes, ecrireComptageTx, etatLigneAValider, exigerExplications, mouvementsDepuis,
  niveauxDe, verrouillerStocks, type CompteSaisi, type Domaine,
} from "./comptage";
import { appliquerPatchArticleTx, changementsDe, exigerCategorieDuDomaine, harmoniserPrix, lireArticlesTx, nomsReferencesTx, patchDesChangements, type PatchArticle } from "./article";

type Tx = Prisma.TransactionClient;

export type Acteur = { id: string; nom: string; role: Role };
export const estDirection = (u: { role: Role }) => u.role === "ADMIN";
export const MESSAGE_RESERVE_DIRECTION = "Réservé à la Direction.";

/** Demande périmée : l'exécuter écrirait un effet faux. Rien n'est écrit ; la Direction la refuse. */
export class ConflitDemande extends Error {
  constructor(detail: string) { super(`${detail} — rien n'a été écrit : refusez cette demande (le demandeur pourra en refaire une à jour).`); }
}

const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Montant d'un message d'erreur : « 100.00 $ » (forme d'avant, inchangée) ou « 280 000 FC ». */
const montantTexte = (n: number, d: DeviseFacture) => (d === "USD" ? `${n.toFixed(2)} $` : formaterMontantFacture(n, "CDF"));
/** Montant d'un message lisible : « 100,00 $ » ou « 280 000 FC ». */
const montantTexteFr = (n: number, d: DeviseFacture) => formaterMontantFacture(n, d);
const nomFacture = (f: { numero: string | null; fournisseurNom: string }) => `${f.numero ? `facture n° ${f.numero}` : "facture sans numéro"} de ${f.fournisseurNom}`;

// ── Création ────────────────────────────────────────────────────────────────
const MESSAGE_CIBLE_PRISE = "Une demande vient d'être déposée pour le même élément : rechargez la page.";

/** Une erreur brute de la base pendant une validation devient un message lisible (rien n'est écrit). */
function traduireErreurBase(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientValidationError) {
    throw new Error("La base a refusé l'écriture (référence disparue ou valeur hors limites) — rien n'a été écrit : refusez cette demande.");
  }
  throw e;
}

/** Une violation de la clé des cibles (deux demandes simultanées) devient un message lisible. */
export function traduireConflitCible(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new Error(MESSAGE_CIBLE_PRISE);
  throw e;
}

async function exigerCiblesLibres(tx: Tx, cles: string[], quoi: (cle: string) => string) {
  if (cles.length === 0) return;
  const prises = await tx.cibleDemandeStock.findMany({ where: { cle: { in: cles } }, include: { demande: { select: { resume: true, auteurNom: true } } } });
  if (prises.length > 0) {
    const p = prises[0];
    throw new Error(`${quoi(p.cle)} : une demande est déjà en attente de la Direction (« ${p.demande.resume} », ${p.demande.auteurNom}).`);
  }
}

async function creerDemandeTx(tx: Tx, p: { nature: NatureDemande; resume: string; charge: ChargePaiement | ChargeComptage | ChargeArticle; cles: string[]; auteur: Acteur }) {
  // La charge doit se relire EXACTEMENT comme elle sera relue à la validation : une charge que
  // `lireCharge` refuserait ne doit jamais être enregistrée (elle bloquerait sa cible pour rien).
  lireCharge(p.nature, JSON.parse(JSON.stringify(p.charge)));
  const d = await tx.demandeValidationStock.create({
    data: {
      nature: p.nature, resume: p.resume.slice(0, 480), charge: p.charge as unknown as Prisma.InputJsonValue,
      auteurId: p.auteur.id, auteurNom: p.auteur.nom,
      cibles: { create: p.cles.map((cle) => ({ cle })) },
    },
  });
  await journaliser(tx, { entite: "DemandeValidationStock", entiteId: d.id, champ: "creation", nouvelleValeur: `${p.nature} — ${d.resume}`, userId: p.auteur.id });
  return d;
}

/**
 * Effets APRÈS la transaction (notifications, alertes, journal secondaire) : la décision est déjà
 * écrite. Un échec ici (e-mail, push, base momentanément indisponible) est consigné, jamais relancé :
 * sinon l'écran annoncerait « non traitée » une demande bel et bien validée.
 */
export async function apresCommit(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { console.error("[validations-stock] effet après validation en échec :", e); }
}

/** Cloche + e-mail + push à la Direction (même patron que les bons de commande à valider). */
async function notifierNouvelleDemande(d: { id: string; resume: string; auteurNom: string }) {
  await creerNotification({ domaine: "STOCK", type: "AUTRE", message: `À valider — ${d.resume} (${d.auteurNom})`.slice(0, 480), lien: "/stock/a-valider", refId: d.id });
}

// ── Paiement de facture ─────────────────────────────────────────────────────
export type DemandePaiementSaisie =
  | { mode: "SOLDE"; factureId: string; dateStr?: string }
  | { mode: "LOT"; factureIds: string[]; dateStr?: string; enFrancs?: boolean; verse?: VerseLot }
  | { mode: "REGLEMENT"; factureId: string; dateStr?: string; reglement: ReglementDemande };

/**
 * Demande de paiement (compte non-Direction) : rien n'est payé. Les factures sont relues sous
 * verrou ; mêmes contrôles que le geste direct (date de paiement, montant ≤ reste) pour que la
 * demande ne soit pas refusée à la validation pour une faute de saisie visible dès maintenant.
 * Une facture déjà réglée n'entre pas dans une demande de lot (comme le lot direct l'exclut).
 */
export async function demanderPaiement(auteur: Acteur, s: DemandePaiementSaisie): Promise<{ demandeId: string; nbFactures: number; demandees: number }> {
  const ids = s.mode === "LOT" ? [...new Set(s.factureIds.map(String))].filter(Boolean) : [s.factureId];
  if (ids.length === 0) throw new Error("Aucune facture sélectionnée.");
  const d = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "stock"."FactureFournisseur" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
    // Ordre de la sélection (jamais l'ordre physique de la base) : le résumé se relit à l'identique.
    const facs = (await tx.factureFournisseur.findMany({ where: { id: { in: ids } } })).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    const aRegler = facs.filter((f) => f.statut !== "REGLEE" && resteFacture(f) > 0.001);
    if (aRegler.length === 0) throw new Error(ids.length > 1 ? "Aucune de ces factures n'est à régler." : "Cette facture est déjà réglée.");
    const maintenant = new Date();
    for (const f of aRegler) {
      try { lireDatePaiement(s.dateStr, f.date, maintenant); } catch (e) {
        throw new Error(s.mode === "LOT" ? `${f.numero ? `${f.fournisseurNom} (n° ${f.numero})` : f.fournisseurNom} : ${e instanceof Error ? e.message : "date invalide"}` : e instanceof Error ? e.message : "Date de paiement invalide.");
      }
    }
    const date = lireDatePaiement(s.dateStr, null, maintenant);
    if (s.mode === "REGLEMENT") {
      // Versé dans l'autre devise que la facture : contrôle avec le taux d'AUJOURD'HUI (indicatif) —
      // la validation reconvertit au taux de son jour et recontrôle.
      const m = montantsFacture(aRegler[0]);
      const verse = s.reglement.montantCDF !== null ? { devise: "CDF" as const, montant: Number(s.reglement.montantCDF) } : { devise: "USD" as const, montant: Number(s.reglement.montantUSD) };
      if (!(verse.montant > 0)) throw new Error("Le montant doit être supérieur à 0.");
      if (Math.abs(verse.montant * 100 - Math.round(verse.montant * 100)) > 1e-6) throw new Error("Le montant se saisit au centime près (deux décimales au plus).");
      const imp = imputation(m.devise, verse, verse.devise !== m.devise ? await lireTauxReglement(tx) : null, m.reste)!;
      if (imp.depasse) throw new Error(`Le ${s.reglement.type === "AVOIR" ? "montant de l'avoir" : "paiement"} (${montantTexte(imp.impute, m.devise)}) dépasse le reste à payer (${montantTexte(m.reste, m.devise)}).`);
    }
    await exigerCiblesLibres(tx, aRegler.map((f) => cleFacture(f.id)), (cle) => {
      const f = aRegler.find((x) => cleFacture(x.id) === cle);
      return f ? `${nomFacture(f).charAt(0).toUpperCase()}${nomFacture(f).slice(1)}` : "Facture";
    });
    const verseLot: VerseLot = s.mode === "LOT" ? (s.verse ?? (s.enFrancs ? "CDF" : "USD")) : "USD";
    const charge: ChargePaiement = {
      v: 1, mode: s.mode, date,
      factures: aRegler.map((f) => {
        const m = montantsFacture(f);
        return m.devise === "CDF"
          ? { id: f.id, fournisseurNom: f.fournisseurNom, numero: f.numero, devise: "CDF" as const, resteCDF: m.resteTexte }
          : { id: f.id, fournisseurNom: f.fournisseurNom, numero: f.numero, resteUSD: m.resteTexte };
      }),
      reglement: s.mode === "REGLEMENT" ? s.reglement : null,
      ...(s.mode === "LOT" && verseLot === "CDF" ? { enFrancs: true as const } : {}),
      ...(s.mode === "LOT" && verseLot === "SA_DEVISE" ? { saDevise: true as const } : {}),
    };
    const total = totalFactures(aRegler, "reste");
    const toutUSD = total.nbCDF === 0;
    const lotFC = s.mode === "LOT" && verseLot === "CDF";
    // Une facture payée dans l'autre devise : le taux est celui de la VALIDATION ; il doit exister dès la demande (refus lisible).
    if (s.mode === "LOT" && aRegler.some((f) => (verseLot === "SA_DEVISE" ? deviseFacture(f) : verseLot) !== deviseFacture(f))) await lireTauxReglement(tx);
    const noms = aRegler.map((f) => (f.numero ? `${f.fournisseurNom} n° ${f.numero}` : f.fournisseurNom)).join(", ");
    const resume =
      lotFC && toutUSD
        ? `Payer ${aRegler.length > 1 ? `${aRegler.length} factures` : `la ${nomFacture(aRegler[0])}`} en francs le ${dateFr(date)} — ${formaterUSD(total.usd)} en FC au taux du jour de la validation${aRegler.length > 1 ? ` (${noms})` : ""}`
        : s.mode === "LOT" && !toutUSD
        // Lot qui compte des factures en francs : total par devise ; la devise versée est dite.
        ? `Payer ${aRegler.length > 1 ? `${aRegler.length} factures` : `la ${nomFacture(aRegler[0])}`} le ${dateFr(date)} — ${libelleTotal(total)}, ${verseLot === "SA_DEVISE" ? "chacune dans sa devise" : verseLot === "CDF" ? "versé en francs (au taux du jour de la validation)" : "versé en dollars (au taux du jour de la validation)"}${aRegler.length > 1 ? ` (${noms})` : ""}`
        : s.mode === "LOT" && aRegler.length > 1
        ? `Payer ${aRegler.length} factures le ${dateFr(date)} — ${formaterUSD(total.usd)} (${noms})`
        : s.mode === "REGLEMENT"
          ? `${s.reglement.type === "AVOIR" ? "Avoir" : "Paiement"} de ${s.reglement.montantCDF !== null ? formaterFC(Number(s.reglement.montantCDF)) : formaterUSD(Number(s.reglement.montantUSD))} sur la ${nomFacture(aRegler[0])} le ${dateFr(date)}`
          : `Payer la ${nomFacture(aRegler[0])} le ${dateFr(date)} — ${libelleTotal(total)}`;
    return creerDemandeTx(tx, { nature: "PAIEMENT_FACTURE", resume, charge, cles: aRegler.map((f) => cleFacture(f.id)), auteur });
  }).catch(traduireConflitCible);
  await apresCommit(() => notifierNouvelleDemande(d));
  const charge = lireCharge("PAIEMENT_FACTURE", d.charge);
  return { demandeId: d.id, nbFactures: charge.factures.length, demandees: ids.length };
}

/** Refuse le geste direct de la Direction sur une facture dont un paiement est déjà demandé. */
export async function exigerAucunPaiementDemande(client: Tx | typeof prisma, factureIds: string[]) {
  const prises = await client.cibleDemandeStock.findMany({ where: { cle: { in: factureIds.map(cleFacture) } }, include: { demande: { select: { resume: true, auteurNom: true } } } });
  if (prises.length > 0) {
    throw new Error(`Un paiement est déjà demandé (« ${prises[0].demande.resume} », ${prises[0].demande.auteurNom}) : validez ou refusez cette demande dans « Demandes à valider », pour ne pas régler deux fois.`);
  }
}

async function executerPaiementTx(tx: Tx, decideur: Acteur, d: { auteurNom: string }, c: ChargePaiement, dateCorrigee?: string): Promise<ReglementEcrit[]> {
  const date = dateCorrigee?.trim() || c.date;
  const courantes = new Map<string, { devise: "USD" | "CDF"; reste: number }>();
  // Verrous pris dans un ordre fixe (par id) : pas d'interblocage avec un lot concurrent.
  for (const f of [...c.factures].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const existe = await tx.factureFournisseur.findUnique({ where: { id: f.id }, select: { id: true } });
    if (!existe) throw new ConflitDemande(`La ${nomFacture(f)} a été supprimée depuis la demande`);
    const cur = await verrouillerFacture(tx, f.id);
    const m = montantsFacture(cur);
    if (cur.statut === "REGLEE" || m.reste <= 0.001) throw new ConflitDemande(`La ${nomFacture(f)} a déjà été réglée depuis la demande`);
    // Jeton : la devise et le reste VUS par le demandeur, dans la devise de la facture.
    const deviseVue = f.devise === "CDF" ? "CDF" : "USD";
    const resteVu = f.devise === "CDF" ? f.resteCDF : f.resteUSD;
    if (m.devise !== deviseVue) throw new ConflitDemande(`La devise de la ${nomFacture(f)} a changé depuis la demande`);
    if (!new Decimal(m.resteTexte).equals(new Decimal(resteVu))) {
      throw new ConflitDemande(`Le reste à payer de la ${nomFacture(f)} a changé depuis la demande (${montantTexteFr(Number(resteVu), m.devise)} → ${montantTexteFr(m.reste, m.devise)})`);
    }
    courantes.set(f.id, { devise: m.devise, reste: m.reste });
  }
  const trace = `demandé par ${d.auteurNom}, validé par ${decideur.nom}`;
  if (c.mode === "SOLDE") {
    const f = c.factures[0];
    // Le reste, dans la devise de la facture (vérifié ci-dessus : celui que le demandeur a vu).
    return [await reglerFactureTx(tx, decideur.id, f.id, { dateStr: date, note: `Marquée payée (${trace})` })];
  }
  if (c.mode === "LOT") {
    const verse: VerseLot = c.saDevise ? "SA_DEVISE" : c.enFrancs ? "CDF" : "USD";
    const regs = await reglerLotTx(tx, decideur.id, c.factures.map((f) => f.id), date, `Marquée payée (lot${c.enFrancs ? " en francs" : c.saDevise ? " dans la devise de chaque facture" : ""} — ${trace})`, { verse });
    if (regs.length !== c.factures.length) throw new ConflitDemande("Une facture du lot n'est plus à régler");
    return regs;
  }
  const r = c.reglement!;
  const cur = courantes.get(c.factures[0].id)!;
  const verse = r.montantCDF !== null ? { devise: "CDF" as const, montant: Number(r.montantCDF) } : { devise: "USD" as const, montant: Number(r.montantUSD) };
  // Versé dans l'autre devise : conversion au taux des Paramètres MAINTENANT, comme le paiement direct
  // de ce jour. À ce taux, le versement vaut peut-être plus que le reste : la demande est périmée.
  if (verse.devise !== cur.devise) {
    const taux = await lireTauxReglement(tx);
    const imp = imputation(cur.devise, verse, taux, cur.reste)!;
    if (imp.depasse) {
      throw new ConflitDemande(`Au taux de ce jour (${formaterNombre(taux)} FC/$), ${montantTexteFr(verse.montant, verse.devise)} font ${montantTexteFr(imp.impute, cur.devise)} : plus que le reste à payer (${montantTexteFr(cur.reste, cur.devise)})`);
    }
  }
  return [await reglerFactureTx(tx, decideur.id, c.factures[0].id, { verse, dateStr: date, mode: r.modePaiement, note: r.note, type: r.type })];
}

// ── Réconciliation ──────────────────────────────────────────────────────────
export type ResultatComptage =
  | { applique: true; sessionId: string; nbEcarts: number; nbHorsTol: number }
  | { applique: false; demandeId: string; nbEcarts: number; nbHorsTol: number };

/**
 * Applique un comptage (Direction, ou comptage SANS écart : rien à ajuster) ou le soumet à la
 * Direction (autre compte, au moins un écart). Tout se décide dans UNE transaction, stocks
 * verrouillés : un écart qui apparaîtrait pendant la saisie ne peut pas passer sans validation.
 */
export async function appliquerOuDemanderComptage(user: Acteur, saisie: { comptes: CompteSaisi[]; domaine: Domaine | null; origine: string }): Promise<ResultatComptage> {
  const { comptes, domaine, origine } = saisie;
  if (comptes.length === 0) throw new Error("Saisissez au moins un comptage physique.");
  const ids = comptes.map((c) => c.articleId);
  const doublon = ids.find((id, i) => ids.indexOf(id) !== i);
  const r = await prisma.$transaction(async (tx) => {
    const stocks = await verrouillerStocks(tx, ids);
    const articles = await tx.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true, designation: true, unite: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true } });
    const theo = new Map(stocks.map((s) => [s.articleId, Number(s.quantite)]));
    const theoTexte = new Map(stocks.map((s) => [s.articleId, s.quantite.toString()]));
    const noms = new Map(articles.map((a) => [a.id, a.designation]));
    // Un article compté deux fois : lequel des deux chiffres est le bon ? Refus, jamais un choix au hasard.
    if (doublon) throw new Error(`« ${noms.get(doublon) ?? "Un article"} » est compté deux fois : gardez une seule ligne.`);
    // Direction : un comptage direct sur un article dont une réconciliation attend sa décision rendrait
    // cette demande inapplicable (« autre ajustement depuis ») sans qu'elle le sache — elle la tranche d'abord.
    // Même règle pour un MOUVEMENT MANUEL en attente : validé après ce comptage, il retrancherait une
    // quantité que le comptage a peut-être déjà constatée (stock 10, sortie de 3 demandée, comptage
    // à 7, puis validation de la sortie → 4). La Direction tranche d'abord la demande. (Depuis le
    // 2026-10-07, plus aucune demande de mouvement n'est créée : la règle ne vise que les anciennes.)
    if (estDirection(user)) {
      const cles = [...ids.map(cleComptage), ...ids.map(cleMouvement)];
      const prises = await tx.cibleDemandeStock.findMany({ where: { cle: { in: cles } }, include: { demande: { select: { resume: true, auteurNom: true, nature: true } } } });
      if (prises.length > 0) {
        const p = prises[0];
        const art = noms.get(p.cle.slice(p.cle.indexOf(":") + 1)) ?? "Un article";
        const quoi = p.demande.nature === "MOUVEMENT_MANUEL" ? "d'un mouvement manuel" : "d'une réconciliation";
        throw new Error(`« ${art} » fait partie ${quoi} en attente de votre décision (« ${p.demande.resume} », ${p.demande.auteurNom}) : validez-la ou refusez-la d'abord dans « Demandes à valider ».`);
      }
    }
    const niveauxAvant = niveauxDe(stocks);
    const lignes = calculerLignes(comptes, theo, noms);
    exigerExplications(lignes);
    const nbEcarts = lignes.filter(aUnEcart).length;
    const nbHorsTol = lignes.filter((l) => l.horsTol).length;

    if (estDirection(user) || nbEcarts === 0) {
      const e = await ecrireComptageTx(tx, user.id, { domaine, origine, lignes: lignes.map((l) => ({ ...l, stockFinal: texteDecimal(l.physique) })) });
      return { applique: true as const, sessionId: e.session.id, nbEcarts, nbHorsTol, niveauxAvant };
    }

    const parId = new Map(articles.map((a) => [a.id, a]));
    const taux = await tauxDuJour(tx);
    const charge: ChargeComptage = {
      v: 1, domaine, origine,
      lignes: lignes.map((l) => ({
        articleId: l.articleId, designation: l.designation, unite: parId.get(l.articleId)?.unite ?? null,
        theorique: theoTexte.get(l.articleId) ?? "0", physique: texteDecimal(l.physique), explication: l.explication,
        // Valeur des écarts (affichage à la Direction) : un article en francs au taux du jour, « — » sans taux.
        prixUnitaireUSD: (() => { const a = parId.get(l.articleId); return a ? prixArticleEnUSDTexte(a, taux)?.valeur ?? null : null; })(),
      })),
    };
    const avecEcart = lignes.filter(aUnEcart);
    await exigerCiblesLibres(tx, avecEcart.map((l) => cleComptage(l.articleId)), (cle) => `« ${avecEcart.find((l) => cleComptage(l.articleId) === cle)?.designation ?? "Article"} »`);
    const resume = `${origine} — ${nbEcarts} écart(s)${nbHorsTol ? `, dont ${nbHorsTol} hors tolérance` : ""} sur ${lignes.length} article(s) compté(s)`;
    const d = await creerDemandeTx(tx, { nature: "RECONCILIATION", resume, charge, cles: avecEcart.map((l) => cleComptage(l.articleId)), auteur: user });
    return { applique: false as const, demande: d, nbEcarts, nbHorsTol };
  }, { timeout: 60000 }).catch(traduireConflitCible);

  if (r.applique) {
    await apresCommit(async () => {
      await apresComptage({ sessionId: r.sessionId, nbHorsTol: r.nbHorsTol, articleIds: ids, niveauxAvant: r.niveauxAvant });
      await journaliser(prisma, { entite: "SessionComptage", entiteId: r.sessionId, champ: "comptage", nouvelleValeur: `${r.nbEcarts} écart(s), ${r.nbHorsTol} hors tolérance`, userId: user.id });
    });
    return { applique: true, sessionId: r.sessionId, nbEcarts: r.nbEcarts, nbHorsTol: r.nbHorsTol };
  }
  await apresCommit(() => notifierNouvelleDemande(r.demande));
  return { applique: false, demandeId: r.demande.id, nbEcarts: r.nbEcarts, nbHorsTol: r.nbHorsTol };
}

async function executerComptageTx(tx: Tx, decideur: Acteur, d: { createdAt: Date; auteurId: string }, c: ChargeComptage) {
  const ids = c.lignes.map((l) => l.articleId);
  const existants = new Set((await tx.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((a) => a.id));
  const disparus = c.lignes.filter((l) => !existants.has(l.articleId));
  if (disparus.length > 0) throw new ConflitDemande(`${disparus.map((l) => `« ${l.designation} »`).join(", ")} n'existe(nt) plus (supprimé ou fusionné depuis le comptage)`);
  const stocks = await verrouillerStocks(tx, ids);
  const actuel = new Map(stocks.map((s) => [s.articleId, new Decimal(s.quantite.toString())]));
  const theo = new Map(c.lignes.map((l) => [l.articleId, Number(l.theorique)]));
  const noms = new Map(c.lignes.map((l) => [l.articleId, l.designation]));
  const calculees = calculerLignes(c.lignes.map((l) => ({ articleId: l.articleId, physique: Number(l.physique), explication: l.explication })), theo, noms);
  const depuis = await mouvementsDepuis(tx, calculees.filter(aUnEcart).map((l) => l.articleId), d.createdAt);
  const conflits: string[] = [];
  const lignes = calculees.map((l, i) => {
    const a = actuel.get(l.articleId) ?? new Decimal(0);
    if (!aUnEcart(l)) return { ...l, stockFinal: a.toString() }; // rien à ajuster : le stock actuel est gardé
    const e = etatLigneAValider(c.lignes[i], a, depuis.get(l.articleId)!);
    if (e.etat === "conflit") { conflits.push(`« ${l.designation} » : ${e.raison}`); return { ...l, stockFinal: a.toString() }; }
    return { ...l, stockFinal: e.final.toString() };
  });
  if (conflits.length > 0) throw new ConflitDemande(`Le stock a bougé depuis le comptage — ${conflits.join(" ; ")}. Il faut recompter ces articles`);
  const niveauxAvant = niveauxDe(stocks);
  // L'archive dit la vérité du comptage : QUI a compté (le demandeur) et QUAND (jour de la demande).
  // La validation par la Direction est au journal d'audit et sur la demande.
  const e = await ecrireComptageTx(tx, d.auteurId, { domaine: c.domaine, origine: c.origine, lignes, date: new Date(`${jourKinshasaISO(d.createdAt)}T00:00:00.000Z`) });
  return { sessionId: e.session.id, nbEcarts: e.nbEcarts, nbHorsTol: e.nbHorsTol, articleIds: ids, niveauxAvant };
}

// ── Modification d'article ──────────────────────────────────────────────────
function resumeArticles(articles: ArticleDemande[]): string {
  const champs = [...new Set(articles.flatMap((a) => a.changements.map((c) => CHAMPS_ARTICLE[c.champ].libelle)))];
  if (articles.length === 1) {
    const a = articles[0];
    if (a.changements.length === 1) { const c = a.changements[0]; return `« ${a.designation} » : ${CHAMPS_ARTICLE[c.champ].libelle} ${c.avantLibelle} → ${c.apresLibelle}`; }
    return `« ${a.designation} » : ${champs.join(", ")}`;
  }
  const uniques = new Set(articles.map((a) => a.changements.map((c) => `${c.champ}=${c.apresLibelle}`).join("|")));
  if (uniques.size === 1 && articles[0].changements.length === 1) {
    const c = articles[0].changements[0];
    return `${articles.length} articles : ${CHAMPS_ARTICLE[c.champ].libelle} → ${c.apresLibelle}`;
  }
  return `${articles.length} articles : ${champs.join(", ")}`;
}

/**
 * Références d'une proposition vérifiées DÈS LA SAISIE (refus lisible), plutôt qu'à la validation :
 * catégorie et fournisseur existants ; désignation et code qui ne doublonnent pas un autre article.
 */
async function exigerReferencesValides(tx: Tx, articles: ArticleDemande[], noms: { categories: Map<string, string>; fournisseurs: Map<string, string> }) {
  const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
  let autres: { id: string; designation: string; code: string | null }[] | null = null;
  for (const a of articles) {
    for (const c of a.changements) {
      if (c.champ === "designation" && !String(c.apres ?? "").trim()) throw new Error(`« ${a.designation} » : la désignation ne peut pas être vide.`);
      if (c.champ === "categorieId" && c.apres && !noms.categories.has(String(c.apres))) throw new Error(`« ${a.designation} » : catégorie introuvable — rechargez la page.`);
      if (c.champ === "fournisseurId" && c.apres && !noms.fournisseurs.has(String(c.apres))) throw new Error(`« ${a.designation} » : fournisseur introuvable — rechargez la page.`);
      if ((c.champ === "designation" || c.champ === "code") && c.apres) {
        autres ??= await tx.articleStock.findMany({ select: { id: true, designation: true, code: true } });
        const v = norm(String(c.apres));
        const doublon = autres.find((x) => x.id !== a.id && (c.champ === "designation" ? norm(x.designation) === v : x.code !== null && norm(x.code) === v));
        if (doublon) throw new Error(c.champ === "designation" ? `Un autre article s'appelle déjà « ${doublon.designation} » : choisissez une autre désignation (ou demandez une fusion à la Direction).` : `Le code « ${String(c.apres)} » est déjà celui de « ${doublon.designation} ».`);
      }
    }
  }
}

export type ResultatProposition = { rien: true } | { rien: false; demandeId: string; nbArticles: number; fusionnee: boolean };

/**
 * Propose des modifications d'articles (compte non-Direction) : rien ne change sur les articles.
 * Un champ inchangé n'est pas proposé ; si rien ne change, rien n'est créé. Un article qui a déjà
 * une proposition en attente d'un AUTRE compte est refusé en le nommant ; celle du MÊME auteur
 * reçoit les nouveaux changements (une retouche avant décision ne crée pas une seconde demande).
 */
export async function proposerModifications(auteur: Acteur, libelle: string, patchs: { id: string; patch: PatchArticle }[]): Promise<ResultatProposition> {
  const r = await prisma.$transaction(async (tx) => {
    const ids = [...new Set(patchs.map((p) => p.id))];
    const etats = await lireArticlesTx(tx, ids);
    const manquant = ids.find((id) => !etats.has(id));
    if (manquant) throw new Error("Article introuvable : rechargez la page.");
    // Domaine changé : catégorie du nouveau domaine, ou « à classer » — refus dès la proposition.
    for (const p of patchs) await exigerCategorieDuDomaine(tx, p.id, p.patch);
    const noms = await nomsReferencesTx(tx);

    // Propositions déjà en attente sur ces articles : celles d'un AUTRE compte bloquent ; celles du
    // MÊME auteur recevront la retouche (y compris un retour à la valeur d'origine, qui retire le
    // champ de la proposition : on compare alors à ce qui est PROPOSÉ, pas seulement à l'article).
    const prises = await tx.cibleDemandeStock.findMany({ where: { cle: { in: ids.map(cleArticle) } }, include: { demande: true } });
    const autre = prises.find((p) => p.demande.auteurId !== auteur.id);
    if (autre) {
      const e = etats.get(autre.cle.slice(cleArticle("").length));
      throw new Error(`« ${e?.designation ?? "Article"} » a déjà une proposition en attente (${autre.demande.auteurNom}) : attendez la décision de la Direction.`);
    }
    const dejaProposes = new Map<string, Set<ChampArticle>>();
    for (const p of prises) {
      const c = lireCharge("MODIF_ARTICLE", p.demande.charge);
      for (const a of c.articles) dejaProposes.set(a.id, new Set(a.changements.map((x) => x.champ)));
    }
    const articles: ArticleDemande[] = patchs
      .map(({ id, patch }) => { const e = etats.get(id)!; return { id, designation: e.designation, changements: changementsDe(e, patch, noms, dejaProposes.get(id)) }; })
      .filter((a) => a.changements.length > 0);
    if (articles.length === 0) return { rien: true as const };
    await exigerReferencesValides(tx, articles, noms);

    // Retouche d'une proposition du même auteur : fusion dans SA demande en attente.
    let fusionnee: string | null = null;
    const annulees: string[] = [];
    const retouchees: { id: string; resume: string; auteurNom: string }[] = [];
    const restants = new Map(articles.map((a) => [a.id, a]));
    for (const demandeId of [...new Set(prises.filter((p) => restants.has(p.cle.slice(cleArticle("").length))).map((p) => p.demandeId))].sort()) {
      await tx.$queryRaw`SELECT "id" FROM "stock"."DemandeValidationStock" WHERE "id" = ${demandeId} FOR UPDATE`;
      const dem = await tx.demandeValidationStock.findUniqueOrThrow({ where: { id: demandeId } });
      // La cible a été lue AVANT le verrou : la Direction a pu décider entre-temps. Une demande
      // décidée ne se retouche jamais (sinon la retouche serait perdue, ou le statut réécrit).
      if (dem.statut !== "EN_ATTENTE") throw new Error("Votre proposition vient d'être décidée par la Direction : rechargez la page, puis refaites la modification si elle est toujours utile.");
      const charge = lireCharge("MODIF_ARTICLE", dem.charge);
      const vides: string[] = [];
      for (const art of charge.articles) {
        const nouveau = restants.get(art.id);
        if (!nouveau) continue;
        art.changements = fusionnerChangements(art.changements, nouveau.changements);
        // Retouche fusionnée : domaine et catégorie relus ENSEMBLE (un domaine proposé avant, une catégorie
        // de l'ancien domaine proposée après, ne doivent pas faire une proposition invalidable).
        await exigerCategorieDuDomaine(tx, art.id, patchDesChangements(art.changements));
        if (art.changements.length === 0) vides.push(art.id);
        restants.delete(art.id);
      }
      charge.articles = charge.articles.filter((a) => !vides.includes(a.id));
      if (vides.length) await tx.cibleDemandeStock.deleteMany({ where: { cle: { in: vides.map(cleArticle) } } });
      if (charge.articles.length === 0) {
        await tx.demandeValidationStock.update({ where: { id: demandeId }, data: { statut: "ANNULEE", decideLe: new Date() } });
        annulees.push(demandeId);
      } else {
        await tx.demandeValidationStock.update({ where: { id: demandeId }, data: { charge: charge as unknown as Prisma.InputJsonValue, resume: resumeArticles(charge.articles).slice(0, 480) } });
      }
      await journaliser(tx, { entite: "DemandeValidationStock", entiteId: demandeId, champ: "retouche", nouvelleValeur: charge.articles.length ? resumeArticles(charge.articles) : "plus rien à proposer (annulée)", userId: auteur.id });
      fusionnee = demandeId;
      if (charge.articles.length > 0) retouchees.push({ id: demandeId, resume: resumeArticles(charge.articles), auteurNom: dem.auteurNom });
    }
    const nouveaux = [...restants.values()];
    if (nouveaux.length === 0) return { rien: false as const, demandeId: fusionnee!, nbArticles: articles.length, fusionnee: true, nouvelle: null, annulees, retouchees };
    const charge: ChargeArticle = { v: 1, libelle, articles: nouveaux };
    const d = await creerDemandeTx(tx, { nature: "MODIF_ARTICLE", resume: resumeArticles(nouveaux), charge, cles: nouveaux.map((a) => cleArticle(a.id)), auteur });
    return { rien: false as const, demandeId: d.id, nbArticles: articles.length, fusionnee: fusionnee !== null, nouvelle: d, annulees, retouchees };
  }).catch(traduireConflitCible);

  if (r.rien) return { rien: true };
  await apresCommit(async () => {
    for (const id of r.annulees) await supprimerNotificationsPour(id);
    // Retouche : la cloche de la Direction montre le contenu À JOUR de la proposition.
    for (const d of r.retouchees) { await supprimerNotificationsPour(d.id); await notifierNouvelleDemande(d); }
    if (r.nouvelle) await notifierNouvelleDemande(r.nouvelle);
  });
  return { rien: false, demandeId: r.demandeId, nbArticles: r.nbArticles, fusionnee: r.fusionnee };
}

async function executerModifArticleTx(tx: Tx, decideur: Acteur, c: ChargeArticle) {
  const ids = c.articles.map((a) => a.id);
  const etats = await lireArticlesTx(tx, ids, true);
  const noms = await nomsReferencesTx(tx);
  const conflits: string[] = [];
  for (const a of c.articles) {
    const e = etats.get(a.id);
    if (!e) { conflits.push(`« ${a.designation} » n'existe plus`); continue; }
    for (const ch of a.changements) {
      const actuel = e.valeurs[ch.champ];
      if (!valeursEgales(ch.champ, actuel, ch.avant)) {
        const lib = ch.champ === "categorieId" ? (actuel ? noms.categories.get(String(actuel)) ?? "?" : "— à classer —")
          : ch.champ === "fournisseurId" ? (actuel ? noms.fournisseurs.get(String(actuel)) ?? "?" : "—") : libelleValeur(ch.champ, actuel);
        conflits.push(`« ${a.designation} » — ${CHAMPS_ARTICLE[ch.champ].libelle} a changé depuis la proposition (${ch.avantLibelle} → aujourd'hui ${lib})`);
      }
      if (ch.champ === "categorieId" && ch.apres && !noms.categories.has(String(ch.apres))) conflits.push(`« ${a.designation} » — la catégorie proposée n'existe plus`);
      if (ch.champ === "fournisseurId" && ch.apres && !noms.fournisseurs.has(String(ch.apres))) conflits.push(`« ${a.designation} » — le fournisseur proposé n'existe plus`);
    }
  }
  if (conflits.length > 0) throw new ConflitDemande(conflits.join(" ; "));
  for (const a of c.articles) {
    // Prix dans une devise que l'article n'a plus (la Direction l'a changée depuis) : demande périmée.
    try { harmoniserPrix(etats.get(a.id)!.valeurs.devisePrix === "CDF" ? "CDF" : "USD", patchDesChangements(a.changements)); }
    catch (e) { throw new ConflitDemande(`« ${a.designation} » — ${e instanceof Error ? e.message : "prix incohérent avec la devise de l'article"}`); }
    // Approbation : seul un doublon CERTAIN apparu depuis la proposition bloque ; un nom proche, la Direction le voit et tranche.
    await appliquerPatchArticleTx(tx, a.id, patchDesChangements(a.changements), { renommerQuandMeme: true });
    await journaliser(tx, { entite: "ArticleStock", entiteId: a.id, champ: "modification (proposition validée)", nouvelleValeur: a.changements.map((ch) => `${CHAMPS_ARTICLE[ch.champ].libelle} : ${ch.avantLibelle} → ${ch.apresLibelle}`).join(" ; ").slice(0, 900), userId: decideur.id });
  }
}

// ── Entrée / sortie manuelle (ANCIENNES demandes) ──────────────────────────────
// Depuis le 2026-10-07, une entrée/sortie manuelle est écrite tout de suite pour tout compte Stock et
// notifiée à la Direction (mouvement.ts → appliquerMouvementManuel) : plus aucune demande
// MOUVEMENT_MANUEL n'est créée. Celles déposées avant restent en attente et se décident comme avant
// (valider = le même mouvement que le geste direct ; refuser = rien d'écrit) : rien ne les efface.

/** Motif choisi par la Direction en validant une ancienne demande de SORTIE (elles n'en portaient pas). */
export type MotifValidation = { categorie: string; raison?: string | null };

/**
 * Validation : le MÊME mouvement que le geste direct (quantités telles que saisies, date saisie).
 * Une SORTIE prend le motif choisi par la Direction à la validation : depuis le 2026-10-07, aucune
 * sortie ne s'écrit sans motif, et les anciennes demandes de sortie n'en portaient jamais.
 */
async function executerMouvementTx(tx: Tx, d: { auteurId: string; createdAt: Date }, c: ChargeMouvement, motifChoisi?: MotifValidation) {
  let categorieSortie: MotifSortieObligatoire | null = null;
  let raisonSortie = c.raisonSortie;
  let origine = c.origine;
  if (c.type === "SORTIE") {
    if (!motifChoisi || !estMotifSortie(motifChoisi.categorie)) throw new Error("Choisissez le motif de cette sortie (« Livraison restaurant » ou « Perte ») avant de la valider : une sortie sans motif n'est plus acceptée. Rien n'a été écrit.");
    categorieSortie = motifChoisi.categorie;
    raisonSortie = categorieSortie === "PERTE" ? String(motifChoisi.raison ?? "").trim() || null : null;
    if (categorieSortie === "PERTE" && !raisonSortie) throw new Error(MESSAGE_RAISON_PERTE);
    // Le libellé automatique d'une sortie sans motif devient celui du motif choisi ; un libellé saisi reste.
    if (origine === "Sortie / consommation") origine = origineDuMotif(categorieSortie, raisonSortie);
  }
  const date = new Date(c.date);
  await exigerPeriodeOuverte(date);
  const ids = c.lignes.map((l) => l.articleId);
  const existants = new Set((await tx.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((a) => a.id));
  const disparus = c.lignes.filter((l) => !existants.has(l.articleId));
  if (disparus.length > 0) throw new ConflitDemande(`${disparus.map((l) => `« ${l.designation} »`).join(", ")} n'existe(nt) plus (supprimé ou fusionné depuis la demande)`);
  const stocks = await verrouillerStocks(tx, ids);
  // Un comptage (ou tout ajustement) depuis la demande a pu constater ce mouvement : l'écrire en plus
  // le compterait deux fois (stock 10, sortie de 3 demandée, comptage à 7 → 4). Refus, à redemander.
  const depuis = await mouvementsDepuis(tx, ids, d.createdAt);
  const recomptes = c.lignes.filter((l) => (depuis.get(l.articleId)?.ajustements ?? 0) > 0);
  if (recomptes.length > 0) throw new ConflitDemande(`Un comptage ou ajustement a eu lieu depuis la demande sur ${recomptes.map((l) => `« ${l.designation} »`).join(", ")} : refusez la demande, ou faites-la refaire si le mouvement n'a pas été compté`);
  const niveauxAvant = niveauxDe(stocks);
  const saisi: MouvementSaisi = {
    type: c.type, date, categorieSortie, raisonSortie, origine, retourRestaurant: false,
    lignes: c.lignes.map((l) => ({ articleId: l.articleId, quantite: Number(l.quantite) })),
  };
  // Le mouvement est celui du demandeur (il l'a constaté) ; la validation est au journal et sur la demande.
  await ecrireMouvementsTx(tx, d.auteurId, saisi);
  return { saisi, niveauxAvant };
}

// ── Décisions ───────────────────────────────────────────────────────────────
async function verrouillerDemande(tx: Tx, id: string, version: string | null) {
  await tx.$queryRaw`SELECT "id" FROM "stock"."DemandeValidationStock" WHERE "id" = ${id} FOR UPDATE`;
  const d = await tx.demandeValidationStock.findUnique({ where: { id } });
  if (!d) throw new Error("Demande introuvable.");
  if (d.statut !== "EN_ATTENTE") throw new Error(`Cette demande a déjà été ${d.statut === "VALIDEE" ? "validée" : d.statut === "REFUSEE" ? "refusée" : "retirée"}.`);
  // Jeton de version : la Direction décide de ce qu'elle a VU. Une retouche de l'auteur après
  // l'ouverture de sa page (fusion d'une proposition) change `updatedAt` : décision refusée.
  // `version` null : retrait par son auteur (il retire SA demande, quel que soit son état de retouche).
  if (version !== null && d.updatedAt.toISOString() !== version) {
    throw new Error("Cette demande a été modifiée depuis que vous l'avez ouverte : rechargez la page.");
  }
  return d;
}

/** Clés de cible qu'une charge DOIT porter — recalculées depuis la charge relue (voir validerDemande). */
function clesAttendues(nature: NatureDemande, brut: unknown): string[] {
  if (nature === "PAIEMENT_FACTURE") return lireCharge(nature, brut).factures.map((f) => cleFacture(f.id));
  if (nature === "MODIF_ARTICLE") return lireCharge(nature, brut).articles.map((a) => cleArticle(a.id));
  if (nature === "MOUVEMENT_MANUEL") return lireCharge(nature, brut).lignes.map((l) => cleMouvement(l.articleId));
  return lireCharge("RECONCILIATION", brut).lignes.filter((l) => aUnEcart({ ecart: Number(l.physique) - Number(l.theorique) })).map((l) => cleComptage(l.articleId));
}

/**
 * La charge exécutée doit viser EXACTEMENT les éléments verrouillés à la création : une charge
 * altérée (ou corrompue) ne paie jamais une autre facture, ne touche jamais un autre article.
 */
async function exigerCiblesCoherentes(tx: Tx, d: { id: string; nature: NatureDemande; charge: unknown }) {
  const attendues = [...new Set(clesAttendues(d.nature, d.charge))].sort();
  const posees = (await tx.cibleDemandeStock.findMany({ where: { demandeId: d.id }, select: { cle: true } })).map((c) => c.cle).sort();
  if (attendues.length !== posees.length || attendues.some((c, i) => c !== posees[i])) {
    throw new ConflitDemande("Le contenu de cette demande ne correspond plus aux éléments qu'elle verrouille (demande altérée)");
  }
}

async function notifierDemandeur(d: { id: string; auteurId: string }, message: string, lien: string) {
  // Cloche PERSONNELLE du demandeur dans l'espace Stock (le motif d'un refus ne regarde que lui) :
  // `destinataireUserId` la cache aux autres comptes (chargerNotifications, acces-notification).
  await prisma.notification.create({ data: { domaine: "STOCK", destinataireUserId: d.auteurId, type: "AUTRE", message: message.slice(0, 480), lien, refId: `decision:${d.id}` } });
  await envoyerPush([d.auteurId], { title: "Demande traitée par la Direction", body: message.slice(0, 180), url: lien, tag: `decision-${d.id}` });
}

function lienCible(nature: NatureDemande, charge: unknown): string {
  try {
    if (nature === "PAIEMENT_FACTURE") { const c = lireCharge(nature, charge); return c.factures.length === 1 ? `/stock/factures/${c.factures[0].id}` : "/stock/factures"; }
    if (nature === "MODIF_ARTICLE") { const c = lireCharge(nature, charge); return c.articles.length === 1 ? `/stock/catalogue/${c.articles[0].id}` : "/stock/catalogue"; }
  } catch { /* charge illisible : lien générique */ }
  return nature === "RECONCILIATION" ? "/stock/reconciliation" : nature === "MOUVEMENT_MANUEL" ? "/stock/mouvements" : "/stock/a-valider";
}

export type ResultatValidation = { id: string; nature: NatureDemande; resume: string };

/**
 * Valide une demande : exécute son effet par le cœur commun, puis la passe à VALIDEE — dans la même
 * transaction. `date` : date de paiement corrigée par la Direction (paiements seulement). `motif` :
 * motif d'une ancienne demande de SORTIE, choisi par la Direction (obligatoire pour elle).
 */
export async function validerDemande(decideur: Acteur, id: string, opts: { date?: string; version: string; motif?: MotifValidation }): Promise<ResultatValidation> {
  if (!estDirection(decideur)) throw new Error(MESSAGE_RESERVE_DIRECTION);
  const r = await prisma.$transaction(async (tx) => {
    if (!opts?.version) throw new Error("Version de la demande inconnue : rechargez la page avant de décider.");
    const d = await verrouillerDemande(tx, id, opts.version);
    await exigerCiblesCoherentes(tx, d);
    let reglements: ReglementEcrit[] = [];
    let comptage: Awaited<ReturnType<typeof executerComptageTx>> | null = null;
    let mouvement: Awaited<ReturnType<typeof executerMouvementTx>> | null = null;
    if (d.nature === "PAIEMENT_FACTURE") reglements = await executerPaiementTx(tx, decideur, d, lireCharge("PAIEMENT_FACTURE", d.charge), opts.date);
    else if (d.nature === "RECONCILIATION") comptage = await executerComptageTx(tx, decideur, d, lireCharge("RECONCILIATION", d.charge));
    else if (d.nature === "MOUVEMENT_MANUEL") mouvement = await executerMouvementTx(tx, d, lireCharge("MOUVEMENT_MANUEL", d.charge), opts.motif);
    else await executerModifArticleTx(tx, decideur, lireCharge("MODIF_ARTICLE", d.charge));
    await tx.demandeValidationStock.update({ where: { id }, data: { statut: "VALIDEE", decideurId: decideur.id, decideurNom: decideur.nom, decideLe: new Date() } });
    await tx.cibleDemandeStock.deleteMany({ where: { demandeId: id } });
    await journaliser(tx, { entite: "DemandeValidationStock", entiteId: id, champ: "statut", ancienneValeur: "EN_ATTENTE", nouvelleValeur: "VALIDEE", userId: decideur.id });
    return { d, reglements, comptage, mouvement };
  }, { timeout: 60000 }).catch(traduireErreurBase);

  const { d } = r;
  await apresCommit(async () => {
  await supprimerNotificationsPour(id);
  if (d.nature === "PAIEMENT_FACTURE") {
    await notifierReglements(r.reglements, d.auteurId);
  } else if (d.nature === "RECONCILIATION" && r.comptage) {
    await apresComptage({ sessionId: r.comptage.sessionId, nbHorsTol: r.comptage.nbHorsTol, articleIds: r.comptage.articleIds, niveauxAvant: r.comptage.niveauxAvant });
    await journaliser(prisma, { entite: "SessionComptage", entiteId: r.comptage.sessionId, champ: "comptage", nouvelleValeur: `${r.comptage.nbEcarts} écart(s), ${r.comptage.nbHorsTol} hors tolérance (demande validée)`, userId: decideur.id });
    await notifierDemandeur(d, `Réconciliation validée par la Direction — ${d.resume}`, `/stock/archives/${r.comptage.sessionId}`);
  } else if (d.nature === "MOUVEMENT_MANUEL" && r.mouvement) {
    await apresMouvements(r.mouvement.saisi, r.mouvement.niveauxAvant);
    await notifierDemandeur(d, `Mouvement validé par la Direction — ${d.resume}`, "/stock/mouvements");
  } else {
    await notifierDemandeur(d, `Modification validée par la Direction — ${d.resume}`, lienCible(d.nature, d.charge));
  }
  });
  return { id, nature: d.nature, resume: d.resume };
}

/** Refuse une demande (motif obligatoire) : rien n'est écrit hors la demande elle-même. */
export async function refuserDemande(decideur: Acteur, id: string, motif: string, version: string): Promise<ResultatValidation> {
  if (!estDirection(decideur)) throw new Error(MESSAGE_RESERVE_DIRECTION);
  const m = String(motif ?? "").trim();
  if (m.length < 3) throw new Error("Indiquez le motif du refus.");
  const d = await prisma.$transaction(async (tx) => {
    if (!version) throw new Error("Version de la demande inconnue : rechargez la page avant de décider.");
    const d = await verrouillerDemande(tx, id, version);
    await tx.demandeValidationStock.update({ where: { id }, data: { statut: "REFUSEE", motifRefus: m.slice(0, 480), decideurId: decideur.id, decideurNom: decideur.nom, decideLe: new Date() } });
    await tx.cibleDemandeStock.deleteMany({ where: { demandeId: id } });
    await journaliser(tx, { entite: "DemandeValidationStock", entiteId: id, champ: "statut", ancienneValeur: "EN_ATTENTE", nouvelleValeur: `REFUSEE — ${m}`, userId: decideur.id });
    return d;
  });
  await apresCommit(async () => {
    await supprimerNotificationsPour(id);
    await notifierDemandeur(d, `Demande refusée par la Direction — ${d.resume} : ${m}`, lienCible(d.nature, d.charge));
  });
  return { id, nature: d.nature, resume: d.resume };
}

/** Retire sa propre demande tant qu'elle est en attente. */
export async function retirerDemande(auteur: Acteur, id: string) {
  await prisma.$transaction(async (tx) => {
    const d = await verrouillerDemande(tx, id, null);
    if (d.auteurId !== auteur.id) throw new Error("Seul l'auteur d'une demande peut la retirer.");
    await tx.demandeValidationStock.update({ where: { id }, data: { statut: "ANNULEE", decideLe: new Date() } });
    await tx.cibleDemandeStock.deleteMany({ where: { demandeId: id } });
    await journaliser(tx, { entite: "DemandeValidationStock", entiteId: id, champ: "statut", ancienneValeur: "EN_ATTENTE", nouvelleValeur: "ANNULEE (retirée par son auteur)", userId: auteur.id });
  });
  await apresCommit(() => supprimerNotificationsPour(id));
}

export { NATURE_LIBELLE };
