"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { actionLisible } from "@/lib/action-lisible";
import { decSaisiOptionnel } from "@/lib/nombre";
import { appliquerPatchArticleTx, changementsDe, lireArticlesTx, nomsReferencesTx, texteChangements, type DoublonRenommage, doublonDeRenommage, exigerCategorieActive, exigerCategorieDansLeDomaine, exigerDesignationLibre, lireDevisePrix, lireDomaine, lirePatchArticle, type PatchArticle } from "@/lib/validations-stock/article";
import { estDirection, proposerModifications, type Acteur } from "@/lib/validations-stock/demandes";
import { libelleValeur, texteDecimal } from "@/lib/validations-stock/charge";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser, journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { derniereClotureStock, exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { redirect } from "next/navigation";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { poserStocksTx, variationsStockTx } from "@/lib/validations-stock/stock-positif";
import { verrouillerStocks } from "@/lib/validations-stock/comptage";
import { catalogueCandidats } from "@/lib/achats-liste-serveur";
import { decisionArticle } from "@/lib/article-proche";
import { cleArticleExacte, memeArticle, type ArticleCandidat } from "@/lib/achats-doublons";
import { ajouterFournisseursEnMasseTx, definirHabituelEnMasseTx, definirHabituelTx, idsFournisseursParArticleTx, reporterFournisseursDesDoublonsTx, retirerFournisseursEnMasseTx } from "@/lib/article-fournisseurs";
import { valeurListeIds } from "@/lib/validations-stock/charge";
import { bilanSuppression, messageConservation, supprimerArticlesSansHistoriqueTx, type ArticleConserve, type ArticleSupprimable } from "@/lib/validations-stock/suppression-article";
import { analyserChangementUnite, type ApercuUnite } from "@/lib/validations-stock/unite-article";
import { exigerDirectionPourSupprimer } from "@/lib/suppression-direction";


async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/**
 * Réponse d'une modification d'article faite par un compte qui n'est pas la Direction : RIEN ne
 * change sur l'article, une proposition part à la Direction (« À valider »), qui valide
 * (même écriture que la sienne) ou refuse. Règle de Sacha du 2026-09-30.
 */
export type PropositionEnvoyee = { proposition: boolean; message: string };

async function proposer(user: Acteur, libelle: string, patchs: { id: string; patch: PatchArticle }[]): Promise<PropositionEnvoyee> {
  // Renommage proposé : même anti-doublon que la modification directe, refusé DÈS LA PROPOSITION (la validation le revérifie).
  // (un nom proche a déjà été confirmé par la personne dans `modifierArticle` ; seul le doublon certain bloque ici.)
  for (const p of patchs) await exigerDesignationLibre(prisma, p.id, p.patch, { procheAutorise: true });
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
  const marque = String(formData.get("marque") ?? "").trim().replace(/\s+/g, " ") || null; // facultative : « Président », « Lurpak »
  const creerQuandMeme = String(formData.get("creerQuandMeme") ?? "") === "1";
  await exigerCategorieActive(prisma, categorieId); // une catégorie archivée ne reçoit plus de nouvel article

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
  // Même désignation et MARQUES différentes (toutes deux renseignées) : deux articles, pas un doublon.
  const d = decisionArticle(designation, await catalogueCandidats(), marque);
  if (d.type === "auto") return doublon([d.article], false);
  if (d.type === "choix" && (!d.creationPossible || !creerQuandMeme)) return doublon(d.candidats, d.creationPossible);

  const art = await prisma.$transaction(async (tx) => {
    // Deux créations simultanées du même nom : verrou sur la clé du nom, puis relecture (comme la Liste d'achat).
    const cle = cleArticleExacte(designation) || designation;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`article:${cle}`}))::text AS verrou`;
    const meme = (await tx.articleStock.findMany({ select: { id: true, designation: true, marque: true } })).find((a) => memeArticle(designation, marque, a));
    if (meme) throw new Error(`« ${meme.designation} » vient d'être créé : rechargez la page et utilisez-le. Rien n'a été créé.`);
    const cree = await tx.articleStock.create({
      data: {
        designation,
        marque,
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
    if (quantiteInitiale !== 0) await poserStocksTx(tx, [{ articleId: cree.id, quantite: quantiteInitiale }], { quoi: "stock initial" });
    // Le fournisseur choisi à la création est son fournisseur HABITUEL (la liste des fournisseurs de l'article commence là).
    if (fournisseurId) await definirHabituelTx(tx, cree.id, fournisseurId, "CREATION");
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
export const modifierArticle = actionLisible(async (id: string, formData: FormData): Promise<PropositionEnvoyee | DoublonRenommage | void> => {
  const user = await garde();
  // Lecture ET validation (contenance…) avant toute écriture comme avant toute proposition.
  const patch = lirePatchArticle(formData);
  // ANTI-DOUBLON AU RENOMMAGE (2026-10-10), à deux niveaux comme « Ajouter un article » : doublon certain =
  // refus sec ; nom proche = avertissement, et « Renommer quand même » renvoie la saisie avec ce drapeau.
  // Même contrôle pour la Direction (écriture directe) et pour la proposition d'un autre rôle.
  const renommerQuandMeme = String(formData.get("renommerQuandMeme") ?? "") === "1";
  const doublon = await doublonDeRenommage(prisma, id, patch);
  if (doublon && (!doublon.creationPossible || !renommerQuandMeme)) return doublon;
  if (!estDirection(user)) return proposer(user, "Modification de l'article", [{ id, patch }]);
  // Le journal écrit ce qui a VRAIMENT changé, avant → après (état relu sous verrou, dans la même transaction).
  const changements = await prisma.$transaction(async (tx) => {
    const etat = (await lireArticlesTx(tx, [id], true)).get(id);
    const diff = etat ? changementsDe(etat, patch, await nomsReferencesTx(tx)) : [];
    await appliquerPatchArticleTx(tx, id, patch, { renommerQuandMeme });
    return diff;
  });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: id, champ: "modification", nouvelleValeur: changements.length ? texteChangements(changements) : "aucun changement", userId: user.id });
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

  const bilan = { commandesReportees: 0, commandesCumulees: 0, articlesRestoRepointes: 0, fournisseursReportes: 0 };
  await prisma.$transaction(async (tx) => {
    // CLÔTURE : rattacher à l'article conservé les mouvements d'un doublon réécrit l'historique PAR ARTICLE des
    // mois figés (consommations, rapports de ces mois). La fusion est donc refusée tant qu'un doublon a des
    // mouvements datés d'une période clôturée — la Direction rouvre ces mois (Stock → Clôture du mois),
    // fusionne, puis reclôture. Le total du stock ne change pas, mais « une période clôturée ne se réécrit pas en douce ».
    const borne = await derniereClotureStock();
    if (borne) {
      const limite = new Date(Date.UTC(borne.annee, borne.mois, 1)); // 1er jour du mois qui suit le dernier mois clôturé
      const figes = await tx.mouvementStock.groupBy({ by: ["articleId"], where: { articleId: { in: losers.map((l) => l.id) }, date: { lt: limite } }, _count: { _all: true } });
      if (figes.length > 0) {
        const noms = figes.map((f) => `« ${losers.find((l) => l.id === f.articleId)?.designation ?? "?"} » (${f._count._all} mouvement(s))`).join(", ");
        throw new Error(`Fusion refusée : des mouvements de ${figes.length > 1 ? "doublons" : "ce doublon"} sont datés de la période clôturée (jusqu'à ${String(borne.mois).padStart(2, "0")}/${borne.annee}) — ${noms}. Les rattacher à « ${keep.designation} » réécrirait l'historique par article de ces mois figés. Direction : Stock → Clôture du mois pour rouvrir ces mois, fusionner, puis les clôturer à nouveau. Rien n'a été fusionné.`);
      }
    }
    // Stock des doublons cumulé en UNE variation (l'ordre des doublons ne compte pas : 3 − 5 + 5 = 3),
    // par la porte unique : un total qui ferait passer l'article conservé sous 0 refuse la fusion,
    // nommée — corriger d'abord le stock négatif du doublon (comptage ou mise à 0).
    const cumul = losers.reduce((t, l) => (l.stock ? t.plus(l.stock.quantite) : t), new Prisma.Decimal(0));
    if (!cumul.isZero()) await variationsStockTx(tx, [{ articleId: keep.id, delta: cumul }], { verbe: "à retirer (stock négatif des doublons)" });
    // Seuils : le plus ÉLEVÉ des articles fusionnés (le moins élevé laisserait manquer l'alerte que l'autre aurait donnée) ;
    // les articles endommagés s'additionnent comme le stock. Écrits hors `quantite` (porte unique).
    const stocks = arts.map((a) => a.stock).filter((x): x is NonNullable<typeof x> => !!x);
    if (stocks.length > 0) {
      const max = (champ: "stockMinimum" | "seuilUrgent") => stocks.reduce((m, x) => (x[champ].greaterThan(m) ? x[champ] : m), new Prisma.Decimal(0));
      const stockMinimum = max("stockMinimum"), seuilUrgent = max("seuilUrgent");
      const quantiteEndommagee = stocks.reduce((t, x) => t.plus(x.quantiteEndommagee), new Prisma.Decimal(0));
      await tx.stock.upsert({
        where: { articleId: keep.id },
        update: { stockMinimum, seuilUrgent, quantiteEndommagee },
        create: { articleId: keep.id, quantite: 0, stockMinimum, seuilUrgent, quantiteEndommagee },
      });
    }
    // Commandes du restaurant : `CommandeResto.articleId` est en cascade — sans report, supprimer le doublon EFFAÇAIT
    // ses commandes (la comparaison commande / livraison perdait des jours). Elles passent à l'article conservé ;
    // un jour déjà commandé sur l'article conservé (unicité article + date) CUMULE les deux quantités.
    const deLArticleGarde = new Map((await tx.commandeResto.findMany({ where: { articleId: keep.id } })).map((c) => [c.date.toISOString().slice(0, 10), c]));
    // Fournisseurs des doublons : reportés sur l'article conservé, sans doublon de couple (leurs liens partent en
    // cascade avec les doublons). Son habituel reste le sien ; sans habituel, il adopte celui d'un doublon.
    const fournisseursReportes = await reporterFournisseursDesDoublonsTx(tx, keep.id, losers.map((l) => l.id));
    bilan.fournisseursReportes = fournisseursReportes.reportes;
    for (const l of losers) {
      for (const c of await tx.commandeResto.findMany({ where: { articleId: l.id } })) {
        const jour = c.date.toISOString().slice(0, 10);
        const existante = deLArticleGarde.get(jour);
        if (existante) {
          deLArticleGarde.set(jour, await tx.commandeResto.update({ where: { id: existante.id }, data: { quantite: existante.quantite.plus(c.quantite) } }));
          await tx.commandeResto.delete({ where: { id: c.id } });
          bilan.commandesCumulees++;
        } else {
          deLArticleGarde.set(jour, await tx.commandeResto.update({ where: { id: c.id }, data: { articleId: keep.id } }));
          bilan.commandesReportees++;
        }
      }
      // Articles du restaurant rattachés au doublon (un article du restaurant peut en avoir plusieurs : table ArticleRestoStock) :
      // leur lien SUIT l'article conservé, au lieu de disparaître avec le doublon (cascade). Un article du restaurant déjà
      // rattaché à l'article conservé garde son seul lien : jamais deux fois le même couple.
      const liens = await tx.articleRestoStock.findMany({ where: { articleStockId: l.id }, select: { id: true, articleRestoId: true } });
      if (liens.length > 0) {
        const dejaSurGarde = new Set((await tx.articleRestoStock.findMany({ where: { articleStockId: keep.id, articleRestoId: { in: liens.map((x) => x.articleRestoId) } }, select: { articleRestoId: true } })).map((x) => x.articleRestoId));
        const aRepointer = liens.filter((x) => !dejaSurGarde.has(x.articleRestoId)).map((x) => x.id);
        if (aRepointer.length > 0) bilan.articlesRestoRepointes += (await tx.articleRestoStock.updateMany({ where: { id: { in: aRepointer } }, data: { articleStockId: keep.id } })).count;
      }
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
      await tx.articleStock.delete({ where: { id: l.id } });
    }
  });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: keep.id, champ: "fusion", nouvelleValeur: `${losers.length} doublon(s) fusionné(s) → ${keep.designation}${bilan.commandesReportees + bilan.commandesCumulees > 0 ? ` · commandes du restaurant : ${bilan.commandesReportees} reportée(s), ${bilan.commandesCumulees} cumulée(s) (même jour)` : ""}${bilan.articlesRestoRepointes > 0 ? ` · ${bilan.articlesRestoRepointes} article(s) du restaurant rattaché(s)` : ""}${bilan.fournisseursReportes > 0 ? ` · ${bilan.fournisseursReportes} fournisseur(s) reporté(s)` : ""}`, userId: user.id });
  revalidatePath("/stock/catalogue");
});

