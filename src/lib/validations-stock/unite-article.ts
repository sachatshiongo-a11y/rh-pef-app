import "server-only";

// CHANGER L'UNITÉ DE PLUSIEURS ARTICLES — ce que ce geste fait à l'argent et au stock.
// Demande de la Direction (2026-10-14) : « on ne peut pas changer l'unité de plusieurs articles en actions groupées ».
//
// Changer l'unité d'un article ne CONVERTIT RIEN : les quantités (stock, mouvements, commandes du restaurant,
// comptages, lignes de facture et de bon) et les prix gardent les MÊMES CHIFFRES, relus dans la nouvelle unité —
// 2 kg deviennent 2 g, un prix de 5 $ le kilo devient 5 $ le gramme. Le logiciel ne convertit jamais en
// silence (règle de la Direction, comme pour l'alignement d'unité du restaurant). Ce module calcule, article par
// article, CE QUI CHANGE DE SENS, pour que la confirmation le compte et le nomme ; il n'écrit rien.
//
// Règles (`classerChangementUnite`) :
//   - même unité, ou même unité à l'orthographe près (« Kg » → « kg », « Pièces » → « pièce ») : aucun risque ;
//   - article SANS unité jusqu'ici : l'unité se POSE, rien n'a de sens à perdre (on signale seulement ce que la
//     pose déclenche : livraisons du restaurant désormais comptées, lignes de fiche désormais convertibles) ;
//   - article sans stock, sans historique, sans prix, sans fiche, sans rattachement : changement LIBRE ;
//   - sinon, A RISQUE : permis à la Direction, mais confirmé en le comptant et en le nommant.
// Les cohérences vérifiées ailleurs sont recalculées avec les MÊMES fonctions que leurs écrans : conversion des
// lignes de fiche technique (`convertirVersUniteArticle`, contenance comprise), livraisons du restaurant
// (`convertirDepuisUniteArticle`), règle « une seule unité par produit » (`normaliserUnite`).

import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { estUniteComptage, normaliserUnite, uniteManquante, type UniteArticle } from "@/lib/fiches/conversion";
import { convertirDepuisUniteArticle, convertirVersUniteArticle } from "@/lib/fiches/disponibilite";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";
import { formaterNombre } from "@/lib/montant";
import { formaterPrix } from "@/lib/prix-article";
import { historiqueDesArticles } from "./historique-article";

type Client = Prisma.TransactionClient | typeof prisma;

/** Ce que l'on sait d'un article avant de changer son unité (texte pour les décimales : pleine précision). */
export type FaitsUnite = {
  /** `designation` : nom affiché (contenance comprise) ; `nom` : la désignation enregistrée (journal d'audit). */
  id: string; designation: string; nom: string;
  unite: string | null;
  contenance: string | null; contenanceUnite: string | null; uniteParCarton: string | null;
  stock: string; stockEndommage: string;
  /** Prix de référence tel qu'affiché (« 2,50 $ », « 7 000 FC »), null sans prix. */
  prix: string | null;
  nbMouvements: number; nbLignesFacture: number; nbLignesBon: number; nbCommandesResto: number; nbComptages: number;
  /** Une ligne par ligne de fiche technique qui consomme l'article, dans SON unité de consommation. */
  fiches: { fiche: string; unite: string }[];
  /** Articles du restaurant (actifs) rattachés à l'article, avec leur unité de comptage. */
  liens: { restoDesignation: string; espace: "CUISINE" | "BAR"; restoUnite: string | null }[];
};

export type NatureUnite = "INCHANGE" | "ORTHOGRAPHE" | "POSEE" | "LIBRE" | "A_RISQUE";

export type LigneUnite = {
  id: string; designation: string; nom: string;
  avant: string | null; apres: string;
  nature: NatureUnite;
  /** Ce que l'article porte déjà (« stock 12 kg », « 40 mouvements »…) — vide : rien à perdre. */
  raisons: string[];
  /** Cohérences que le changement casse ou déplace (restaurant, fiches techniques, contenance, carton). */
  alertes: string[];
  /** Le changement est écrit, mais seulement après confirmation de la Direction. */
  confirmer: boolean;
};

