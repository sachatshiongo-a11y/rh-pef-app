"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { decSaisiOptionnel } from "@/lib/nombre";
import { appliquerPatchArticleTx, lireDevisePrix, lireDomaine, lirePatchArticle, type PatchArticle } from "@/lib/validations-stock/article";
import { estDirection, proposerModifications, type Acteur } from "@/lib/validations-stock/demandes";
import { libelleValeur, texteDecimal } from "@/lib/validations-stock/charge";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { redirect } from "next/navigation";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { poserStocksTx, variationsStockTx } from "@/lib/validations-stock/stock-positif";
import { catalogueCandidats } from "@/lib/achats-liste-serveur";
import { decisionArticle } from "@/lib/article-proche";
import { cleArticleExacte, memeDesignation, type ArticleCandidat } from "@/lib/achats-doublons";


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

/**
 * Réponse de « Ajouter un article » quand le catalogue a déjà un article de ce nom ou d'un nom PROCHE
 * (anti-doublon, même règle que la Liste d'achat — lib/article-proche.ts) : RIEN n'est créé ; l'écran
 * montre les articles et demande « Utiliser … » ou « Créer quand même un nouvel article »
 * (`creationPossible` faux quand le nom exact existe déjà : un second serait un doublon certain).
 */
export type DoublonCreation = { doublon: true; candidats: ArticleCandidat[]; creationPossible: boolean; message: string };

