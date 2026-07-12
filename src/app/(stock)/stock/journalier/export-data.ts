import "server-only";
import { prisma } from "@/lib/prisma";
import { lundiDe } from "@/lib/dates-fr";
import type { Prisma } from "@prisma/client";
import type { Colonne } from "@/lib/pdf/tableau";

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const nb = (n: number) => (n ? String(Math.round(n * 1000) / 1000) : "");

export type RoleCol = "cmd" | "liv" | null;
export type ExportJournalier = {
  titre: string; sousTitre: string; fichierBase: string;
  entete: string[]; colonnes: Colonne[]; lignes: (string | number)[][];
  sectionRows: number[]; colRole: RoleCol[];
};

/** Prépare les données d'export (PDF/Excel) de la Conso. journalière selon la vue courante. */
export async function donneesJournalier(sp: URLSearchParams): Promise<ExportJournalier> {
  const domaine = sp.get("domaine") === "NOURRITURE" ? ("NOURRITURE" as const) : sp.get("domaine") === "BOISSON" ? ("BOISSON" as const) : undefined;
  const vue = sp.get("vue") === "commande" || sp.get("vue") === "comparaison" ? sp.get("vue")! : "conso";
  const lundi = sp.get("semaine") ? lundiDe(new Date(sp.get("semaine")!)) : lundiDe(new Date());
  const jours = Array.from({ length: 7 }, (_, i) => addDays(lundi, i));
  const fin = addDays(lundi, 7);
  const labels = jours.map((d, i) => `${JOURS[i]} ${d.getUTCDate()}`);
  const sousTitre = `Semaine du ${lundi.getUTCDate()}/${lundi.getUTCMonth() + 1} au ${addDays(lundi, 6).getUTCDate()}/${addDays(lundi, 6).getUTCMonth() + 1}`;
  const suffixe = domaine ? (domaine === "NOURRITURE" ? "_Cuisine" : "_Bar") : "";

  // Livraisons (sorties de stock) par article × jour.
  const where: Prisma.MouvementStockWhereInput = { type: "SORTIE", date: { gte: lundi, lt: fin }, ...(domaine ? { article: { domaine } } : {}) };
  const sorties = await prisma.mouvementStock.findMany({ where, include: { article: { select: { designation: true } } } });
  const livr = new Map<string, { designation: string; jours: number[] }>();
  for (const m of sorties) {
    const row = livr.get(m.articleId) ?? { designation: m.article.designation, jours: Array(7).fill(0) };
    const idx = Math.floor((new Date(m.date).getTime() - lundi.getTime()) / 86_400_000);
    if (idx >= 0 && idx < 7) row.jours[idx] += Number(m.quantite);
    livr.set(m.articleId, row);
  }

  // ---------- CONSOMMATION (livraisons + légumes frais) ----------
  if (vue === "conso") {
    const rows = [...livr.values()].sort((a, b) => a.designation.localeCompare(b.designation));
    const lignes: (string | number)[][] = [];
    const sectionRows: number[] = [];
    if (rows.length) { sectionRows.push(lignes.length); lignes.push(["Articles (sorties de stock)"]); }
    for (const r of rows) lignes.push([r.designation, ...r.jours.map(nb), nb(r.jours.reduce((a, b) => a + b, 0))]);

    // Légumes frais (achats du jour) — inclus uniquement en Cuisine ou Tous.
    if (domaine !== "BOISSON") {
      const legumes = await prisma.achatLegume.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { legume: true, date: true, quantite: true } });
      const parLeg = new Map<string, number[]>();
      for (const l of legumes) {
        const arr = parLeg.get(l.legume) ?? Array(7).fill(0);
        const idx = Math.floor((new Date(l.date).getTime() - lundi.getTime()) / 86_400_000);
        if (idx >= 0 && idx < 7) arr[idx] += Number(l.quantite);
        parLeg.set(l.legume, arr);
      }
      const legRows = [...parLeg.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      if (legRows.length) {
        sectionRows.push(lignes.length); lignes.push(["Légumes frais (achats du jour)"]);
        for (const [leg, j] of legRows) lignes.push([leg, ...j.map(nb), nb(j.reduce((a, b) => a + b, 0))]);
      }
    }

    return {
      titre: "Consommation journalière", sousTitre, fichierBase: `Conso_journaliere${suffixe}_${iso(lundi)}`,
      entete: ["Article", ...labels, "Total"],
      colonnes: [{ header: "Article", width: "26%" }, ...labels.map((l) => ({ header: l, width: "9%", align: "right" as const })), { header: "Total", width: "11%", align: "right" as const }],
      lignes, sectionRows, colRole: [null, ...labels.map(() => "liv" as RoleCol), "liv"],
    };
  }

  // Articles (catalogue) + commandes de la semaine.
  const articles = await prisma.articleStock.findMany({
    where: { actif: true, ...(domaine ? { domaine } : {}) },
    orderBy: [{ categorie: { nom: "asc" } }, { designation: "asc" }],
    select: { id: true, designation: true, categorie: { select: { nom: true } } },
  });
  const cmds = await prisma.commandeResto.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { articleId: true, date: true, quantite: true } });
  const cmdMap: Record<string, number[]> = {};
  for (const c of cmds) { (cmdMap[c.articleId] ??= Array(7).fill(0))[Math.floor((new Date(c.date).getTime() - lundi.getTime()) / 86_400_000)] += Number(c.quantite); }

  // ---------- COMMANDE ----------
  if (vue === "commande") {
    const lignes: (string | number)[][] = [];
    const sectionRows: number[] = [];
    let derniereCat: string | null = null;
    for (const a of articles) {
      const cat = a.categorie?.nom ?? "À classer";
      if (cat !== derniereCat) { sectionRows.push(lignes.length); lignes.push([cat]); derniereCat = cat; }
      const j = cmdMap[a.id] ?? Array(7).fill(0);
      lignes.push([a.designation, ...j.map(nb), nb(j.reduce((x, y) => x + y, 0))]);
    }
    return {
      titre: "Commande journalière", sousTitre, fichierBase: `Commande${suffixe}_${iso(lundi)}`,
      entete: ["Article", ...labels, "Total"],
      colonnes: [{ header: "Article", width: "26%" }, ...labels.map((l) => ({ header: l, width: "9%", align: "right" as const })), { header: "Total", width: "11%", align: "right" as const }],
      lignes, sectionRows, colRole: [null, ...labels.map(() => "cmd" as RoleCol), "cmd"],
    };
  }

  // ---------- COMPARAISON (Commande C / Livraison L par jour) ----------
  const lignes: (string | number)[][] = [];
  const sectionRows: number[] = [];
  let derniereCat: string | null = null;
  for (const a of articles) {
    const cmd = cmdMap[a.id] ?? Array(7).fill(0);
    const liv = livr.get(a.id)?.jours ?? Array(7).fill(0);
    if (!cmd.some((v) => v > 0) && !liv.some((v) => v > 0)) continue;
    const cat = a.categorie?.nom ?? "À classer";
    if (cat !== derniereCat) { sectionRows.push(lignes.length); lignes.push([cat]); derniereCat = cat; }
    const cells: (string | number)[] = [a.designation];
    for (let i = 0; i < 7; i++) { cells.push(nb(cmd[i]), nb(liv[i])); }
    cells.push(nb(cmd.reduce((x, y) => x + y, 0)), nb(liv.reduce((x, y) => x + y, 0)));
    lignes.push(cells);
  }
  const colonnes: Colonne[] = [{ header: "Article", width: "18%" }];
  const entete: string[] = ["Article"];
  const colRole: RoleCol[] = [null];
  const dayW = `${82 / 16}%`;
  for (const l of labels) { colonnes.push({ header: `${l} C`, width: dayW, align: "right" }, { header: `${l} L`, width: dayW, align: "right" }); entete.push(`${l} Cmd`, `${l} Liv`); colRole.push("cmd", "liv"); }
  colonnes.push({ header: "Tot. C", width: dayW, align: "right" }, { header: "Tot. L", width: dayW, align: "right" });
  entete.push("Total Cmd", "Total Liv"); colRole.push("cmd", "liv");

  return {
    titre: "Comparaison commande / livraison", sousTitre, fichierBase: `Comparaison${suffixe}_${iso(lundi)}`,
    entete, colonnes, lignes, sectionRows, colRole,
  };
}