/** Catégorise en masse : affecte une catégorie à plusieurs articles. */
export const categoriserEnMasse = actionLisible(async (articleIds: string[], categorieId: string) => {
  const user = await garde();
  for (const id of new Set(articleIds.map(String))) await exigerCategorieActive(prisma, categorieId, id); // archivée : refusée (sauf pour qui la porte déjà)
  await exigerCategorieDansLeDomaine(prisma, [...new Set(articleIds.map(String))].filter(Boolean), categorieId); // du domaine de chaque article, sinon refus qui les nomme (tout ou rien)
  if (!estDirection(user)) {
    if (articleIds.length === 0 || !categorieId) return;
    return proposer(user, "Catégorie en masse", [...new Set(articleIds.map(String))].filter(Boolean).map((id) => ({ id, patch: { categorieId } })));
  }
  if (articleIds.length === 0 || !categorieId) return;
  await prisma.articleStock.updateMany({ where: { id: { in: articleIds } }, data: { categorieId } });
  // Le journal garde le NOM de la catégorie (un id ne dit rien) ; l'id suit entre parenthèses si le nom est introuvable.
  const cat = await prisma.categorieStock.findUnique({ where: { id: categorieId }, select: { nom: true } });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: `${articleIds.length} articles`, champ: "categorie (masse)", nouvelleValeur: cat?.nom ?? categorieId, userId: user.id });
  revalidatePath("/stock/catalogue");
});

