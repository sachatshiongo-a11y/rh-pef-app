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
import { formaterUSD } from "@/lib/montant";
import { lireDatePaiement } from "@/lib/date-paiement";
import {
  CHAMPS_ARTICLE, NATURE_LIBELLE, type ChampArticle, cleArticle, cleComptage, cleFacture, fusionnerChangements, libelleValeur, lireCharge, texteDecimal, valeursEgales,
  type ArticleDemande, type ChargeArticle, type ChargeComptage, type ChargePaiement, type NatureDemande, type ReglementDemande,
} from "./charge";
import { reglerFactureTx, reglerLotTx, notifierReglements, verrouillerFacture, type ReglementEcrit } from "./reglement";
import {
  aUnEcart, apresComptage, calculerLignes, ecrireComptageTx, etatLigneAValider, exigerExplications, mouvementsDepuis,
  niveauxDe, verrouillerStocks, type CompteSaisi, type Domaine,
} from "./comptage";
import { appliquerPatchArticleTx, changementsDe, lireArticlesTx, nomsReferencesTx, patchDesChangements, type PatchArticle } from "./article";

type Tx = Prisma.TransactionClient;

export type Acteur = { id: string; nom: string; role: Role };
export const estDirection = (u: { role: Role }) => u.role === "ADMIN";
export const MESSAGE_RESERVE_DIRECTION = "Réservé à la Direction.";

/** Demande périmée : l'exécuter écrirait un effet faux. Rien n'est écrit ; la Direction la refuse. */
export class ConflitDemande extends Error {
  constructor(detail: string) { super(`${detail} — rien n'a été écrit : refusez cette demande (le demandeur pourra en refaire une à jour).`); }
}

const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nomFacture = (f: { numero: string | null; fournisseurNom: string }) => `${f.numero ? `facture n° ${f.numero}` : "facture sans numéro"} de ${f.fournisseurNom}`;

// ── Création ────────────────────────────────────────────────────────────────
const MESSAGE_CIBLE_PRISE = "Une demande vient d'être déposée pour le même élément : rechargez la page.";

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

/** Cloche + e-mail + push à la Direction (même patron que les bons de commande à valider). */
async function notifierNouvelleDemande(d: { id: string; resume: string; auteurNom: string }) {
  await creerNotification({ domaine: "STOCK", type: "AUTRE", message: `À valider — ${d.resume} (${d.auteurNom})`.slice(0, 480), lien: "/stock/a-valider", refId: d.id });
}

