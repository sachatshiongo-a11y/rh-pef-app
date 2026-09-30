"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import {
  planifierImportBar, rattacherFiches, rattacherIngredients, validerChoix, validerFichesLues,
  type ArticleExistant, type FicheBarLue, type FicheExistanteBar, type FichePlan,
} from "@/lib/fiches/classeur-bar";

// « Importer les fiches du bar (classeur Excel) » (Fiches techniques → Boissons) : RÉSERVÉ À LA
// DIRECTION, comme « Importer les lignes du classeur » de la Conso. journalière. Le fichier est lu
// dans le navigateur ; le serveur ne reçoit que les fiches lues (revalidées ici, jamais crues sur
// parole), les compare aux fiches et au catalogue, puis écrit — dans UNE transaction — ce que la
// Direction a validé. La simulation et l'écriture passent par le même `planifierImportBar` : on
// n'écrit que ce qui a été montré. Rien n'est rattaché d'office hors correspondance sûre ; tout
// est journalisé.

async function direction() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]); // la Direction importe, comme elle crée les fiches du classeur des ventes
  return user;
}

type Lecteur = Pick<Prisma.TransactionClient, "articleStock" | "ficheTechnique">;

async function lireBase(db: Lecteur): Promise<{ articles: ArticleExistant[]; fiches: FicheExistanteBar[] }> {
  const [articles, fiches] = await Promise.all([
    db.articleStock.findMany({ where: { actif: true }, select: { id: true, designation: true, unite: true, prixUnitaireUSD: true, domaine: true, contenance: true, contenanceUnite: true }, orderBy: { designation: "asc" } }),
    db.ficheTechnique.findMany({
      where: { type: "BAR", estSousRecette: false },
      select: { id: true, nom: true, categorie: true, type: true, estSousRecette: true, actif: true, recette: true, prixVenteTTC: true, _count: { select: { ingredients: true } } },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
    }),
  ]);
  return {
    articles: articles.map((a) => ({
      id: a.id, designation: a.designation, unite: a.unite, prixUnitaireUSD: a.prixUnitaireUSD === null ? null : Number(a.prixUnitaireUSD), domaine: a.domaine,
      contenance: a.contenance === null ? null : a.contenance.toString(), contenanceUnite: a.contenanceUnite,
    })),
    fiches: fiches.map((f) => ({
      id: f.id, nom: f.nom, categorie: f.categorie, type: f.type, estSousRecette: f.estSousRecette, actif: f.actif,
      nbIngredients: f._count.ingredients, recetteVide: !f.recette?.trim(), prixVenteTTC: f.prixVenteTTC === null ? null : Number(f.prixVenteTTC),
    })),
  };
}

/** Simulation SANS écriture : fiche proposée pour chaque feuille, article pour chaque ingrédient. */
export const analyserFichesBar = actionLisible(async (brut: FicheBarLue[]) => {
  await direction();
  const lues = validerFichesLues(brut);
  const { articles, fiches } = await lireBase(prisma);
  return {
    ok: true as const,
    fiches: rattacherFiches(lues, fiches),
    ingredients: rattacherIngredients(lues, articles),
    articles,
    fichesBar: fiches,
  };
});

export type BilanImportBar = {
  ok: true;
  /** Fiches existantes remplies (ou remplacées), fiches créées, par nom. */
  remplies: string[];
  creees: string[];
  /** Remplacement demandé mais recette identique : rien réécrit. */
  identiques: string[];
  /** Déjà remplies, sans la case « Remplacer » : laissées telles quelles. */
  dejaRemplies: string[];
  ignorees: string[];
  nonEcrites: { feuille: string; raisons: string[] }[];
  articlesCrees: string[];
  /** Contenances écrites sur des articles du catalogue (« Absolut Vodka-75cl : 75 cl »). */
  contenancesEcrites: string[];
  lignesIgnorees: { fiche: string; libelle: string }[];
  /** Fiches dont la recette (texte) existante a été gardée. */
  recettesConservees: string[];
};

const quantite3 = (q: number) => new Decimal(q).toDecimalPlaces(3).toString();
const signature = (ls: { articleId: string | null; unite: string; quantite: string }[]) =>
  ls.map((l) => `${l.articleId}|${l.unite}|${new Decimal(l.quantite).toString()}`).join("¦");