/** Crée un article dans l'inventaire (+ sa ligne de stock). Anti-doublon : voir `DoublonCreation`. */
export const creerArticle = actionLisible(async (formData: FormData): Promise<DoublonCreation | void> => {
  const user = await garde();
  const designation = String(formData.get("designation") ?? "").trim();
  const domaineRaw = String(formData.get("domaine") ?? "");
  if (!designation) throw new Error("La désignation est requise.");
  const domaine = domaineRaw === "NOURRITURE" || domaineRaw === "BOISSON" || domaineRaw === "AUTRE" ? domaineRaw : "NOURRITURE";
  const categorieId = String(formData.get("categorieId") ?? "").trim() || null;
  const fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;
  const creerQuandMeme = String(formData.get("creerQuandMeme") ?? "") === "1";

  // Le stock initial d'un nouvel article est une quantité posée hors flux : hors Direction, il
  // entre par la Liste d'achat (entrée) ou par un comptage, pas par la création.
  const quantiteInitiale = decSaisiOptionnel(formData.get("quantite"), "stock initial") ?? 0;
  if (quantiteInitiale !== 0 && !estDirection(user)) {
    throw new Error("Le stock initial se saisit par une entrée (Liste d'achat) ou un comptage : créez l'article avec un stock vide, ou demandez à la Direction.");
  }
  if (quantiteInitiale < 0) throw new Error("Le stock initial ne peut pas être négatif : un stock ne passe jamais sous 0.");

  // Prix de référence dans SA devise (2026-10-08) : « devisePrix » absent = dollars, comme avant.
  const devisePrix = formData.has("devisePrix") ? lireDevisePrix(formData.get("devisePrix")) : "USD";
  const prix = decSaisiOptionnel(formData.get(devisePrix === "CDF" ? "prixUnitaireCDF" : "prixUnitaireUSD"), "prix unitaire");

  // ANTI-DOUBLON (2026-10-09) — même règle que la Liste d'achat : nom EXACT déjà au catalogue (même
  // inactif) → refus, l'article existant est montré ; noms PROCHES (actifs) → choix explicite.
  const doublon = (candidats: ArticleCandidat[], creationPossible: boolean): DoublonCreation => ({
    doublon: true, candidats, creationPossible,
    message: creationPossible
      ? `« ${designation} » ressemble à un article déjà au catalogue : utilisez-le, ou créez quand même un nouvel article. Rien n'a été créé.`
      : `« ${designation} » existe déjà au catalogue sous ce nom : utilisez-le (réactivez-le s'il est inactif). Rien n'a été créé.`,
  });
  const d = decisionArticle(designation, await catalogueCandidats());
  if (d.type === "auto") return doublon([d.article], false);
  if (d.type === "choix" && (!d.creationPossible || !creerQuandMeme)) return doublon(d.candidats, d.creationPossible);

  const art = await prisma.$transaction(async (tx) => {
    // Deux créations simultanées du même nom : verrou sur la clé du nom, puis relecture (comme la Liste d'achat).
    const cle = cleArticleExacte(designation) || designation;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`article:${cle}`}))::text AS verrou`;
    const meme = (await tx.articleStock.findMany({ select: { id: true, designation: true } })).find((a) => memeDesignation(designation, a.designation));
    if (meme) throw new Error(`« ${meme.designation} » vient d'être créé : rechargez la page et utilisez-le. Rien n'a été créé.`);
    const cree = await tx.articleStock.create({
      data: {
        designation,
        domaine,
        code: String(formData.get("code") ?? "").trim() || null,
        unite: String(formData.get("unite") ?? "").trim() || null,
        categorieId,
        fournisseurId,
        devisePrix,
        prixUnitaireUSD: devisePrix === "USD" ? prix : null,
        prixUnitaireCDF: devisePrix === "CDF" ? prix : null,
        uniteParCarton: decSaisiOptionnel(formData.get("uniteParCarton"), "unités par carton"),
        stock: {
          create: {
            quantite: 0, // le stock initial passe par la porte unique, ci-dessous
            stockMinimum: decSaisiOptionnel(formData.get("stockMinimum"), "stock minimum") ?? 0,
            seuilUrgent: decSaisiOptionnel(formData.get("seuilUrgent"), "seuil urgent") ?? 0,
          },
        },
      },
    });
    if (quantiteInitiale !== 0) await poserStocksTx(tx, [{ articleId: cree.id, quantite: quantiteInitiale }], { quoi: "Le stock initial" });
    return cree;
  });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: art.id, champ: "creation", nouvelleValeur: designation + (d.type === "choix" ? ` (créé quand même, proche de ${d.candidats.map((c) => `« ${c.designation} »`).join(", ")})` : ""), userId: user.id });
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
      // Stock du doublon cumulé par la porte unique : un doublon NÉGATIF qui ferait passer l'article
      // conservé sous 0 refuse la fusion (nommé) — corriger d'abord son stock (comptage ou mise à 0).
      if (l.stock && !l.stock.quantite.isZero()) await variationsStockTx(tx, [{ articleId: keep.id, delta: l.stock.quantite }], { verbe: "à retirer (stock négatif du doublon)" });
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
 * Change le DOMAINE (Nourriture / Boissons / Autre) de plusieurs articles — demande de Sacha du
 * 2026-10-09. Direction : écrit tout de suite ; autre compte : PROPOSITION (avant → après), comme toute
 * modification d'article. Ni stock ni mouvement ne change : seul le classement de l'article bouge.
 *
 * Une catégorie vit dans un domaine. `categorie` dit quoi faire de celle des articles déplacés :
 *  - "" (par défaut) : la catégorie DU MÊME NOM dans le nouveau domaine si elle existe, sinon « à classer » ;
 *  - "A_CLASSER" : « à classer » pour tous ;
 *  - un id : cette catégorie, qui doit appartenir au nouveau domaine.
 * Le compte rendu dit combien d'articles ont gardé leur catégorie (par son nom) et lesquels sont à classer.
 */
export const changerDomaineEnMasse = actionLisible(async (articleIds: string[], domaineSaisi: string, categorie = ""): Promise<PropositionEnvoyee | { proposition: false; message: string }> => {
  const user = await garde();
  const domaine = lireDomaine(domaineSaisi);
  const ids = [...new Set((Array.isArray(articleIds) ? articleIds : []).map(String))].filter(Boolean);
  if (ids.length === 0) throw new Error("Aucun article sélectionné.");
  const [arts, cats] = await Promise.all([
    prisma.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true, designation: true, domaine: true, categorieId: true, categorie: { select: { nom: true } } } }),
    prisma.categorieStock.findMany({ select: { id: true, nom: true, domaine: true } }),
  ]);
  if (arts.length !== ids.length) throw new Error("Article introuvable : rechargez la page.");
  const choisie = categorie && categorie !== "A_CLASSER" ? cats.find((c) => c.id === categorie) : null;
  if (categorie && categorie !== "A_CLASSER" && (!choisie || choisie.domaine !== domaine)) throw new Error("La catégorie choisie n'appartient pas au nouveau domaine : rechargez la page et choisissez-en une du nouveau domaine, ou « à classer ».");
  const memeNom = (nom: string) => cats.find((c) => c.domaine === domaine && c.nom.trim().toLowerCase() === nom.trim().toLowerCase()) ?? null;

  const aDeplacer = arts.filter((a) => a.domaine !== domaine);
  const libelle = libelleValeur("domaine", domaine);
  if (aDeplacer.length === 0) return { proposition: false, message: `Rien à changer : ${arts.length > 1 ? "ces articles sont" : "cet article est"} déjà en ${libelle}.` };
  const reprises: string[] = [];
  const aClasser: string[] = [];
  const patchs = aDeplacer.map((a) => {
    const patch: PatchArticle = { domaine };
    if (choisie) patch.categorieId = choisie.id;
    else if (a.categorieId) {
      const m = categorie === "A_CLASSER" ? null : memeNom(a.categorie?.nom ?? "");
      patch.categorieId = m?.id ?? null;
      if (m) reprises.push(a.designation); else aClasser.push(a.designation);
    }
    return { id: a.id, patch };
  });
  const detail = [
    reprises.length ? `${reprises.length} garde(nt) une catégorie du même nom` : "",
    aClasser.length ? `${aClasser.length} remis « à classer » (catégorie absente en ${libelle}) : ${aClasser.slice(0, 8).map((d) => `« ${d} »`).join(", ")}${aClasser.length > 8 ? "…" : ""}` : "",
    choisie ? `catégorie « ${choisie.nom} »` : "",
  ].filter(Boolean).join(" ; ");

  if (!estDirection(user)) {
    const r = await proposer(user, `Domaine → ${libelle}`, patchs);
    return { ...r, message: r.message + (r.proposition && detail ? ` (${detail}.)` : "") };
  }
  await prisma.$transaction(async (tx) => { for (const p of patchs) await appliquerPatchArticleTx(tx, p.id, p.patch); }, { timeout: 60000 });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: `${patchs.length} articles`, champ: "domaine (masse)", nouvelleValeur: `${libelle}${detail ? ` — ${detail}` : ""}`.slice(0, 900), userId: user.id });
  revalidatePath("/stock/catalogue", "layout");
  revalidatePath("/stock/reconciliation");
  revalidatePath("/stock/journalier");
  revalidatePath("/stock");
  const deja = arts.length - aDeplacer.length;
  return { proposition: false, message: `${aDeplacer.length} article(s) passé(s) en ${libelle}${deja ? ` (${deja} déjà dans ce domaine)` : ""}${detail ? ` ; ${detail}` : ""}. Ni stock ni mouvement n'a changé.` };
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
  const date = jourCivilKinshasa(new Date()); // jour civil de Kinshasa
  await exigerPeriodeOuverte(date);
  await prisma.$transaction(async (tx) => {
    for (const s of stocks) {
      const manque = -Number(s.quantite); // quantité positive à réinjecter pour revenir à 0
      await tx.mouvementStock.create({ data: { articleId: s.articleId, type: "ENTREE", quantite: manque, origine: "Correction stock négatif (mise à 0)", date, creeParId: user.id } });
    }
    await poserStocksTx(tx, stocks.map((s) => ({ articleId: s.articleId, quantite: 0 }))); // porte unique
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
