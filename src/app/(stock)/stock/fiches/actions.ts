"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { dec, decOptionnel } from "@/lib/nombre";

// Fiches techniques : recettes et ingrédients. Aucune de ces actions ne calcule un coût, une marge
// ou un prix — ces chiffres ne sont JAMAIS stockés, ils sont recalculés par le moteur
// (`src/lib/fiches/cout.ts`) à chaque affichage.

const ENTITE = "FicheTechnique";
const ENTITE_LIGNE = "IngredientFiche";

/** Cloisonnement : espace Stock. Pas de restriction de rôle : la cuisine tient ses fiches. */
async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

function rafraichir(...ficheIds: string[]) {
  revalidatePath("/stock/fiches");
  for (const id of ficheIds) revalidatePath(`/stock/fiches/${id}`);
}

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const txtOuNull = (fd: FormData, k: string) => txt(fd, k) || null;
const coche = (fd: FormData, k: string) => {
  const v = txt(fd, k);
  return v === "on" || v === "true" || v === "1";
};

// ─── Fiches ──────────────────────────────────────────────────────────────────

/** Crée une fiche (entête seule) et renvoie son identifiant pour ouvrir la fiche aussitôt. */
export const creerFiche = actionLisible(async (formData: FormData) => {
  const user = await garde();
  const nom = txt(formData, "nom");
  if (!nom) throw new Error("Le nom de la fiche est requis.");

  const nbPortions = Math.trunc(dec(formData.get("nbPortions"))) || 1;
  if (nbPortions <= 0) throw new Error("Le nombre de portions doit être supérieur à 0.");

  const fiche = await prisma.ficheTechnique.create({
    data: {
      nom,
      categorie: txtOuNull(formData, "categorie"),
      type: txt(formData, "type") === "BAR" ? "BAR" : "PLAT",
      nbPortions,
      estSousRecette: coche(formData, "estSousRecette"),
    },
  });

  await journaliser(prisma, { entite: ENTITE, entiteId: fiche.id, champ: "creation", nouvelleValeur: nom, userId: user.id });
  rafraichir(fiche.id);
  return { id: fiche.id };
});

/**
 * Modifie l'entête d'une fiche. Une sous-recette n'exige aucun prix de vente (la marge n'a de sens
 * que sur un plat vendu) ; en revanche son rendement doit être complet ou absent, jamais à moitié
 * saisi — un rendement sans unité rouvrirait l'erreur d'échelle que le moteur refuse d'assumer.
 */
export const modifierFiche = actionLisible(async (id: string, formData: FormData) => {
  const user = await garde();
  const avant = await prisma.ficheTechnique.findUnique({ where: { id }, select: { nom: true } });
  if (!avant) throw new Error("Fiche introuvable.");

  const nom = txt(formData, "nom");
  if (!nom) throw new Error("Le nom de la fiche est requis.");

  const nbPortions = Math.trunc(dec(formData.get("nbPortions")));
  if (nbPortions <= 0) throw new Error("Le nombre de portions doit être supérieur à 0.");

  const tauxTVA = decOptionnel(formData.get("tauxTVA")) ?? 0;
  if (tauxTVA < 0) throw new Error("Le taux de TVA ne peut pas être négatif.");
  if (tauxTVA > 1) throw new Error("Saisissez la TVA en décimal : 0,16 pour 16 %.");

  const coefficient = decOptionnel(formData.get("coefficientMargeCible"));
  if (coefficient !== null && coefficient <= 0) throw new Error("Le coefficient cible doit être supérieur à 0.");

  const prixVenteTTC = decOptionnel(formData.get("prixVenteTTC"));
  if (prixVenteTTC !== null && prixVenteTTC <= 0) throw new Error("Le prix de vente TTC doit être supérieur à 0.");

  const estSousRecette = coche(formData, "estSousRecette");
  const rendementQuantite = decOptionnel(formData.get("rendementQuantite"));
  const rendementUnite = txtOuNull(formData, "rendementUnite");
  if (rendementQuantite !== null && rendementQuantite <= 0) throw new Error("Le rendement doit être supérieur à 0.");
  if (rendementQuantite !== null && !rendementUnite) throw new Error("Précisez l'unité du rendement (« g » ou « ml ») : sans elle, le coût de la sous-recette serait faux d'un facteur 1000 sans que rien ne le signale.");
  if (rendementUnite && rendementQuantite === null) throw new Error("Précisez la quantité du rendement.");

  await prisma.ficheTechnique.update({
    where: { id },
    data: {
      nom,
      categorie: txtOuNull(formData, "categorie"),
      type: txt(formData, "type") === "BAR" ? "BAR" : "PLAT",
      nbPortions,
      tauxTVA,
      prixVenteTTC,
      coefficientMargeCible: coefficient,
      estSousRecette,
      rendementQuantite,
      rendementUnite,
      recette: txtOuNull(formData, "recette"),
      actif: coche(formData, "actif"),
    },
  });

  await journaliser(prisma, { entite: ENTITE, entiteId: id, champ: "modification", ancienneValeur: avant.nom, nouvelleValeur: nom, userId: user.id });
  rafraichir(id);
});