/** Active ou désactive plusieurs articles d'un coup. */
export const basculerActifArticles = actionLisible(async (articleIds: string[], actif: boolean) => {
  const user = await garde();
  const uniq = [...new Set(articleIds.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  if (!estDirection(user)) return proposer(user, actif ? "Activation en masse" : "Désactivation en masse", uniq.map((id) => ({ id, patch: { actif } })));
  const n = await prisma.articleStock.updateMany({ where: { id: { in: uniq } }, data: { actif } });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: uniq.length === 1 ? uniq[0] : "lot", champ: "actif", nouvelleValeur: `${n.count} article(s) ${actif ? "activé(s)" : "désactivé(s)"}`, userId: user.id });
  revalidatePath("/stock/catalogue", "layout"); // l'Inventaire ET les fiches article (badge « Inactif », bouton Désactiver / Réactiver)
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

// ── Fournisseurs d'un article (2026-10-16) ──────────────────────────────────────────────────────────────────────
// Un article a PLUSIEURS fournisseurs, dont un HABITUEL. Trois gestes, en lot (articles) comme sur une fiche :
// « habituel », « ajouter », « retirer ». Direction : écriture directe, journalisée ; autre rôle : PROPOSITION
// (avant → après) comme toute modification d'article. L'alimentation automatique par un achat réel n'est pas ici :
// elle vit dans l'achat lui-même (src/lib/article-fournisseurs.ts), sans validation, car c'est un fait constaté.

type OpFournisseur = "HABITUEL" | "AJOUTER" | "RETIRER";
export type ReponseFournisseurs = PropositionEnvoyee | { proposition: false; message: string };

const LIBELLE_OP: Record<OpFournisseur, string> = { HABITUEL: "Fournisseur habituel", AJOUTER: "Ajout de fournisseur", RETIRER: "Retrait de fournisseur" };

async function gestesFournisseurs(user: Acteur, articleIds: string[], op: OpFournisseur, fournisseurIds: string[]): Promise<ReponseFournisseurs> {
  const ids = [...new Set((Array.isArray(articleIds) ? articleIds : []).map(String))].filter(Boolean);
  const fours = [...new Set((Array.isArray(fournisseurIds) ? fournisseurIds : []).map(String))].filter(Boolean);
  if (ids.length === 0) throw new Error("Aucun article sélectionné.");
  if (fours.length === 0) throw new Error("Choisissez un fournisseur.");
  if (op === "HABITUEL" && fours.length !== 1) throw new Error("Un article n'a qu'un seul fournisseur habituel : choisissez-en un.");
  const [existants, articles] = await Promise.all([
    prisma.fournisseur.findMany({ where: { id: { in: fours } }, select: { id: true, nom: true } }),
    prisma.articleStock.count({ where: { id: { in: ids } } }),
  ]);
  if (existants.length !== fours.length) throw new Error("Fournisseur introuvable : rechargez la page.");
  if (articles !== ids.length) throw new Error("Article introuvable : rechargez la page.");
  const noms = existants.map((f) => f.nom).sort((a, b) => a.localeCompare(b, "fr")).join(", ");

  if (!estDirection(user)) {
    // La liste proposée est la liste COMPLÈTE après le geste : on part de ce que chaque article a aujourd'hui.
    const actuels = op === "HABITUEL" ? null : await idsFournisseursParArticleTx(prisma, ids);
    return proposer(user, LIBELLE_OP[op], ids.map((id) => ({
      id,
      patch: op === "HABITUEL"
        ? { fournisseurId: fours[0] }
        : { fournisseursIds: valeurListeIds(op === "AJOUTER" ? [...(actuels!.get(id) ?? []), ...fours] : (actuels!.get(id) ?? []).filter((x) => !fours.includes(x))) },
    })));
  }

  const n = await prisma.$transaction(async (tx) => {
    if (op === "HABITUEL") return definirHabituelEnMasseTx(tx, ids, fours[0]);
    if (op === "AJOUTER") return ajouterFournisseursEnMasseTx(tx, ids, fours, "MANUEL");
    return retirerFournisseursEnMasseTx(tx, ids, fours);
  });
  const verbe = op === "HABITUEL" ? `habituel : ${noms}` : op === "AJOUTER" ? `ajouté : ${noms}` : `retiré : ${noms}`;
  await journaliser(prisma, { entite: "ArticleStock", entiteId: ids.length === 1 ? ids[0] : `${ids.length} articles`, champ: "fournisseurs", nouvelleValeur: `${verbe} (${n} article(s) ou lien(s) modifié(s))`, userId: user.id });
  revalidatePath("/stock/catalogue", "layout");
  revalidatePath("/stock/fournisseurs", "layout");
  return { proposition: false, message: n === 0 ? "Rien à changer : c'était déjà le cas." : `Fournisseurs mis à jour (${verbe}).` };
}

/**
 * Définit le fournisseur HABITUEL de plusieurs articles d'un coup (il rejoint la liste de chacun ; l'ancien habituel y
 * reste). Ancienne action « Fournisseur en masse » : même nom, même effet pour l'habituel ; vide = plus d'habituel
 * (la liste des fournisseurs de l'article ne change pas — pour en retirer un, voir `retirerFournisseurEnMasse`).
 */
export const definirFournisseurEnMasse = actionLisible(async (articleIds: string[], fournisseurId: string): Promise<ReponseFournisseurs | void> => {
  const user = await garde();
  const ids = [...new Set(articleIds.map(String))].filter(Boolean);
  if (ids.length === 0) return;
  if (fournisseurId) return gestesFournisseurs(user, ids, "HABITUEL", [fournisseurId]);
  if (!estDirection(user)) return proposer(user, "Fournisseur habituel retiré", ids.map((id) => ({ id, patch: { fournisseurId: null } })));
  const n = await prisma.$transaction((tx) => definirHabituelEnMasseTx(tx, ids, null));
  await journaliser(prisma, { entite: "ArticleStock", entiteId: ids.length === 1 ? ids[0] : `${ids.length} articles`, champ: "fournisseurs", nouvelleValeur: `plus de fournisseur habituel (${n} article(s))`, userId: user.id });
  revalidatePath("/stock/catalogue", "layout");
  return { proposition: false, message: n === 0 ? "Rien à changer : aucun de ces articles n'avait de fournisseur habituel." : "Fournisseur habituel retiré (les fournisseurs restent dans la liste de chaque article)." };
});

/** Ajoute un fournisseur à plusieurs articles d'un coup, sans changer leur habituel. */
export const ajouterFournisseurEnMasse = actionLisible(async (articleIds: string[], fournisseurId: string): Promise<ReponseFournisseurs> => gestesFournisseurs(await garde(), articleIds, "AJOUTER", [fournisseurId]));

/** Retire un fournisseur de plusieurs articles d'un coup (l'habituel retiré laisse l'article sans habituel). */
export const retirerFournisseurEnMasse = actionLisible(async (articleIds: string[], fournisseurId: string): Promise<ReponseFournisseurs> => gestesFournisseurs(await garde(), articleIds, "RETIRER", [fournisseurId]));

/** Fiche article : définit le fournisseur habituel. */
export const definirFournisseurHabituel = actionLisible(async (articleId: string, fournisseurId: string): Promise<ReponseFournisseurs> => gestesFournisseurs(await garde(), [articleId], "HABITUEL", [fournisseurId]));

/** Fiche article : ajoute un ou plusieurs fournisseurs à l'article. */
export const ajouterFournisseursArticle = actionLisible(async (articleId: string, fournisseurIds: string[]): Promise<ReponseFournisseurs> => gestesFournisseurs(await garde(), [articleId], "AJOUTER", fournisseurIds));

/** Fiche article : retire un ou plusieurs fournisseurs de l'article. */
export const retirerFournisseursArticle = actionLisible(async (articleId: string, fournisseurIds: string[]): Promise<ReponseFournisseurs> => gestesFournisseurs(await garde(), [articleId], "RETIRER", fournisseurIds));

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
    prisma.categorieStock.findMany({ select: { id: true, nom: true, domaine: true, actif: true } }),
  ]);
  if (arts.length !== ids.length) throw new Error("Article introuvable : rechargez la page.");
  const choisie = categorie && categorie !== "A_CLASSER" ? cats.find((c) => c.id === categorie) : null;
  if (categorie && categorie !== "A_CLASSER" && (!choisie || choisie.domaine !== domaine)) throw new Error("La catégorie choisie n'appartient pas au nouveau domaine : rechargez la page et choisissez-en une du nouveau domaine, ou « à classer ».");
  if (choisie && !choisie.actif) throw new Error(`La catégorie « ${choisie.nom} » est archivée : choisissez une catégorie active du nouveau domaine, ou « à classer ».`);
  const memeNom = (nom: string) => cats.find((c) => c.actif && c.domaine === domaine && c.nom.trim().toLowerCase() === nom.trim().toLowerCase()) ?? null;

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
  const date = jourCivilKinshasa(new Date()); // jour civil de Kinshasa
  const nb = await prisma.$transaction(async (tx) => {
    // Lignes Stock VERROUILLÉES (`FOR UPDATE`, ids triés) AVANT d'être relues : une entrée simultanée
    // qui relèverait un de ces stocks est attendue, puis relue — elle n'est pas écrasée par la remise à 0.
    // Seuls les stocks encore négatifs APRÈS le verrou sont corrigés.
    const stocks = (await verrouillerStocks(tx, ids)).filter((s) => s.quantite.isNegative() && !s.quantite.isZero());
    if (stocks.length === 0) return 0;
    await exigerPeriodeOuverte(date); // période close : rien n'est écrit (la transaction est annulée)
    for (const s of stocks) {
      const manque = s.quantite.negated(); // quantité positive à réinjecter pour revenir à 0 (décimal exact)
      await tx.mouvementStock.create({ data: { articleId: s.articleId, type: "ENTREE", quantite: manque, origine: "Correction stock négatif (mise à 0)", date, creeParId: user.id } });
    }
    await poserStocksTx(tx, stocks.map((s) => ({ articleId: s.articleId, quantite: 0 }))); // porte unique
    return stocks.length;
  }, { timeout: 60000 });
  if (nb === 0) return { corriges: 0 };
  await journaliser(prisma, { entite: "Stock", entiteId: `${nb} articles`, champ: "correction stock négatif", nouvelleValeur: "remis à 0 (ajustement)", userId: user.id });
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
  return { corriges: nb };
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
 * (mouvements, lignes de facture ou de bon de commande, comptages, commandes resto, fiches techniques,
 * demande « À valider » en attente) ne peut pas être supprimé — la traçabilité prime : désactivez-le
 * (il disparaît des listes) ou fusionnez-le. Un article vierge est supprimé avec sa ligne de stock, et
 * journalisé. Même règle, même code que la suppression groupée (lib/validations-stock/suppression-article.ts).
 */