// ── Paiement de facture ─────────────────────────────────────────────────────
export type DemandePaiementSaisie =
  | { mode: "SOLDE"; factureId: string; dateStr?: string }
  | { mode: "LOT"; factureIds: string[]; dateStr?: string }
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
    await tx.$queryRaw`SELECT "id" FROM "stock"."FactureFournisseur" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`;
    const facs = await tx.factureFournisseur.findMany({ where: { id: { in: ids } } });
    const aRegler = facs.filter((f) => f.statut !== "REGLEE" && Number(f.resteAPayerUSD) > 0.001);
    if (aRegler.length === 0) throw new Error(ids.length > 1 ? "Aucune de ces factures n'est à régler." : "Cette facture est déjà réglée.");
    const maintenant = new Date();
    for (const f of aRegler) {
      try { lireDatePaiement(s.dateStr, f.date, maintenant); } catch (e) {
        throw new Error(s.mode === "LOT" ? `${f.numero ? `${f.fournisseurNom} (n° ${f.numero})` : f.fournisseurNom} : ${e instanceof Error ? e.message : "date invalide"}` : e instanceof Error ? e.message : "Date de paiement invalide.");
      }
    }
    const date = lireDatePaiement(s.dateStr, null, maintenant);
    if (s.mode === "REGLEMENT") {
      const m = Number(s.reglement.montantUSD);
      const reste = Number(aRegler[0].resteAPayerUSD);
      if (!(m > 0)) throw new Error("Le montant doit être supérieur à 0.");
      if (m > reste + 0.009) throw new Error(`Le ${s.reglement.type === "AVOIR" ? "montant de l'avoir" : "paiement"} (${m.toFixed(2)} $) dépasse le reste à payer (${reste.toFixed(2)} $).`);
    }
    await exigerCiblesLibres(tx, aRegler.map((f) => cleFacture(f.id)), (cle) => {
      const f = aRegler.find((x) => cleFacture(x.id) === cle);
      return f ? `${nomFacture(f).charAt(0).toUpperCase()}${nomFacture(f).slice(1)}` : "Facture";
    });
    const charge: ChargePaiement = {
      v: 1, mode: s.mode, date,
      factures: aRegler.map((f) => ({ id: f.id, fournisseurNom: f.fournisseurNom, numero: f.numero, resteUSD: f.resteAPayerUSD.toString() })),
      reglement: s.mode === "REGLEMENT" ? s.reglement : null,
    };
    const total = aRegler.reduce((t, f) => t + Number(f.resteAPayerUSD), 0);
    const resume =
      s.mode === "LOT" && aRegler.length > 1
        ? `Payer ${aRegler.length} factures le ${dateFr(date)} — ${formaterUSD(total)} (${aRegler.map((f) => (f.numero ? `${f.fournisseurNom} n° ${f.numero}` : f.fournisseurNom)).join(", ")})`
        : s.mode === "REGLEMENT"
          ? `${s.reglement.type === "AVOIR" ? "Avoir" : "Paiement"} de ${formaterUSD(Number(s.reglement.montantUSD))}${s.reglement.montantCDF ? ` (${Number(s.reglement.montantCDF).toLocaleString("fr-FR")} FC)` : ""} sur la ${nomFacture(aRegler[0])} le ${dateFr(date)}`
          : `Payer la ${nomFacture(aRegler[0])} le ${dateFr(date)} — ${formaterUSD(total)}`;
    return creerDemandeTx(tx, { nature: "PAIEMENT_FACTURE", resume, charge, cles: aRegler.map((f) => cleFacture(f.id)), auteur });
  }).catch(traduireConflitCible);
  await notifierNouvelleDemande(d);
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
  const courantes = new Map<string, number>();
  for (const f of c.factures) {
    const existe = await tx.factureFournisseur.findUnique({ where: { id: f.id }, select: { id: true } });
    if (!existe) throw new ConflitDemande(`La ${nomFacture(f)} a été supprimée depuis la demande`);
    const cur = await verrouillerFacture(tx, f.id);
    if (cur.statut === "REGLEE" || Number(cur.resteAPayerUSD) <= 0.001) throw new ConflitDemande(`La ${nomFacture(f)} a déjà été réglée depuis la demande`);
    if (!new Decimal(cur.resteAPayerUSD.toString()).equals(new Decimal(f.resteUSD))) {
      throw new ConflitDemande(`Le reste à payer de la ${nomFacture(f)} a changé depuis la demande (${formaterUSD(Number(f.resteUSD))} → ${formaterUSD(Number(cur.resteAPayerUSD))})`);
    }
    courantes.set(f.id, Number(cur.resteAPayerUSD));
  }
  const trace = `demandé par ${d.auteurNom}, validé par ${decideur.nom}`;
  if (c.mode === "SOLDE") {
    const f = c.factures[0];
    return [await reglerFactureTx(tx, decideur.id, f.id, { montant: courantes.get(f.id)!, dateStr: date, note: `Marquée payée (${trace})` })];
  }
  if (c.mode === "LOT") {
    const regs = await reglerLotTx(tx, decideur.id, c.factures.map((f) => f.id), date, `Marquée payée (lot — ${trace})`);
    if (regs.length !== c.factures.length) throw new ConflitDemande("Une facture du lot n'est plus à régler");
    return regs;
  }
  const r = c.reglement!;
  return [await reglerFactureTx(tx, decideur.id, c.factures[0].id, {
    montant: Number(r.montantUSD), montantCDF: r.montantCDF === null ? null : Number(r.montantCDF), taux: r.taux === null ? null : Number(r.taux),
    dateStr: date, mode: r.modePaiement, note: r.note, type: r.type,
  })];
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
  const r = await prisma.$transaction(async (tx) => {
    const stocks = await verrouillerStocks(tx, ids);
    const articles = await tx.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true, designation: true, unite: true, prixUnitaireUSD: true } });
    const theo = new Map(stocks.map((s) => [s.articleId, Number(s.quantite)]));
    const theoTexte = new Map(stocks.map((s) => [s.articleId, s.quantite.toString()]));
    const noms = new Map(articles.map((a) => [a.id, a.designation]));
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
    const charge: ChargeComptage = {
      v: 1, domaine, origine,
      lignes: lignes.map((l) => ({
        articleId: l.articleId, designation: l.designation, unite: parId.get(l.articleId)?.unite ?? null,
        theorique: theoTexte.get(l.articleId) ?? "0", physique: texteDecimal(l.physique), explication: l.explication,
        prixUnitaireUSD: parId.get(l.articleId)?.prixUnitaireUSD?.toString() ?? null,
      })),
    };
    const avecEcart = lignes.filter(aUnEcart);
    await exigerCiblesLibres(tx, avecEcart.map((l) => cleComptage(l.articleId)), (cle) => `« ${avecEcart.find((l) => cleComptage(l.articleId) === cle)?.designation ?? "Article"} »`);
    const resume = `${origine} — ${nbEcarts} écart(s)${nbHorsTol ? `, dont ${nbHorsTol} hors tolérance` : ""} sur ${lignes.length} article(s) compté(s)`;
    const d = await creerDemandeTx(tx, { nature: "RECONCILIATION", resume, charge, cles: avecEcart.map((l) => cleComptage(l.articleId)), auteur: user });
    return { applique: false as const, demande: d, nbEcarts, nbHorsTol };
  }, { timeout: 60000 }).catch(traduireConflitCible);

  if (r.applique) {
    await apresComptage({ sessionId: r.sessionId, nbHorsTol: r.nbHorsTol, articleIds: ids, niveauxAvant: r.niveauxAvant });
    await journaliser(prisma, { entite: "SessionComptage", entiteId: r.sessionId, champ: "comptage", nouvelleValeur: `${r.nbEcarts} écart(s), ${r.nbHorsTol} hors tolérance`, userId: user.id });
    return { applique: true, sessionId: r.sessionId, nbEcarts: r.nbEcarts, nbHorsTol: r.nbHorsTol };
  }
  await notifierNouvelleDemande(r.demande);
  return { applique: false, demandeId: r.demande.id, nbEcarts: r.nbEcarts, nbHorsTol: r.nbHorsTol };
}

