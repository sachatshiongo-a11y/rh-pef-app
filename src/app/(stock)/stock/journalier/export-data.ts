import "server-only";
import { prisma } from "@/lib/prisma";
import { lundiDe, lundiCourantKinshasa } from "@/lib/dates-fr";
import type { Colonne } from "@/lib/pdf/tableau";
import { LEGUMES } from "../legumes/legumes-data";
import {
  consoApproximativeParArticleCatalogue, consommationParArticleCatalogue, libelleAvecUnite, lignesComparaison, lignesExportComparaison, lignesExportConso, nbExport, partiesPdfComparaison, sommeExacte,
  type EcartExport, type RoleCol,
} from "@/lib/journalier-restaurant";
import { achatsLegumesParLigne, lignesLegumesComparaison } from "@/lib/legumes-semaine";
import { chargerDonneesRestaurant } from "./donnees-restaurant";
import { chargerEcartsVentes } from "./ecarts-data";
import { ENTETE_EXPORT_ECARTS, lignesExportEcarts } from "@/lib/ecarts-ventes-presentation";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";

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
  /** PDF en plusieurs parties (comparaison : trop de colonnes pour une page) — `indices` dans `colonnes`. */
  partiesPdf?: { titre: string; indices: number[]; colonnes: Colonne[]; groupes: { libelle: string; nb: number }[] }[];
  /** Cellules « r:c » commandé / livré d'un jour où le livré diffère du commandé (comparaison). */
  ecartsCL?: Set<string>;
  /** Écart signé (« +2 », « -1 ») des cellules en écart, à écrire à côté de la valeur (comparaison). */
  signes?: Map<string, EcartExport>;
  /** Pied du PDF quand il diffère de celui des autres vues (écarts ventes / consommation). */
  pied?: string;
  /** Comparaison : en-têtes courts sous des groupes (un par jour) — le classeur écrit deux niveaux d'en-tête. */
  enteteCourt?: string[];
  groupesEntete?: { libelle: string; debut: number; nb: number }[];
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
  const vue = sp.get("vue") === "commande" || sp.get("vue") === "comparaison" || sp.get("vue") === "ecarts" ? sp.get("vue")! : "conso";
  const lundi = sp.get("semaine") ? lundiDe(new Date(sp.get("semaine")!)) : lundiCourantKinshasa();
  const jours = Array.from({ length: 7 }, (_, i) => addDays(lundi, i));
  const fin = addDays(lundi, 7);
  const labels = jours.map((d, i) => `${JOURS[i]} ${d.getUTCDate()}`);
  const sousTitre = `Semaine du ${lundi.getUTCDate()}/${lundi.getUTCMonth() + 1} au ${addDays(lundi, 6).getUTCDate()}/${addDays(lundi, 6).getUTCMonth() + 1}`;
  const suffixe = domaine ? (domaine === "NOURRITURE" ? "_Cuisine" : "_Bar") : "";

  // ---------- ÉCARTS VENTES / CONSOMMATION (contrôle : réel vs théorique, signal seulement) ----------
  if (vue === "ecarts") {
    const { ecarts, espaces } = await chargerEcartsVentes(lundi, domaine);
    const { lignes, sectionRows } = lignesExportEcarts(ecarts, espaces);
    return {
      titre: "Écarts ventes / consommation", sousTitre, fichierBase: `Ecarts_ventes_consommation${suffixe}_${iso(lundi)}`,
      entete: ENTETE_EXPORT_ECARTS,
      colonnes: [{ header: "Article", width: "26%" }, { header: "Unité", width: "8%" }, { header: "Comparé", width: "16%" }, ...["Réel", "Théorique", "Écart", "Valeur de l'écart"].map((h) => ({ header: h, width: "12%", align: "right" as const })), { header: "Devise", width: "6%" }],
      lignes, sectionRows, colRole: ENTETE_EXPORT_ECARTS.map(() => null),
      pied: "Écart = réel (compté au début + reçu du dépôt − compté à la fin) − théorique (ventes saisies × fiches techniques) ; positif : consommé en plus de ce que les ventes expliquent. Signal seulement, aucun stock n'est corrigé. « — » : écart inconnu, jamais 0.",
    };
  }

  // ---------- CONSOMMATION (sorties par motif + légumes frais + consommation réelle) ----------
  if (vue === "conso") {
    const donnees = await chargerDonneesRestaurant(lundi, domaine);
    const legumes: { nom: string; unite?: string | null; jours: number[] }[] = [];
    if (domaine !== "BOISSON") {
      const achats = await prisma.achatLegume.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { legume: true, unite: true, date: true, quantite: true } });
      // Par ligne (légume + unité) : jamais des unités différentes additionnées.
      legumes.push(...achatsLegumesParLigne(achats.map((l) => ({ legume: l.legume, unite: l.unite, jour: iso(new Date(l.date)), quantite: Number(l.quantite) })), donnees.jours, LEGUMES));
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
    select: { id: true, ...CHAMPS_LIBELLE, unite: true, categorie: { select: { nom: true } } },
  });
  const cmds = await prisma.commandeResto.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { articleId: true, date: true, quantite: true } });
  const cmdMap: Record<string, number[]> = {};
  for (const c of cmds) { (cmdMap[c.articleId] ??= Array(7).fill(0))[Math.floor((new Date(c.date).getTime() - lundi.getTime()) / 86_400_000)] += Number(c.quantite); }

  // Légumes frais (cuisine) : commande (CommandeLegumeResto) et achat (AchatLegume).
  const inclureLeg = domaine !== "BOISSON";
  const cmdLeg = new Map<string, number[]>();
  let achatsLeg: ReturnType<typeof achatsLegumesParLigne> = [];
  if (inclureLeg) {
    const [cl, al] = await Promise.all([
      prisma.commandeLegumeResto.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { legume: true, date: true, quantite: true } }),
      prisma.achatLegume.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { legume: true, unite: true, date: true, quantite: true } }),
    ]);
    for (const c of cl) { const a = cmdLeg.get(c.legume) ?? Array(7).fill(0); a[Math.floor((new Date(c.date).getTime() - lundi.getTime()) / 86_400_000)] += Number(c.quantite); cmdLeg.set(c.legume, a); }
    achatsLeg = achatsLegumesParLigne(al.map((l) => ({ legume: l.legume, unite: l.unite, jour: iso(new Date(l.date)), quantite: Number(l.quantite) })), jours.map(iso), LEGUMES);
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
      lignes.push([libelleAvecUnite(libelleArticle(a), a.unite), ...j.map(nb), nb(sommeExacte(j))]);
    }
    const legCmd = LEGUMES.map((l) => ({ nom: l.nom, unite: l.unite, j: cmdLeg.get(l.nom) ?? Array(7).fill(0) })).filter((x) => x.j.some((v) => v > 0));
    if (legCmd.length) { sectionRows.push(lignes.length); lignes.push(["Légumes frais"]); for (const x of legCmd) lignes.push([libelleAvecUnite(x.nom, x.unite), ...x.j.map(nb), nb(sommeExacte(x.j))]); }
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
    articles: articles.map((a) => ({ id: a.id, designation: libelleArticle(a), unite: a.unite, categorie: a.categorie?.nom ?? "À classer" })),
    commandes,
    livraisons: donnees.sorties.livraisons,
    consoParArticle: consommationParArticleCatalogue(donnees.entrees, donnees.jours),
    consoApproxParArticle: consoApproximativeParArticleCatalogue(donnees.entrees, donnees.jours),
    inclureHorsCatalogue: !domaine,
    // Commande (unité de la liste) et achat dans une autre unité : deux lignes, jamais la même.
    legumes: inclureLeg
      ? lignesLegumesComparaison({ liste: LEGUMES, achats: achatsLeg, commandes: (nom) => cmdLeg.get(nom) ?? Array(7).fill(0), nbJours: 7 })
      : [],
  });
  const { lignes, sectionRows, entete, colRole, ecarts, colonnes, ecartsCL, signes, enteteCourt, groupes } = lignesExportComparaison(lignesComp, labels);

  return {
    titre: "Comparaison commandé / livré / consommé", sousTitre, fichierBase: `Comparaison${suffixe}_${iso(lundi)}`,
    entete, colonnes, lignes, sectionRows, colRole, ecarts, partiesPdf: partiesPdfComparaison(labels),
    ecartsCL, signes, enteteCourt, groupesEntete: groupes,
  };
}
