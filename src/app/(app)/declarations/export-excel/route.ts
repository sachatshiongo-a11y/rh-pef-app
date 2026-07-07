import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { calculerDeclarationsMois } from "@/lib/declarations";
import { enteteExcel } from "@/lib/export-excel";

const LIBELLE_STATUT: Record<string, string> = {
  A_DECLARER: "À déclarer",
  DECLARE: "Déclaré",
  PAYE: "Payé",
};

/** Export Excel des cotisations sociales & fiscales par organisme (mois courant). */
export async function GET() {
  await verifySession();
  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const mois = config.moisCourant;
  const annee = config.anneeCourante;

  const bordereau = await calculerDeclarationsMois(mois, annee);
  if (!bordereau) return new Response("Aucune paie calculée pour ce mois", { status: 404 });

  const entete = ["Organisme", "Nature", "Montant USD", "Montant CDF", "Échéance", "Statut"];
  const rows = bordereau.lignes.map((l) => [
    l.libelle,
    l.detail,
    Number(l.montantUSD.toFixed(2)),
    Number(l.montantCDF.toFixed(0)),
    new Date(l.echeance).toLocaleDateString("fr-FR") + (l.echeanceAValider ? " (à valider)" : ""),
    LIBELLE_STATUT[l.statut] ?? l.statut,
  ]);
  const totalUSD = bordereau.lignes.reduce((s, l) => s + l.montantUSD, 0);
  const totalCDF = bordereau.lignes.reduce((s, l) => s + l.montantCDF, 0);
  rows.push(["TOTAL", "", Number(totalUSD.toFixed(2)), Number(totalCDF.toFixed(0)), "", ""]);

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...enteteExcel("Cotisations sociales & fiscales", periode), entete, ...rows]), "Cotisations");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Cotisations_${annee}-${String(mois).padStart(2, "0")}.xlsx"`,
    },
  });
}
