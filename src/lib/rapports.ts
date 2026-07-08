import "server-only";
import { prisma } from "@/lib/prisma";

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

export type DonneesRapport = {
  titre: string;
  entete: string[];
  lignes: (string | number)[][];
  // largeurs (pour le PDF), alignements à droite pour les colonnes numériques (par index)
  largeurs: string[];
  droite: number[];
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
  const finExcl = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() + 1, 1));
  const titre = TYPES_RAPPORT[type];

  if (type === "FACTURES") {
    const rows = await prisma.factureFournisseur.findMany({ where: { annee: { gte: debut.getUTCFullYear() } }, select: { annee: true, mois: true, montantUSD: true, resteAPayerUSD: true } });
    const parMois = new Map<string, { fac: number; du: number }>();
    for (const r of rows) { const k = cle(r.annee, r.mois); const e = parMois.get(k) ?? { fac: 0, du: 0 }; e.fac += Number(r.montantUSD); e.du += Number(r.resteAPayerUSD); parMois.set(k, e); }
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const e = parMois.get(cle(annee, m)) ?? { fac: 0, du: 0 }; const l = [labelMois(annee, m), arr(e.fac), arr(e.du), variation(e.fac, prev)]; prev = e.fac; return l; });
    return { titre, entete: ["Mois", "Total facturé USD", "Reste dû USD", "Variation facturé"], lignes, largeurs: ["34%", "24%", "22%", "20%"], droite: [1, 2] };
  }

  if (type === "BONS_COMMANDE") {
    const rows = await prisma.bonDeCommande.findMany({ select: { annee: true, mois: true, totalUSD: true } });
    const parMois = new Map<string, { nb: number; tot: number }>();
    for (const r of rows) { const k = cle(r.annee, r.mois); const e = parMois.get(k) ?? { nb: 0, tot: 0 }; e.nb += 1; e.tot += Number(r.totalUSD); parMois.set(k, e); }
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const e = parMois.get(cle(annee, m)) ?? { nb: 0, tot: 0 }; const l = [labelMois(annee, m), e.nb, arr(e.tot), variation(e.tot, prev)]; prev = e.tot; return l; });
    return { titre, entete: ["Mois", "Nb BC", "Total USD", "Variation total"], lignes, largeurs: ["34%", "16%", "26%", "24%"], droite: [1, 2] };
  }

  if (type === "PAIEMENTS") {
    const rows = await prisma.factureFournisseur.findMany({ where: { statut: "ECHUE_NON_REGLEE" }, select: { annee: true, mois: true, resteAPayerUSD: true } });
    const parMois = new Map<string, number>();
    for (const r of rows) { const k = cle(r.annee, r.mois); parMois.set(k, (parMois.get(k) ?? 0) + Number(r.resteAPayerUSD)); }
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const v = parMois.get(cle(annee, m)) ?? 0; const l = [labelMois(annee, m), arr(v), variation(v, prev)]; prev = v; return l; });
    return { titre, entete: ["Mois", "Échu non réglé USD", "Variation"], lignes, largeurs: ["40%", "34%", "26%"], droite: [1] };
  }

  if (type === "ACHATS") {
    const rows = await prisma.mouvementStock.findMany({ where: { type: "ENTREE", factureId: null, date: { gte: debut, lt: finExcl } }, select: { date: true, montantUSD: true } });
    const parMois = new Map<string, number>();
    for (const r of rows) { const d = new Date(r.date); const k = cle(d.getUTCFullYear(), d.getUTCMonth() + 1); parMois.set(k, (parMois.get(k) ?? 0) + Number(r.montantUSD ?? 0)); }
    let prev: number | null = null;
    const lignes = mois.map(({ annee, mois: m }) => { const v = parMois.get(cle(annee, m)) ?? 0; const l = [labelMois(annee, m), arr(v), variation(v, prev)]; prev = v; return l; });
    return { titre, entete: ["Mois", "Achats USD", "Variation"], lignes, largeurs: ["40%", "34%", "26%"], droite: [1] };
  }

  if (type === "MOUVEMENTS") {
    const rows = await prisma.mouvementStock.findMany({ where: { date: { gte: debut, lt: finExcl } }, select: { date: true, type: true } });
    const parMois = new Map<string, { e: number; s: number }>();
    for (const r of rows) { const d = new Date(r.date); const k = cle(d.getUTCFullYear(), d.getUTCMonth() + 1); const x = parMois.get(k) ?? { e: 0, s: 0 }; if (r.type === "SORTIE") x.s += 1; else if (r.type === "ENTREE") x.e += 1; parMois.set(k, x); }
    const lignes = mois.map(({ annee, mois: m }) => { const x = parMois.get(cle(annee, m)) ?? { e: 0, s: 0 }; return [labelMois(annee, m), x.e, x.s]; });
    return { titre, entete: ["Mois", "Entrées", "Sorties"], lignes, largeurs: ["50%", "25%", "25%"], droite: [1, 2] };
  }

  // LEGUMES
  const rows = await prisma.achatLegume.findMany({ where: { date: { gte: debut, lt: finExcl } }, select: { date: true, montantCDF: true, montantUSD: true } });
  const parMois = new Map<string, { cdf: number; usd: number }>();
  for (const r of rows) { const d = new Date(r.date); const k = cle(d.getUTCFullYear(), d.getUTCMonth() + 1); const e = parMois.get(k) ?? { cdf: 0, usd: 0 }; e.cdf += Number(r.montantCDF ?? 0); e.usd += Number(r.montantUSD ?? 0); parMois.set(k, e); }
  let prev: number | null = null;
  const lignes = mois.map(({ annee, mois: m }) => { const e = parMois.get(cle(annee, m)) ?? { cdf: 0, usd: 0 }; const l = [labelMois(annee, m), arr(e.cdf), arr(e.usd), variation(e.usd, prev)]; prev = e.usd; return l; });
  return { titre, entete: ["Mois", "Montant CDF", "Montant USD", "Variation USD"], lignes, largeurs: ["30%", "26%", "22%", "22%"], droite: [1, 2] };
}
