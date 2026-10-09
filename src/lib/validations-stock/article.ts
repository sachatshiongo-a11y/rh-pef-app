import "server-only";

// CŒUR DES MODIFICATIONS D'ARTICLE — un seul chemin d'écriture pour la modification directe de la
// Direction ET pour la validation d'une proposition. Une modification est un « patch » : champ →
// nouvelle valeur (chaîne décimale exacte pour les nombres). Hors fichier « use server » pour la
// même raison que reglement.ts.

import { Prisma } from "@prisma/client";
import { decSaisiOptionnel } from "@/lib/nombre";
import { lireContenanceSaisie } from "@/lib/fiches/conversion";
import { poserStocksTx } from "./stock-positif";
import type { DevisePrix } from "@/lib/prix-article";
import { libelleArticle } from "@/lib/libelle-article";
import { decisionArticle } from "@/lib/article-proche";
import { catalogueCandidats } from "@/lib/achats-liste-serveur";
import type { ArticleCandidat } from "@/lib/achats-doublons";
import {
  CHAMPS_ARTICLE, LISTE_CHAMPS_ARTICLE, estDomaineArticle, libelleValeur, texteDecimal, valeursEgales,
  type ChampArticle, type Changement, type DomaineArticle, type Valeur,
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
  if (formData.has("domaine")) p.domaine = lireDomaine(formData.get("domaine"));
  // Prix de référence : sa devise (« USD » / « CDF »), puis le prix dans cette devise. Un champ de
  // prix seul (case de l'Inventaire) garde la devise de l'article — `harmoniserPrix` le vérifie.
  if (formData.has("devisePrix")) p.devisePrix = lireDevisePrix(formData.get("devisePrix"));
  if (formData.has("prixUnitaireUSD")) p.prixUnitaireUSD = decTexte(formData.get("prixUnitaireUSD"), "prix unitaire");
  if (formData.has("prixUnitaireCDF")) p.prixUnitaireCDF = decTexte(formData.get("prixUnitaireCDF"), "prix unitaire en francs");
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
  prixUnitaireCDF: { max: 1e14, libelle: "Le prix unitaire en francs" }, // Decimal(16,2)
  uniteParCarton: { max: 1e8, libelle: "Le nombre d'unités par carton" }, // Decimal(10,2)
  stockMinimum: { max: 1e11, libelle: "Le stock minimum" }, // Decimal(14,3)
  seuilUrgent: { max: 1e11, libelle: "Le seuil urgent" },
  quantite: { max: 1e11, libelle: "La quantité" },
};
function exigerBornes(p: PatchArticle) {
  // Un stock ne passe jamais sous 0 (2026-10-09) : refus dès la saisie, avant toute proposition.
  if (typeof p.quantite === "string" && Number(p.quantite) < 0) throw new Error(`La quantité en stock ne peut pas être négative (${p.quantite.replace(".", ",")}) : un stock ne passe jamais sous 0.`);
  for (const [champ, b] of Object.entries(PLAFONDS) as [ChampArticle, { max: number; libelle: string }][]) {
    const v = p[champ];
    if (typeof v === "string" && Math.abs(Number(v)) >= b.max) throw new Error(`${b.libelle} est hors limites (${v.replace(".", ",")}) : vérifiez la saisie.`);
  }
}

const champsDe = (patch: PatchArticle) => LISTE_CHAMPS_ARTICLE.filter((c) => c in patch);

/** « USD » ou « CDF » ; toute autre valeur est refusée (jamais une devise devinée). */
export function lireDevisePrix(v: FormDataEntryValue | null): DevisePrix {
  const d = String(v ?? "").trim().toUpperCase();
  if (d === "USD" || d === "$") return "USD";
  if (d === "CDF" || d === "FC") return "CDF";
  throw new Error("Devise du prix inconnue : choisissez $ ou FC.");
}

/** « NOURRITURE » / « BOISSON » / « AUTRE » ; toute autre valeur est refusée (jamais un domaine deviné). */
export function lireDomaine(v: FormDataEntryValue | null): DomaineArticle {
  const d = String(v ?? "").trim().toUpperCase();
  if (estDomaineArticle(d)) return d;
  throw new Error("Domaine inconnu : choisissez Nourriture, Boissons ou Autre.");
}

/**
 * Domaine changé (2026-10-09) : la catégorie de l'article doit appartenir au NOUVEAU domaine (une
 * catégorie vit dans un domaine). Si celle d'aujourd'hui n'existe que dans l'ancien, le patch doit en
 * choisir une du nouveau, ou « à classer » (null) — refus lisible sinon, rien n'est écrit. Seul un
 * patch qui CHANGE le domaine est contrôlé : une catégorie déjà incohérente (import ancien) ne bloque
 * pas une retouche de prix.
 */