async function executerComptageTx(tx: Tx, decideur: Acteur, d: { createdAt: Date }, c: ChargeComptage) {
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
  const e = await ecrireComptageTx(tx, decideur.id, { domaine: c.domaine, origine: c.origine, lignes });
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

    // Retouche d'une proposition du même auteur : fusion dans SA demande en attente.
    let fusionnee: string | null = null;
    const annulees: string[] = [];
    const restants = new Map(articles.map((a) => [a.id, a]));
    for (const demandeId of new Set(prises.filter((p) => restants.has(p.cle.slice(cleArticle("").length))).map((p) => p.demandeId))) {
      await tx.$queryRaw`SELECT "id" FROM "stock"."DemandeValidationStock" WHERE "id" = ${demandeId} FOR UPDATE`;
      const dem = await tx.demandeValidationStock.findUniqueOrThrow({ where: { id: demandeId } });
      const charge = lireCharge("MODIF_ARTICLE", dem.charge);
      const vides: string[] = [];
      for (const art of charge.articles) {
        const nouveau = restants.get(art.id);
        if (!nouveau) continue;
        art.changements = fusionnerChangements(art.changements, nouveau.changements);
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
    }
    const nouveaux = [...restants.values()];
    if (nouveaux.length === 0) return { rien: false as const, demandeId: fusionnee!, nbArticles: articles.length, fusionnee: true, nouvelle: null, annulees };
    const charge: ChargeArticle = { v: 1, libelle, articles: nouveaux };
    const d = await creerDemandeTx(tx, { nature: "MODIF_ARTICLE", resume: resumeArticles(nouveaux), charge, cles: nouveaux.map((a) => cleArticle(a.id)), auteur });
    return { rien: false as const, demandeId: d.id, nbArticles: articles.length, fusionnee: fusionnee !== null, nouvelle: d, annulees };
  }).catch(traduireConflitCible);

  if (r.rien) return { rien: true };
  for (const id of r.annulees) await supprimerNotificationsPour(id);
  if (r.nouvelle) await notifierNouvelleDemande(r.nouvelle);
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
    await appliquerPatchArticleTx(tx, a.id, patchDesChangements(a.changements));
    await journaliser(tx, { entite: "ArticleStock", entiteId: a.id, champ: "modification (proposition validée)", nouvelleValeur: a.changements.map((ch) => `${CHAMPS_ARTICLE[ch.champ].libelle} : ${ch.avantLibelle} → ${ch.apresLibelle}`).join(" ; ").slice(0, 900), userId: decideur.id });
  }
}