/**
 * Supprime des fiches en lot. Une fiche encore utilisée comme sous-recette AILLEURS est refusée
 * nommément : la supprimer viderait le coût des plats qui s'appuient dessus.
 */
export const supprimerFiches = actionLisible(async (ids: string[]) => {
  const user = await garde();
  if (!ids.length) throw new Error("Aucune fiche sélectionnée.");

  const fiches = await prisma.ficheTechnique.findMany({ where: { id: { in: ids } }, select: { id: true, nom: true } });
  if (!fiches.length) throw new Error("Aucune fiche à supprimer.");

  // Usages HORS du lot supprimé : les lignes des fiches elles-mêmes supprimées disparaissent
  // en cascade, elles ne bloquent donc rien.
  const usages = await prisma.ingredientFiche.findMany({
    where: { sousFicheId: { in: ids }, ficheId: { notIn: ids } },
    select: { sousFiche: { select: { nom: true } }, fiche: { select: { nom: true } } },
  });
  if (usages.length) {
    const detail = [...new Set(usages.map((u) => `« ${u.sousFiche?.nom} » utilisée par « ${u.fiche.nom} »`))].join(" ; ");
    throw new Error(`Suppression impossible : ${detail}. Retirez d'abord ces lignes des fiches concernées.`);
  }

  // Les lignes des fiches supprimées partent D'ABORD : la contrainte RESTRICT sur `sousFicheId`
  // est vérifiée ligne à ligne, donc supprimer d'un coup un plat et sa sous-recette échouerait
  // (l'ordre de suppression n'est pas garanti). Le cascade seul ne suffit pas ici.
  await prisma.$transaction([
    prisma.ingredientFiche.deleteMany({ where: { ficheId: { in: ids } } }),
    prisma.ficheTechnique.deleteMany({ where: { id: { in: ids } } }),
  ]);
  for (const f of fiches) {
    await journaliser(prisma, { entite: ENTITE, entiteId: f.id, champ: "suppression", ancienneValeur: f.nom, userId: user.id });
  }
  rafraichir(...ids);
});

/** Duplique des fiches (entête + ingrédients) en lot. Renvoie les identifiants créés. */
export const dupliquerFiches = actionLisible(async (ids: string[]) => {
  const user = await garde();
  if (!ids.length) throw new Error("Aucune fiche sélectionnée.");

  const fiches = await prisma.ficheTechnique.findMany({
    where: { id: { in: ids } },
    include: { ingredients: { orderBy: { ordre: "asc" } } },
  });
  if (!fiches.length) throw new Error("Aucune fiche à dupliquer.");

  const crees: string[] = [];
  for (const f of fiches) {
    const copie = await prisma.ficheTechnique.create({
      data: {
        nom: `${f.nom} (copie)`,
        categorie: f.categorie,
        type: f.type,
        nbPortions: f.nbPortions,
        tauxTVA: f.tauxTVA,
        prixVenteTTC: f.prixVenteTTC,
        coefficientMargeCible: f.coefficientMargeCible,
        estSousRecette: f.estSousRecette,
        rendementQuantite: f.rendementQuantite,
        rendementUnite: f.rendementUnite,
        recette: f.recette,
        actif: f.actif,
        ingredients: {
          create: f.ingredients.map((i) => ({
            articleId: i.articleId,
            sousFicheId: i.sousFicheId,
            unite: i.unite,
            quantite: i.quantite,
            ordre: i.ordre,
          })),
        },
      },
    });
    crees.push(copie.id);
    await journaliser(prisma, { entite: ENTITE, entiteId: copie.id, champ: "duplication", ancienneValeur: f.nom, nouvelleValeur: copie.nom, userId: user.id });
  }

  rafraichir(...crees);
  return { ids: crees };
});