export async function exigerCategorieDuDomaine(tx: Pick<Tx, "articleStock" | "categorieStock">, id: string, patch: PatchArticle) {
  if (!("domaine" in patch)) return;
  const art = await tx.articleStock.findUnique({ where: { id }, select: { designation: true, domaine: true, categorieId: true, categorie: { select: { nom: true } } } });
  if (!art || art.domaine === patch.domaine) return;
  const categorieId = "categorieId" in patch ? (patch.categorieId as string | null) : art.categorieId;
  if (!categorieId) return;
  const cat = await tx.categorieStock.findUnique({ where: { id: categorieId }, select: { nom: true, domaine: true } });
  if (cat && cat.domaine === patch.domaine) return;
  const nouveau = libelleValeur("domaine", patch.domaine ?? null);
  throw new Error(`« ${art.designation} » passe en ${nouveau} : sa catégorie « ${cat?.nom ?? art.categorie?.nom ?? "?"} » n'existe pas dans ce domaine. Choisissez une catégorie du domaine ${nouveau}, ou « à classer ». Rien n'a été modifié.`);
}

/**
 * Catégorie ARCHIVÉE (Inventaire › Catégories) : elle n'est plus proposée dans les choix, et le serveur
 * la refuse aussi (une action s'appelle sans l'écran). Seule exception : l'article qui la porte déjà
 * peut la GARDER (une retouche de prix ne doit pas buter sur la catégorie d'hier). `articleId` absent =
 * création d'un article.
 */
export async function exigerCategorieActive(tx: Pick<Tx, "articleStock" | "categorieStock">, categorieId: string | null | undefined, articleId?: string) {
  if (!categorieId) return;
  const cat = await tx.categorieStock.findUnique({ where: { id: categorieId }, select: { nom: true, actif: true } });
  if (!cat || cat.actif) return; // inconnue : la clé étrangère s'en charge
  if (articleId) {
    const art = await tx.articleStock.findUnique({ where: { id: articleId }, select: { categorieId: true } });
    if (art?.categorieId === categorieId) return;
  }
  throw new Error(`La catégorie « ${cat.nom} » est archivée : choisissez une catégorie active (ou réactivez-la dans Inventaire › Catégories). Rien n'a été modifié.`);
}

/**
 * Réponse d'un renommage qui tombe sur un article existant — la MÊME forme que `DoublonCreation` de
 * « Ajouter un article » (l'écran affiche le même encadré `ChoixArticleProche`) :
 *  - `creationPossible: false` : doublon CERTAIN (même nom à la casse, aux accents, aux espaces près —
 *    ce que la création refuse sans recours) : refus sec ;
 *  - `creationPossible: true` : nom seulement PROCHE (pluriel, lettre d'écart, ordre des mots :
 *    « Tomate »/« Tomates ») : avertissement, et « Renommer quand même » renvoie la saisie avec le
 *    drapeau `renommerQuandMeme=1`. Sans drapeau, refus.
 */
export type DoublonRenommage = { doublon: true; candidats: ArticleCandidat[]; creationPossible: boolean; message: string };

/**
 * ANTI-DOUBLON AU RENOMMAGE (Direction, 2026-10-10) : la règle de « Ajouter un article » (`decisionArticle`),
 * sur le même catalogue (tous domaines, inactifs compris pour le nom exact), moins l'article lui-même —
 * « tomate » → « Tomate » passe. Seule une désignation qui CHANGE est contrôlée. Rend null quand le nom
 * est libre ; n'écrit rien.
 */
export async function doublonDeRenommage(tx: Tx, id: string, patch: PatchArticle): Promise<DoublonRenommage | null> {
  if (!("designation" in patch) || typeof patch.designation !== "string") return null;
  const nom = patch.designation.trim();
  if (!nom) return null;
  const actuel = await tx.articleStock.findUnique({ where: { id }, select: { designation: true } });
  if (!actuel || actuel.designation === nom) return null; // inchangée (ou article disparu : l'écriture le dira)
  const catalogue = (await catalogueCandidats(tx)).filter((a) => a.id !== id);
  const d = decisionArticle(nom, catalogue);
  if (d.type !== "auto" && d.type !== "choix") return null; // nom libre
  const candidats = d.type === "auto" ? [d.article] : d.candidats;
  const creationPossible = d.type === "choix" && d.creationPossible;
  const noms = candidats.map((c) => `« ${libelleArticle(c)} »${c.actif ? "" : " (inactif)"}`).join(", ");
  return {
    doublon: true, candidats, creationPossible,
    message: creationPossible
      ? `« ${nom} » ressemble à ${candidats.length > 1 ? "des articles" : "un article"} déjà au catalogue : ${noms}. Utilisez-${candidats.length > 1 ? "en un" : "le"}, ou renommez quand même. Rien n'a été modifié.`
      : `« ${nom} » existe déjà au catalogue : ${noms}. Utilisez cet article (réactivez-le s'il est inactif) ou choisissez un autre nom. Rien n'a été modifié.`,
  };
}

