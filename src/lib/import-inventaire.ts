import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { repererDejaPresents, refusAnnulationHistoriquePorte, traceJumeau, ACTION_DEJA_PRESENT } from "./doublons-imports";
import { categorieSortieImport } from "./motif-sorties-import";
import { journaliser } from "./audit";
import { poserStocksTx } from "./validations-stock/stock-positif";
import { catalogueCandidats } from "./achats-liste-serveur";
import { decisionArticle } from "./article-proche";
import { cleArticleImport } from "./import-inventaire-cle";

// ─────────────────────────────────────────────────────────────────────────────
// Import d'inventaire depuis le classeur Excel (feuilles « Nourriture », « Boissons »,
// « Légumes frais »). Les colonnes Entrée/Sortie/Stock final sont des FORMULES non toujours
// mises en cache : on les RECALCULE à partir de valeurs littérales fiables —
//   Stock final = Stock initial + Σ(entrées) − Σ(sorties)  (journal détaillé, à droite de la feuille)
// Le rapprochement avec le catalogue se fait par CODE (domaine + code), puis par nom.
//
// L'import fait DEUX choses : il pose le STOCK FINAL (valeur absolue, qui remplace le stock
// courant) ET il importe le JOURNAL DÉTAILLÉ (mouvements datés) dans l'historique. Un mouvement
// du journal qui a déjà un jumeau exact en base (même article, date, type, quantité — importé le
// matin par l'import de mouvements, par exemple) est IGNORÉ : le 2026-09-28, faute de ce
// garde-fou, 602 mouvements ont été doublés. Voir `doublons-imports.ts`.
// ─────────────────────────────────────────────────────────────────────────────

type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type MvtPreview = { code: string; nom: string; date: string; entree: number; sortie: number };
export type ArtPreview = {
  code: string; nom: string; domaine: Domaine; unite: string | null; prix: number | null; stockMin: number | null;
  stockFinal: number; entreeTot: number; sortieTot: number;
  match: "code" | "nom" | "aucun"; articleId: string | null; articleNom: string | null; articleDomaine: Domaine | null;
  /**
   * Article SANS correspondance dont le nom ressemble à un article du catalogue (anti-doublon du
   * 2026-10-09, règle de lib/article-proche.ts) : la Direction choisit « Utiliser … » ou « Créer quand
   * même » avant d'appliquer ; `creationPossible` faux = le nom exact existe déjà (plusieurs fois).
   */
  proches?: { id: string; designation: string; unite: string | null; actif: boolean }[];
  creationPossible?: boolean;
};
/** Choix de la Direction pour un article à créer qui a des proches : id de l'article à utiliser, ou « CREER ». */
export type ChoixArticlesImport = Record<string, string>;

export type LegPreview = { date: string; legume: string; unite: string | null; quantite: number; montantCDF: number };
export type PreviewInventaire = {
  articles: ArtPreview[]; mouvements: MvtPreview[]; legumes: LegPreview[];
  /** mvEntree / mvSortie : mouvements À INSÉRER ; dejaPresents : mouvements du journal déjà en base, ignorés. */
  resume: { maj: number; crees: number; mvEntree: number; mvSortie: number; dejaPresents: number; legumes: number; sansMatch: number };
};

import { normTexte, cleAlnum } from "./texte";
const strip = (s: string) => normTexte(String(s || ""));
const normEx = (s: string) => cleAlnum(String(s || ""));
const STOP = new Set(["de", "du", "des", "d", "la", "le", "les", "l", "en", "au", "aux", "a", "et", "the"]);
const UNITRE = /^\d+([.,]\d+)?(kg|kgs|g|gr|l|ltr|lt|cl|ml|cm|mm|p|pcs|pce)?$/;
const toks = (s: string) => strip(s).replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w && !STOP.has(w) && !UNITRE.test(w));
import { jaccard as jac } from "./texte";
const OVERRIDE: Record<string, string> = { parmesan: "grana padano 1kg", vodkaabsolute: "absolut vodka-75cl", malibucocunut70cl: "malibu-70cl" };

