import "server-only";
import { prixArticleEnUSD } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { prisma } from "@/lib/prisma";
import { STATUT_FACTURE_LABEL } from "@/lib/stock";
import { WHERE_ACHATS_LISTE, prixUnitaireAchat } from "@/lib/achats-liste";
import { cellulePrixUnitairePdf, type CelluleRapport } from "@/lib/rapports-pdf";
import { chargerExploitation, chargerEcrituresRapport, type LigneEcritureRapport } from "@/app/(exploitation)/exploitation/_data/charger-periode";
import { chargerAnneeRapport } from "@/app/(exploitation)/exploitation/_data/charger-annee";
import { construireRapportAnnuel, type DonneesRapportAnnuel } from "@/lib/exploitation/rapport-annuel";
import type { RatioResultat } from "@/lib/exploitation/calcul";
import { construireRapportVisuel, type DonneesRapportVisuel } from "@/lib/exploitation/rapport-regroupe";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

export type { LigneEcritureRapport };

export const TYPES_RAPPORT = {
  FACTURES: "Factures fournisseurs",
  BONS_COMMANDE: "Bons de commande",
  PAIEMENTS: "Retards de paiement",
  ACHATS: "Achats (liste d'achat)",
  MOUVEMENTS: "Mouvements de stock",
  LEGUMES: "Achats de légumes frais",
} as const;
export type TypeRapport = keyof typeof TYPES_RAPPORT;

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export type TableSecondaire = {
  titre: string; entete: string[]; lignes: (string | number)[][];
  largeurs: string[]; droite: number[]; sommables?: number[];
};
export type DonneesRapport = {
  titre: string;
  entete: string[];
  lignes: (string | number)[][];
  // largeurs (pour le PDF), alignements à droite pour les colonnes numériques (par index)
  largeurs: string[];
  droite: number[];
  sommables?: number[]; // colonnes à totaliser (ligne « Total » en Excel/PDF)
  variationCol?: number; // colonne d'écart/variation à mettre en évidence (couleur)
  soustitre?: string; // sous-titre du 1er tableau (ex. « Synthèse par article »)
  table2?: TableSecondaire; // tableau secondaire (ex. achats jour par jour) — 2e feuille Excel / 2e tableau PDF
  autofiltre?: boolean; // Excel : autofiltre sur l'en-tête, borné aux lignes de données (le total ne se trie pas avec elles)
  /**
   * Présentation PDF propre, quand elle diffère de l'Excel : l'Excel garde des NOMBRES calculables
   * (une colonne par grandeur : prix, devise, équivalent USD…), le PDF les réunit en une cellule
   * lisible (« 4 760 FC ≈ 1,70 $ »). Mêmes lignes, mêmes montants, même total.
   */
  pdf?: { entete: string[]; lignes: CelluleRapport[][]; largeurs: string[]; droite: number[]; sommables?: number[] };
};

/** Liste des clés mois (année, mois) entre deux bornes incluses. */
function moisEntre(debut: Date, fin: Date): { annee: number; mois: number }[] {
  const out: { annee: number; mois: number }[] = [];
  const d = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth(), 1));
  const f = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), 1));
  while (d <= f) {
    out.push({ annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1 });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}
const cle = (a: number, m: number) => `${a}-${m}`;
const labelMois = (a: number, m: number) => `${MOIS[m - 1]} ${a}`;
const variation = (cur: number, prev: number | null): string => {
  if (prev === null || prev === 0) return "—";
  const v = ((cur - prev) / Math.abs(prev)) * 100;
  return `${v > 0 ? "↑" : v < 0 ? "↓" : ""} ${Math.abs(v).toFixed(0)} %`;
};
const arr = (n: number) => Math.round(n * 100) / 100;