export async function supprimerArticle(id: string) {
  await formulaireLisible(`/stock/catalogue/${id}`, async () => {
    const user = await verifySession();
    requireModule(user, "stock");
    requireRole(user, ["ADMIN"]);

    const bilan = await prisma.$transaction((tx) => supprimerArticlesSansHistoriqueTx(tx, user.id, [id]), { timeout: 60000 });
    if (bilan.introuvables > 0) throw new Error("Article introuvable : il a peut-être déjà été supprimé ou fusionné.");
    if (bilan.conserves.length > 0) throw new Error(messageConservation(bilan.conserves[0]));
    revalidatePath("/stock/catalogue", "layout");
    revalidatePath("/stock");
  });
  redirect("/stock/catalogue"); // succès : retour au catalogue
}

// ── Suppression groupée (2026-10-14) ──────────────────────────────────────────────────────────────────────────
// Demande de la Direction : « on ne peut pas supprimer des articles de l'inventaire ». Seule la Direction supprime.
// Une seule règle (voir `supprimerArticle`) : les articles SANS historique sont supprimés, ceux qui en ont un sont
// CONSERVÉS et nommés avec leur raison — la Direction les désactive ou les fusionne. Tout ou rien en cas d'erreur.

/** Aperçu avant de supprimer : ce qui partira, ce qui restera et pourquoi. Lecture seule. */
export type ApercuSuppression = { supprimables: ArticleSupprimable[]; conserves: ArticleConserve[]; introuvables: number };
export type ResultatSuppression = { proposition: false; message: string; supprimes: number; conserves: ArticleConserve[] };