/**
 * Version qui LÈVE (écriture directe, approbation, proposition) : le doublon certain bloque toujours ;
 * le nom proche bloque sauf `procheAutorise` (drapeau « Renommer quand même » de la saisie, ou
 * approbation par la Direction, qui voit la proposition et tranche).
 */
export async function exigerDesignationLibre(tx: Tx, id: string, patch: PatchArticle, { procheAutorise = false }: { procheAutorise?: boolean } = {}) {
  const d = await doublonDeRenommage(tx, id, patch);
  if (d && (!d.creationPossible || !procheAutorise)) throw new Error(d.message);
}

const PRIX_DE: Record<DevisePrix, "prixUnitaireUSD" | "prixUnitaireCDF"> = { USD: "prixUnitaireUSD", CDF: "prixUnitaireCDF" };

/**
 * LA DEVISE DE SAISIE FAIT FOI (2026-10-08) : un article a son prix en dollars OU en francs, jamais
 * les deux. Rend le patch cohérent avec la devise qu'aura l'article (`devisePrix` du patch, sinon
 * celle d'aujourd'hui) : en changeant de devise, le prix de l'autre devise est effacé (il n'est
 * jamais converti en silence) ; un prix saisi dans la devise que l'article n'aura pas est REFUSÉ.
 */
export function harmoniserPrix(deviseActuelle: DevisePrix, patch: PatchArticle): PatchArticle {
  const touche = "devisePrix" in patch || "prixUnitaireUSD" in patch || "prixUnitaireCDF" in patch;
  if (!touche) return patch;
  const p: PatchArticle = { ...patch };
  const devise: DevisePrix = p.devisePrix === "CDF" || p.devisePrix === "USD" ? p.devisePrix : deviseActuelle;
  if ("devisePrix" in p && p.devisePrix !== devise) throw new Error("Devise du prix inconnue : choisissez $ ou FC.");
  const autre = PRIX_DE[devise === "USD" ? "CDF" : "USD"];
  if (p[autre] !== undefined && p[autre] !== null) {
    throw new Error(devise === "CDF"
      ? "Cet article a son prix en francs : saisissez le prix en FC (ou passez l'article en $ depuis sa fiche)."
      : "Cet article a son prix en dollars : saisissez le prix en $ (ou passez l'article en FC depuis sa fiche).");
  }
  // Changement de devise : l'ancien prix s'efface, il n'est jamais converti en silence.
  if (devise !== deviseActuelle || autre in p) p[autre] = null;
  return p;
}

/**
 * Écrit un patch sur un article (et sa ligne Stock, créée si absente — comme `modifierArticle`
 * l'a toujours fait). À appeler dans une transaction.
 */
