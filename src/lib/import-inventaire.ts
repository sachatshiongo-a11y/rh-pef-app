import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Import d'inventaire depuis le classeur Excel (feuilles « Nourriture », « Boissons »,
// « Légumes frais »). Les colonnes Entrée/Sortie/Stock final sont des FORMULES non toujours
// mises en cache : on les RECALCULE à partir de valeurs littérales fiables —
//   Stock final = Stock initial + Σ(entrées) − Σ(sorties)  (journal détaillé, à droite de la feuille)
// Le rapprochement avec le catalogue se fait par CODE (domaine + code), puis par nom.
// ─────────────────────────────────────────────────────────────────────────────

type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type MvtPreview = { code: string; nom: string; date: string; entree: number; sortie: number };
export type ArtPreview = {
  code: string; nom: string; domaine: Domaine; unite: string | null; prix: number | null; stockMin: number | null;
  stockFinal: number; entreeTot: number; sortieTot: number;
  match: "code" | "nom" | "aucun"; articleId: string | null; articleNom: string | null; articleDomaine: Domaine | null;
};
export type LegPreview = { date: string; legume: string; quantite: number; montantCDF: number };
export type PreviewInventaire = {
  articles: ArtPreview[]; mouvements: MvtPreview[]; legumes: LegPreview[];
  resume: { maj: number; crees: number; mvEntree: number; mvSortie: number; legumes: number; sansMatch: number };
};

const strip = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const normEx = (s: string) => strip(s).replace(/[^a-z0-9]/g, "");
const STOP = new Set(["de", "du", "des", "d", "la", "le", "les", "l", "en", "au", "aux", "a", "et", "the"]);
const UNITRE = /^\d+([.,]\d+)?(kg|kgs|g|gr|l|ltr|lt|cl|ml|cm|mm|p|pcs|pce)?$/;
const toks = (s: string) => strip(s).replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w && !STOP.has(w) && !UNITRE.test(w));
const jac = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; const u = new Set([...A, ...B]).size; return u ? i / u : 0; };
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

  // Légumes : journal d'achats (colonnes de droite).
  const legumes: LegPreview[] = [];
  const wl = wb.worksheets.find((w) => /l.gume/i.test(w.name));
  if (wl) for (let r = 12; r <= wl.rowCount; r++) {
    const row = wl.getRow(r);
    const iso = dateAt(row, 11); const nom = txtAt(row, 13); const qte = numAt(row, 14); const prix = numAt(row, 15);
    if (iso && nom && qte != null && prix != null) legumes.push({ date: iso, legume: nom, quantite: round3(qte), montantCDF: prix });
  }

  const resume = {
    maj: articles.filter((a) => a.articleId).length,
    crees: articles.filter((a) => !a.articleId).length,
    mvEntree: mouvements.filter((m) => m.entree > 0).length,
    mvSortie: mouvements.filter((m) => m.sortie > 0).length,
    legumes: legumes.length,
    sansMatch: articles.filter((a) => a.match === "aucun").length,
  };
  return { articles, mouvements, legumes, resume };
}

const DATE_LEG_TAUX = 2300;