const idsUniques = (articleIds: string[]) => [...new Set((Array.isArray(articleIds) ? articleIds : []).map(String))].filter(Boolean);

export const apercuSuppressionArticles = actionLisible(async (articleIds: string[]): Promise<ApercuSuppression> => {
  const user = await garde();
  exigerDirectionPourSupprimer(user);
  const ids = idsUniques(articleIds);
  if (ids.length === 0) throw new Error("Aucun article sélectionné.");
  return bilanSuppression(prisma, ids);
});

export const supprimerArticlesEnMasse = actionLisible(async (articleIds: string[]): Promise<ResultatSuppression> => {
  const user = await garde();
  exigerDirectionPourSupprimer(user);
  const ids = idsUniques(articleIds);
  if (ids.length === 0) throw new Error("Aucun article sélectionné.");
  const bilan = await prisma.$transaction((tx) => supprimerArticlesSansHistoriqueTx(tx, user.id, ids), { timeout: 60000 });
  revalidatePath("/stock/catalogue", "layout");
  revalidatePath("/stock");
  revalidatePath("/stock/restaurant");
  const n = bilan.supprimables.length, k = bilan.conserves.length;
  const morceaux = [
    n === 0 ? "Aucun article supprimé" : `${n} supprimé${n > 1 ? "s" : ""}`,
    k > 0 ? `${k} conservé${k > 1 ? "s" : ""} car ${k > 1 ? "ils ont" : "il a"} un historique (désactivez-${k > 1 ? "les" : "le"} ou fusionnez-${k > 1 ? "les" : "le"})` : null,
    bilan.introuvables > 0 ? `${bilan.introuvables} introuvable${bilan.introuvables > 1 ? "s" : ""} (déjà supprimé${bilan.introuvables > 1 ? "s" : ""} ou fusionné${bilan.introuvables > 1 ? "s" : ""})` : null,
  ].filter(Boolean);
  return { proposition: false, message: morceaux.join(" · "), supprimes: n, conserves: bilan.conserves };
});

