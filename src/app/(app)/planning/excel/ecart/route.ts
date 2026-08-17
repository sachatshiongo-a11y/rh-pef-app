import { verifySession } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { chargerEcartMois } from "../../ecart-data";
import { libelleShift } from "../../creneaux";
import { JOURS_FR, MOIS_FR } from "@/lib/dates-fr";

const RAISON_CODE: Record<string, string> = {
  M: "maladie", A: "absence justifiée", N: "absence injustifiée", C: "congé", S: "sans solde", O: "repos", F: "férié",
};
const raisonDe = (code: string | null) => (code == null ? "non renseigné" : (RAISON_CODE[code] ?? code));

const fmt1 = (n: number) => n.toFixed(1).replace(".", ",");
const fmtEcart = (n: number) => `${n > 0 ? "↑" : n < 0 ? "↓" : ""} ${n >= 0 ? "+" : "−"}${fmt1(Math.abs(n))} h`;

/** Export Excel de la vue « Écart prévu/réalisé » : mêmes données que l'écran, deux feuilles
 *  (Couverture non tenue, Heures par salarié), même motif que /planning/excel (route.ts). */
export async function GET(req: Request) {
  await verifySession();
  const sp = new URL(req.url).searchParams;
  const annee = Number(sp.get("annee")) || new Date().getUTCFullYear();
  const mois = Math.min(12, Math.max(1, Number(sp.get("mois")) || new Date().getUTCMonth() + 1));

  const { resultat, employesInfo, shiftsInfo } = await chargerEcartMois(mois, annee);

  const nonTenues = resultat.couverture
    .filter((g) => g.tenus < g.prevus)
    .sort((a, b) => (b.prevus - b.tenus) - (a.prevus - a.tenus) || a.date.getTime() - b.date.getTime());

  const lignesCouverture = nonTenues.map((g) => {
    const shift = shiftsInfo.get(g.shiftId);
    const label = shift ? libelleShift(shift.nom, shift.heureDebut, shift.heureFin) : "shift";
    const manquants = g.manquants
      .map((m) => `${employesInfo.get(m.employeeId)?.nom ?? "—"} (${raisonDe(m.code)})`)
      .join(", ");
    return [
      `${JOURS_FR[g.date.getUTCDay()]} ${g.date.getUTCDate()}`,
      label,
      g.poste || "—",
      g.prevus,
      g.tenus,
      manquants,
    ];
  });

  const heuresTriees = [...resultat.heures].sort((a, b) => a.ecart - b.ecart);
  const lignesHeures = heuresTriees.map((l) => [
    employesInfo.get(l.employeeId)?.nom ?? "—",
    l.joursPlanifies,
    l.joursTenus,
    l.heuresPlanifiees,
    l.heuresRealisees,
    fmtEcart(l.ecart),
  ]);

  const periode = `${MOIS_FR[mois - 1]} ${annee}`;
  const buf = await classeurExcel({
    titre: "Écart prévu / réalisé",
    periode,
    feuilles: [
      { nom: "Couverture", entete: ["Jour", "Shift", "Poste", "Prévus", "Tenus", "Manquants (raison)"], lignes: lignesCouverture, totauxCols: [3, 4] },
      { nom: "Heures", entete: ["Salarié", "Jours prévus", "Jours tenus", "Heures planifiées", "Heures réalisées", "Écart"], lignes: lignesHeures, totauxCols: [1, 2, 3, 4], variationCol: 5 },
    ],
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Planning_ecart_${annee}-${String(mois).padStart(2, "0")}.xlsx"`,
    },
  });
}