// Valeur numérique d'une cellule exceljs (nombre littéral ou résultat de formule mis en cache).
function numAt(row: ExcelJS.Row, col: number): number | null {
  const v = row.getCell(col).value as unknown;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "result" in v) { const r = (v as { result: unknown }).result; return typeof r === "number" ? r : null; }
  const n = Number(String(v).replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function txtAt(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value as unknown;
  if (v == null) return "";
  if (typeof v === "object" && v !== null) { const o = v as { result?: unknown; text?: unknown }; return String(o.result ?? o.text ?? "").trim(); }
  return String(v).trim();
}
const isoDate = (d: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
// Cellule date : dans le classeur c'est un vrai objet Date (pas « JJ/MM/AAAA » comme en CSV).
function dateAt(row: ExcelJS.Row, col: number): string | null {
  const v = row.getCell(col).value as unknown;
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v !== null && "result" in v) { const r = (v as { result: unknown }).result; if (r instanceof Date) return r.toISOString().slice(0, 10); }
  return isoDate(String(v).trim());
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type FeuilleCfg = { nom: RegExp; domaine: Domaine; main: { code: number; nom: number; unite: number | null; cat: number; smin: number; sinit: number; prix: number }; detail: { date: number; code: number; e: number; s: number } };
const FEUILLES: FeuilleCfg[] = [
  { nom: /nourriture/i, domaine: "NOURRITURE", main: { code: 1, nom: 2, unite: 3, cat: 4, smin: 7, sinit: 6, prix: 12 }, detail: { date: 17, code: 18, e: 22, s: 23 } },
  { nom: /boisson/i, domaine: "BOISSON", main: { code: 1, nom: 2, unite: null, cat: 3, smin: 6, sinit: 5, prix: 11 }, detail: { date: 15, code: 16, e: 19, s: 20 } },
];

/** Lit le classeur et produit l'aperçu (aucune écriture). */
export async function analyserInventaire(buffer: ArrayBuffer): Promise<PreviewInventaire> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const db = (await prisma.articleStock.findMany({ select: { id: true, designation: true, domaine: true, code: true } }))
    .map((r) => ({ ...r, ex: normEx(r.designation), tk: toks(r.designation) }));
  const parCode = new Map<string, typeof db[number]>();
  for (const a of db) if (a.code) parCode.set(a.domaine + "|" + a.code.trim(), a);

  function matcher(code: string, nom: string, dom: Domaine): { m: ArtPreview["match"]; a: typeof db[number] | null } {
    const byCode = parCode.get(dom + "|" + code);
    if (byCode) return { m: "code", a: byCode };
    const ne = OVERRIDE[normEx(nom)] ? normEx(OVERRIDE[normEx(nom)]) : normEx(nom);
    for (const d of [dom, "AUTRE", "NOURRITURE", "BOISSON"] as Domaine[]) { const e = db.find((a) => a.domaine === d && a.ex === ne); if (e) return { m: "nom", a: e }; }
    const t = toks(nom); let best: typeof db[number] | null = null, bs = 0;
    for (const a of db) { const s = jac(t, a.tk); const sub = t.every((x) => a.tk.includes(x)) || a.tk.every((x) => t.includes(x)); if (sub && s >= 0.5 && s > bs) { bs = s; best = a; } }
    return best ? { m: "nom", a: best } : { m: "aucun", a: null };
  }

  const articles: ArtPreview[] = [];
  const mouvements: MvtPreview[] = [];
  for (const cfg of FEUILLES) {
    const ws = wb.worksheets.find((w) => cfg.nom.test(w.name));
    if (!ws) continue;
    // Journal détaillé : agrège entrées/sorties par code + collecte les mouvements datés.
    const eParCode = new Map<string, number>(), sParCode = new Map<string, number>();
    for (let r = 13; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = txtAt(row, cfg.detail.code); const iso = dateAt(row, cfg.detail.date);
      if (!/^\d+$/.test(code) || !iso) continue;
      const e = numAt(row, cfg.detail.e) || 0, s = numAt(row, cfg.detail.s) || 0;
      if (e <= 0 && s <= 0) continue;
      if (e > 0) eParCode.set(code, (eParCode.get(code) || 0) + e);
      if (s > 0) sParCode.set(code, (sParCode.get(code) || 0) + s);
    }
    // Lignes d'articles principales.
    for (let r = 13; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = txtAt(row, cfg.main.code); const nom = txtAt(row, cfg.main.nom);
      if (!/^\d+$/.test(code) || !nom) continue;
      const sinit = numAt(row, cfg.main.sinit) || 0;
      const entreeTot = round3(eParCode.get(code) || 0), sortieTot = round3(sParCode.get(code) || 0);
      const stockFinal = round3(sinit + entreeTot - sortieTot);
      const { m, a } = matcher(code, nom, cfg.domaine);
      articles.push({
        code, nom, domaine: cfg.domaine, unite: cfg.main.unite != null ? (txtAt(row, cfg.main.unite) || null) : null,
        prix: numAt(row, cfg.main.prix), stockMin: numAt(row, cfg.main.smin), stockFinal, entreeTot, sortieTot,
        match: m, articleId: a?.id ?? null, articleNom: a?.designation ?? null, articleDomaine: (a?.domaine as Domaine) ?? null,
      });
    }
    // Mouvements datés (pour l'historique).
    for (let r = 13; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = txtAt(row, cfg.detail.code); const iso = dateAt(row, cfg.detail.date);
      if (!/^\d+$/.test(code) || !iso) continue;
      const e = numAt(row, cfg.detail.e) || 0, s = numAt(row, cfg.detail.s) || 0;
      if (e > 0) mouvements.push({ code: cfg.domaine + "|" + code, nom: "", date: iso, entree: round3(e), sortie: 0 });
      if (s > 0) mouvements.push({ code: cfg.domaine + "|" + code, nom: "", date: iso, entree: 0, sortie: round3(s) });
    }
  }

  // ANTI-DOUBLON (2026-10-09) : un article qui serait CRÉÉ mais ressemble à un article du catalogue
  // (« Tomate » quand « Tomates » existe, même nom écrit autrement) attend le choix de la Direction.
  const sansMatch = articles.filter((a) => a.match === "aucun");
  if (sansMatch.length > 0) {
    const catalogue = await catalogueCandidats();
    for (const a of sansMatch) {
      const d = decisionArticle(a.nom, catalogue);
      if (d.type === "auto") { a.proches = [{ id: d.article.id, designation: d.article.designation, unite: d.article.unite, actif: d.article.actif }]; a.creationPossible = false; }
      else if (d.type === "choix") { a.proches = d.candidats.map((c) => ({ id: c.id, designation: c.designation, unite: c.unite, actif: c.actif })); a.creationPossible = d.creationPossible; }
    }
  }

  // Légumes : journal d'achats (colonnes de droite) + unités depuis le catalogue de gauche
  // (code col 1, désignation col 2, unité col 3 — le journal, lui, n'a pas de colonne unité).
  const legumes: LegPreview[] = [];
  const wl = wb.worksheets.find((w) => /l.gume/i.test(w.name));
  if (wl) {
    const uniteLegume = new Map<string, string>();
    for (let r = 12; r <= wl.rowCount; r++) {
      const row = wl.getRow(r);
      const nom = txtAt(row, 2); const unite = txtAt(row, 3);
      if (nom && unite) uniteLegume.set(normEx(nom), unite);
    }
    for (let r = 12; r <= wl.rowCount; r++) {
      const row = wl.getRow(r);
      const iso = dateAt(row, 11); const nom = txtAt(row, 13); const qte = numAt(row, 14); const prix = numAt(row, 15);
      if (iso && nom && qte != null && prix != null) legumes.push({ date: iso, legume: nom, unite: uniteLegume.get(normEx(nom)) ?? null, quantite: round3(qte), montantCDF: prix });
    }
  }

  // Garde-fou doublons (aperçu) : les mouvements dont l'article existe déjà et qui ont un jumeau
  // exact en base seront ignorés. Ceux d'un article à créer sont forcément nouveaux ; ceux d'un
  // code absent des lignes d'articles ne sont pas importés (comme à l'application).
  const idParCode = new Map(articles.map((a) => [a.domaine + "|" + a.code, a.articleId]));
  const importables = mouvements.filter((m) => idParCode.has(m.code));
  const { nouveaux } = await repererDejaPresents(prisma, candidatsMouvements(importables, (m) => idParCode.get(m.code) ?? null));
  const aInserer = new Set(nouveaux.map((c) => c.m));
  const nouveauxOuACreer = importables.filter((m) => aInserer.has(m) || !idParCode.get(m.code));
  const resume = {
    maj: articles.filter((a) => a.articleId).length,
    crees: articles.filter((a) => !a.articleId).length,
    mvEntree: nouveauxOuACreer.filter((m) => m.entree > 0).length,
    mvSortie: nouveauxOuACreer.filter((m) => m.sortie > 0).length,
    dejaPresents: importables.length - nouveauxOuACreer.length,
    legumes: legumes.length,
    sansMatch: articles.filter((a) => a.match === "aucun").length,
  };
  return { articles, mouvements, legumes, resume };
}

const DATE_LEG_TAUX = 2300;

/** Un mouvement du journal (entrée XOR sortie) sous la forme comparable aux mouvements en base. */
function candidatsMouvements(mvts: MvtPreview[], articleDe: (m: MvtPreview) => string | null) {
  const out: { m: MvtPreview; articleId: string; date: string; type: "ENTREE" | "SORTIE"; quantite: number }[] = [];
  for (const m of mvts) {
    const articleId = articleDe(m);
    if (!articleId) continue;
    if (m.entree > 0) out.push({ m, articleId, date: m.date, type: "ENTREE", quantite: m.entree });
    if (m.sortie > 0) out.push({ m, articleId, date: m.date, type: "SORTIE", quantite: m.sortie });
  }
  return out;
}

/** Applique l'inventaire dans une transaction et enregistre un ImportBatch réversible.
 *  `sortiesLivraisonRestaurant` (défaut : oui, décision Direction) : les sorties du journal
 *  reçoivent le motif « Livraison restaurant » ; non → aucun motif. */
export async function appliquerInventaire(
  buffer: ArrayBuffer, libelle: string, userId: string | null,
  { sortiesLivraisonRestaurant = true, choixArticles = {} }: { sortiesLivraisonRestaurant?: boolean; choixArticles?: ChoixArticlesImport } = {}
): Promise<{ batchId: string; resume: PreviewInventaire["resume"] }> {
  const preview = await analyserInventaire(buffer);
  // Anti-doublon : chaque article à créer qui a des proches doit avoir été décidé (relu ici, sur
  // l'analyse refaite) — « Utiliser » un des proches, ou « Créer quand même » si c'est permis.
  const aChoisir: string[] = [];
  for (const a of preview.articles) {
    if (a.match !== "aucun" || !a.proches?.length) continue;
    const c = choixArticles[cleArticleImport(a)];
    const utilise = a.proches.find((p) => p.id === c);
    if (utilise) { a.articleId = utilise.id; a.articleNom = utilise.designation; continue; }
    if (c === "CREER" && a.creationPossible) continue;
    aChoisir.push(`« ${a.nom} » → ${a.proches.map((p) => `« ${p.designation} »`).join(", ")}${a.creationPossible ? "" : " (ce nom existe déjà : utilisez-le)"}`);
  }
  if (aChoisir.length > 0) throw new Error(`Article déjà au catalogue sous un nom proche : choisissez « Utiliser … » ou « Créer quand même » pour ${aChoisir.length > 1 ? "chaque article" : "l'article"} ; rien n'a été importé. ${aChoisir.join(" ; ")}.`);
  preview.resume.maj = preview.articles.filter((a) => a.articleId).length; // « Utiliser … » : mis à jour, pas créé
  preview.resume.crees = preview.articles.filter((a) => !a.articleId).length;
  const codeToArticleId = new Map<string, string>();
  for (const a of preview.articles) if (a.articleId) codeToArticleId.set(a.domaine + "|" + a.code, a.articleId);

  let resume: PreviewInventaire["resume"] = preview.resume;
  const batchId = await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({ data: { type: "INVENTAIRE", libelle, statut: "APPLIQUE", creeParId: userId } });
    const ops: Prisma.ImportOperationCreateManyInput[] = [];
    const stocksFinaux: { articleId: string; quantite: number; stockMin: number | null }[] = [];

    for (const a of preview.articles) {
      let articleId = a.articleId;
      if (!articleId) {
        const cree = await tx.articleStock.create({ data: { designation: a.nom, domaine: a.domaine, code: a.code, unite: a.unite, prixUnitaireUSD: a.prix ?? undefined } });
        articleId = cree.id;
        ops.push({ batchId: batch.id, entite: "ArticleStock", entiteId: articleId, action: "CREATE", avant: Prisma.DbNull });
        codeToArticleId.set(a.domaine + "|" + a.code, articleId);
      } else {
        const cur = await tx.articleStock.findUniqueOrThrow({ where: { id: articleId }, select: { devisePrix: true, prixUnitaireUSD: true, unite: true, stock: { select: { quantite: true } } } });
        ops.push({ batchId: batch.id, entite: "ArticleStock", entiteId: articleId, action: "UPDATE", avant: { ...(cur.devisePrix !== "CDF" ? { prixUnitaireUSD: cur.prixUnitaireUSD?.toString() ?? null } : {}), unite: cur.unite ?? null } });
        ops.push({ batchId: batch.id, entite: "Stock", entiteId: articleId, action: "UPDATE", avant: { quantite: cur.stock?.quantite?.toString() ?? null } });
        // Le classeur donne des prix en dollars : un article dont le prix de référence est en FRANCS
        // (2026-10-08) garde ce prix — la devise de saisie fait foi, l'import ne la renverse pas.
        await tx.articleStock.update({ where: { id: articleId }, data: { ...(a.prix != null && cur.devisePrix !== "CDF" ? { prixUnitaireUSD: a.prix } : {}), ...(a.unite ? { unite: a.unite } : {}) } });
      }
      stocksFinaux.push({ articleId, quantite: a.stockFinal, stockMin: a.stockMin });
    }
    // Stock final (photo instant T) : posé EN UNE FOIS par la porte unique (stock-positif.ts, écriture
    // groupée : pas de délai dépassé sur un gros classeur) — un stock final négatif est refusé, TOUS
    // les articles fautifs nommés ; rien n'est écrit. Puis les seuils, sur des lignes qui existent.
    await poserStocksTx(tx, stocksFinaux, { quoi: "stock final du classeur" });
    for (const f of stocksFinaux) if (f.stockMin != null) await tx.stock.update({ where: { articleId: f.articleId }, data: { stockMinimum: f.stockMin } });

    // Journal détaillé (mouvements datés). Garde-fou : un mouvement qui a déjà un jumeau exact en
    // base n'est PAS recréé (le stock final, lui, est posé en absolu ci-dessus quoi qu'il arrive).
    const { nouveaux, dejaPresents } = await repererDejaPresents(tx, candidatsMouvements(preview.mouvements, (m) => codeToArticleId.get(m.code) ?? null));
    for (const c of nouveaux) {
      const mv = await tx.mouvementStock.create({
        data: { articleId: c.articleId, type: c.type, quantite: c.quantite, date: new Date(c.date), origine: libelle, categorieSortie: categorieSortieImport(c.type, sortiesLivraisonRestaurant) },
      });
      ops.push({ batchId: batch.id, entite: "MouvementStock", entiteId: mv.id, action: "CREATE", avant: Prisma.DbNull });
    }
    for (const { candidat: c, jumeauId } of dejaPresents) {
      ops.push({ batchId: batch.id, entite: "MouvementStock", entiteId: jumeauId, action: ACTION_DEJA_PRESENT, avant: traceJumeau(jumeauId, c) });
    }
    resume = {
      ...preview.resume,
      mvEntree: nouveaux.filter((c) => c.type === "ENTREE").length,
      mvSortie: nouveaux.filter((c) => c.type === "SORTIE").length,
      dejaPresents: dejaPresents.length,
    };

    // Légumes
    for (const l of preview.legumes) {
      const ach = await tx.achatLegume.create({ data: { date: new Date(l.date), legume: l.legume, unite: l.unite, quantite: l.quantite, montantCDF: l.montantCDF, montantUSD: Math.round((l.montantCDF / DATE_LEG_TAUX) * 100) / 100, tauxChangeUtilise: DATE_LEG_TAUX, creeParId: userId } });
      ops.push({ batchId: batch.id, entite: "AchatLegume", entiteId: ach.id, action: "CREATE", avant: Prisma.DbNull });
    }

    await tx.importOperation.createMany({ data: ops });
    await tx.importBatch.update({ where: { id: batch.id }, data: { resume } });
    return batch.id;
  }, { timeout: 120000 });

  return { batchId, resume };
}

