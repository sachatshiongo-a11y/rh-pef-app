import { prisma } from "@/lib/prisma";
import { exigerEspaceRH } from "@/lib/garde-route";
import { calculerDeclarationsMois } from "@/lib/declarations";
import { classeurExcel } from "@/lib/export-excel";
import { lireMoisAnnee } from "@/lib/mois-route";
import { MENTION_PROVISOIRE } from "@/lib/mention-provisoire";
import { formaterNombre } from "@/lib/montant";

const LIBELLE_STATUT: Record<string, string> = {
  A_DECLARER: "À déclarer",
  DECLARE: "Déclaré",
  PAYE: "Payé",
};

/**
 * Export Excel des cotisations sociales & fiscales par organisme. Le mois est celui demandé
 * (`?mois=&annee=`, le même que l'écran et le PDF) ; sans paramètre, le mois courant de la paie.
 */
export async function GET(request: Request) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const lu = lireMoisAnnee(new URL(request.url).searchParams, { mois: config.moisCourant, annee: config.anneeCourante });
  if (!lu.ok) return new Response(lu.message, { status: 400 });
  const { mois, annee } = lu;

  const bordereau = await calculerDeclarationsMois(mois, annee);
  if (!bordereau) return new Response("Aucune paie calculée pour ce mois", { status: 404 });

  const entete = ["Organisme", "Nature", "Montant USD", "Montant CDF", "Échéance", "Statut"];
  const rows = bordereau.lignes.map((l) => [
    l.libelle,
    l.detail,
    Number(l.montantUSD.toFixed(2)),
    Number(l.montantCDF.toFixed(0)),
    new Date(l.echeance).toLocaleDateString("fr-FR") + (l.echeanceAValider ? " (à valider)" : ""),
    (LIBELLE_STATUT[l.statut] ?? l.statut) +
      (l.fige && l.ecartAvecFige ? ` — montant figé au marquage ; recalcul du jour : ${formaterNombre(l.recalculUSD, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $` : ""),
  ]);
  const totalUSD = bordereau.lignes.reduce((s, l) => s + l.montantUSD, 0);
  const totalCDF = bordereau.lignes.reduce((s, l) => s + l.montantCDF, 0);
  rows.push(["TOTAL", "", Number(totalUSD.toFixed(2)), Number(totalCDF.toFixed(0)), "", ""]);

  const periodeMois = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const periode = bordereau.provisoire ? `${periodeMois} — ${MENTION_PROVISOIRE} (${bordereau.nbNonValides} bulletin(s) sur ${bordereau.nbBulletins})` : periodeMois;
  const buf = await classeurExcel({
    titre: "Cotisations sociales & fiscales",
    periode,
    feuilles: [{ nom: "Cotisations", entete, lignes: rows }],
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Cotisations_${annee}-${String(mois).padStart(2, "0")}.xlsx"`,
    },
  });
}