// ── Unité en masse (2026-10-14) ───────────────────────────────────────────────────────────────────────────────
// Demande de la Direction : « on ne peut pas changer l'unité de plusieurs articles en actions groupées ». Direction :
// écrit tout de suite ; autre compte : PROPOSITION (avant → après), comme toute modification d'article.
//
// RIEN n'est converti : les quantités et les prix gardent les mêmes chiffres, relus dans la nouvelle unité (2 kg
// deviennent 2 g). Un article qui a du stock, un historique, un prix, une fiche technique ou un rattachement au
// restaurant demande donc une CONFIRMATION qui le compte et le nomme (lib/validations-stock/unite-article.ts) ; le
// serveur la réclame lui-même (réponse `confirmation`, rien d'écrit) et ne l'accepte que pour les articles vus.

export type ReponseUnite = PropositionEnvoyee | { proposition: false; message: string } | { confirmation: true; apercu: ApercuUnite };

const LONGUEUR_MAX_UNITE = 40;

export const changerUniteEnMasse = actionLisible(async (articleIds: string[], uniteSaisie: string, confirmes: string[] = []): Promise<ReponseUnite> => {
  const user = await garde();
  const ids = idsUniques(articleIds);
  if (ids.length === 0) throw new Error("Aucun article sélectionné.");
  const unite = String(uniteSaisie ?? "").trim().replace(/\s+/g, " ");
  if (!unite) throw new Error("Choisissez ou saisissez l'unité à appliquer.");
  if (unite.length > LONGUEUR_MAX_UNITE) throw new Error(`L'unité est trop longue (${LONGUEUR_MAX_UNITE} caractères au plus).`);

  if (!estDirection(user)) {
    const r = await proposer(user, "Unité en masse", ids.map((id) => ({ id, patch: { unite } })));
    if (!r.proposition) return r;
    // La proposition part dans tous les cas ; on dit au demandeur ce que la Direction verra à l'approbation.
    const { apercu } = await analyserChangementUnite(prisma, ids, unite);
    const k = apercu.aConfirmer.length;
    return k === 0 ? r : { ...r, message: `${r.message} ${k} article${k > 1 ? "s" : ""} ${k > 1 ? "ont" : "a"} du stock, un historique ou un rattachement : la Direction le verra à l'approbation (rien n'est converti).` };
  }

  const sortie = await prisma.$transaction(async (tx) => {
    // Articles verrouillés (ids triés) AVANT l'analyse : un mouvement saisi au même instant est attendu, puis vu.
    const tries = [...ids].sort();
    await tx.$queryRaw`SELECT "id" FROM "stock"."ArticleStock" WHERE "id" IN (${Prisma.join(tries)}) ORDER BY "id" FOR UPDATE`;
    const { lignes, apercu } = await analyserChangementUnite(tx, ids, unite);
    if (lignes.length !== ids.length) throw new Error("Article introuvable : rechargez la page.");
    const vus = new Set((Array.isArray(confirmes) ? confirmes : []).map(String));
    if (apercu.aConfirmer.some((l) => !vus.has(l.id))) return { genre: "confirmation" as const, apercu };
    const aEcrire = lignes.filter((l) => l.nature !== "INCHANGE");
    if (aEcrire.length === 0) return { genre: "rien" as const, apercu };
    await tx.articleStock.updateMany({ where: { id: { in: aEcrire.map((l) => l.id) } }, data: { unite } });
    // Le journal garde l'ANCIENNE et la NOUVELLE unité de chaque article, et dit ce qui a été confirmé.
    const journal: EntreeJournal[] = aEcrire.map((l) => ({
      entite: "ArticleStock", entiteId: l.id, champ: "unite (masse)", ancienneValeur: l.avant, nouvelleValeur: l.apres, userId: user.id,
    }));
    const risque = aEcrire.filter((l) => l.confirmer);
    journal.push({
      entite: "ArticleStock", entiteId: `${aEcrire.length} articles`, champ: "unite (masse)", userId: user.id,
      nouvelleValeur: `${unite} : ${aEcrire.length} article(s)${risque.length ? `, dont ${risque.length} avec stock, historique ou rattachement confirmé(s) (mêmes chiffres, rien converti) : ${risque.map((l) => `${l.nom} (${l.avant ?? "—"} → ${l.apres})`).join(" ; ")}` : ""}`.slice(0, 900),
    });
    await journaliserPlusieurs(tx, journal);
    return { genre: "ecrit" as const, ecrit: aEcrire.length, apercu };
  }, { timeout: 60000 });

  if (sortie.genre === "confirmation") return { confirmation: true, apercu: sortie.apercu };
  if (sortie.genre === "rien") return { proposition: false, message: `Rien à changer : ${ids.length > 1 ? "ces articles sont" : "cet article est"} déjà en « ${unite} ».` };
  revalidatePath("/stock/catalogue", "layout");
  revalidatePath("/stock");
  revalidatePath("/stock/journalier");
  revalidatePath("/stock/restaurant");
  revalidatePath("/stock/fiches");
  revalidatePath("/stock/mouvements");
  const a = sortie.apercu;
  const dont = a.aConfirmer.length;
  const deja = a.nbInchanges;
  return {
    proposition: false,
    message: `Unité « ${unite} » appliquée à ${sortie.ecrit} article${sortie.ecrit > 1 ? "s" : ""}${deja ? ` (${deja} déjà en « ${unite} »)` : ""}${dont ? `, dont ${dont} avec stock, historique ou rattachement : leurs quantités et prix sont restés les mêmes chiffres, rien n'a été converti` : ""}.`,
  };
});

/** Cloche de l'espace Stock : un article créé hors Direction (Inventaire ou Liste d'achat). */
async function signalerCreationArticle(id: string, designation: string, auteurNom: string) {
  await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `Nouvel article « ${designation} » créé par ${auteurNom}`.slice(0, 480), lien: `/stock/catalogue/${id}`, refId: `article-cree:${id}` } });
}