export async function appliquerPatchArticleTx(tx: Tx, id: string, patchSaisi: PatchArticle, { renommerQuandMeme = false }: { renommerQuandMeme?: boolean } = {}) {
  // Prix : cohérent avec la devise de l'article, relue ICI (geste direct comme proposition validée).
  let patch = patchSaisi;
  await exigerCategorieDuDomaine(tx, id, patch); // domaine changé : catégorie du nouveau domaine, ou « à classer »
  await exigerDesignationLibre(tx, id, patch, { procheAutorise: renommerQuandMeme }); // renommage : jamais un doublon d'un autre article
  if ("categorieId" in patch) await exigerCategorieActive(tx, patch.categorieId as string | null, id); // jamais vers une catégorie archivée
  if ("devisePrix" in patch || "prixUnitaireUSD" in patch || "prixUnitaireCDF" in patch) {
    const cur = await tx.articleStock.findUniqueOrThrow({ where: { id }, select: { devisePrix: true } });
    patch = harmoniserPrix(cur.devisePrix, patch);
  }
  const data: Prisma.ArticleStockUpdateInput = {};
  const stock: Prisma.StockUpdateInput = {};
  let quantite: string | null = null;
  for (const champ of champsDe(patch)) {
    const v = patch[champ] ?? null;
    if (champ === "categorieId") data.categorie = v ? { connect: { id: String(v) } } : { disconnect: true };
    else if (champ === "fournisseurId") data.fournisseur = v ? { connect: { id: String(v) } } : { disconnect: true };
    else if (champ === "quantite") quantite = String(v ?? "0");
    else if (CHAMPS_ARTICLE[champ].porte === "stock") (stock as Record<string, unknown>)[champ] = v ?? "0";
    else (data as Record<string, unknown>)[champ] = v;
  }
  if (Object.keys(data).length > 0) await tx.articleStock.update({ where: { id }, data });
  // Quantité saisie sur la fiche : posée par la porte unique (stock-positif.ts), jamais négative.
  if (quantite !== null) await poserStocksTx(tx, [{ articleId: id, quantite }], { quoi: "quantité en stock" });
  if (Object.keys(stock).length > 0) {
    await tx.stock.upsert({
      where: { articleId: id },
      update: stock,
      create: {
        articleId: id,
        quantite: 0, // la quantité ne s'écrit que par la porte unique, ci-dessus
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
      code: a.code, designation: a.designation, nomCourt: a.nomCourt, domaine: a.domaine, unite: a.unite,
      contenance: dec(a.contenance), contenanceUnite: a.contenanceUnite,
      devisePrix: a.devisePrix, prixUnitaireUSD: dec(a.prixUnitaireUSD), prixUnitaireCDF: dec(a.prixUnitaireCDF), uniteParCarton: dec(a.uniteParCarton),
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
export function changementsDe(etat: EtatArticle, patch: PatchArticle, noms: { categories: Map<string, string>; fournisseurs: Map<string, string>; domainesCategories?: Map<string, string> }, inclure?: Set<ChampArticle>): Changement[] {
  // Domaine changé : la catégorie dit son domaine (« Jus (Nourriture) → Jus (Boissons) »), sinon les
  // deux catégories homonymes se liraient « Jus → Jus ».
  const avecDomaine = "domaine" in patch && !valeursEgales("domaine", etat.valeurs.domaine, patch.domaine ?? null);
  const nomCategorie = (id: string) => {
    const nom = noms.categories.get(id) ?? "(catégorie inconnue)";
    const d = avecDomaine ? noms.domainesCategories?.get(id) : undefined;
    return d ? `${nom} (${libelleValeur("domaine", d)})` : nom;
  };
  const libelle = (champ: ChampArticle, v: Valeur) =>
    champ === "categorieId" ? (v ? nomCategorie(String(v)) : "— à classer —")
      : champ === "fournisseurId" ? (v ? noms.fournisseurs.get(String(v)) ?? "(fournisseur inconnu)" : "—")
        : libelleValeur(champ, v);
  // `inclure` : champs déjà proposés (même auteur) — gardés même s'ils reviennent à la valeur de
  // l'article, pour que la fusion les RETIRE de la proposition au lieu de les y laisser.
  patch = harmoniserPrix(etat.valeurs.devisePrix === "CDF" ? "CDF" : "USD", patch);
  const changes = new Set(champsDe(patch).filter((c) => inclure?.has(c) || !valeursEgales(c, etat.valeurs[c], patch[c] ?? null)));
  if (changes.has("contenance") || changes.has("contenanceUnite")) { changes.add("contenance"); changes.add("contenanceUnite"); }
  // Changement de devise du prix : la devise et les deux prix vont ensemble (avant → après lisible).
  if (changes.has("devisePrix")) { changes.add("prixUnitaireUSD"); changes.add("prixUnitaireCDF"); }
  return LISTE_CHAMPS_ARTICLE.filter((c) => changes.has(c)).map((champ) => {
    const avant = etat.valeurs[champ];
    const apres = champ in patch ? (patch[champ] ?? null) : avant;
    return { champ, avant, apres, avantLibelle: libelle(champ, avant), apresLibelle: libelle(champ, apres) };
  });
}

/** Noms des catégories et fournisseurs (libellés des propositions). */
export async function nomsReferencesTx(tx: Tx) {
  const [cats, fours] = await Promise.all([
    tx.categorieStock.findMany({ select: { id: true, nom: true, domaine: true } }),
    tx.fournisseur.findMany({ select: { id: true, nom: true } }),
  ]);
  return { categories: new Map(cats.map((c) => [c.id, c.nom])), domainesCategories: new Map(cats.map((c) => [c.id, String(c.domaine)])), fournisseurs: new Map(fours.map((f) => [f.id, f.nom])) };
}

/** Patch à écrire pour une proposition validée : les valeurs APRÈS de ses changements. */
export function patchDesChangements(changements: Changement[]): PatchArticle {
  const p: PatchArticle = {};
  for (const c of changements) p[c.champ] = c.apres;
  return p;
}
