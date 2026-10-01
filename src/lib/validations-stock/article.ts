import "server-only";

// CŒUR DES MODIFICATIONS D'ARTICLE — un seul chemin d'écriture pour la modification directe de la
// Direction ET pour la validation d'une proposition. Une modification est un « patch » : champ →
// nouvelle valeur (chaîne décimale exacte pour les nombres). Hors fichier « use server » pour la
// même raison que reglement.ts.

import { Prisma } from "@prisma/client";
import { decSaisiOptionnel } from "@/lib/nombre";
import { lireContenanceSaisie } from "@/lib/fiches/conversion";
import {
  CHAMPS_ARTICLE, LISTE_CHAMPS_ARTICLE, libelleValeur, texteDecimal, valeursEgales,
  type ChampArticle, type Changement, type Valeur,
} from "./charge";

type Tx = Prisma.TransactionClient;

export type PatchArticle = Partial<Record<ChampArticle, Valeur>>;

/** Nombre lu à la française par `decSaisiOptionnel` (illisible : refus lisible qui nomme le champ) → chaîne décimale exacte, ou null. */
const decTexte = (v: FormDataEntryValue | null, libelle: string): string | null => { const n = decSaisiOptionnel(v, libelle); return n === null ? null : texteDecimal(n); };

/**
 * Lit la saisie de « Modifier l'article » (fiche, case de l'Inventaire) — MÊMES RÈGLES qu'avant :
 * un champ présent dans le formulaire est une modification, un champ absent n'est pas touché ;
 * texte vide = effacé ; seuils et quantité vides = 0.
 */
export function lirePatchArticle(formData: FormData): PatchArticle {
  const p: PatchArticle = {};
  const texte = (k: string) => String(formData.get(k) ?? "").trim() || null;
  if (formData.has("code")) p.code = texte("code");
  if (formData.has("designation")) p.designation = String(formData.get("designation")).trim();
  if (formData.has("nomCourt")) p.nomCourt = texte("nomCourt");
  if (formData.has("prixUnitaireUSD")) p.prixUnitaireUSD = decTexte(formData.get("prixUnitaireUSD"), "prix unitaire");
  if (formData.has("uniteParCarton")) p.uniteParCarton = decTexte(formData.get("uniteParCarton"), "unités par carton");
  if (formData.has("unite")) p.unite = String(formData.get("unite")).trim() || null;
  // Contenance : validée avant toute écriture (nombre ET unité, ou aucun des deux).
  if (formData.has("contenance") || formData.has("contenanceUnite")) {
    const c = lireContenanceSaisie(formData.get("contenance"), formData.get("contenanceUnite"));
    p.contenance = c.contenance;
    p.contenanceUnite = c.contenanceUnite;
  }
  if (formData.has("categorieId")) p.categorieId = String(formData.get("categorieId")).trim() || null;
  if (formData.has("fournisseurId")) p.fournisseurId = String(formData.get("fournisseurId")).trim() || null;
  if (formData.has("stockMinimum")) p.stockMinimum = decTexte(formData.get("stockMinimum"), "stock minimum") ?? "0";
  if (formData.has("seuilUrgent")) p.seuilUrgent = decTexte(formData.get("seuilUrgent"), "seuil urgent") ?? "0";
  if (formData.has("quantite")) p.quantite = decTexte(formData.get("quantite"), "quantité") ?? "0";
  exigerBornes(p);
  return p;
}

/**
 * Bornes des colonnes décimales (précision, échelle de la base) : une valeur hors bornes est refusée
 * À LA SAISIE, avec un message lisible — jamais acceptée en proposition pour échouer à la validation
 * sur une erreur Prisma brute (ni écrite par la Direction avec la même erreur).
 */
const PLAFONDS: Partial<Record<ChampArticle, { max: number; libelle: string }>> = {
  prixUnitaireUSD: { max: 1e8, libelle: "Le prix unitaire" }, // Decimal(12,4)
  uniteParCarton: { max: 1e8, libelle: "Le nombre d'unités par carton" }, // Decimal(10,2)
  stockMinimum: { max: 1e11, libelle: "Le stock minimum" }, // Decimal(14,3)
  seuilUrgent: { max: 1e11, libelle: "Le seuil urgent" },
  quantite: { max: 1e11, libelle: "La quantité" },
};
function exigerBornes(p: PatchArticle) {
  for (const [champ, b] of Object.entries(PLAFONDS) as [ChampArticle, { max: number; libelle: string }][]) {
    const v = p[champ];
    if (typeof v === "string" && Math.abs(Number(v)) >= b.max) throw new Error(`${b.libelle} est hors limites (${v.replace(".", ",")}) : vérifiez la saisie.`);
  }
}

const champsDe = (patch: PatchArticle) => LISTE_CHAMPS_ARTICLE.filter((c) => c in patch);

/**
 * Écrit un patch sur un article (et sa ligne Stock, créée si absente — comme `modifierArticle`
 * l'a toujours fait). À appeler dans une transaction.
 */