// ─── Ingrédients ─────────────────────────────────────────────────────────────

/**
 * Un ingrédient est un article du stock OU une sous-recette — jamais les deux, jamais aucun.
 * Une fiche ne peut pas se contenir elle-même (le moteur détecte les boucles indirectes ; celle-ci
 * est évidente, on la refuse à la saisie).
 */
async function lireSource(formData: FormData, ficheId: string) {
  const articleId = txtOuNull(formData, "articleId");
  const sousFicheId = txtOuNull(formData, "sousFicheId");

  if (articleId && sousFicheId) throw new Error("Un ingrédient est soit un article du stock, soit une sous-recette — jamais les deux.");
  if (!articleId && !sousFicheId) throw new Error("Choisissez un article du stock ou une sous-recette.");
  if (sousFicheId === ficheId) throw new Error("Une fiche ne peut pas se contenir elle-même.");

  if (articleId) {
    const art = await prisma.articleStock.findUnique({ where: { id: articleId }, select: { id: true } });
    if (!art) throw new Error("Article introuvable au catalogue.");
  } else if (sousFicheId) {
    const sf = await prisma.ficheTechnique.findUnique({ where: { id: sousFicheId }, select: { id: true } });
    if (!sf) throw new Error("Sous-recette introuvable.");
  }

  const unite = txt(formData, "unite");
  if (!unite) throw new Error("L'unité de consommation est requise (« g », « cl », « pièce »…).");

  const quantite = dec(formData.get("quantite"));
  if (quantite <= 0) throw new Error("La quantité doit être supérieure à 0.");

  return { articleId, sousFicheId, unite, quantite };
}

/** Ajoute une ligne d'ingrédient à une fiche. */
export const ajouterIngredient = actionLisible(async (ficheId: string, formData: FormData) => {
  const user = await garde();
  const fiche = await prisma.ficheTechnique.findUnique({ where: { id: ficheId }, select: { id: true } });
  if (!fiche) throw new Error("Fiche introuvable.");

  const { articleId, sousFicheId, unite, quantite } = await lireSource(formData, ficheId);
  const dernier = await prisma.ingredientFiche.findFirst({ where: { ficheId }, orderBy: { ordre: "desc" }, select: { ordre: true } });

  const ligne = await prisma.ingredientFiche.create({
    data: { ficheId, articleId, sousFicheId, unite, quantite, ordre: (dernier?.ordre ?? 0) + 1 },
  });

  await journaliser(prisma, { entite: ENTITE_LIGNE, entiteId: ligne.id, champ: "ajout", nouvelleValeur: `${quantite} ${unite}`, userId: user.id });
  rafraichir(ficheId);
});

/** Modifie une ligne d'ingrédient (source, unité, quantité). */
export const modifierIngredient = actionLisible(async (ingredientId: string, formData: FormData) => {
  const user = await garde();
  const avant = await prisma.ingredientFiche.findUnique({
    where: { id: ingredientId },
    select: { ficheId: true, unite: true, quantite: true },
  });
  if (!avant) throw new Error("Ingrédient introuvable.");

  const { articleId, sousFicheId, unite, quantite } = await lireSource(formData, avant.ficheId);

  await prisma.ingredientFiche.update({
    where: { id: ingredientId },
    data: { articleId, sousFicheId, unite, quantite },
  });

  await journaliser(prisma, {
    entite: ENTITE_LIGNE,
    entiteId: ingredientId,
    champ: "modification",
    ancienneValeur: `${avant.quantite.toString()} ${avant.unite}`,
    nouvelleValeur: `${quantite} ${unite}`,
    userId: user.id,
  });
  rafraichir(avant.ficheId);
});

/** Supprime des lignes d'ingrédient en lot (une seule ligne = un lot de un). */
export const supprimerIngredients = actionLisible(async (ficheId: string, ids: string[]) => {
  const user = await garde();
  if (!ids.length) throw new Error("Aucun ingrédient sélectionné.");

  const { count } = await prisma.ingredientFiche.deleteMany({ where: { id: { in: ids }, ficheId } });
  if (!count) throw new Error("Aucun ingrédient à supprimer.");

  await journaliser(prisma, { entite: ENTITE, entiteId: ficheId, champ: "ingredients_supprimes", nouvelleValeur: String(count), userId: user.id });
  rafraichir(ficheId);
});
