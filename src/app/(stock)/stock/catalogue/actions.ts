"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { decOptionnel as dec } from "@/lib/nombre";
import { appliquerPatchArticleTx, lirePatchArticle, type PatchArticle } from "@/lib/validations-stock/article";
import { estDirection, proposerModifications, type Acteur } from "@/lib/validations-stock/demandes";
import { texteDecimal } from "@/lib/validations-stock/charge";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { redirect } from "next/navigation";


async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/**
 * Réponse d'une modification d'article faite par un compte qui n'est pas la Direction : RIEN ne
 * change sur l'article, une proposition part à la Direction (« Demandes à valider »), qui valide
 * (même écriture que la sienne) ou refuse. Règle de Sacha du 2026-09-30.
 */
export type PropositionEnvoyee = { proposition: boolean; message: string };

async function proposer(user: Acteur, libelle: string, patchs: { id: string; patch: PatchArticle }[]): Promise<PropositionEnvoyee> {
  const r = await proposerModifications(user, libelle, patchs);
  revalidatePath("/stock/catalogue", "layout");
  revalidatePath("/stock/a-valider");
  revalidatePath("/stock");
  if (r.rien) return { proposition: false, message: "Aucun changement : rien n'a été proposé." };
  const qui = r.nbArticles > 1 ? `${r.nbArticles} articles` : "l'article";
  return {
    proposition: true,
    message: r.fusionnee
      ? `Ajouté à votre proposition en attente : ${qui} ne change${r.nbArticles > 1 ? "nt" : ""} qu'après validation de la Direction.`
      : `Proposition envoyée à la Direction : ${qui} ne change${r.nbArticles > 1 ? "nt" : ""} qu'après sa validation.`,
  };
}

const MESSAGE_DIRECTION_SEULE = (quoi: string) => `${quoi} est réservé à la Direction.`;

/** Crée un article dans l'inventaire (+ sa ligne de stock). */
export const creerArticle = actionLisible(async (formData: FormData) => {
  const user = await garde();
  const designation = String(formData.get("designation") ?? "").trim();
  const domaineRaw = String(formData.get("domaine") ?? "");
  if (!designation) throw new Error("La désignation est requise.");
  const domaine = domaineRaw === "NOURRITURE" || domaineRaw === "BOISSON" || domaineRaw === "AUTRE" ? domaineRaw : "NOURRITURE";
  const categorieId = String(formData.get("categorieId") ?? "").trim() || null;
  const fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;

  // Le stock initial d'un nouvel article est une quantité posée hors flux : hors Direction, il
  // entre par la Liste d'achat (entrée) ou par un comptage, pas par la création.
  const quantiteInitiale = dec(formData.get("quantite")) ?? 0;
  if (quantiteInitiale !== 0 && !estDirection(user)) {
    throw new Error("Le stock initial se saisit par une entrée (Liste d'achat) ou un comptage : créez l'article avec un stock vide, ou demandez à la Direction.");
  }

  const art = await prisma.articleStock.create({
    data: {
      designation,
      domaine,
      code: String(formData.get("code") ?? "").trim() || null,
      unite: String(formData.get("unite") ?? "").trim() || null,
      categorieId,
      fournisseurId,
      prixUnitaireUSD: dec(formData.get("prixUnitaireUSD")),
      uniteParCarton: dec(formData.get("uniteParCarton")),
      stock: {
        create: {
          quantite: dec(formData.get("quantite")) ?? 0,
          stockMinimum: dec(formData.get("stockMinimum")) ?? 0,
          seuilUrgent: dec(formData.get("seuilUrgent")) ?? 0,
        },
      },
    },
  });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: art.id, champ: "creation", nouvelleValeur: designation, userId: user.id });
  // Création hors Direction : permise (un article nouveau n'est pas une modification), mais SIGNALÉE
  // sur la cloche de l'espace Stock.
  if (!estDirection(user)) await signalerCreationArticle(art.id, designation, user.nom);
  revalidatePath("/stock/catalogue");
});

/**
 * Modifie un ou plusieurs champs d'un article (et ses seuils/stock). Direction : écrit tout de
 * suite. Autre compte : propose (voir `PropositionEnvoyee`) — rien ne change avant validation.
 */
