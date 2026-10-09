import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { MOTIF_LIVRAISON_RESTAURANT } from "@/lib/stock-restaurant";
import { planifierRattachementsAuto, type CibleAuto, type DecisionAuto, type RestoAuto } from "@/lib/fiches/rattachement-resto";
import { notifierGesteStock, type AuteurGeste } from "@/lib/validations-stock/geste-notifie";
import { libelleArticle } from "@/lib/libelle-article";

// RATTACHEMENT AUTOMATIQUE des livraisons au restaurant — demande de Sacha (2026-10-08) : « je veux
// un rattachement automatique ». La RÈGLE est pure (lib/fiches/rattachement-resto.ts,
// `planifierRattachementsAuto`) ; ici, la lecture et l'écriture. Deux déclencheurs, une seule fonction :
//   - SORTIE : après une sortie « Livraison restaurant » (mouvement.ts → appliquerMouvementManuel),
//     APRÈS sa transaction — la sortie est déjà écrite, et le rattachement ne la fait jamais échouer ;
//   - BOUTON : « Rattacher automatiquement (N) » du bandeau de Stock → Restaurant (arriéré).
// Jamais à l'affichage d'une page (une page ne fait que LIRE le plan : `planRattachementAuto`).
// Chaque écriture est journalisée « (automatique) » ; un compte non-Direction notifie la Direction.

type Client = Prisma.TransactionClient | typeof prisma;

export type CompteRenduAuto = {
  rattaches: { designationResto: string; designationCatalogue: string; espace: "CUISINE" | "BAR" }[];
  crees: { designation: string; espace: "CUISINE" | "BAR"; unite: string; categorie: string }[];
  laisses: { designationCatalogue: string; raison: string }[];
  /** Panne pendant le rattachement : rien n'a été écrit (transaction annulée). */
  erreur?: string;
};

const VIDE: CompteRenduAuto = { rattaches: [], crees: [], laisses: [] };

/** Articles du catalogue (parmi `ids`) qui ont au moins une sortie « Livraison restaurant ». */
async function livres(client: Client, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const m = await client.mouvementStock.findMany({
    where: { articleId: { in: [...new Set(ids)] }, type: "SORTIE", categorieSortie: MOTIF_LIVRAISON_RESTAURANT },
    distinct: ["articleId"], select: { articleId: true },
  });
  return m.map((x) => x.articleId);
}

/** Cibles (triées : la règle les traite dans l'ordre) et TOUS les articles du restaurant. */
async function lireEtat(client: Client, ids: string[]): Promise<{ cibles: CibleAuto[]; restos: RestoAuto[]; catalogue: { id: string; designation: string; nomCourt: string | null }[] }> {
  const [cat, restos, catalogue] = await Promise.all([
    client.articleStock.findMany({
      where: { id: { in: ids } },
      orderBy: [{ designation: "asc" }, { id: "asc" }],
      select: { id: true, designation: true, nomCourt: true, actif: true, domaine: true, unite: true, contenance: true, contenanceUnite: true, categorie: { select: { nom: true } } },
    }),
    client.articleResto.findMany({
      orderBy: [{ espace: "asc" }, { ordre: "asc" }, { designation: "asc" }],
      select: { id: true, designation: true, espace: true, unite: true, actif: true, articleStockId: true, articleStock: { select: { designation: true } } },
    }),
    client.articleStock.findMany({ where: { actif: true }, select: { id: true, designation: true, nomCourt: true } }),
  ]);
  return {
    catalogue,
    cibles: cat.map((a) => ({
      id: a.id, designation: a.designation, nomCourt: a.nomCourt, actif: a.actif, domaine: a.domaine, unite: a.unite,
      contenance: a.contenance?.toString() ?? null, contenanceUnite: a.contenanceUnite, categorie: a.categorie?.nom ?? null,
    })),
    restos: restos.map((r) => ({ id: r.id, designation: r.designation, espace: r.espace, unite: r.unite, actif: r.actif, articleStockId: r.articleStockId, rattacheA: r.articleStock?.designation ?? null })),
  };
}

/**
 * Plan du rattachement automatique pour des articles du catalogue livrés (LECTURE SEULE : c'est ce
 * que le bandeau annonce avant le clic). Les articles jamais livrés au restaurant sont ignorés.
 */
export async function planRattachementAuto(articleStockIds: string[]): Promise<DecisionAuto[]> {
  const ids = await livres(prisma, articleStockIds);
  if (ids.length === 0) return [];
  const { cibles, restos, catalogue } = await lireEtat(prisma, ids);
  return planifierRattachementsAuto(cibles, restos, catalogue);
}

/**
 * Applique la règle et ÉCRIT : rattachements et créations, journalisés « (automatique) ». Tout se
 * relit SOUS UN VERROU (deux sorties simultanées du même article nouveau ne créent pas deux lignes),
 * et chaque rattachement n'est posé que si l'article du restaurant est ENCORE libre. Ne lève JAMAIS :
 * une panne rend `erreur` et n'écrit rien. Notification de la Direction si l'auteur n'en est pas.
 */
