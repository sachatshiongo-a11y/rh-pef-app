import "server-only";
import { prisma } from "@/lib/prisma";
import { lundiDe } from "@/lib/dates-fr";
import type { Colonne } from "@/lib/pdf/tableau";
import { LEGUMES } from "../legumes/legumes-data";
import {
  consommationParArticleCatalogue, lignesComparaison, lignesExportComparaison, lignesExportConso, nbExport, type RoleCol,
} from "@/lib/journalier-restaurant";
import { chargerDonneesRestaurant } from "./donnees-restaurant";

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const nb = nbExport;

export type { RoleCol };
export type ExportJournalier = {
  titre: string; sousTitre: string; fichierBase: string;
  entete: string[]; colonnes: Colonne[]; lignes: (string | number)[][];
  sectionRows: number[]; colRole: RoleCol[];
  /** Rôle d'une ligne entière (prime sur celui de la colonne) : livré, consommé, ou aucun (pertes). */
  rolesLignes?: Record<number, RoleCol>;
  /** Cellules « r:c » du consommé en écart avec le livré (comparaison). */
  ecarts?: Set<string>;
};

/** Rôle (couleur) d'une cellule d'export : celui de la ligne s'il est posé, sinon celui de la colonne. */
export function roleCellule(d: ExportJournalier, r: number, c: number): RoleCol | "ecart" {
  if (c === 0) return null;
  if (d.ecarts?.has(`${r}:${c}`)) return "ecart";
  if (d.rolesLignes && r in d.rolesLignes) return d.rolesLignes[r]!;
  return d.colRole[c] ?? null;
}

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

  // ---------- CONSOMMATION (sorties par motif + légumes frais + consommation réelle) ----------
  if (vue === "conso") {
    const donnees = await chargerDonneesRestaurant(lundi, domaine);
    const legumes: { nom: string; jours: number[] }[] = [];
    if (domaine !== "BOISSON") {
      const achats = await prisma.achatLegume.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { legume: true, date: true, quantite: true } });
      const parLeg = new Map<string, number[]>();
      for (const l of achats) {
        const arr = parLeg.get(l.legume) ?? Array(7).fill(0);
        const idx = Math.floor((new Date(l.date).getTime() - lundi.getTime()) / 86_400_000);
        if (idx >= 0 && idx < 7) arr[idx] += Number(l.quantite);
        parLeg.set(l.legume, arr);
      }
      legumes.push(...[...parLeg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([nom, jours]) => ({ nom, jours })));
    }
    const { lignes, sectionRows, rolesLignes } = lignesExportConso({ sorties: donnees.sorties, legumes, consoResto: donnees.consoResto });
    return {
      titre: "Consommation journalière", sousTitre, fichierBase: `Conso_journaliere${suffixe}_${iso(lundi)}`,
      entete: ["Article", ...labels, "Total"],
      colonnes: [{ header: "Article", width: "26%" }, ...labels.map((l) => ({ header: l, width: "9%", align: "right" as const })), { header: "Total", width: "11%", align: "right" as const }],
      lignes, sectionRows, colRole: [null, ...labels.map(() => "liv" as RoleCol), "liv"], rolesLignes,
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

  // Légumes frais (cuisine) : commande (CommandeLegumeResto) et achat (AchatLegume).
  const inclureLeg = domaine !== "BOISSON";
  const cmdLeg = new Map<string, number[]>(), achatLeg = new Map<string, number[]>();
  if (inclureLeg) {
    const [cl, al] = await Promise.all([
      prisma.commandeLegumeResto.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { legume: true, date: true, quantite: true } }),
      prisma.achatLegume.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { legume: true, date: true, quantite: true } }),
    ]);
    for (const c of cl) { const a = cmdLeg.get(c.legume) ?? Array(7).fill(0); a[Math.floor((new Date(c.date).getTime() - lundi.getTime()) / 86_400_000)] += Number(c.quantite); cmdLeg.set(c.legume, a); }
    for (const c of al) { const a = achatLeg.get(c.legume) ?? Array(7).fill(0); a[Math.floor((new Date(c.date).getTime() - lundi.getTime()) / 86_400_000)] += Number(c.quantite); achatLeg.set(c.legume, a); }
  }

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
    const legCmd = LEGUMES.map((l) => ({ nom: l.nom, j: cmdLeg.get(l.nom) ?? Array(7).fill(0) })).filter((x) => x.j.some((v) => v > 0));
    if (legCmd.length) { sectionRows.push(lignes.length); lignes.push(["Légumes frais"]); for (const x of legCmd) lignes.push([x.nom, ...x.j.map(nb), nb(x.j.reduce((a, b) => a + b, 0))]); }
    return {
      titre: "Commande journalière", sousTitre, fichierBase: `Commande${suffixe}_${iso(lundi)}`,
      entete: ["Article", ...labels, "Total"],
      colonnes: [{ header: "Article", width: "26%" }, ...labels.map((l) => ({ header: l, width: "9%", align: "right" as const })), { header: "Total", width: "11%", align: "right" as const }],
      lignes, sectionRows, colRole: [null, ...labels.map(() => "cmd" as RoleCol), "cmd"],
    };
  }

  // ---------- COMPARAISON (commandé / livré au restaurant / consommé, par jour) ----------
  const donnees = await chargerDonneesRestaurant(lundi, domaine);
  const commandes: Record<string, number> = {};
  for (const [id, j] of Object.entries(cmdMap)) j.forEach((q, i) => { if (q) commandes[`${id}_${donnees.jours[i]}`] = q; });
  const lignesComp = lignesComparaison({
    jours: donnees.jours,
    articles: articles.map((a) => ({ id: a.id, designation: a.designation, categorie: a.categorie?.nom ?? "À classer" })),
    commandes,
    livraisons: donnees.sorties.livraisons,
    consoParArticle: consommationParArticleCatalogue(donnees.entrees, donnees.jours),
    inclureHorsCatalogue: !domaine,
    legumes: inclureLeg
      ? [...new Set([...LEGUMES.map((l) => l.nom), ...achatLeg.keys()])].map((nom) => ({ nom, cmd: cmdLeg.get(nom) ?? Array(7).fill(0), liv: achatLeg.get(nom) ?? Array(7).fill(0) }))
      : [],
  });
  const { lignes, sectionRows, entete, colRole, ecarts } = lignesExportComparaison(lignesComp, labels);
  const colW = `${84 / 24}%`;
  const colonnes: Colonne[] = [
    { header: "Article", width: "16%" },
    ...[...labels, "Tot."].flatMap((l) => [
      { header: `${l} C`, width: colW, align: "right" as const },
      { header: `${l} L`, width: colW, align: "right" as const },
      { header: `${l} Cs`, width: colW, align: "right" as const },
    ]),
  ];

  return {
    titre: "Comparaison commandé / livré / consommé", sousTitre, fichierBase: `Comparaison${suffixe}_${iso(lundi)}`,
    entete, colonnes, lignes, sectionRows, colRole, ecarts,
  };
}