export const modifierArticle = actionLisible(async (id: string, formData: FormData): Promise<PropositionEnvoyee | void> => {
  const user = await garde();
  // Lecture ET validation (contenance…) avant toute écriture comme avant toute proposition.
  const patch = lirePatchArticle(formData);
  if (!estDirection(user)) return proposer(user, "Modification de l'article", [{ id, patch }]);
  await prisma.$transaction((tx) => appliquerPatchArticleTx(tx, id, patch));
  await journaliser(prisma, { entite: "ArticleStock", entiteId: id, champ: "modification", userId: user.id });
  revalidatePath("/stock/catalogue");
  revalidatePath(`/stock/catalogue/${id}`); // la fiche article se modifie aussi depuis elle-même
});

/** Fusionne plusieurs articles en un seul (pour les doublons sémantiques : crème fraîche = cooking
 * cream…). Garde le premier ; réaffecte mouvements et lignes de BC, cumule le stock, supprime les autres. */
/**
 * Fusionne plusieurs articles en un seul. `keepId` = article à CONSERVER (choisi par l'utilisateur) ;
 * s'il est absent/invalide, on garde par défaut celui qui a une catégorie, sinon le plus fourni.
 * Les mouvements, lignes de BC, lignes de facture et ingrédients de fiche technique des doublons
 * sont rattachés à l'article conservé, leur stock cumulé, puis ils sont supprimés.
 */
export const fusionnerArticles = actionLisible(async (articleIds: string[], keepId?: string) => {
  const user = await garde();
  // Fusionner supprime des articles et additionne leurs stocks : réservé à la Direction.
  if (!estDirection(user)) throw new Error(MESSAGE_DIRECTION_SEULE("Fusionner des articles"));
  const ids = [...new Set(articleIds.map(String))].filter(Boolean);
  if (ids.length < 2) throw new Error("Sélectionnez au moins deux articles à fusionner.");
  const arts = await prisma.articleStock.findMany({ where: { id: { in: ids } }, include: { stock: true } });
  if (arts.length < 2) return;

  // Choix explicite de l'utilisateur, sinon repli : catégorie d'abord, puis stock le plus fourni.
  const keep = (keepId ? arts.find((a) => a.id === keepId) : undefined)
    ?? [...arts].sort((a, b) => (b.categorieId ? 1 : 0) - (a.categorieId ? 1 : 0) || Number(b.stock?.quantite ?? 0) - Number(a.stock?.quantite ?? 0))[0];
  const losers = arts.filter((a) => a.id !== keep.id);
  if (losers.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const l of losers) {
      await tx.mouvementStock.updateMany({ where: { articleId: l.id }, data: { articleId: keep.id } });
      await tx.ligneBonDeCommande.updateMany({ where: { articleId: l.id }, data: { articleId: keep.id } });
      await tx.ligneFacture.updateMany({ where: { articleId: l.id }, data: { articleId: keep.id } });
      // Fiches techniques : `IngredientFiche.articleId` est en `onDelete: Restrict`. Sans ce
      // rebranchement, fusionner un doublon utilisé dans une recette échouait sur une violation
      // de contrainte brute et annulait TOUTE la transaction — alors que la fusion est justement
      // le remède aux doublons (« CAILLES » / « Cailles »). Deux lignes d'une même fiche peuvent
      // se retrouver sur l'article conservé : elles restent DEUX consommations distinctes, leurs
      // quantités s'additionnent au coût — on ne fusionne pas des lignes de recette à l'aveugle.
      await tx.ingredientFiche.updateMany({ where: { articleId: l.id }, data: { articleId: keep.id } });
      if (l.stock) await tx.stock.update({ where: { articleId: keep.id }, data: { quantite: { increment: Number(l.stock.quantite) } } });
      await tx.articleStock.delete({ where: { id: l.id } });
    }
  });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: keep.id, champ: "fusion", nouvelleValeur: `${losers.length} doublon(s) fusionné(s) → ${keep.designation}`, userId: user.id });
  revalidatePath("/stock/catalogue");
});

/** Catégorise en masse : affecte une catégorie à plusieurs articles. */
export const categoriserEnMasse = actionLisible(async (articleIds: string[], categorieId: string) => {
  const user = await garde();
  if (!estDirection(user)) {
    if (articleIds.length === 0 || !categorieId) return;
    return proposer(user, "Catégorie en masse", [...new Set(articleIds.map(String))].filter(Boolean).map((id) => ({ id, patch: { categorieId } })));
  }
  if (articleIds.length === 0 || !categorieId) return;
  await prisma.articleStock.updateMany({ where: { id: { in: articleIds } }, data: { categorieId } });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: `${articleIds.length} articles`, champ: "categorie (masse)", nouvelleValeur: categorieId, userId: user.id });
  revalidatePath("/stock/catalogue");
});