/**
 * Applique les choix de la Direction, dans UNE transaction (tout ou rien). IDEMPOTENT : une fiche
 * ou un article « à créer » qui existe déjà sous le même nom est réutilisé ; une fiche qui a déjà
 * des ingrédients n'est réécrite que si « Remplacer la recette existante » est coché, et une
 * recette identique n'est pas réécrite. Le prix de vente d'une fiche existante n'est JAMAIS
 * touché ; une fiche créée prend le prix TTC du classeur arrondi au centime.
 */
export const appliquerImportBar = actionLisible(async (brut: FicheBarLue[], brutChoix: unknown): Promise<BilanImportBar> => {
  const user = await direction();
  const lues = validerFichesLues(brut);
  const choix = validerChoix(brutChoix, lues);
  const parFeuille = new Map(lues.map((l) => [l.feuille, l]));

  const bilan: BilanImportBar = { ok: true, remplies: [], creees: [], identiques: [], dejaRemplies: [], ignorees: [], nonEcrites: [], articlesCrees: [], contenancesEcrites: [], lignesIgnorees: [], recettesConservees: [] };
  await prisma.$transaction(async (tx) => {
    const { articles, fiches } = await lireBase(tx);
    const propositions = rattacherIngredients(lues, articles);
    const plans = planifierImportBar(lues, choix, articles, fiches, propositions);
    const prets = plans.filter((p) => p.statut === "PRETE");
    for (const p of plans) {
      if (p.statut === "IGNOREE") bilan.ignorees.push(p.feuille);
      else if (p.statut === "DEJA_REMPLIE") bilan.dejaRemplies.push(p.cible?.nom ?? p.nom);
      else if (p.statut !== "PRETE") bilan.nonEcrites.push({ feuille: p.feuille, raisons: p.raisons });
    }
    if (prets.length === 0) {
      throw new Error("Aucune fiche prête à écrire : décidez les fiches et les ingrédients signalés (ou cochez « Remplacer » pour une fiche déjà remplie). Rien n'a été écrit.");
    }

    const journal: EntreeJournal[] = [];
    // 1. Articles à créer : seulement ceux qu'une fiche ÉCRITE emploie, une fois par libellé.
    const idArticle = new Map<string, string>();
    for (const p of prets) {
      for (const l of p.lignes) {
        if (l.statut !== "OK" || !l.article || l.article.id || idArticle.has(l.cle)) continue;
        const valeurs = propositions.find((x) => x.cle === l.cle)?.creation;
        if (!valeurs) throw new Error(`« ${l.libelle} » : valeurs de création introuvables.`);
        const a = await tx.articleStock.create({
          data: { designation: valeurs.designation, domaine: choix.ingredients[l.cle]?.domaine ?? "BOISSON", unite: valeurs.unite, prixUnitaireUSD: valeurs.prixUnitaireUSD },
          select: { id: true },
        });
        idArticle.set(l.cle, a.id);
        bilan.articlesCrees.push(valeurs.designation);
        journal.push({ entite: "ArticleStock", entiteId: a.id, champ: "creation", nouvelleValeur: `import des fiches du bar : ${valeurs.designation} (${valeurs.unite}, ${valeurs.prixUnitaireUSD ?? "sans prix"})`, userId: user.id });
      }
    }

    // 1 bis. Contenances confirmées, écrites sur les articles des fiches ÉCRITES — jamais par-dessus
    // une contenance déjà renseignée (le plan relu dans cette transaction ne la redemande pas, et
    // l'écriture est conditionnée à « contenance IS NULL » : deux imports concurrents ne s'écrasent pas).
    const contenancesFaites = new Set<string>();
    for (const p of prets) {
      for (const l of p.lignes) {
        const a = l.article;
        if (l.statut !== "OK" || !a?.id || !a.contenanceAEcrire || contenancesFaites.has(a.id)) continue;
        const c = a.contenanceAEcrire;
        const { count } = await tx.articleStock.updateMany({
          where: { id: a.id, contenance: null },
          data: { contenance: new Decimal(c.quantite).toDecimalPlaces(3).toString(), contenanceUnite: c.unite, ...(c.uniteStock ? { unite: c.uniteStock } : {}) },
        });
        if (count !== 1) throw new Error(`« ${a.designation} » : sa contenance vient d'être renseignée par ailleurs. Relancez l'import.`);
        contenancesFaites.add(a.id);
        const texte = `${c.quantite} ${c.unite}${c.uniteStock ? ` (unité de stock : ${c.uniteStock})` : ""}`;
        bilan.contenancesEcrites.push(`${a.designation} : ${texte}`);
        journal.push({ entite: "ArticleStock", entiteId: a.id, champ: "contenance", nouvelleValeur: `import des fiches du bar : ${texte}`, userId: user.id });
      }
    }

    // 2. Fiches.
    for (const p of prets) {
      const lue = parFeuille.get(p.feuille)!;
      const lignes = lignesAEcrire(p, idArticle);
      for (const l of p.lignes) if (l.statut === "IGNOREE") bilan.lignesIgnorees.push({ fiche: p.cible!.nom, libelle: l.libelle });
      const cible = p.cible!;
      if (cible.id === null) {
        const tva = lue.tauxTVA !== null && lue.tauxTVA >= 0 && lue.tauxTVA <= 1 ? lue.tauxTVA : undefined;
        const f = await tx.ficheTechnique.create({
          data: {
            nom: cible.nom, categorie: cible.categorie, type: "BAR", nbPortions: p.nbPortions!, recette: p.recette,
            prixVenteTTC: cible.prixVenteTTC, ...(tva !== undefined ? { tauxTVA: tva } : {}),
            ingredients: { create: lignes },
          },
          select: { id: true },
        });
        bilan.creees.push(cible.nom);
        journal.push({ entite: "FicheTechnique", entiteId: f.id, champ: "creation", nouvelleValeur: `import des fiches du bar (feuille « ${p.feuille} ») : ${cible.nom} (${cible.categorie}), ${lignes.length} ingrédient(s)`, userId: user.id });
        continue;
      }
      if (cible.nbIngredients > 0) {
        const avant = await tx.ingredientFiche.findMany({ where: { ficheId: cible.id }, orderBy: { ordre: "asc" }, select: { articleId: true, unite: true, quantite: true } });
        if (signature(avant.map((a) => ({ ...a, quantite: a.quantite.toString() }))) === signature(lignes)) { bilan.identiques.push(cible.nom); continue; }
        await tx.ingredientFiche.deleteMany({ where: { ficheId: cible.id } });
      }
      // Texte de recette : écrit s'il n'y en a pas, ou si « Remplacer » est coché — jamais effacé
      // par une feuille qui n'en a pas. Un texte existant conservé reçoit tout de même la note
      // des ingrédients non repris : la fiche ne doit pas paraître complète.
      let recette: { recette?: string } = {};
      if (p.recette !== null && (cible.recetteVide || p.remplacer)) recette = { recette: p.recette };
      else if (!cible.recetteVide) {
        if (!p.remplacer) bilan.recettesConservees.push(cible.nom);
        const note = noteNonRepris(p);
        if (note) {
          const actuelle = (await tx.ficheTechnique.findUniqueOrThrow({ where: { id: cible.id }, select: { recette: true } })).recette ?? "";
          if (!actuelle.includes(note)) recette = { recette: `${actuelle.trimEnd()}\n\n${note}` };
        }
      }
      await tx.ficheTechnique.update({ where: { id: cible.id }, data: { nbPortions: p.nbPortions!, ...recette, ingredients: { create: lignes } } });
      bilan.remplies.push(cible.nom);
      journal.push({
        entite: "FicheTechnique", entiteId: cible.id, champ: "ingredients_importes",
        ancienneValeur: cible.nbIngredients ? `${cible.nbIngredients} ingrédient(s)` : null,
        nouvelleValeur: `import des fiches du bar (feuille « ${p.feuille} ») : ${lignes.length} ingrédient(s)${cible.nbIngredients ? ", recette remplacée" : ""}`,
        userId: user.id,
      });
    }
    await journaliserPlusieurs(tx, journal);
  }, { timeout: 60_000, maxWait: 15_000 });

  revalidatePath("/stock/fiches");
  revalidatePath("/stock/catalogue");
  return bilan;
});

/** « Non repris du classeur : … » de la recette du classeur, s'il y a des lignes ignorées. */
function noteNonRepris(p: FichePlan): string | null {
  return p.recette?.split("\n\n").find((b) => b.startsWith("Non repris du classeur")) ?? null;
}

function lignesAEcrire(p: FichePlan, idArticle: Map<string, string>) {
  return p.lignes
    .filter((l) => l.statut === "OK")
    .map((l, i) => {
      const articleId = l.article!.id ?? idArticle.get(l.cle);
      if (!articleId) throw new Error(`« ${l.libelle} » : article introuvable après création.`);
      return { articleId, unite: l.unite!, quantite: quantite3(l.quantite!), ordre: i + 1 };
    });
}
