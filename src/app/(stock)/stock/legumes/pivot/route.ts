import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel, type FeuilleExcel } from "@/lib/export-excel";
import { MOIS_FR_COURT } from "@/lib/dates-fr";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Récapitulatif croisé des achats de légumes : une ligne par légume, une colonne par mois
 * (quantité totale, puis dépense CDF et USD). Évite de refaire un TCD sur l'export brut.
 */
export async function GET() {
  const user = await verifySession();
  requireModule(user, "stock");

  const achats = await prisma.achatLegume.findMany({ orderBy: { date: "asc" } });

  // Axes du tableau croisé : mois présents (colonnes) × légumes (lignes).
  const moisCles: string[] = [];
  const moisVus = new Set<string>();
  const legumes: string[] = [];
  const legVus = new Set<string>();
  // Agrégats : cle "legume|mois" → { qte, cdf, usd } et l'unité du légume.
  const agg = new Map<string, { qte: number; cdf: number; usd: number }>();
  const unite = new Map<string, string>();

  for (const a of achats) {
    const d = new Date(a.date);
    const cleM = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!moisVus.has(cleM)) { moisVus.add(cleM); moisCles.push(cleM); }
    const leg = a.legume.trim();
    if (!legVus.has(leg)) { legVus.add(leg); legumes.push(leg); }
    if (a.unite && !unite.has(leg)) unite.set(leg, a.unite);
    const k = `${leg}|${cleM}`;
    const e = agg.get(k) ?? { qte: 0, cdf: 0, usd: 0 };
    e.qte += Number(a.quantite);
    e.cdf += Number(a.montantCDF ?? 0);
    e.usd += Number(a.montantUSD ?? 0);
    agg.set(k, e);
  }

  legumes.sort((a, b) => a.localeCompare(b, "fr"));
  const moisLabel = (cle: string) => { const [y, m] = cle.split("-").map(Number); return `${MOIS_FR_COURT[m - 1]} ${y}`; };
  const colTotalIdx = moisCles.length + 1; // 0 = Légume, puis un col/mois, puis Total

  // Une feuille par indicateur (Quantités / Dépense CDF / Dépense USD), même structure croisée.
  const feuille = (nom: string, champ: "qte" | "cdf" | "usd", arrondi: (n: number) => number): FeuilleExcel => {
    const lignes = legumes.map((leg) => {
      const cells: (string | number)[] = [unite.get(leg) ? `${leg} (${unite.get(leg)})` : leg];
      let total = 0;
      for (const cle of moisCles) { const v = agg.get(`${leg}|${cle}`)?.[champ] ?? 0; total += v; cells.push(v ? arrondi(v) : ""); }
      cells.push(arrondi(total));
      return cells;
    });
    return {
      nom,
      entete: ["Légume", ...moisCles.map(moisLabel), "Total"],
      lignes,
      totauxCols: [...moisCles.map((_, i) => i + 1), colTotalIdx],
    };
  };

  const feuilles = [
    feuille("Quantités", "qte", r2),
    feuille("Dépense CDF", "cdf", (n) => Math.round(n)),
    feuille("Dépense USD", "usd", r2),
  ];

  if (legumes.length === 0) feuilles[0].lignes = [["Aucun achat enregistré.", ""]];

  const buf = await classeurExcel({ titre: "Achats de légumes — récap mensuel", periode: `${legumes.length} légume(s) · ${moisCles.length} mois`, feuilles });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Legumes_recap_mensuel_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