const D = Decimal.clone({ precision: 60 });
const pl = (n: number, un: string, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;
const nb = (v: string) => formaterNombre(Number(v), { maximumFractionDigits: 6 });
const ESPACE: Record<"CUISINE" | "BAR", string> = { CUISINE: "Cuisine", BAR: "Bar" };
const egaux = (a: string | null, b: string | null) => (a === null || b === null ? a === b : new D(a).equals(new D(b)));

/**
 * Classe le changement d'unité de chaque article. PUR : aucune lecture, aucune écriture. `uniteSaisie` est
 * l'unité telle que la personne l'a écrite (espaces de bord retirés) ; elle est refusée vide par l'action.
 */
export function classerChangementUnite(faits: readonly FaitsUnite[], uniteSaisie: string): LigneUnite[] {
  const apres = uniteSaisie.trim();
  return faits.map((f): LigneUnite => {
    const avant = f.unite?.trim() ? f.unite.trim() : null;
    const base = { id: f.id, designation: f.designation, nom: f.nom, avant, apres, raisons: [] as string[], alertes: [] as string[] };
    if ((f.unite ?? null) === apres || avant === apres) return { ...base, nature: "INCHANGE", confirmer: false };
    if (avant && normaliserUnite(avant) === normaliserUnite(apres)) return { ...base, nature: "ORTHOGRAPHE", confirmer: false };

    const posee = uniteManquante(avant);
    const raisons: string[] = [];
    const qte = (v: string) => (new D(v).isZero() ? null : `${nb(v)}${avant ? ` ${avant}` : ""}`);
    if (qte(f.stock)) raisons.push(`stock ${qte(f.stock)}`);
    if (qte(f.stockEndommage)) raisons.push(`${qte(f.stockEndommage)} endommagé(s)`);
    if (f.nbMouvements) raisons.push(pl(f.nbMouvements, "mouvement"));
    if (f.prix) raisons.push(`prix de référence ${f.prix}`);
    if (f.nbLignesFacture) raisons.push(pl(f.nbLignesFacture, "ligne de facture", "lignes de facture"));
    if (f.nbLignesBon) raisons.push(pl(f.nbLignesBon, "ligne de bon de commande", "lignes de bon de commande"));
    if (f.nbCommandesResto) raisons.push(pl(f.nbCommandesResto, "commande resto", "commandes resto"));
    if (f.nbComptages) raisons.push(pl(f.nbComptages, "comptage"));
    if (f.fiches.length) raisons.push(`${pl(new Set(f.fiches.map((x) => x.fiche)).size, "fiche technique", "fiches techniques")}`);
    if (f.liens.length) raisons.push("rattaché au restaurant");

    // ── Cohérences vérifiées ailleurs, recalculées avec les mêmes fonctions ────────────────────────────
    const alertes: string[] = [];
    const art = (unite: string | null): UniteArticle => ({ unite, contenance: f.contenance, contenanceUnite: f.contenanceUnite });

    // Restaurant : les livraisons du dépôt (en unité du CATALOGUE) sont ramenées dans l'unité de l'article du restaurant.
    for (const l of f.liens) {
      if (uniteManquante(l.restoUnite)) continue; // « unité du restaurant non renseignée » : déjà signalé à l'écran du restaurant
      const r = l.restoUnite!.trim();
      const avantConv = posee ? null : convertirDepuisUniteArticle(1, art(avant), r);
      const apresConv = convertirDepuisUniteArticle(1, art(apres), r);
      const phrases: string[] = [];
      if (avantConv !== null && apresConv === null) phrases.push(`unités incompatibles (${apres} / ${r}) : ses livraisons n'alimenteront plus le stock du restaurant`);
      else if (avantConv === null && apresConv !== null) phrases.push(posee
        ? `ses livraisons, jusqu'ici ignorées faute d'unité, seront désormais ajoutées au stock du restaurant (1 ${apres} = ${nb(apresConv)} ${r})`
        : `ses livraisons redeviennent convertibles (1 ${apres} = ${nb(apresConv)} ${r})`);
      else if (avantConv !== null && apresConv !== null && !egaux(avantConv, apresConv)) phrases.push(`ses livraisons déjà sorties seront relues dans la nouvelle unité (1 ${avant} = ${nb(avantConv)} ${r} avant, 1 ${apres} = ${nb(apresConv)} ${r} après) : le stock du restaurant change`);
      if (!posee && normaliserUnite(r) === normaliserUnite(avant!) && normaliserUnite(r) !== normaliserUnite(apres)) phrases.push(`une seule unité par produit : le restaurant compte en ${r}, l'Inventaire en ${apres} — à aligner depuis Stock → Restaurant`);
      if (phrases.length) alertes.push(`Rattaché à « ${l.restoDesignation} » (${ESPACE[l.espace]}, compté en ${r}) : ${phrases.join(" ; ")}.`);
    }

    // Fiches techniques : chaque ligne consomme dans son unité, ramenée à l'unité de stock (contenance comprise).
    let coutChange = 0, perdues = 0, gagnees = 0;
    for (const x of f.fiches) {
      const b = posee ? null : convertirVersUniteArticle(1, x.unite, art(avant));
      const a = convertirVersUniteArticle(1, x.unite, art(apres));
      if (b !== null && a === null) perdues++;
      else if (b === null && a !== null) gagnees++;
      else if (b !== null && a !== null && !egaux(b, a)) coutChange++;
    }
    if (coutChange + perdues + gagnees > 0) {
      const noms = [...new Set(f.fiches.map((x) => `« ${x.fiche} »`))];
      const parties = [
        coutChange ? `${pl(coutChange, "ligne")} ${coutChange > 1 ? "changent" : "change"} de coût (le prix reste le même chiffre, par ${apres})` : null,
        perdues ? `${pl(perdues, "ligne")} ${perdues > 1 ? "ne seront plus convertibles" : "ne sera plus convertible"} : le coût de la fiche sera annoncé incomplet` : null,
        gagnees ? `${pl(gagnees, "ligne")} ${gagnees > 1 ? "deviennent convertibles" : "devient convertible"} : le coût sera calculé avec le prix actuel` : null,
      ].filter(Boolean);
      alertes.push(`Fiches techniques ${noms.slice(0, 5).join(", ")}${noms.length > 5 ? ` et ${noms.length - 5} autre(s)` : ""} : ${parties.join(" ; ")}.`);
    }

    // Contenance : elle ne sert que pour un article compté à l'unité (Bouteille, Pièce…).
    if (f.contenance && f.contenanceUnite && !posee && estUniteComptage(avant) && !estUniteComptage(apres)) {
      alertes.push(`Contenance ${nb(f.contenance)} ${f.contenanceUnite} par ${avant} : elle ne sert qu'aux articles comptés à l'unité, elle ne sera plus utilisée pour « ${apres} ».`);
    }
    if (f.uniteParCarton && !posee) alertes.push(`${nb(f.uniteParCarton)} unités par carton : saisi pour « ${avant} », à revérifier.`);

    const nature: NatureUnite = posee ? "POSEE" : raisons.length > 0 || alertes.length > 0 ? "A_RISQUE" : "LIBRE";
    return { ...base, nature, raisons: posee ? [] : raisons, alertes, confirmer: nature === "A_RISQUE" || (posee && alertes.length > 0) };
  });
}

export type ApercuUnite = {
  unite: string;
  /** Articles de la sélection. */
  total: number;
  /** Écrits par le geste (les « inchangés » n'en font pas partie). */
  nbChangent: number;
  nbInchanges: number;
  nbOrthographe: number;
  nbPosees: number;
  nbLibres: number;
  /** Articles qui demandent confirmation, nommés. */
  aConfirmer: LigneUnite[];
  /** Identifiants des articles confirmés : renvoyés à l'écriture, qui refuse s'il en apparaît d'autres. */
  confirmes: string[];
  /** Phrase de la confirmation (« 3 articles ont déjà du stock… »), vide sans risque. */
  resume: string;
};

export function apercuUnite(lignes: readonly LigneUnite[], unite: string): ApercuUnite {
  const aConfirmer = lignes.filter((l) => l.confirmer);
  const avecDonnees = aConfirmer.filter((l) => l.nature === "A_RISQUE" && l.raisons.length > 0);
  const avecAlerte = aConfirmer.filter((l) => l.alertes.length > 0);
  const parties: string[] = [];
  if (avecDonnees.length) parties.push(`${pl(avecDonnees.length, "article a", "articles ont")} déjà du stock, des mouvements, un prix, une fiche technique ou un rattachement au restaurant : leurs quantités et prix resteront les mêmes chiffres dans la nouvelle unité (${unite}), rien n'est converti`);
  if (avecAlerte.length) parties.push(`${avecAlerte.length} ${avecAlerte.length > 1 ? "ont" : "a"} une cohérence à revoir (restaurant, fiches techniques, contenance, carton), détaillée ci-dessous`);
  const compte = (n: NatureUnite) => lignes.filter((l) => l.nature === n).length;
  return {
    unite, total: lignes.length,
    nbChangent: lignes.filter((l) => l.nature !== "INCHANGE").length, nbInchanges: compte("INCHANGE"), nbOrthographe: compte("ORTHOGRAPHE"), nbPosees: compte("POSEE"), nbLibres: compte("LIBRE"),
    aConfirmer, confirmes: aConfirmer.map((l) => l.id),
    resume: parties.length ? `${parties.join(". ")}.` : "",
  };
}

/** Lit ce qu'il faut savoir des articles (plusieurs requêtes l'une après l'autre : `client` peut être une transaction). */
export async function chargerFaitsUnite(client: Client, ids: readonly string[]): Promise<FaitsUnite[]> {
  const liste = [...new Set(ids.map(String))].filter(Boolean);
  if (liste.length === 0) return [];
  const db = client as typeof prisma; // une transaction offre les mêmes lectures ; le type d'union des deux ne résout pas les `groupBy`
  const arts = await db.articleStock.findMany({
    where: { id: { in: liste } },
    select: {
      id: true, ...CHAMPS_LIBELLE, unite: true, uniteParCarton: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true, prixCartonUSD: true,
      stock: { select: { quantite: true, quantiteEndommagee: true } },
      liensResto: { where: { articleResto: { actif: true } }, select: { articleResto: { select: { designation: true, espace: true, unite: true } } } },
    },
  });
  const historique = await historiqueDesArticles(db, liste);
  const lignesFiche = await db.ingredientFiche.findMany({ where: { articleId: { in: liste } }, select: { articleId: true, unite: true, fiche: { select: { nom: true } } } });
  const fichesDe = new Map<string, { fiche: string; unite: string }[]>();
  for (const l of lignesFiche) fichesDe.set(l.articleId!, [...(fichesDe.get(l.articleId!) ?? []), { fiche: l.fiche.nom, unite: l.unite }]);

  return arts.map((a): FaitsUnite => {
    const prixBrut = a.devisePrix === "CDF" ? a.prixUnitaireCDF : a.prixUnitaireUSD;
    const prixCarton = a.prixCartonUSD && !a.prixCartonUSD.isZero() ? a.prixCartonUSD : null;
    return {
      id: a.id, designation: libelleArticle(a), nom: a.designation, unite: a.unite,
      contenance: a.contenance?.toString() ?? null, contenanceUnite: a.contenanceUnite, uniteParCarton: a.uniteParCarton && !a.uniteParCarton.isZero() ? a.uniteParCarton.toString() : null,
      stock: a.stock?.quantite.toString() ?? "0", stockEndommage: a.stock?.quantiteEndommagee.toString() ?? "0",
      prix: prixBrut && prixBrut.greaterThan(0) ? formaterPrix(Number(prixBrut), a.devisePrix === "CDF" ? "CDF" : "USD") : prixCarton ? `${formaterPrix(Number(prixCarton), "USD")} le carton` : null,
      nbMouvements: historique.get(a.id)!.mouvements, nbLignesFacture: historique.get(a.id)!.lignesFacture, nbLignesBon: historique.get(a.id)!.lignesBon, nbCommandesResto: historique.get(a.id)!.commandesResto, nbComptages: historique.get(a.id)!.comptages,
      fiches: fichesDe.get(a.id) ?? [],
      liens: a.liensResto.map((l) => ({ restoDesignation: l.articleResto.designation, espace: l.articleResto.espace, restoUnite: l.articleResto.unite })),
    };
  }).sort((x, y) => x.designation.localeCompare(y.designation, "fr"));
}

/** Analyse complète : lit puis classe. Les articles introuvables n'y figurent pas (l'action le dit). */
export async function analyserChangementUnite(client: Client, ids: readonly string[], uniteSaisie: string) {
  const lignes = classerChangementUnite(await chargerFaitsUnite(client, ids), uniteSaisie);
  return { lignes, apercu: apercuUnite(lignes, uniteSaisie.trim()) };
}

// ── Les avertissements vus par la Direction, revérifiés à l'approbation ─────────────────────────────────────────────
// L'écran « À valider » calcule les avertissements à l'AFFICHAGE ; entre l'affichage et le clic « Approuver », un article
// peut avoir reçu du stock ou un mouvement. La Direction décide de ce qu'elle a VU : le jeton de version de la demande
// (`ApercuDemande.version`) porte donc, pour une demande qui change des unités, une EMPREINTE des avertissements affichés
// (un court identifiant d'article + l'empreinte de ses raisons et alertes). À l'approbation, le serveur recalcule et refuse
// si l'ensemble a changé (`ecartsAvertissements`). Approbation unique et approbation groupée passent par le même contrôle.

const PREFIXE_JETON = "#u:";
const empreinte = (l: LigneUnite) => createHash("sha1").update(JSON.stringify([l.raisons, l.alertes])).digest("hex").slice(0, 6);
const court = (id: string) => id.replace(/-/g, "").slice(0, 10);

/** Suffixe du jeton de version : les articles à confirmer (ou ayant une alerte) avec l'empreinte de leurs avertissements. */
export function jetonAvertissements(lignes: readonly LigneUnite[]): string {
  return `${PREFIXE_JETON}${lignes.filter((l) => l.confirmer).map((l) => `${court(l.id)}~${empreinte(l)}`).sort().join(",")}`;
}

/** Sépare un jeton de version en son horodatage et, s'il y en a un, le suffixe des avertissements (null : jeton nu). */
export function lireJetonVersion(version: string): { horodatage: string; avertissements: string | null } {
  const i = version.indexOf(PREFIXE_JETON);
  return i < 0 ? { horodatage: version, avertissements: null } : { horodatage: version.slice(0, i), avertissements: version.slice(i) };
}

/**
 * Ce qui a changé depuis l'affichage (liste vide : les avertissements vus sont toujours les bons). Chaque message nomme
 * l'article et dit ce qu'il porte MAINTENANT. PUR.
 */
export function ecartsAvertissements(vu: string, lignes: readonly LigneUnite[]): string[] {
  const avant = new Map(vu.slice(PREFIXE_JETON.length).split(",").filter(Boolean).map((e) => { const [id, h] = e.split("~"); return [id, h] as const; }));
  const actuel = new Map(lignes.filter((l) => l.confirmer).map((l) => [court(l.id), l] as const));
  const message: string[] = [];
  for (const [id, l] of actuel) {
    const maintenant = [...l.raisons, ...l.alertes.map(() => "cohérence à revoir")].join(", ");
    if (!avant.has(id)) message.push(`« ${l.designation} » a reçu du stock, de l'historique ou un rattachement depuis l'affichage${maintenant ? ` (${maintenant})` : ""}`);
    else if (avant.get(id) !== empreinte(l)) message.push(`« ${l.designation} » a changé depuis l'affichage${maintenant ? ` (${maintenant})` : ""}`);
  }
  for (const id of avant.keys()) {
    if (actuel.has(id)) continue;
    const l = lignes.find((x) => court(x.id) === id);
    message.push(`« ${l?.designation ?? "Un article"} » n'a plus de quoi justifier l'avertissement affiché`);
  }
  return message;
}
