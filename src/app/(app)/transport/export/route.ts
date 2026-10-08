import { prisma } from "@/lib/prisma";
import { exigerEspaceRH } from "@/lib/garde-route";
import { chargerParametresPaie } from "@/lib/config";
import { classeurExcel } from "@/lib/export-excel";
import { lignesTransport, colonnesTransport } from "../_donnees";
import { filtrerEmployes, statutEmployes, whereStatutEmployes } from "../../employes/_donnees";

/** Export Excel de la grille de transport — FIDÈLE à l'onglet (mêmes filtres, montants, total mois complet). */
export async function GET(request: Request) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const sp = new URL(request.url).searchParams;
  const [tous, parametres] = await Promise.all([
    prisma.employee.findMany({ where: whereStatutEmployes(statutEmployes(sp.get("statut"))), orderBy: [{ categorie: "asc" }, { nom: "asc" }] }),
    chargerParametresPaie(),
  ]);
  const employes = filtrerEmployes(tous, sp);
  const jours = parametres.joursOuvrablesMois;
  const taux = parametres.tauxChangeCDF;
  const { items } = lignesTransport(employes, jours, taux);

  // Colonnes numériques en nombres bruts → la ligne « Total » (totauxCols) s'additionne correctement.
  const lignes = items.map((l) => [
    l.matricule, l.nom, l.poste, l.categorie,
    l.brigade ? Math.round(l.jourCDF) : "",
    l.brigade ? "" : Math.round(l.forfaitUSD * 100) / 100,
    Math.round(l.moisCompletCDF),
  ]);

  const buf = await classeurExcel({
    titre: "Grille de transport",
    periode: `${items.length} employé(s) · base ${jours} j ouvrables · 1 $ = ${taux.toLocaleString("fr-FR")} CDF`,
    feuilles: [{ nom: "Transport", entete: colonnesTransport.map((c) => c.header), lignes, totauxCols: [6] }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Transport.xlsx"`,
    },
  });
}