export async function genererDonneesRapport(type: TypeRapport, debut: Date, fin: Date): Promise<DonneesRapport> {
  const mois = moisEntre(debut, fin);
  const finExcl = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate() + 1));
  const titre = TYPES_RAPPORT[type];

  if (type === "FACTURES") {
    // Factures en francs (2026-10-09) : colonnes en francs À PART (jamais additionnées aux dollars),
    // présentes seulement s'il existe des factures en francs — sinon le rapport d'avant, à l'identique.
    const rows = await prisma.factureFournisseur.findMany({ where: { annee: { gte: debut.getUTCFullYear() } }, select: { annee: true, mois: true, devise: true, montantUSD: true, resteAPayerUSD: true, montantCDF: true, resteAPayerCDF: true } });
    const parMois = new Map<string, { fac: number; du: number; facFC: number; duFC: number }>();
    for (const r of rows) { const k = cle(r.annee, r.mois); const e = parMois.get(k) ?? { fac: 0, du: 0, facFC: 0, duFC: 0 }; e.fac += Number(r.montantUSD ?? 0); e.du += Number(r.resteAPayerUSD ?? 0); e.facFC += Number(r.montantCDF ?? 0); e.duFC += Number(r.resteAPayerCDF ?? 0); parMois.set(k, e); }
    const avecFC = rows.some((r) => r.devise === "CDF");
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const e = parMois.get(cle(annee, m)) ?? { fac: 0, du: 0, facFC: 0, duFC: 0 }; const l = [labelMois(annee, m), arr(e.fac), arr(e.du), ...(avecFC ? [arr(e.facFC), arr(e.duFC)] : []), variation(e.fac, prev)]; prev = e.fac; return l; });
    if (avecFC) return { titre, entete: ["Mois", "Total facturé USD", "Reste dû USD", "Total facturé CDF", "Reste dû CDF", "Variation facturé USD"], lignes, largeurs: ["22%", "16%", "15%", "17%", "15%", "15%"], droite: [1, 2, 3, 4], sommables: [1, 2, 3, 4], variationCol: 5 };
    return { titre, entete: ["Mois", "Total facturé USD", "Reste dû USD", "Variation facturé"], lignes, largeurs: ["34%", "24%", "22%", "20%"], droite: [1, 2], sommables: [1, 2], variationCol: 3 };
  }

  if (type === "BONS_COMMANDE") {
    const rows = await prisma.bonDeCommande.findMany({ select: { annee: true, mois: true, totalUSD: true } });
    const parMois = new Map<string, { nb: number; tot: number }>();
    for (const r of rows) { const k = cle(r.annee, r.mois); const e = parMois.get(k) ?? { nb: 0, tot: 0 }; e.nb += 1; e.tot += Number(r.totalUSD); parMois.set(k, e); }
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const e = parMois.get(cle(annee, m)) ?? { nb: 0, tot: 0 }; const l = [labelMois(annee, m), e.nb, arr(e.tot), variation(e.tot, prev)]; prev = e.tot; return l; });
    return { titre, entete: ["Mois", "Nb BC", "Total USD", "Variation total"], lignes, largeurs: ["34%", "16%", "26%", "24%"], droite: [1, 2], sommables: [1, 2], variationCol: 3 };
  }

  if (type === "PAIEMENTS") {
    const rows = await prisma.factureFournisseur.findMany({ where: { statut: "ECHUE_NON_REGLEE" }, select: { annee: true, mois: true, devise: true, resteAPayerUSD: true, resteAPayerCDF: true } });
    const parMois = new Map<string, number>(), parMoisFC = new Map<string, number>();
    for (const r of rows) { const k = cle(r.annee, r.mois); parMois.set(k, (parMois.get(k) ?? 0) + Number(r.resteAPayerUSD ?? 0)); parMoisFC.set(k, (parMoisFC.get(k) ?? 0) + Number(r.resteAPayerCDF ?? 0)); }
    const avecFC = rows.some((r) => r.devise === "CDF");
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const v = parMois.get(cle(annee, m)) ?? 0; const l = [labelMois(annee, m), arr(v), ...(avecFC ? [arr(parMoisFC.get(cle(annee, m)) ?? 0)] : []), variation(v, prev)]; prev = v; return l; });
    if (avecFC) return { titre, entete: ["Mois", "Échu non réglé USD", "Échu non réglé CDF", "Variation USD"], lignes, largeurs: ["30%", "25%", "25%", "20%"], droite: [1, 2], sommables: [1, 2], variationCol: 3 };
    return { titre, entete: ["Mois", "Échu non réglé USD", "Variation"], lignes, largeurs: ["40%", "34%", "26%"], droite: [1], sommables: [1], variationCol: 2 };
  }

  if (type === "ACHATS") {
    // Achats hors facture = ceux de la Liste d'achat : même règle que son écran (ni réception de BC, ni entrée manuelle).
    const rows = await prisma.mouvementStock.findMany({ where: { ...WHERE_ACHATS_LISTE, date: { gte: debut, lt: finExcl } }, select: { date: true, montantUSD: true } });
    const parMois = new Map<string, number>();
    for (const r of rows) { const d = new Date(r.date); const k = cle(d.getUTCFullYear(), d.getUTCMonth() + 1); parMois.set(k, (parMois.get(k) ?? 0) + Number(r.montantUSD ?? 0)); }
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const v = parMois.get(cle(annee, m)) ?? 0; const l = [labelMois(annee, m), arr(v), variation(v, prev)]; prev = v; return l; });
    return { titre, entete: ["Mois", "Achats USD", "Variation"], lignes, largeurs: ["40%", "34%", "26%"], droite: [1], sommables: [1], variationCol: 2 };
  }

  if (type === "MOUVEMENTS") {
    const rows = await prisma.mouvementStock.findMany({ where: { date: { gte: debut, lt: finExcl } }, select: { date: true, type: true } });
    const parMois = new Map<string, { e: number; s: number }>();
    for (const r of rows) { const d = new Date(r.date); const k = cle(d.getUTCFullYear(), d.getUTCMonth() + 1); const x = parMois.get(k) ?? { e: 0, s: 0 }; if (r.type === "SORTIE") x.s += 1; else if (r.type === "ENTREE") x.e += 1; parMois.set(k, x); }
    const lignes = mois.map(({ annee, mois: m }) => { const x = parMois.get(cle(annee, m)) ?? { e: 0, s: 0 }; return [labelMois(annee, m), x.e, x.s]; });
    return { titre, entete: ["Mois", "Entrées", "Sorties"], lignes, largeurs: ["50%", "25%", "25%"], droite: [1, 2], sommables: [1, 2] };
  }

  // LEGUMES
  const rows = await prisma.achatLegume.findMany({ where: { date: { gte: debut, lt: finExcl } }, select: { date: true, montantCDF: true, montantUSD: true } });
  const parMois = new Map<string, { cdf: number; usd: number }>();
  for (const r of rows) { const d = new Date(r.date); const k = cle(d.getUTCFullYear(), d.getUTCMonth() + 1); const e = parMois.get(k) ?? { cdf: 0, usd: 0 }; e.cdf += Number(r.montantCDF ?? 0); e.usd += Number(r.montantUSD ?? 0); parMois.set(k, e); }
  let prev: number | null = null;
  const lignes = mois.map(({ annee, mois: m }) => { const e = parMois.get(cle(annee, m)) ?? { cdf: 0, usd: 0 }; const l = [labelMois(annee, m), arr(e.cdf), arr(e.usd), variation(e.usd, prev)]; prev = e.usd; return l; });
  return { titre, entete: ["Mois", "Montant CDF", "Montant USD", "Variation USD"], lignes, largeurs: ["30%", "26%", "22%", "22%"], droite: [1, 2], sommables: [1, 2], variationCol: 3 };
}

