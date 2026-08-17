import "server-only";
import { prisma } from "@/lib/prisma";
import { STATUT_FACTURE_LABEL } from "@/lib/stock";
import { chargerExploitation, chargerEcrituresRapport, type LigneEcritureRapport } from "@/app/(exploitation)/exploitation/_data/charger-periode";
import { chargerAnnee } from "@/app/(exploitation)/exploitation/_data/charger-annee";
import { construireMatriceAnnuelle, type LigneMatriceAnnuelle } from "@/lib/exploitation/matrice-annuelle";
import type { RatioResultat, ResultatExploitation } from "@/lib/exploitation/calcul";

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
    const rows = await prisma.factureFournisseur.findMany({ where: { annee: { gte: debut.getUTCFullYear() } }, select: { annee: true, mois: true, montantUSD: true, resteAPayerUSD: true } });
    const parMois = new Map<string, { fac: number; du: number }>();
    for (const r of rows) { const k = cle(r.annee, r.mois); const e = parMois.get(k) ?? { fac: 0, du: 0 }; e.fac += Number(r.montantUSD); e.du += Number(r.resteAPayerUSD); parMois.set(k, e); }
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const e = parMois.get(cle(annee, m)) ?? { fac: 0, du: 0 }; const l = [labelMois(annee, m), arr(e.fac), arr(e.du), variation(e.fac, prev)]; prev = e.fac; return l; });
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
    const rows = await prisma.factureFournisseur.findMany({ where: { statut: "ECHUE_NON_REGLEE" }, select: { annee: true, mois: true, resteAPayerUSD: true } });
    const parMois = new Map<string, number>();
    for (const r of rows) { const k = cle(r.annee, r.mois); parMois.set(k, (parMois.get(k) ?? 0) + Number(r.resteAPayerUSD)); }
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const v = parMois.get(cle(annee, m)) ?? 0; const l = [labelMois(annee, m), arr(v), variation(v, prev)]; prev = v; return l; });
    return { titre, entete: ["Mois", "Échu non réglé USD", "Variation"], lignes, largeurs: ["40%", "34%", "26%"], droite: [1], sommables: [1], variationCol: 2 };
  }

  if (type === "ACHATS") {
    const rows = await prisma.mouvementStock.findMany({ where: { type: "ENTREE", factureId: null, date: { gte: debut, lt: finExcl } }, select: { date: true, montantUSD: true } });
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
    const auj = Date.now();
    const lignes = rows.map((r) => {
      const jrs = r.dateEcheance ? Math.round((auj - new Date(r.dateEcheance).getTime()) / 86400000) : null;
      return [r.fournisseur?.nom ?? r.fournisseurNom, r.numero ?? "—", jj(r.dateEcheance), jrs !== null ? `${jrs} j` : "—", arr(Number(r.resteAPayerUSD))];
    });
    return { titre, entete: ["Fournisseur", "N°", "Échéance", "Retard", "Reste USD"], lignes, largeurs: ["34%", "16%", "16%", "14%", "20%"], droite: [4], sommables: [4] };
  }

  if (type === "ACHATS") {
    const rows = await prisma.mouvementStock.findMany({ where: { type: "ENTREE", factureId: null, date: { gte: debut, lt: finExcl } }, orderBy: { date: "desc" }, include: { article: { select: { designation: true } } } });
    const lignes = rows.map((m) => [jj(m.date), m.article.designation, q3(m.quantite), m.montantUSD !== null ? arr(Number(m.montantUSD)) : "", m.origine ?? ""]);
    return { titre, entete: ["Date", "Article", "Quantité", "Montant USD", "Origine"], lignes, largeurs: ["12%", "34%", "14%", "16%", "24%"], droite: [2, 3], sommables: [3] };
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

// ─── Rapport « visuel » (Task 12) ────────────────────────────────────────────────────────────
// Second mapping du même moteur (`chargerExploitation`), à côté de `genererRapportExploitation`
// ci-dessus : celui-ci alimente la présentation calquée sur le modèle papier de la Direction
// (cartes KPI, soldes des comptes, tableaux Recettes/Dépenses ligne à ligne) — écran
// (`ApercuRapport`) ET PDF (`RapportExploitationDocument`), pour rester rigoureusement identiques
// (« cohérence écran/PDF » demandée par le brief). L'export Excel, lui, continue d'utiliser
// `genererRapportExploitation`/`DonneesRapport` (structure tabulaire générique, inchangée).
// AUCUN chiffre n'est recalculé ici : les totaux viennent tels quels de `ResultatExploitation`
// (Task 6/8) ; seules les lignes Recettes/Dépenses sont un LISTING (déjà lu ci-dessus,
// `chargerEcrituresRapport`) — leur somme coïncide avec les totaux du moteur car un sens
// RECETTE/DEPENSE n'existe que sur les rubriques de ce même sens (cf. seed-exploitation.ts).

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

export type DonneesRapportVisuel = {
  type: TypeRapportExploitation;
  titre: string; // « Rapport journalier »... (TYPES_RAPPORT_EXPLOITATION)
  periodeTexte: string; // libellePeriodeRapport ci-dessus
  resultat: ResultatExploitation;
  totalCouverts: number;
  recettes: LigneEcritureRapport[];
  depenses: LigneEcritureRapport[];
};

/**
 * Version « visuelle » du rapport Exploitation (écran + PDF, Task 12) : mêmes bornes/horizon que
 * `genererRapportExploitation`, mais renvoie le `ResultatExploitation` tel quel (pas aplati en
 * lignes Poste/Montant) + les écritures Recettes/Dépenses de la période, triées pour que les
 * tableaux « ressemblent » au regroupement du compte d'exploitation même s'ils listent des
 * écritures individuelles : dépenses dans le même ordre rubrique (montant décroissant — même tri
 * que `compte-exploitation.tsx`, `parRubrique` n'étant PAS ordonné en sortie du moteur, cf.
 * calcul.ts) puis catégorie (Task 10, `categories` déjà trié par montant décroissant, lui) ;
 * recettes par rubrique puis catégorie alphabétique (le moteur n'a pas d'équivalent `parRubrique`
 * côté recettes).
 */
export async function genererRapportExploitationVisuel(type: TypeRapportExploitation, debut: Date, fin: Date): Promise<DonneesRapportVisuel> {
  const horizon = type === "ANNUEL" ? "annuel" : "mensuel";
  const [{ resultat, totalCouverts }, { recettes, depenses }] = await Promise.all([
    chargerExploitation(jourIso(debut), jourIso(fin), horizon),
    chargerEcrituresRapport(jourIso(debut), jourIso(fin)),
  ]);

  const rubriquesTriees = resultat.parRubrique.slice().sort((a, b) => b.montant - a.montant);
  const ordreRubrique = new Map(rubriquesTriees.map((d, i) => [d.rubrique, i]));
  const ordreCategorie = new Map<string, number>();
  for (const d of rubriquesTriees) d.categories.forEach((c, i) => ordreCategorie.set(`${d.rubrique}··${c.categorie}`, i));

  const depensesTriees = depenses.slice().sort((a, b) => {
    const ra = ordreRubrique.get(a.rubrique) ?? 999, rb = ordreRubrique.get(b.rubrique) ?? 999;
    if (ra !== rb) return ra - rb;
    const ca = ordreCategorie.get(`${a.rubrique}··${a.categorie}`) ?? 999, cb = ordreCategorie.get(`${b.rubrique}··${b.categorie}`) ?? 999;
    return ca - cb;
  });
  const recettesTriees = recettes.slice().sort((a, b) => a.rubrique.localeCompare(b.rubrique, "fr") || a.categorie.localeCompare(b.categorie, "fr"));

  return {
    type,
    titre: TYPES_RAPPORT_EXPLOITATION[type],
    periodeTexte: libellePeriodeRapport(type, debut, fin),
    resultat,
    totalCouverts,
    recettes: recettesTriees,
    depenses: depensesTriees,
  };
}

// ─── Rapport ANNUEL « visuel » — matrice (Task 11) ──────────────────────────────────────────────
// Contrairement aux 3 autres types (journalier/hebdo/mensuel, mappés par `genererRapportExploitation
// Visuel` ci-dessus vers UN `ResultatExploitation`), l'annuel est une MATRICE 12 mois + TOTAL —
// c'est le sens même de l'onglet Excel « Tableau de bord 2026 » de la Direction (Task 11). Elle
// alimente l'écran (`annuel/tableau-annuel.tsx`) ET les exports PDF/Excel dédiés, via la même
// construction pure `construireMatriceAnnuelle` (aucun chiffre recalculé deux fois).

export type DonneesRapportAnnuelVisuel = {
  annee: number;
  matrice: LigneMatriceAnnuelle[];
  ratiosOrdonnes: RatioResultat[]; // matieres/salaires/loyers/depensesCA, cibles annuelles
  totalRecettes: number;
  totalDepenses: number;
  resultat: number;
  margeBrute: number;
  nbMoisAvecActivite: number; // dénominateur des moyennes mensuelles (e)
};

/** Charge une année Exploitation (Task 11, `chargerAnnee`) et construit la version « visuelle »
 *  (matrice + ratios + totaux) pour l'export PDF/Excel — même construction que l'écran. */
export async function genererRapportAnnuelVisuel(annee: number): Promise<DonneesRapportAnnuelVisuel> {
  const donnees = await chargerAnnee(annee);
  const matrice = construireMatriceAnnuelle(donnees);
  const ratiosOrdonnes = RATIO_ORDRE_EXPLOITATION
    .map((cle) => donnees.annuel.ratios.find((x) => x.cle === cle))
    .filter((x): x is RatioResultat => Boolean(x));
  const nbMoisAvecActivite =
    donnees.mensuel.filter((m) => m.resultat.totalRecettes !== 0 || m.resultat.totalDepenses !== 0).length || 12;

  return {
    annee,
    matrice,
    ratiosOrdonnes,
    totalRecettes: donnees.annuel.totalRecettes,
    totalDepenses: donnees.annuel.totalDepenses,
    resultat: donnees.annuel.resultat,
    margeBrute: donnees.annuel.margeBrute,
    nbMoisAvecActivite,
  };
}