/** Annule un import : supprime les créations, restaure les mises à jour. Réversible.
 *  `userId` : l'annulation est journalisée à son nom (le 2026-09-28, trois imports ont été
 *  annulés sans que le journal dise par qui). */
export async function annulerImport(batchId: string, userId?: string): Promise<{ stocksLaisses: string[] }> {
  const stocksLaisses: string[] = [];
  const restaurations: { articleId: string; quantite: Prisma.Decimal }[] = [];
  await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { operations: true } });
    if (batch.statut === "ANNULE") throw new Error("Cet import a déjà été annulé.");
    // Ordre : d'abord supprimer les créations (mouvements, achats, articles), puis restaurer les updates.
    // Seules CREATE et UPDATE se rejouent : DOUBLON_RETIRE (copie retirée par le nettoyage des
    // doublons) et DEJA_PRESENT (mouvement ignoré à l'import) n'ont rien créé à supprimer.
    const creations = batch.operations.filter((o) => o.action === "CREATE");
    const updates = batch.operations.filter((o) => o.action === "UPDATE");
    // 0) Un AUTRE import encore appliqué s'appuie sur des mouvements de celui-ci (ses copies ont
    //    été retirées, ou ignorées car déjà présentes) : les supprimer viderait son historique.
    const refus = await refusAnnulationHistoriquePorte(tx, batchId, creations.filter((o) => o.entite === "MouvementStock").map((o) => o.entiteId));
    if (refus) throw new Error(refus);
    // 1) Supprime d'abord les entités dépendantes créées par l'import.
    for (const o of creations) {
      if (o.entite === "MouvementStock") await tx.mouvementStock.deleteMany({ where: { id: o.entiteId } });
      else if (o.entite === "AchatLegume") await tx.achatLegume.deleteMany({ where: { id: o.entiteId } });
      else if (o.entite === "FactureFournisseur") await tx.factureFournisseur.deleteMany({ where: { id: o.entiteId } });
    }
    // 2) Puis les entités « parentes » créées par l'import.
    //    Un article créé par l'import a pu être mis dans une FICHE TECHNIQUE entre-temps :
    //    `IngredientFiche.articleId` est en `onDelete: Restrict`, la suppression échouerait alors
    //    sur une violation de contrainte brute (message Postgres en anglais) et annulerait toute
    //    l'annulation. On le dit d'abord, en nommant l'article ET la fiche : l'opérateur sait quoi
    //    détacher. Refus ENTIER plutôt qu'annulation partielle — un import à moitié annulé, marqué
    //    « ANNULE », serait pire que pas d'annulation du tout.
    const idsArticlesCrees = creations.filter((o) => o.entite === "ArticleStock").map((o) => o.entiteId);
    if (idsArticlesCrees.length > 0) {
      const utilises = await tx.ingredientFiche.findMany({
        where: { articleId: { in: idsArticlesCrees } },
        select: { article: { select: { designation: true } }, fiche: { select: { nom: true } } },
      });
      if (utilises.length > 0) {
        const details = [
          ...new Set(utilises.map((u) => `« ${u.article?.designation ?? "?"} » (fiche « ${u.fiche.nom} »)`)),
        ];
        throw new Error(
          `Annulation impossible : ${details.length} article(s) créé(s) par cet import sont utilisés dans une fiche technique — ` +
            `${details.join(", ")}. Retirez-les de ces fiches, puis relancez l'annulation. Rien n'a été annulé.`
        );
      }
    }
    for (const o of creations) if (o.entite === "ArticleStock") await tx.articleStock.deleteMany({ where: { id: o.entiteId } });
    for (const o of creations) if (o.entite === "Fournisseur") {
      // Ne supprime un fournisseur créé que s'il n'est plus référencé (sécurité).
      // Les achats DIRECTS de la Liste d'achat (MouvementStock.fournisseurId) comptent aussi : sinon
      // ils perdraient leur fournisseur en silence (FK SET NULL).
      const [nbArt, nbBC, nbFac, nbMvt] = await Promise.all([
        tx.articleStock.count({ where: { fournisseurId: o.entiteId } }),
        tx.bonDeCommande.count({ where: { fournisseurId: o.entiteId } }),
        tx.factureFournisseur.count({ where: { fournisseurId: o.entiteId } }),
        tx.mouvementStock.count({ where: { fournisseurId: o.entiteId } }),
      ]);
      if (nbArt === 0 && nbBC === 0 && nbFac === 0 && nbMvt === 0) await tx.fournisseur.deleteMany({ where: { id: o.entiteId } });
    }
    for (const o of updates) {
      const av = o.avant as Record<string, string | null> | null;
      if (!av) continue;
      if (o.entite === "ArticleStock") {
        // Le prix n'est restauré que si l'import l'avait écrit (clé présente dans `avant` : article en
        // dollars à l'import) et que l'article est encore en dollars — passé en francs depuis, son prix
        // en francs reste (un prix en dollars n'y a plus sa place).
        const art = await tx.articleStock.findUnique({ where: { id: o.entiteId }, select: { devisePrix: true } });
        const restaurerPrix = "prixUnitaireUSD" in av && art?.devisePrix !== "CDF";
        await tx.articleStock.update({ where: { id: o.entiteId }, data: { ...(restaurerPrix ? { prixUnitaireUSD: av.prixUnitaireUSD != null ? new Prisma.Decimal(av.prixUnitaireUSD) : null } : {}), unite: av.unite } });
      }
      else if (o.entite === "Stock") restaurations.push({ articleId: o.entiteId, quantite: av.quantite != null ? new Prisma.Decimal(av.quantite) : new Prisma.Decimal(0) });
    }
    // Remise des stocks à leur valeur d'avant l'import, EN UNE FOIS par la porte unique (lignes encore
    // présentes seulement). Un stock ne passe jamais sous 0 (2026-10-09) : une valeur d'avant NÉGATIVE
    // n'est pas réécrite — l'article garde son stock actuel, et il est NOMMÉ (journal + compte rendu) ;
    // le reste de l'annulation se fait.
    const presents = new Map((await tx.stock.findMany({ where: { articleId: { in: restaurations.map((r) => r.articleId) } }, select: { articleId: true, quantite: true } })).map((x) => [x.articleId, x.quantite]));
    const aRestaurer = restaurations.filter((r) => presents.has(r.articleId));
    const negatifs = aRestaurer.filter((r) => r.quantite.isNegative() && !r.quantite.isZero() && !presents.get(r.articleId)!.equals(r.quantite));
    await poserStocksTx(tx, aRestaurer.filter((r) => !negatifs.includes(r)), { quoi: "stock d'avant l'import" });
    if (negatifs.length > 0) {
      const noms = new Map((await tx.articleStock.findMany({ where: { id: { in: negatifs.map((r) => r.articleId) } }, select: { id: true, designation: true } })).map((a) => [a.id, a.designation]));
      stocksLaisses.push(...negatifs.map((r) => `${noms.get(r.articleId) ?? "Article"} (stock d'avant négatif : ${r.quantite.toString().replace(".", ",")} ; gardé à ${presents.get(r.articleId)!.toString().replace(".", ",")})`));
    }
    await tx.importBatch.update({ where: { id: batchId }, data: { statut: "ANNULE", annuleeAt: new Date() } });
    if (userId) {
      const nb = (e: string) => creations.filter((o) => o.entite === e).length;
      await journaliser(tx, {
        entite: "Stock",
        entiteId: batchId,
        champ: "annulation d'import",
        nouvelleValeur:
          `Import « ${batch.libelle} » annulé : ${nb("MouvementStock")} mouvement(s) retiré(s), ` +
          `stock de ${aRestaurer.length - negatifs.length} article(s) remis à sa valeur d'avant l'import` +
          (stocksLaisses.length ? `, ${stocksLaisses.length} stock(s) laissé(s) tel(s) quel(s) (valeur d'avant négative, jamais réécrite) : ${stocksLaisses.join(", ")}` : "") +
          (nb("AchatLegume") ? `, ${nb("AchatLegume")} achat(s) de légumes retiré(s)` : "") +
          (nb("ArticleStock") ? `, ${nb("ArticleStock")} article(s) créé(s) supprimé(s)` : ""),
        userId,
      });
    }
  }, { timeout: 120000 });
  return { stocksLaisses };
}