const jj = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");
const q3 = (v: unknown) => Math.round(Number(v) * 1000) / 1000;

/** Rapport DÉTAILLÉ : liste ligne par ligne (fournisseurs, articles, montants) au lieu des totaux mensuels. */
export async function genererDonneesRapportDetail(type: TypeRapport, debut: Date, fin: Date): Promise<DonneesRapport> {
  const finExcl = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate() + 1));
  const bornInf = debut.getUTCFullYear() * 12 + debut.getUTCMonth();
  const bornSup = fin.getUTCFullYear() * 12 + (fin.getUTCMonth());
  const dans = (a: number, m: number) => { const i = a * 12 + (m - 1); return i >= bornInf && i <= bornSup; };
  // Filtre au jour près quand la ligne porte une date exacte ; sinon repli sur le mois (factures sans date).
  const dansJour = (d: Date | null, a: number, m: number) => (d ? d >= debut && d < finExcl : dans(a, m));
  const titre = `${TYPES_RAPPORT[type]} — détail`;

  if (type === "FACTURES") {
    const rows = (await prisma.factureFournisseur.findMany({ orderBy: [{ annee: "asc" }, { mois: "asc" }, { date: "asc" }], include: { fournisseur: { select: { nom: true } } } }))
      .filter((r) => dansJour(r.date, r.annee, r.mois));
    // Montants dans la devise de chaque facture : colonnes en francs à part (vides pour une facture en
    // dollars, et inversement), seulement s'il existe des factures en francs.
    if (rows.some((r) => r.devise === "CDF")) {
      const lignes = rows.map((r) => {
        const fc = r.devise === "CDF";
        return [jj(r.date), r.fournisseur?.nom ?? r.fournisseurNom, r.numero ?? "—", jj(r.dateEcheance), fc ? "" : arr(Number(r.montantUSD)), fc ? "" : arr(Number(r.resteAPayerUSD)), fc ? arr(Number(r.montantCDF)) : "", fc ? arr(Number(r.resteAPayerCDF)) : "", STATUT_FACTURE_LABEL[r.statut] ?? r.statut];
      });
      return { titre, entete: ["Date", "Fournisseur", "N°", "Échéance", "Montant USD", "Reste USD", "Montant CDF", "Reste CDF", "Statut"], lignes, largeurs: ["9%", "19%", "9%", "9%", "11%", "10%", "12%", "11%", "10%"], droite: [4, 5, 6, 7], sommables: [4, 5, 6, 7] };
    }
    const lignes = rows.map((r) => [jj(r.date), r.fournisseur?.nom ?? r.fournisseurNom, r.numero ?? "—", jj(r.dateEcheance), arr(Number(r.montantUSD)), arr(Number(r.resteAPayerUSD)), STATUT_FACTURE_LABEL[r.statut] ?? r.statut]);
    return { titre, entete: ["Date", "Fournisseur", "N°", "Échéance", "Montant USD", "Reste USD", "Statut"], lignes, largeurs: ["11%", "24%", "12%", "12%", "13%", "13%", "15%"], droite: [4, 5], sommables: [4, 5] };
  }

  if (type === "BONS_COMMANDE") {
    const bcs = (await prisma.bonDeCommande.findMany({ orderBy: [{ annee: "asc" }, { sequence: "asc" }], include: { fournisseur: { select: { nom: true } }, lignes: { orderBy: { designation: "asc" } } } }))
      .filter((b) => dansJour(b.date, b.annee, b.mois));
    const lignes: (string | number)[][] = [];
    for (const b of bcs) {
      if (b.lignes.length === 0) lignes.push([b.numero, jj(b.date), b.fournisseur?.nom ?? "—", "—", "", "", arr(Number(b.totalUSD))]);
      for (const l of b.lignes) lignes.push([b.numero, jj(b.date), b.fournisseur?.nom ?? "—", l.designation, q3(l.quantite), arr(Number(l.prixUnitaireUSD)), arr(Number(l.totalLigneUSD))]);
    }
    return { titre, entete: ["N° BC", "Date", "Fournisseur", "Article", "Qté", "P.U. USD", "Total USD"], lignes, largeurs: ["13%", "10%", "20%", "27%", "9%", "10%", "11%"], droite: [4, 5, 6], sommables: [6] };
  }

  if (type === "PAIEMENTS") {
    const rows = (await prisma.factureFournisseur.findMany({ where: { statut: "ECHUE_NON_REGLEE" }, orderBy: { dateEcheance: "asc" }, include: { fournisseur: { select: { nom: true } } } }));
    // Retard en jours CIVILS de Kinshasa (échéance = minuit UTC d'un jour civil) : plus d'arrondi à midi.
    const auj = jourCivilKinshasa(new Date()).getTime();
    const avecFC = rows.some((r) => r.devise === "CDF");
    const lignes = rows.map((r) => {
      const jrs = r.dateEcheance ? Math.round((auj - new Date(r.dateEcheance).getTime()) / 86400000) : null;
      const base = [r.fournisseur?.nom ?? r.fournisseurNom, r.numero ?? "—", jj(r.dateEcheance), jrs !== null ? `${jrs} j` : "—"];
      return avecFC ? [...base, r.devise === "CDF" ? "" : arr(Number(r.resteAPayerUSD)), r.devise === "CDF" ? arr(Number(r.resteAPayerCDF)) : ""] : [...base, arr(Number(r.resteAPayerUSD))];
    });
    if (avecFC) return { titre, entete: ["Fournisseur", "N°", "Échéance", "Retard", "Reste USD", "Reste CDF"], lignes, largeurs: ["30%", "14%", "14%", "12%", "15%", "15%"], droite: [4, 5], sommables: [4, 5] };
    return { titre, entete: ["Fournisseur", "N°", "Échéance", "Retard", "Reste USD"], lignes, largeurs: ["34%", "16%", "16%", "14%", "20%"], droite: [4], sommables: [4] };
  }

  if (type === "ACHATS") {
    // Demande Direction 2026-09-30 : l'UNITÉ et le PRIX UNITAIRE de chaque ligne (voir `prixUnitaireAchat`).
    // Le mouvement ne porte pas d'unité : c'est celle de l'article (« — » si elle manque). Les
    // montants et leur total ne changent pas : même colonne « Montant USD », mêmes valeurs.
    const rows = await prisma.mouvementStock.findMany({ where: { ...WHERE_ACHATS_LISTE, date: { gte: debut, lt: finExcl } }, orderBy: { date: "desc" }, include: { article: { select: { designation: true, unite: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true } } } });
    const taux = await tauxDuJour(); // repli « prix du catalogue » d'un article en francs : en dollars au taux du jour
    const COURT = { USD: "USD", CDF: "FC" } as const;
    const lignesPdf: CelluleRapport[][] = [];
    const lignes = rows.map((m) => {
      const unite = m.article.unite?.trim() || "—";
      const montant = m.montantUSD !== null ? arr(Number(m.montantUSD)) : "";
      const pu = prixUnitaireAchat({ quantite: m.quantite, devise: m.devise, montantOrigine: m.montantOrigine, montantUSD: m.montantUSD, tauxChangeUtilise: m.tauxChangeUtilise, prixCatalogueUSD: prixArticleEnUSD(m.article, taux)?.valeur ?? null });
      lignesPdf.push([jj(m.date), m.article.designation, unite, q3(m.quantite), cellulePrixUnitairePdf(pu), montant, m.origine ?? ""]);
      return [
        jj(m.date), m.article.designation, unite, q3(m.quantite),
        pu ? pu.valeur : "—", pu ? COURT[pu.devise] : "—", pu?.equivalentUSD ?? "—", pu ? pu.source : "—",
        montant, m.origine ?? "",
      ];
    });
    return {
      titre, autofiltre: true,
      entete: ["Date", "Article", "Unité", "Quantité", "Prix unitaire", "Devise", "Prix unitaire USD", "Source du prix", "Montant USD", "Origine"],
      lignes, largeurs: ["9%", "20%", "7%", "8%", "10%", "7%", "10%", "9%", "9%", "11%"], droite: [3, 4, 6, 8], sommables: [8],
      pdf: {
        entete: ["Date", "Article", "Unité", "Quantité", "Prix unitaire", "Montant USD", "Origine"],
        lignes: lignesPdf, largeurs: ["11%", "24%", "10%", "9%", "17%", "12%", "17%"], droite: [3, 4, 5], sommables: [5],
      },
    };
  }

  if (type === "MOUVEMENTS") {
    const TYPE: Record<string, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement" };
    const rows = await prisma.mouvementStock.findMany({ where: { date: { gte: debut, lt: finExcl } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], include: { article: { select: { designation: true } } } });
    const lignes = rows.map((m) => [jj(m.date), m.article.designation, TYPE[m.type] ?? m.type, `${m.type === "SORTIE" ? "−" : "+"}${q3(m.quantite)}`, m.origine ?? ""]);
    return { titre, entete: ["Date", "Article", "Type", "Quantité", "Motif / origine"], lignes, largeurs: ["11%", "30%", "12%", "13%", "34%"], droite: [3] };
  }

  // LEGUMES — synthèse par article (quantité, prix unitaire moyen, prix total) + achats jour par jour.
  const rows = await prisma.achatLegume.findMany({ where: { date: { gte: debut, lt: finExcl } }, orderBy: { date: "asc" } });

  // Synthèse : un légume par ligne, cumul sur la période.
  const parLegume = new Map<string, { unite: string; qte: number; cdf: number; usd: number }>();
  for (const l of rows) {
    const nom = l.legume.trim();
    const e = parLegume.get(nom) ?? { unite: l.unite ?? "", qte: 0, cdf: 0, usd: 0 };
    if (!e.unite && l.unite) e.unite = l.unite;
    e.qte += Number(l.quantite); e.cdf += Number(l.montantCDF ?? 0); e.usd += Number(l.montantUSD ?? 0);
    parLegume.set(nom, e);
  }
  const synthese = [...parLegume.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "fr"))
    .map(([nom, e]) => [nom, e.unite, arr(e.qte), e.qte ? arr(e.usd / e.qte) : 0, arr(e.usd), arr(e.cdf)]);

  // Détail jour par jour.
  const detail = rows.slice().reverse().map((l) => {
    const q = Number(l.quantite), u = Number(l.montantUSD ?? 0);
    return [jj(l.date), l.legume, l.unite ?? "", q3(l.quantite), q ? arr(u / q) : 0, arr(u), l.montantCDF !== null ? arr(Number(l.montantCDF)) : ""];
  });

  return {
    titre, soustitre: "Synthèse par article",
    entete: ["Légume", "Unité", "Quantité", "Prix U. USD", "Prix total USD", "Total CDF"],
    lignes: synthese,
    largeurs: ["30%", "12%", "14%", "15%", "15%", "14%"], droite: [2, 3, 4, 5], sommables: [4, 5],
    table2: {
      titre: "Achats jour par jour",
      entete: ["Date", "Légume", "Unité", "Quantité", "Prix U. USD", "Total USD", "Total CDF"],
      lignes: detail,
      largeurs: ["12%", "26%", "11%", "13%", "13%", "13%", "12%"], droite: [3, 4, 5, 6], sommables: [5, 6],
    },
  };
}

