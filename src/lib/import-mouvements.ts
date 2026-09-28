import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { cleAlnum } from "./texte";
import { meilleurArticle } from "./article-match";
import { exigerPeriodesOuvertes } from "./cloture-stock";
import { niveauxActuels, notifierNouvellesAlertes } from "./alerte-stock";
import { parserMouvementsCsv, type MouvementCsv } from "./import-mouvements-csv";
import { repererDejaPresents, traceJumeau, ACTION_DEJA_PRESENT } from "./doublons-imports";
import { categorieSortieImport } from "./motif-sorties-import";

// Import de mouvements de stock (entrées/sorties) depuis un CSV, avec aperçu et journal réversible.
// Chaque ligne applique son effet sur le stock (ENTREE +, SORTIE −) ; l'annulation restaure le stock.
// Un mouvement qui a DÉJÀ un jumeau exact en base (même article, date, type, quantité — importé
// par un autre fichier, ou par l'inventaire) est IGNORÉ : ni inséré, ni compté dans le stock
// (son effet y est déjà). Voir `doublons-imports.ts`.

export type Rapprochement = "code" | "nom" | "flou" | "inconnu";
export type MouvementPreview = {
  ligne: number; date: string | null; codeCsv: string; designationCsv: string; entree: number; sortie: number;
  articleId: string | null; articleNom: string | null; rapprochement: Rapprochement;
  /** L'entrée / la sortie de cette ligne a déjà un jumeau exact en base : elle sera ignorée. */
  entreeDejaPresente: boolean; sortieDejaPresente: boolean;
};
export type PreviewMouvements = {
  lignes: MouvementPreview[];
  resume: { total: number; rapprochees: number; inconnues: number; entreesQte: number; sortiesQte: number; articles: number; sansDate: number; dejaPresents: number };
  erreurs: string[];
};

type ArticleRef = { id: string; designation: string; code: string | null };

function indexer(articles: ArticleRef[]) {
  const parCode = new Map<string, ArticleRef[]>(); // un code peut être porté par PLUSIEURS articles
  const parNom = new Map<string, ArticleRef>();
  for (const a of articles) {
    if (a.code && a.code.trim()) {
      const k = a.code.trim();
      (parCode.get(k) ?? parCode.set(k, []).get(k)!).push(a);
    }
    const k = cleAlnum(a.designation);
    if (k && !parNom.has(k)) parNom.set(k, a);
  }
  return { parCode, parNom };
}

/**
 * Rapproche une ligne CSV d'un article. La DÉSIGNATION exacte prime : les codes entrent en
 * collision entre les catalogues Nourriture / Boissons / Autre (chacun a sa numérotation —
 * ex. « 16 » = Sprite en boissons ET côtes de porc en nourriture), et le schéma les documente
 * comme « non fiables comme clé ». Ordre :
 *  1. désignation exacte (insensible casse/accents/ponctuation) ;
 *  2. code article : s'il est UNIQUE au catalogue → direct ; en collision → départagé par la
 *     similarité de nom parmi les porteurs du code, sinon le code ne prouve rien (on continue) ;
 *  3. repli flou sur tout le catalogue.
 */
function rapprocher(l: MouvementCsv, idx: ReturnType<typeof indexer>, candidats: { id: string; designation: string }[]): { article: ArticleRef | null; type: Rapprochement } {
  const k = cleAlnum(l.designation);
  if (k && idx.parNom.has(k)) return { article: idx.parNom.get(k)!, type: "nom" };

  if (l.code && idx.parCode.has(l.code.trim())) {
    const porteurs = idx.parCode.get(l.code.trim())!;
    if (porteurs.length === 1) return { article: porteurs[0], type: "code" };
    const m = l.designation
      ? meilleurArticle(l.designation, porteurs.map((a) => ({ id: a.id, designation: a.designation })), 0.5)
      : null;
    if (m) return { article: { id: m.id, designation: m.designation, code: null }, type: "code" };
    // Collision sans nom proche : on n'attribue PAS au hasard, le repli flou tranchera (ou inconnu).
  }

  const m = l.designation ? meilleurArticle(l.designation, candidats, 0.6) : null;
  if (m) return { article: { id: m.id, designation: m.designation, code: null }, type: "flou" };
  return { article: null, type: "inconnu" };
}

async function chargerArticles(): Promise<ArticleRef[]> {
  return prisma.articleStock.findMany({ where: { actif: true }, select: { id: true, designation: true, code: true } });
}