/** Active ou désactive plusieurs articles d'un coup. */
export const basculerActifArticles = actionLisible(async (articleIds: string[], actif: boolean) => {
  const user = await garde();
  const uniq = [...new Set(articleIds.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  if (!estDirection(user)) return proposer(user, actif ? "Activation en masse" : "Désactivation en masse", uniq.map((id) => ({ id, patch: { actif } })));
  const n = await prisma.articleStock.updateMany({ where: { id: { in: uniq } }, data: { actif } });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: "lot", champ: "actif", nouvelleValeur: `${n.count} article(s) ${actif ? "activé(s)" : "désactivé(s)"}`, userId: user.id });
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
});

/**
 * Met des articles « Sur la fiche commande » (ou les en retire), d'un coup. Un article mis sans rang
 * se range en fin de sa rubrique ; retirer garde son rang et sa rubrique (le remettre les retrouve).
 */
export const basculerFicheCommande = actionLisible(async (articleIds: string[], sur: boolean) => {
  const user = await garde();
  const uniq = [...new Set((Array.isArray(articleIds) ? articleIds : []).map(String))].filter(Boolean);
  if (uniq.length === 0) throw new Error("Aucun article sélectionné.");
  if (!estDirection(user)) return proposer(user, sur ? "Mise sur la fiche commande" : "Retrait de la fiche commande", uniq.map((id) => ({ id, patch: { surFicheCommande: sur } })));
  const n = await prisma.articleStock.updateMany({ where: { id: { in: uniq }, surFicheCommande: !sur }, data: { surFicheCommande: sur } });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: "lot", champ: "ficheCommande", nouvelleValeur: `${n.count} article(s) ${sur ? "mis sur" : "retiré(s) de"} la fiche commande`, userId: user.id });
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/journalier");
  return { ok: true as const, modifies: n.count };
});

/** Affecte un fournisseur (ou le retire si vide) à plusieurs articles d'un coup. */
export const definirFournisseurEnMasse = actionLisible(async (articleIds: string[], fournisseurId: string) => {
  const user = await garde();
  const ids = [...new Set(articleIds.map(String))].filter(Boolean);
  if (ids.length === 0) return;
  if (!estDirection(user)) return proposer(user, "Fournisseur en masse", ids.map((id) => ({ id, patch: { fournisseurId: fournisseurId || null } })));
  await prisma.articleStock.updateMany({ where: { id: { in: ids } }, data: { fournisseurId: fournisseurId || null } });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: `${ids.length} articles`, champ: "fournisseur (masse)", nouvelleValeur: fournisseurId || "retiré", userId: user.id });
  revalidatePath("/stock/catalogue");
});

/**
 * Corrige les stocks négatifs des articles donnés en les remettant à 0. Un stock négatif traduit
 * plus de sorties que d'entrées enregistrées : on le comble par un mouvement d'ENTRÉE d'ajustement
 * (traçable), daté du jour, plutôt qu'en écrasant silencieusement la quantité.
 */
export const corrigerStocksNegatifs = actionLisible(async (articleIds: string[]) => {
  const user = await garde();
  // Poser une quantité hors flux normal : réservé à la Direction. Hors Direction, un stock faux se
  // corrige par un comptage (Réconciliation), soumis à la Direction.
  if (!estDirection(user)) throw new Error(MESSAGE_DIRECTION_SEULE("Corriger les stocks négatifs (mise à 0)") + " Faites un comptage dans Réconciliation : il lui sera soumis.");
  const ids = [...new Set(articleIds.map(String))].filter(Boolean);
  if (ids.length === 0) return { corriges: 0 };
  const stocks = await prisma.stock.findMany({ where: { articleId: { in: ids }, quantite: { lt: 0 } } });
  if (stocks.length === 0) return { corriges: 0 };
  const date = new Date();
  await exigerPeriodeOuverte(date);
  await prisma.$transaction(async (tx) => {
    for (const s of stocks) {
      const manque = -Number(s.quantite); // quantité positive à réinjecter pour revenir à 0
      await tx.mouvementStock.create({ data: { articleId: s.articleId, type: "ENTREE", quantite: manque, origine: "Correction stock négatif (mise à 0)", date, creeParId: user.id } });
      await tx.stock.update({ where: { articleId: s.articleId }, data: { quantite: 0 } });
    }
  }, { timeout: 60000 });
  await journaliser(prisma, { entite: "Stock", entiteId: `${stocks.length} articles`, champ: "correction stock négatif", nouvelleValeur: "remis à 0 (ajustement)", userId: user.id });
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
  return { corriges: stocks.length };
});