// ─── Rapports Exploitation (Task 8) ──────────────────────────────────────────────────────────
// Même pattern que `genererDonneesRapport` ci-dessus, mais consommant le moteur Exploitation
// (Task 6/7) au lieu de requêter Prisma directement : `chargerExploitation` a déjà tout requêté
// (une seule fenêtre d'écritures + soldes + ratios) — on se contente de MAPPER son résultat vers
// `DonneesRapport`, sans re-requêter le moteur à la main.

export const TYPES_RAPPORT_EXPLOITATION = {
  JOURNALIER: "Rapport journalier",
  HEBDO: "Rapport hebdomadaire",
  MENSUEL: "Rapport mensuel",
  ANNUEL: "Rapport annuel",
} as const;
export type TypeRapportExploitation = keyof typeof TYPES_RAPPORT_EXPLOITATION;

// Mêmes clés/ordre/libellés que le tableau de bord (`exploitation/page.tsx`, RATIO_ORDRE) — ne
// pas laisser dériver les deux listes.
export const RATIO_LABEL_EXPLOITATION: Record<string, string> = {
  matieres: "Coûts matières premières",
  salaires: "Salaires et charges",
  loyers: "Loyers & charges locatives",
  depensesCA: "Dépenses / CA",
};
const RATIO_ORDRE_EXPLOITATION = ["matieres", "salaires", "loyers", "depensesCA"];
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)} %`);
const jourIso = (d: Date) => d.toISOString().slice(0, 10);

/** Libellé textuel du point mort (Direction, demande du 2026-08-14) pour la ligne « Point mort »
 *  du rapport Excel (colonne Montant : cellule textuelle, comme les autres lignes numériques
 *  n'ont pas d'équivalent — cf. `genererRapportExploitation` ci-dessous). Réutilise `MOIS` (déjà
 *  défini plus haut, noms complets français). */
function libellePointMortRapport(pointMortDate: string | null, pointMortAtteint: boolean): string {
  if (pointMortDate === null) return "—";
  if (!pointMortAtteint) return "Non atteint sur la période";
  const [annee, mois, jour] = pointMortDate.split("-").map(Number);
  return `Atteint le ${jour} ${MOIS[mois - 1].toLowerCase()} ${annee}`;
}

/**
 * Rapport Exploitation jour/hebdo/mensuel/annuel — mappe `ResultatExploitation` (moteur Task 6,
 * via le chargeur `chargerExploitation` Task 7) vers `DonneesRapport`. `ANNUEL` bascule l'horizon
 * du moteur sur `"annuel"` (cibles de ratio annuelles, ex. matières 0,25/0,30 au lieu de
 * 0,30/0,35) ; les 3 autres types restent sur l'horizon `"mensuel"` (mêmes cibles, seule la
 * fenêtre [debut, fin] change — jour, semaine ou mois selon l'appelant).
 *
 * Table 1 (recettes/ventilation/dépenses par rubrique/résultat/marge/seuil) : PAS de colonne
 * `sommables` — les lignes mélangent des postes de nature différente (recette, dépense,
 * résultat...) : une somme automatique en pied de tableau additionnerait CA + dépenses + résultat
 * et produirait un nombre trompeur. Chaque sous-total utile (TOTAL RECETTES, TOTAL DÉPENSES,
 * RÉSULTAT...) est déjà une ligne calculée par le moteur, affichée explicitement.
 * Table 2 (ratios cibles + métriques) : même raison, pas de `sommables` (pourcentages/compteurs
 * non additionnables entre eux).
 */
export async function genererRapportExploitation(type: TypeRapportExploitation, debut: Date, fin: Date): Promise<DonneesRapport> {
  const horizon = type === "ANNUEL" ? "annuel" : "mensuel";
  const { resultat: r, totalCouverts } = await chargerExploitation(jourIso(debut), jourIso(fin), horizon);
  const titre = TYPES_RAPPORT_EXPLOITATION[type];

  const lignes: (string | number)[][] = [
    ["Chiffre d'affaires (Recettes restaurant)", arr(r.caTotal)],
    ["Entrées autres", arr(r.entreesAutres)],
    ["TOTAL RECETTES", arr(r.totalRecettes)],
    ["  dont Espèces", arr(r.ventilation.especes)],
    ["  dont Carte", arr(r.ventilation.carte)],
    ["  dont Mobile", arr(r.ventilation.mobile)],
  ];
  for (const d of r.parRubrique.slice().sort((a, b) => b.montant - a.montant)) {
    lignes.push([d.rubrique, arr(d.montant)]);
    // Détail par catégorie sous la rubrique (Task 10, demande Direction) — additif, même liste
    // que le moteur (déjà triée par montant décroissant), indentée sous sa rubrique.
    for (const c of d.categories) {
      lignes.push([`    — ${c.categorie}`, arr(c.montant)]);
    }
  }
  lignes.push(
    ["  dont Loyers & charges locatives", arr(r.loyers.montant)],
    ["TOTAL DÉPENSES", arr(r.totalDepenses)],
    ["RÉSULTAT", arr(r.resultat)],
    ["Marge brute", arr(r.margeBrute)],
    ["Seuil de rentabilité", r.seuilRentabilite === null ? "—" : arr(r.seuilRentabilite)],
    ["Point mort", libellePointMortRapport(r.pointMortDate, r.pointMortAtteint)],
    ["Écart au point mort", r.ecartPointMort === null ? "—" : arr(r.ecartPointMort)],
  );

  const ratiosOrdonnes = RATIO_ORDRE_EXPLOITATION
    .map((cle) => r.ratios.find((x) => x.cle === cle))
    .filter((x): x is RatioResultat => Boolean(x));
  const lignesTable2: (string | number)[][] = ratiosOrdonnes.map((ratio) => [
    RATIO_LABEL_EXPLOITATION[ratio.cle] ?? ratio.cle,
    pct(ratio.valeur),
    pct(ratio.ideal),
    pct(ratio.max),
  ]);
  lignesTable2.push(
    ["Jours ouvrés", r.nbJoursOuvres, "—", "—"],
    ["Recette journalière moyenne (USD)", r.recetteJournaliereMoyenne === null ? "—" : arr(r.recetteJournaliereMoyenne), "—", "—"],
    ["Ticket moyen (USD)", r.ticketMoyen === null ? "—" : arr(r.ticketMoyen), "—", "—"],
    ["Couverts (période)", totalCouverts, "—", "—"],
  );

  return {
    titre,
    entete: ["Poste", "Montant USD"],
    lignes,
    largeurs: ["64%", "36%"],
    droite: [1],
    table2: {
      titre: "Ratios & indicateurs",
      entete: ["Indicateur", "Valeur", "Idéal", "Max"],
      lignes: lignesTable2,
      largeurs: ["40%", "20%", "20%", "20%"],
      droite: [1, 2, 3],
    },
  };
}

// ─── Rapport « visuel » (Task 12, regroupé le 2026-09-29) ──────────────────────────────────────
// Second mapping du même moteur (`chargerExploitation`), à côté de `genererRapportExploitation`
// ci-dessus : il alimente l'écran (`ApercuRapport`), le PDF (`RapportExploitationDocument`) et les
// feuilles Recettes/Dépenses de l'Excel, qui lisent donc les MÊMES groupes. AUCUN total n'est
// recalculé : ceux affichés viennent tels quels de `ResultatExploitation` ; les groupes rubrique ›
// catégorie sont la somme des écritures listées (`chargerEcrituresRapport`) — elle coïncide avec
// les totaux du moteur car un sens RECETTE/DEPENSE n'existe que sur les rubriques de ce même sens
// (cf. seed-exploitation.ts). Un écart éventuel est calculé et affiché, jamais masqué.

const MOIS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS_LONG = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const jourLong = (d: Date) => `${d.getUTCDate()} ${MOIS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** Texte de période affiché en gras dans l'entête (« Jeudi 16 juillet 2026 », « Semaine du 13 au
 *  19 juillet 2026», « Juillet 2026», « Année 2026 ») — un format par type de rapport. */