type Candidat = { ligne: number; sens: "entree" | "sortie"; articleId: string; date: string; type: "ENTREE" | "SORTIE"; quantite: number };

/** Les mouvements (entrée et/ou sortie) portés par des lignes rapprochées, datés. */
function candidatsDe(lignes: MouvementPreview[], dateDefaut: string | undefined): Candidat[] {
  const out: Candidat[] = [];
  for (const l of lignes) {
    const date = l.date ?? dateDefaut;
    if (!l.articleId || !date) continue;
    if (l.entree > 0) out.push({ ligne: l.ligne, sens: "entree", articleId: l.articleId, date, type: "ENTREE", quantite: l.entree });
    if (l.sortie > 0) out.push({ ligne: l.ligne, sens: "sortie", articleId: l.articleId, date, type: "SORTIE", quantite: l.sortie });
  }
  return out;
}

/** Analyse le CSV et renvoie l'aperçu (aucune écriture). `dateDefaut` date les lignes qui n'en ont pas
 *  (pour repérer leurs jumeaux) ; absente, ces lignes ne sont pas comparées ici — l'import tranchera. */
export async function analyserMouvements(texte: string, dateDefaut?: string): Promise<PreviewMouvements> {
  const { lignes, erreurs } = parserMouvementsCsv(texte);
  const articles = await chargerArticles();
  const idx = indexer(articles);
  const candidats = articles.map((a) => ({ id: a.id, designation: a.designation }));

  const preview: MouvementPreview[] = lignes.map((l) => {
    const { article, type } = rapprocher(l, idx, candidats);
    return {
      ligne: l.ligne, date: l.date, codeCsv: l.code, designationCsv: l.designation, entree: l.entree, sortie: l.sortie,
      articleId: article?.id ?? null, articleNom: article?.designation ?? null, rapprochement: type,
      entreeDejaPresente: false, sortieDejaPresente: false,
    };
  });

  const { dejaPresents } = await repererDejaPresents(prisma, candidatsDe(preview, dateDefaut));
  const parLigne = new Map(preview.map((p) => [p.ligne, p]));
  for (const { candidat: c } of dejaPresents) {
    const p = parLigne.get(c.ligne)!;
    if (c.sens === "entree") p.entreeDejaPresente = true;
    else p.sortieDejaPresente = true;
  }

  const rapprochees = preview.filter((p) => p.articleId);
  const resume = {
    total: preview.length,
    rapprochees: rapprochees.length,
    inconnues: preview.length - rapprochees.length,
    entreesQte: Math.round(rapprochees.reduce((t, p) => t + p.entree, 0) * 1000) / 1000,
    sortiesQte: Math.round(rapprochees.reduce((t, p) => t + p.sortie, 0) * 1000) / 1000,
    articles: new Set(rapprochees.map((p) => p.articleId)).size,
    sansDate: preview.filter((p) => !p.date).length,
    dejaPresents: dejaPresents.length,
  };
  return { lignes: preview, resume, erreurs };
}

/**
 * Applique l'import : crée les mouvements (ENTREE/SORTIE), ajuste le stock et enregistre un
 * ImportBatch réversible. `dateDefaut` (AAAA-MM-JJ) sert aux lignes sans date. Direction.
 * `lignesChoisies` (optionnel) : numéros de lignes CSV sélectionnées dans l'aperçu — seules
 * celles-ci sont importées (période / cases décochées côté client) ; absent = tout le fichier.
 * `sortiesLivraisonRestaurant` (défaut : oui, décision Direction) : les sorties reçoivent le motif
 * « Livraison restaurant » ; non → aucun motif.
 */