// ── Décisions ───────────────────────────────────────────────────────────────
async function verrouillerDemande(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "stock"."DemandeValidationStock" WHERE "id" = ${id} FOR UPDATE`;
  const d = await tx.demandeValidationStock.findUnique({ where: { id } });
  if (!d) throw new Error("Demande introuvable.");
  if (d.statut !== "EN_ATTENTE") throw new Error(`Cette demande a déjà été ${d.statut === "VALIDEE" ? "validée" : d.statut === "REFUSEE" ? "refusée" : "retirée"}.`);
  return d;
}

async function notifierDemandeur(d: { id: string; auteurId: string }, message: string, lien: string) {
  await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: message.slice(0, 480), lien, refId: `decision:${d.id}` } });
  await envoyerPush([d.auteurId], { title: "Demande traitée par la Direction", body: message.slice(0, 180), url: lien, tag: `decision-${d.id}` });
}

function lienCible(nature: NatureDemande, charge: unknown): string {
  try {
    if (nature === "PAIEMENT_FACTURE") { const c = lireCharge(nature, charge); return c.factures.length === 1 ? `/stock/factures/${c.factures[0].id}` : "/stock/factures"; }
    if (nature === "MODIF_ARTICLE") { const c = lireCharge(nature, charge); return c.articles.length === 1 ? `/stock/catalogue/${c.articles[0].id}` : "/stock/catalogue"; }
  } catch { /* charge illisible : lien générique */ }
  return nature === "RECONCILIATION" ? "/stock/reconciliation" : "/stock/a-valider";
}

export type ResultatValidation = { id: string; nature: NatureDemande; resume: string };

/**
 * Valide une demande : exécute son effet par le cœur commun, puis la passe à VALIDEE — dans la même
 * transaction. `date` : date de paiement corrigée par la Direction (paiements seulement).
 */
export async function validerDemande(decideur: Acteur, id: string, opts: { date?: string } = {}): Promise<ResultatValidation> {
  if (!estDirection(decideur)) throw new Error(MESSAGE_RESERVE_DIRECTION);
  const r = await prisma.$transaction(async (tx) => {
    const d = await verrouillerDemande(tx, id);
    let reglements: ReglementEcrit[] = [];
    let comptage: Awaited<ReturnType<typeof executerComptageTx>> | null = null;
    if (d.nature === "PAIEMENT_FACTURE") reglements = await executerPaiementTx(tx, decideur, d, lireCharge("PAIEMENT_FACTURE", d.charge), opts.date);
    else if (d.nature === "RECONCILIATION") comptage = await executerComptageTx(tx, decideur, d, lireCharge("RECONCILIATION", d.charge));
    else await executerModifArticleTx(tx, decideur, lireCharge("MODIF_ARTICLE", d.charge));
    await tx.demandeValidationStock.update({ where: { id }, data: { statut: "VALIDEE", decideurId: decideur.id, decideurNom: decideur.nom, decideLe: new Date() } });
    await tx.cibleDemandeStock.deleteMany({ where: { demandeId: id } });
    await journaliser(tx, { entite: "DemandeValidationStock", entiteId: id, champ: "statut", ancienneValeur: "EN_ATTENTE", nouvelleValeur: "VALIDEE", userId: decideur.id });
    return { d, reglements, comptage };
  }, { timeout: 60000 });

  const { d } = r;
  await supprimerNotificationsPour(id);
  if (d.nature === "PAIEMENT_FACTURE") {
    await notifierReglements(r.reglements, d.auteurId);
  } else if (d.nature === "RECONCILIATION" && r.comptage) {
    await apresComptage({ sessionId: r.comptage.sessionId, nbHorsTol: r.comptage.nbHorsTol, articleIds: r.comptage.articleIds, niveauxAvant: r.comptage.niveauxAvant });
    await journaliser(prisma, { entite: "SessionComptage", entiteId: r.comptage.sessionId, champ: "comptage", nouvelleValeur: `${r.comptage.nbEcarts} écart(s), ${r.comptage.nbHorsTol} hors tolérance (demande validée)`, userId: decideur.id });
    await notifierDemandeur(d, `Réconciliation validée par la Direction — ${d.resume}`, `/stock/archives/${r.comptage.sessionId}`);
  } else {
    await notifierDemandeur(d, `Modification validée par la Direction — ${d.resume}`, lienCible(d.nature, d.charge));
  }
  return { id, nature: d.nature, resume: d.resume };
}

/** Refuse une demande (motif obligatoire) : rien n'est écrit hors la demande elle-même. */
export async function refuserDemande(decideur: Acteur, id: string, motif: string): Promise<ResultatValidation> {
  if (!estDirection(decideur)) throw new Error(MESSAGE_RESERVE_DIRECTION);
  const m = String(motif ?? "").trim();
  if (m.length < 3) throw new Error("Indiquez le motif du refus.");
  const d = await prisma.$transaction(async (tx) => {
    const d = await verrouillerDemande(tx, id);
    await tx.demandeValidationStock.update({ where: { id }, data: { statut: "REFUSEE", motifRefus: m.slice(0, 480), decideurId: decideur.id, decideurNom: decideur.nom, decideLe: new Date() } });
    await tx.cibleDemandeStock.deleteMany({ where: { demandeId: id } });
    await journaliser(tx, { entite: "DemandeValidationStock", entiteId: id, champ: "statut", ancienneValeur: "EN_ATTENTE", nouvelleValeur: `REFUSEE — ${m}`, userId: decideur.id });
    return d;
  });
  await supprimerNotificationsPour(id);
  await notifierDemandeur(d, `Demande refusée par la Direction — ${d.resume} : ${m}`, lienCible(d.nature, d.charge));
  return { id, nature: d.nature, resume: d.resume };
}

/** Retire sa propre demande tant qu'elle est en attente. */
export async function retirerDemande(auteur: Acteur, id: string) {
  await prisma.$transaction(async (tx) => {
    const d = await verrouillerDemande(tx, id);
    if (d.auteurId !== auteur.id) throw new Error("Seul l'auteur d'une demande peut la retirer.");
    await tx.demandeValidationStock.update({ where: { id }, data: { statut: "ANNULEE", decideLe: new Date() } });
    await tx.cibleDemandeStock.deleteMany({ where: { demandeId: id } });
    await journaliser(tx, { entite: "DemandeValidationStock", entiteId: id, champ: "statut", ancienneValeur: "EN_ATTENTE", nouvelleValeur: "ANNULEE (retirée par son auteur)", userId: auteur.id });
  });
  await supprimerNotificationsPour(id);
}

export { NATURE_LIBELLE };
