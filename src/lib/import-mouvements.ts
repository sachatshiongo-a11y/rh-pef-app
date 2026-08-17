import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { cleAlnum } from "./texte";
import { meilleurArticle } from "./article-match";
import { exigerPeriodesOuvertes } from "./cloture-stock";
import { niveauxActuels, notifierNouvellesAlertes } from "./alerte-stock";
import { parserMouvementsCsv, type MouvementCsv } from "./import-mouvements-csv";

// Import de mouvements de stock (entrées/sorties) depuis un CSV, avec aperçu et journal réversible.
// Chaque ligne applique son effet sur le stock (ENTREE +, SORTIE −) ; l'annulation restaure le stock.

export type Rapprochement = "code" | "nom" | "flou" | "inconnu";
export type MouvementPreview = {
  ligne: number; date: string | null; codeCsv: string; designationCsv: string; entree: number; sortie: number;
  articleId: string | null; articleNom: string | null; rapprochement: Rapprochement;
};
export type PreviewMouvements = {
  lignes: MouvementPreview[];
  resume: { total: number; rapprochees: number; inconnues: number; entreesQte: number; sortiesQte: number; articles: number; sansDate: number };
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

/** Analyse le CSV et renvoie l'aperçu (aucune écriture). */
export async function analyserMouvements(texte: string): Promise<PreviewMouvements> {
  const { lignes, erreurs } = parserMouvementsCsv(texte);
  const articles = await chargerArticles();
  const idx = indexer(articles);
  const candidats = articles.map((a) => ({ id: a.id, designation: a.designation }));

  const preview: MouvementPreview[] = lignes.map((l) => {
    const { article, type } = rapprocher(l, idx, candidats);
    return {
      ligne: l.ligne, date: l.date, codeCsv: l.code, designationCsv: l.designation, entree: l.entree, sortie: l.sortie,
      articleId: article?.id ?? null, articleNom: article?.designation ?? null, rapprochement: type,
    };
  });

  const rapprochees = preview.filter((p) => p.articleId);
  const resume = {
    total: preview.length,
    rapprochees: rapprochees.length,
    inconnues: preview.length - rapprochees.length,
    entreesQte: Math.round(rapprochees.reduce((t, p) => t + p.entree, 0) * 1000) / 1000,
    sortiesQte: Math.round(rapprochees.reduce((t, p) => t + p.sortie, 0) * 1000) / 1000,
    articles: new Set(rapprochees.map((p) => p.articleId)).size,
    sansDate: preview.filter((p) => !p.date).length,
  };
  return { lignes: preview, resume, erreurs };
}

/**
 * Applique l'import : crée les mouvements (ENTREE/SORTIE), ajuste le stock et enregistre un
 * ImportBatch réversible. `dateDefaut` (AAAA-MM-JJ) sert aux lignes sans date. Direction.
 * `lignesChoisies` (optionnel) : numéros de lignes CSV sélectionnées dans l'aperçu — seules
 * celles-ci sont importées (période / cases décochées côté client) ; absent = tout le fichier.
 */
export async function appliquerMouvements(texte: string, libelle: string, dateDefaut: string, userId: string | null, lignesChoisies?: number[]): Promise<{ batchId: string; resume: PreviewMouvements["resume"] }> {
  const preview = await analyserMouvements(texte);
  const choisies = lignesChoisies ? new Set(lignesChoisies) : null;
  const aInserer = preview.lignes.filter((p) => p.articleId && (!choisies || choisies.has(p.ligne)));
  if (aInserer.length === 0) throw new Error("Aucune ligne rapprochée à un article : rien à importer.");

  // Le résumé archivé reflète ce qui est RÉELLEMENT importé (sélection), pas tout le fichier.
  const resumeApplique: PreviewMouvements["resume"] = {
    total: preview.resume.total,
    rapprochees: aInserer.length,
    inconnues: preview.resume.inconnues,
    entreesQte: Math.round(aInserer.reduce((t, p) => t + p.entree, 0) * 1000) / 1000,
    sortiesQte: Math.round(aInserer.reduce((t, p) => t + p.sortie, 0) * 1000) / 1000,
    articles: new Set(aInserer.map((p) => p.articleId)).size,
    sansDate: aInserer.filter((p) => !p.date).length,
  };

  const dateDe = (p: MouvementPreview) => new Date(`${p.date ?? dateDefaut}T00:00:00.000Z`);
  // Refuse toute écriture dans un mois clôturé.
  await exigerPeriodesOuvertes(aInserer.map(dateDe));

  const articleIds = [...new Set(aInserer.map((p) => p.articleId!))];
  // Niveaux d'alerte AVANT l'import : pour notifier les articles qui passent sous leur seuil.
  const niveauxAvant = await niveauxActuels(articleIds);

  const res = await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({ data: { type: "MOUVEMENTS", libelle, statut: "APPLIQUE", creeParId: userId } });
    const ops: Prisma.ImportOperationCreateManyInput[] = [];

    // Photo du stock AVANT import (pour restauration à l'annulation), une opération par article.
    const stocks = await tx.stock.findMany({ where: { articleId: { in: articleIds } }, select: { articleId: true, quantite: true } });
    const avant = new Map(stocks.map((s) => [s.articleId, s.quantite.toString()]));
    for (const articleId of articleIds) {
      ops.push({ batchId: batch.id, entite: "Stock", entiteId: articleId, action: "UPDATE", avant: { quantite: avant.get(articleId) ?? null } });
    }

    // Crée les mouvements et cumule l'effet net par article.
    const net = new Map<string, number>();
    for (const p of aInserer) {
      const date = dateDe(p);
      if (p.entree > 0) {
        const mv = await tx.mouvementStock.create({ data: { articleId: p.articleId!, type: "ENTREE", quantite: p.entree, date, origine: libelle, creeParId: userId } });
        ops.push({ batchId: batch.id, entite: "MouvementStock", entiteId: mv.id, action: "CREATE", avant: Prisma.DbNull });
        net.set(p.articleId!, (net.get(p.articleId!) ?? 0) + p.entree);
      }
      if (p.sortie > 0) {
        const mv = await tx.mouvementStock.create({ data: { articleId: p.articleId!, type: "SORTIE", quantite: p.sortie, date, origine: libelle, creeParId: userId } });
        ops.push({ batchId: batch.id, entite: "MouvementStock", entiteId: mv.id, action: "CREATE", avant: Prisma.DbNull });
        net.set(p.articleId!, (net.get(p.articleId!) ?? 0) - p.sortie);
      }
    }

    // Applique l'effet net sur le stock (crée la ligne si absente).
    for (const articleId of articleIds) {
      const delta = net.get(articleId) ?? 0;
      await tx.stock.upsert({ where: { articleId }, update: { quantite: { increment: delta } }, create: { articleId, quantite: delta } });
    }

    await tx.importBatch.update({ where: { id: batch.id }, data: { resume: resumeApplique } });
    await tx.importOperation.createMany({ data: ops });
    return { batchId: batch.id, resume: resumeApplique };
  }, { timeout: 120000 });

  await notifierNouvellesAlertes(articleIds, niveauxAvant);
  return res;
}