export async function appliquerPatchArticleTx(tx: Tx, id: string, patch: PatchArticle) {
  const data: Prisma.ArticleStockUpdateInput = {};
  const stock: Prisma.StockUpdateInput = {};
  for (const champ of champsDe(patch)) {
    const v = patch[champ] ?? null;
    if (champ === "categorieId") data.categorie = v ? { connect: { id: String(v) } } : { disconnect: true };
    else if (champ === "fournisseurId") data.fournisseur = v ? { connect: { id: String(v) } } : { disconnect: true };
    else if (CHAMPS_ARTICLE[champ].porte === "stock") (stock as Record<string, unknown>)[champ] = v ?? "0";
    else (data as Record<string, unknown>)[champ] = v;
  }
  if (Object.keys(data).length > 0) await tx.articleStock.update({ where: { id }, data });
  if (Object.keys(stock).length > 0) {
    await tx.stock.upsert({
      where: { articleId: id },
      update: stock,
      create: {
        articleId: id,
        quantite: (patch.quantite as string | null | undefined) ?? "0",
        stockMinimum: (patch.stockMinimum as string | null | undefined) ?? "0",
        seuilUrgent: (patch.seuilUrgent as string | null | undefined) ?? "0",
      },
    });
  }
}

/** Valeurs ACTUELLES des champs d'articles (décimales en chaîne), et les noms des références. */
export type EtatArticle = { id: string; designation: string; valeurs: Record<ChampArticle, Valeur>; categorieNom: string | null; fournisseurNom: string | null };

export async function lireArticlesTx(tx: Tx, ids: string[], verrouiller = false): Promise<Map<string, EtatArticle>> {
  if (ids.length === 0) return new Map();
  if (verrouiller) {
    // Ligne d'article et ligne de stock verrouillées jusqu'à la fin de la transaction : la
    // comparaison « avant » et l'écriture portent sur le même état.
    // Toujours dans le même ordre (par id) : deux transactions qui verrouillent les mêmes lignes ne
    // peuvent pas s'attendre mutuellement (interblocage).
    await tx.$queryRaw`SELECT "id" FROM "stock"."ArticleStock" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "stock"."Stock" WHERE "articleId" IN (${Prisma.join(ids)}) ORDER BY "articleId" FOR UPDATE`;
  }
  const arts = await tx.articleStock.findMany({
    where: { id: { in: ids } },
    include: { stock: true, categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } } },
  });
  const dec = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toString());
  return new Map(arts.map((a) => [a.id, {
    id: a.id,
    designation: a.designation,
    categorieNom: a.categorie?.nom ?? null,
    fournisseurNom: a.fournisseur?.nom ?? null,
    valeurs: {
      code: a.code, designation: a.designation, nomCourt: a.nomCourt, unite: a.unite,
      contenance: dec(a.contenance), contenanceUnite: a.contenanceUnite,
      prixUnitaireUSD: dec(a.prixUnitaireUSD), uniteParCarton: dec(a.uniteParCarton),
      categorieId: a.categorieId, fournisseurId: a.fournisseurId,
      actif: a.actif, surFicheCommande: a.surFicheCommande,
      // Sans ligne Stock, la fiche affiche 0 : c'est la valeur que le demandeur a vue.
      stockMinimum: dec(a.stock?.stockMinimum) ?? "0", seuilUrgent: dec(a.stock?.seuilUrgent) ?? "0", quantite: dec(a.stock?.quantite) ?? "0",
    },
  }]));
}

/**
 * Changements réels d'un patch par rapport à l'état actuel (un champ inchangé n'est pas proposé).
 * Contenance et son unité vont par paire : si l'une change, les deux sont proposées ensemble.
 * `noms` résout le nom d'une catégorie / d'un fournisseur pour l'affichage.
 */
export function changementsDe(etat: EtatArticle, patch: PatchArticle, noms: { categories: Map<string, string>; fournisseurs: Map<string, string> }, inclure?: Set<ChampArticle>): Changement[] {
  const libelle = (champ: ChampArticle, v: Valeur) =>
    champ === "categorieId" ? (v ? noms.categories.get(String(v)) ?? "(catégorie inconnue)" : "— à classer —")
      : champ === "fournisseurId" ? (v ? noms.fournisseurs.get(String(v)) ?? "(fournisseur inconnu)" : "—")
        : libelleValeur(champ, v);
  // `inclure` : champs déjà proposés (même auteur) — gardés même s'ils reviennent à la valeur de
  // l'article, pour que la fusion les RETIRE de la proposition au lieu de les y laisser.
  const changes = new Set(champsDe(patch).filter((c) => inclure?.has(c) || !valeursEgales(c, etat.valeurs[c], patch[c] ?? null)));
  if (changes.has("contenance") || changes.has("contenanceUnite")) { changes.add("contenance"); changes.add("contenanceUnite"); }
  return LISTE_CHAMPS_ARTICLE.filter((c) => changes.has(c)).map((champ) => {
    const avant = etat.valeurs[champ];
    const apres = champ in patch ? (patch[champ] ?? null) : avant;
    return { champ, avant, apres, avantLibelle: libelle(champ, avant), apresLibelle: libelle(champ, apres) };
  });
}

/** Noms des catégories et fournisseurs (libellés des propositions). */
export async function nomsReferencesTx(tx: Tx) {
  const [cats, fours] = await Promise.all([
    tx.categorieStock.findMany({ select: { id: true, nom: true } }),
    tx.fournisseur.findMany({ select: { id: true, nom: true } }),
  ]);
  return { categories: new Map(cats.map((c) => [c.id, c.nom])), fournisseurs: new Map(fours.map((f) => [f.id, f.nom])) };
}

/** Patch à écrire pour une proposition validée : les valeurs APRÈS de ses changements. */
export function patchDesChangements(changements: Changement[]): PatchArticle {
  const p: PatchArticle = {};
  for (const c of changements) p[c.champ] = c.apres;
  return p;
}