/** Définit le stock minimum (seuil d'alerte de réappro) de plusieurs articles d'un coup. */
export const definirSeuilEnMasse = actionLisible(async (articleIds: string[], seuil: number) => {
  const user = await garde();
  const ids = [...new Set(articleIds.map(String))].filter(Boolean);
  const s = Math.max(0, Number(seuil) || 0);
  if (ids.length === 0) return;
  if (!estDirection(user)) return proposer(user, "Stock minimum en masse", ids.map((id) => ({ id, patch: { stockMinimum: texteDecimal(s) } })));
  // Le seuil vit sur la ligne Stock (créée si absente).
  await prisma.$transaction(async (tx) => {
    for (const articleId of ids) {
      await tx.stock.upsert({ where: { articleId }, update: { stockMinimum: s }, create: { articleId, quantite: 0, stockMinimum: s } });
    }
  }, { timeout: 60000 });
  await journaliser(prisma, { entite: "Stock", entiteId: `${ids.length} articles`, champ: "stockMinimum (masse)", nouvelleValeur: String(s), userId: user.id });
  revalidatePath("/stock/catalogue");
});

/**
 * Supprime un article du catalogue (Direction). GARDE-FOU : un article avec un HISTORIQUE
 * (mouvements, lignes de facture ou de bon de commande, comptages, commandes resto) ne peut
 * pas être supprimé — la traçabilité prime : désactivez-le (il disparaît des listes) ou
 * fusionnez-le. Un article vierge est supprimé avec sa ligne de stock, et journalisé.
 */
export async function supprimerArticle(id: string) {
  await formulaireLisible(`/stock/catalogue/${id}`, async () => {
    const user = await verifySession();
    requireModule(user, "stock");
    requireRole(user, ["ADMIN"]);

    const a = await prisma.articleStock.findUniqueOrThrow({ where: { id }, select: { designation: true } });
    const [mvts, lFac, lBC, cResto, cComptage, ingredients] = await Promise.all([
      prisma.mouvementStock.count({ where: { articleId: id } }),
      prisma.ligneFacture.count({ where: { articleId: id } }),
      prisma.ligneBonDeCommande.count({ where: { articleId: id } }),
      prisma.commandeResto.count({ where: { articleId: id } }),
      prisma.ligneComptage.count({ where: { articleId: id } }),
      // `IngredientFiche.articleId` est en `onDelete: Restrict` : sans ce contrôle, un article
      // sans aucun autre historique passait le garde-fou, puis la suppression échouait sur une
      // violation de contrainte Postgres — message brut, en anglais, illisible pour la Direction.
      prisma.ingredientFiche.findMany({ where: { articleId: id }, select: { fiche: { select: { nom: true } } } }),
    ]);
    const attaches: string[] = [];
    if (mvts) attaches.push(`${mvts} mouvement(s)`);
    if (lFac) attaches.push(`${lFac} ligne(s) de facture`);
    if (lBC) attaches.push(`${lBC} ligne(s) de bon de commande`);
    if (cResto) attaches.push(`${cResto} commande(s) resto`);
    if (cComptage) attaches.push(`${cComptage} comptage(s)`);
    if (ingredients.length) {
      // On NOMME les fiches : c'est là qu'il faut aller retirer l'ingrédient pour débloquer.
      const noms = [...new Set(ingredients.map((i) => i.fiche.nom))];
      attaches.push(`${ingredients.length} ligne(s) de fiche technique (${noms.map((n) => `« ${n} »`).join(", ")})`);
    }
    if (attaches.length > 0) {
      throw new Error(
        `« ${a.designation} » a un historique (${attaches.join(", ")}) : il ne peut pas être supprimé. Désactivez-le (il disparaît des listes), retirez-le des fiches techniques qui l'utilisent, ou fusionnez-le avec un doublon.`
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.stock.deleteMany({ where: { articleId: id } });
      await tx.articleStock.delete({ where: { id } });
      await journaliser(tx, { entite: "ArticleStock", entiteId: id, champ: "suppression", ancienneValeur: a.designation, userId: user.id });
    });
    revalidatePath("/stock/catalogue", "layout");
    revalidatePath("/stock");
  });
  redirect("/stock/catalogue"); // succès : retour au catalogue
}

/** Cloche de l'espace Stock : un article créé hors Direction (Inventaire ou Liste d'achat). */
async function signalerCreationArticle(id: string, designation: string, auteurNom: string) {
  await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `Nouvel article « ${designation} » créé par ${auteurNom}`.slice(0, 480), lien: `/stock/catalogue/${id}`, refId: `article-cree:${id}` } });
}
