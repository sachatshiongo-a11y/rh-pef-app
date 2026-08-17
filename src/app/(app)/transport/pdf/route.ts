import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";
import { TableauDocument } from "@/lib/pdf/tableau";
import { lignesTransport, colonnesTransport, cdf, usd } from "../_donnees";
import { filtrerEmployes } from "../../employes/_donnees";

/** Export PDF de la grille de transport — mêmes filtres, colonnes et montants que l'onglet, total en pied. */
export async function GET(request: Request) {
  await verifySession();
  const sp = new URL(request.url).searchParams;
  const [tous, parametres] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, orderBy: [{ categorie: "asc" }, { nom: "asc" }] }),
    chargerParametresPaie(),
  ]);
  const employes = filtrerEmployes(tous, sp);
  const jours = parametres.joursOuvrablesMois;
  const taux = parametres.tauxChangeCDF;
  const { items, totalMoisCDF } = lignesTransport(employes, jours, taux);

  const lignes = items.map((l) => [
    l.matricule, l.nom, l.poste, l.categorie,
    l.brigade ? cdf(l.jourCDF) : "—",
    l.brigade ? "—" : usd(l.forfaitUSD),
    cdf(l.moisCompletCDF),
  ]);

  const buffer = await renderPdfBuffer(
    TableauDocument({
      titre: "Grille de transport",
      sousTitre: `${items.length} employé(s) · base ${jours} j ouvrables · 1 $ = ${taux.toLocaleString("fr-FR")} CDF`,
      colonnes: colonnesTransport,
      lignes,
      paysage: true,
      pied: `Total transport (mois complet) : ${cdf(totalMoisCDF)} CDF — ${items.length} employé(s)`,
    }),
  );
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Transport.pdf"` },
  });
}