export async function rattacherAutomatiquement(
  auteur: AuteurGeste, articleStockIds: string[], declencheur: "SORTIE" | "BOUTON",
  // Une sortie notifie déjà la Direction (un geste, une notification) : l'appelant passe `notifier: false`.
  { notifier = true }: { notifier?: boolean } = {},
): Promise<CompteRenduAuto> {
  let cr: CompteRenduAuto;
  try {
    cr = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('stock.rattachement-resto-auto'))`;
      const ids = await livres(tx, articleStockIds);
      if (ids.length === 0) return VIDE;
      const { cibles, restos, catalogue } = await lireEtat(tx, ids);
      const decisions = planifierRattachementsAuto(cibles, restos, catalogue);
      const nom = new Map(cibles.map((c) => [c.id, libelleArticle(c)])); // nom AFFICHÉ du compte rendu (contenance comprise)
      const out: CompteRenduAuto = { rattaches: [], crees: [], laisses: [] };
      const journal: EntreeJournal[] = [];
      const ordres = new Map<"CUISINE" | "BAR", number>();
      const ordreSuivant = async (espace: "CUISINE" | "BAR") => {
        if (!ordres.has(espace)) ordres.set(espace, (await tx.articleResto.aggregate({ where: { espace }, _max: { ordre: true } }))._max.ordre ?? 0);
        const n = ordres.get(espace)! + 1;
        ordres.set(espace, n);
        return n;
      };
      for (const d of decisions) {
        const designationCatalogue = nom.get(d.articleStockId) ?? "";
        if (d.action === "LAISSER") { out.laisses.push({ designationCatalogue, raison: d.raison }); continue; }
        if (d.action === "RATTACHER") {
          // Garde « encore libre et actif » dans la requête même (comme accepterPropositions).
          const r = await tx.articleResto.updateMany({ where: { id: d.articleRestoId, articleStockId: null, actif: true }, data: { articleStockId: d.articleStockId } });
          if (r.count !== 1) { out.laisses.push({ designationCatalogue, raison: `« ${d.designationResto} » a changé entre-temps : rechargez la page` }); continue; }
          journal.push({ entite: "ArticleResto", entiteId: d.articleRestoId, champ: "articleStockId (automatique)", ancienneValeur: null, nouvelleValeur: d.articleStockId, userId: auteur.id });
          out.rattaches.push({ designationResto: d.designationResto, designationCatalogue, espace: d.espace });
          continue;
        }
        // Stock de base VIDE (null, « — ») : jamais 0, la Direction le fixera.
        const cree = await tx.articleResto.create({
          data: { espace: d.espace, designation: d.designation, unite: d.unite, categorie: d.categorie, stockBaseJournalier: null, articleStockId: d.articleStockId, ordre: await ordreSuivant(d.espace) },
          select: { id: true },
        });
        journal.push({
          entite: "ArticleResto", entiteId: cree.id, champ: "creation (automatique)", ancienneValeur: null,
          nouvelleValeur: `« ${d.designation} » — ${d.espace === "BAR" ? "Bar" : "Cuisine"}, ${d.unite}, ${d.categorie} ; rattaché à ${d.articleStockId} (${declencheur === "SORTIE" ? "à la sortie Livraison restaurant" : "bouton du bandeau"})`,
          userId: auteur.id,
        });
        out.crees.push({ designation: d.designation, espace: d.espace, unite: d.unite, categorie: d.categorie });
      }
      await journaliserPlusieurs(tx, journal);
      return out;
    }, { timeout: 30_000 }); // un arriéré de plusieurs dizaines d'articles, requêtes en série vers la base distante
  } catch (e) {
    console.error("[stock] rattachement automatique au restaurant en échec (rien n'a été écrit) :", e);
    return { ...VIDE, erreur: "Le rattachement automatique n'a pas pu se faire (rien n'a été écrit) : réessayez avec le bouton du bandeau, dans Stock → Restaurant." };
  }
  if (notifier && cr.rattaches.length + cr.crees.length > 0) {
    await notifierGesteStock(auteur, { genre: "RATTACHEMENT_RESTO", declencheur, rattaches: cr.rattaches.map((r) => r.designationResto), crees: cr.crees.map((c) => c.designation) });
  }
  return cr;
}

/** Ce qui a été ÉCRIT, en une phrase : « « Sel » rattaché au stock du restaurant ; « Farfalle » (Cuisine) ajouté… ». */
export function resumeEcritures(cr: CompteRenduAuto): string {
  const parties: string[] = [];
  if (cr.rattaches.length) parties.push(`${cr.rattaches.map((r) => `« ${r.designationResto} »`).join(", ")} rattaché${cr.rattaches.length > 1 ? "s" : ""} au stock du restaurant`);
  if (cr.crees.length) parties.push(`${cr.crees.map((c) => `« ${c.designation} » (${c.espace === "BAR" ? "Bar" : "Cuisine"})`).join(", ")} ajouté${cr.crees.length > 1 ? "s" : ""} au stock du restaurant`);
  return parties.join(" ; ");
}

/** Compte-rendu complet pour l'auteur : les écritures, puis ce qui reste à rattacher à la main et pourquoi. */
export function resumeCompteRendu(cr: CompteRenduAuto): string {
  const parties = [resumeEcritures(cr)].filter((x) => x !== "");
  if (cr.laisses.length) parties.push(`à rattacher à la main dans Stock → Restaurant : ${cr.laisses.map((l) => `« ${l.designationCatalogue} » (${l.raison})`).join(", ")}`);
  return parties.join(" ; ");
}