export function libellePeriodeRapport(type: TypeRapportExploitation, debut: Date, fin: Date): string {
  if (type === "JOURNALIER") return `${cap(JOURS_LONG[debut.getUTCDay()])} ${jourLong(debut)}`;
  if (type === "HEBDO") return `Semaine du ${jourLong(debut)} au ${jourLong(fin)}`;
  if (type === "MENSUEL") return `${cap(MOIS_LONG[debut.getUTCMonth()])} ${debut.getUTCFullYear()}`;
  return `Année ${debut.getUTCFullYear()}`;
}

export type { DonneesRapportVisuel };

/**
 * Version « visuelle » du rapport Exploitation (écran + PDF + Excel) : mêmes bornes/horizon que
 * `genererRapportExploitation`, renvoie le `ResultatExploitation` tel quel + les écritures
 * Recettes/Dépenses de la période, en liste plate (présentation historique « liste ») ET
 * regroupées par rubrique › catégorie (présentations « compact » / « détaillé », demande Direction
 * du 2026-09-29). Assemblage pur dans `construireRapportVisuel` (testable sans base).
 */
export async function genererRapportExploitationVisuel(type: TypeRapportExploitation, debut: Date, fin: Date): Promise<DonneesRapportVisuel> {
  const horizon = type === "ANNUEL" ? "annuel" : "mensuel";
  const [{ resultat, totalCouverts }, { recettes, depenses }] = await Promise.all([
    chargerExploitation(jourIso(debut), jourIso(fin), horizon),
    chargerEcrituresRapport(jourIso(debut), jourIso(fin)),
  ]);
  return construireRapportVisuel({
    type,
    titre: TYPES_RAPPORT_EXPLOITATION[type],
    periodeTexte: libellePeriodeRapport(type, debut, fin),
    debut,
    fin,
    resultat,
    totalCouverts,
    recettes,
    depenses,
  });
}

// ─── Rapport ANNUEL « visuel » (Task 11, refait le 2026-09-29) ──────────────────────────────────
// Contrairement aux 3 autres types (un seul `ResultatExploitation`), l'annuel ventile l'année MOIS
// PAR MOIS : recettes et dépenses regroupées par rubrique › catégorie (ordre du plan de comptes),
// une colonne par mois + le total, puis résultat, marge brute, seuil et point mort. Même structure
// pour l'écran (`annuel/tableau-annuel.tsx`), le PDF et l'Excel : `construireRapportAnnuel`.

export type DonneesRapportAnnuelVisuel = DonneesRapportAnnuel;

/** Charge une année Exploitation (écritures comprises, une seule lecture) et construit le rapport
 *  annuel regroupé — même construction que l'écran « Vue annuelle ». */
export async function genererRapportAnnuelVisuel(annee: number): Promise<DonneesRapportAnnuelVisuel> {
  const { donnees, recettes, depenses } = await chargerAnneeRapport(annee);
  return construireRapportAnnuel(donnees, { recettes, depenses });
}