/** Applique l'inventaire dans une transaction et enregistre un ImportBatch réversible. */
export async function appliquerInventaire(buffer: ArrayBuffer, libelle: string, userId: string | null): Promise<{ batchId: string; resume: PreviewInventaire["resume"] }> {
  const preview = await analyserInventaire(buffer);
  const codeToArticleId = new Map<string, string>();
  for (const a of preview.articles) if (a.articleId) codeToArticleId.set(a.domaine + "|" + a.code, a.articleId);

  const batchId = await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({ data: { type: "INVENTAIRE", libelle, statut: "APPLIQUE", resume: preview.resume, creeParId: userId } });
    const ops: Prisma.ImportOperationCreateManyInput[] = [];

    for (const a of preview.articles) {
      let articleId = a.articleId;
      if (!articleId) {
        const cree = await tx.articleStock.create({ data: { designation: a.nom, domaine: a.domaine, code: a.code, unite: a.unite, prixUnitaireUSD: a.prix ?? undefined } });
        articleId = cree.id;
        ops.push({ batchId: batch.id, entite: "ArticleStock", entiteId: articleId, action: "CREATE", avant: Prisma.DbNull });
        codeToArticleId.set(a.domaine + "|" + a.code, articleId);
      } else {
        const cur = await tx.articleStock.findUniqueOrThrow({ where: { id: articleId }, select: { prixUnitaireUSD: true, unite: true, stock: { select: { quantite: true } } } });
        ops.push({ batchId: batch.id, entite: "ArticleStock", entiteId: articleId, action: "UPDATE", avant: { prixUnitaireUSD: cur.prixUnitaireUSD?.toString() ?? null, unite: cur.unite ?? null } });
        ops.push({ batchId: batch.id, entite: "Stock", entiteId: articleId, action: "UPDATE", avant: { quantite: cur.stock?.quantite?.toString() ?? null } });
        await tx.articleStock.update({ where: { id: articleId }, data: { ...(a.prix != null ? { prixUnitaireUSD: a.prix } : {}), ...(a.unite ? { unite: a.unite } : {}) } });
      }
      // Stock final (photo instant T)
      await tx.stock.upsert({
        where: { articleId },
        update: { quantite: a.stockFinal, ...(a.stockMin != null ? { stockMinimum: a.stockMin } : {}) },
        create: { articleId, quantite: a.stockFinal, stockMinimum: a.stockMin ?? 0, seuilUrgent: 0 },
      });
    }

    // Mouvements datés
    for (const m of preview.mouvements) {
      const articleId = codeToArticleId.get(m.code);
      if (!articleId) continue;
      if (m.entree > 0) { const mv = await tx.mouvementStock.create({ data: { articleId, type: "ENTREE", quantite: m.entree, date: new Date(m.date), origine: libelle } }); ops.push({ batchId: batch.id, entite: "MouvementStock", entiteId: mv.id, action: "CREATE", avant: Prisma.DbNull }); }
      if (m.sortie > 0) { const mv = await tx.mouvementStock.create({ data: { articleId, type: "SORTIE", quantite: m.sortie, date: new Date(m.date), origine: libelle } }); ops.push({ batchId: batch.id, entite: "MouvementStock", entiteId: mv.id, action: "CREATE", avant: Prisma.DbNull }); }
    }

    // Légumes
    for (const l of preview.legumes) {
      const ach = await tx.achatLegume.create({ data: { date: new Date(l.date), legume: l.legume, quantite: l.quantite, montantCDF: l.montantCDF, montantUSD: Math.round((l.montantCDF / DATE_LEG_TAUX) * 100) / 100, tauxChangeUtilise: DATE_LEG_TAUX, creeParId: userId } });
      ops.push({ batchId: batch.id, entite: "AchatLegume", entiteId: ach.id, action: "CREATE", avant: Prisma.DbNull });
    }

    await tx.importOperation.createMany({ data: ops });
    return batch.id;
  }, { timeout: 120000 });

  return { batchId, resume: preview.resume };
}

/** Annule un import : supprime les créations, restaure les mises à jour. Réversible. */
export async function annulerImport(batchId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { operations: true } });
    if (batch.statut === "ANNULE") throw new Error("Cet import a déjà été annulé.");
    // Ordre : d'abord supprimer les créations (mouvements, achats, articles), puis restaurer les updates.
    const creations = batch.operations.filter((o) => o.action === "CREATE");
    const updates = batch.operations.filter((o) => o.action === "UPDATE");
    // 1) Supprime d'abord les entités dépendantes créées par l'import.
    for (const o of creations) {
      if (o.entite === "MouvementStock") await tx.mouvementStock.deleteMany({ where: { id: o.entiteId } });
      else if (o.entite === "AchatLegume") await tx.achatLegume.deleteMany({ where: { id: o.entiteId } });
      else if (o.entite === "FactureFournisseur") await tx.factureFournisseur.deleteMany({ where: { id: o.entiteId } });
    }
    // 2) Puis les entités « parentes » créées par l'import.
    for (const o of creations) if (o.entite === "ArticleStock") await tx.articleStock.deleteMany({ where: { id: o.entiteId } });
    for (const o of creations) if (o.entite === "Fournisseur") {
      // Ne supprime un fournisseur créé que s'il n'est plus référencé (sécurité).
      const [nbArt, nbBC, nbFac] = await Promise.all([
        tx.articleStock.count({ where: { fournisseurId: o.entiteId } }),
        tx.bonDeCommande.count({ where: { fournisseurId: o.entiteId } }),
        tx.factureFournisseur.count({ where: { fournisseurId: o.entiteId } }),
      ]);
      if (nbArt === 0 && nbBC === 0 && nbFac === 0) await tx.fournisseur.deleteMany({ where: { id: o.entiteId } });
    }
    for (const o of updates) {
      const av = o.avant as Record<string, string | null> | null;
      if (!av) continue;
      if (o.entite === "ArticleStock") await tx.articleStock.update({ where: { id: o.entiteId }, data: { prixUnitaireUSD: av.prixUnitaireUSD != null ? new Prisma.Decimal(av.prixUnitaireUSD) : null, unite: av.unite } });
      else if (o.entite === "Stock") await tx.stock.updateMany({ where: { articleId: o.entiteId }, data: { quantite: av.quantite != null ? new Prisma.Decimal(av.quantite) : 0 } });
    }
    await tx.importBatch.update({ where: { id: batchId }, data: { statut: "ANNULE", annuleeAt: new Date() } });
  }, { timeout: 120000 });
}