export async function appliquerMouvements(
  texte: string, libelle: string, dateDefaut: string, userId: string | null, lignesChoisies?: number[],
  { sortiesLivraisonRestaurant = true }: { sortiesLivraisonRestaurant?: boolean } = {}
): Promise<{ batchId: string; resume: PreviewMouvements["resume"] }> {
  const preview = await analyserMouvements(texte, dateDefaut);
  const choisies = lignesChoisies ? new Set(lignesChoisies) : null;
  const aInserer = preview.lignes.filter((p) => p.articleId && (!choisies || choisies.has(p.ligne)));
  if (aInserer.length === 0) throw new Error("Aucune ligne rapprochée à un article : rien à importer.");

  const dateDe = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  // Refuse toute écriture dans un mois clôturé.
  await exigerPeriodesOuvertes(aInserer.map((p) => dateDe(p.date ?? dateDefaut)));

  const articlesChoisis = [...new Set(aInserer.map((p) => p.articleId!))];
  // Niveaux d'alerte AVANT l'import : pour notifier les articles qui passent sous leur seuil.
  const niveauxAvant = await niveauxActuels(articlesChoisis);

  const res = await prisma.$transaction(async (tx) => {
    // Garde-fou doublons : relu DANS la transaction d'écriture, sur la sélection réelle.
    const { nouveaux, dejaPresents } = await repererDejaPresents(tx, candidatsDe(aInserer, dateDefaut));
    if (nouveaux.length === 0) {
      throw new Error(`Les ${dejaPresents.length} mouvement(s) choisis sont déjà présents en base (même article, date, type et quantité) : rien à importer. Rien n'a été écrit.`);
    }
    const q3 = (n: number) => Math.round(n * 1000) / 1000;
    // Le résumé archivé reflète ce qui est RÉELLEMENT importé (sélection, déjà présents exclus).
    const resumeApplique: PreviewMouvements["resume"] = {
      total: preview.resume.total,
      rapprochees: aInserer.length,
      inconnues: preview.resume.inconnues,
      entreesQte: q3(nouveaux.filter((c) => c.type === "ENTREE").reduce((t, c) => t + c.quantite, 0)),
      sortiesQte: q3(nouveaux.filter((c) => c.type === "SORTIE").reduce((t, c) => t + c.quantite, 0)),
      articles: new Set(nouveaux.map((c) => c.articleId)).size,
      sansDate: aInserer.filter((p) => !p.date).length,
      dejaPresents: dejaPresents.length,
    };

    const batch = await tx.importBatch.create({ data: { type: "MOUVEMENTS", libelle, statut: "APPLIQUE", resume: resumeApplique, creeParId: userId } });
    const ops: Prisma.ImportOperationCreateManyInput[] = [];

    // Photo du stock AVANT import (pour restauration à l'annulation), une opération par article
    // RÉELLEMENT touché : un article dont tout était déjà présent ne bouge pas, et son stock ne
    // doit pas être « restauré » à l'annulation (il a pu être corrigé entre-temps).
    const articleIds = [...new Set(nouveaux.map((c) => c.articleId))];
    const stocks = await tx.stock.findMany({ where: { articleId: { in: articleIds } }, select: { articleId: true, quantite: true } });
    const avant = new Map(stocks.map((s) => [s.articleId, s.quantite.toString()]));
    for (const articleId of articleIds) {
      ops.push({ batchId: batch.id, entite: "Stock", entiteId: articleId, action: "UPDATE", avant: { quantite: avant.get(articleId) ?? null } });
    }

    // Crée les mouvements nouveaux et cumule l'effet net par article (les ignorés ne comptent pas).
    const net = new Map<string, number>();
    for (const c of nouveaux) {
      const mv = await tx.mouvementStock.create({
        data: { articleId: c.articleId, type: c.type, quantite: c.quantite, date: dateDe(c.date), origine: libelle, creeParId: userId, categorieSortie: categorieSortieImport(c.type, sortiesLivraisonRestaurant) },
      });
      ops.push({ batchId: batch.id, entite: "MouvementStock", entiteId: mv.id, action: "CREATE", avant: Prisma.DbNull });
      net.set(c.articleId, (net.get(c.articleId) ?? 0) + (c.type === "ENTREE" ? c.quantite : -c.quantite));
    }
    // Les ignorés sont tracés : ils nomment le jumeau qui porte leur historique.
    for (const { candidat: c, jumeauId } of dejaPresents) {
      ops.push({ batchId: batch.id, entite: "MouvementStock", entiteId: jumeauId, action: ACTION_DEJA_PRESENT, avant: traceJumeau(jumeauId, c) });
    }

    // Applique l'effet net sur le stock (crée la ligne si absente).
    for (const articleId of articleIds) {
      const delta = net.get(articleId) ?? 0;
      await tx.stock.upsert({ where: { articleId }, update: { quantite: { increment: delta } }, create: { articleId, quantite: delta } });
    }

    await tx.importOperation.createMany({ data: ops });
    return { batchId: batch.id, resume: resumeApplique };
  }, { timeout: 120000 });

  await notifierNouvellesAlertes(articlesChoisis, niveauxAvant);
  return res;
}
