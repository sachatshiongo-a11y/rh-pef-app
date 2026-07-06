import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { LIBELLE_STATUT } from "@/lib/paie-etats";

/**
 * Export Excel de la paie du mois courant — FIDÈLE à l'onglet Paie : mêmes lignes (brigade puis
 * backoffice, triées par nom) et mêmes colonnes que le tableau à l'écran, plus le détail des
 * retenues pour l'usage comptable.
 */
export async function GET(request: Request) {
  await verifySession();

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  // Mois/année optionnels (?mois=&annee=) pour exporter n'importe quel mois de l'historique.
  const sp = new URL(request.url).searchParams;
  const mois = Number(sp.get("mois")) || config.moisCourant;
  const annee = Number(sp.get("annee")) || config.anneeCourante;

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: { include: { employee: true } } },
  });

  const lignes = (run?.lignes ?? []).sort((a, b) => {
    if (a.employee.categorie !== b.employee.categorie)
      return a.employee.categorie.localeCompare(b.employee.categorie);
    return a.employee.nom.localeCompare(b.employee.nom);
  });

  const entete = [
    "Matricule",
    "Nom",
    "Catégorie",
    "Salaire brut $",
    "CNSS salarié $",
    "IPR $",
    "Transport $",
    "Salaire net $",
    "Salaire net CDF",
    "Statut",
  ];

  const rows = lignes.map((l) => [
    l.employee.matricule,
    l.employee.nom,
    l.employee.categorie,
    Number(Number(l.salBrutUSD).toFixed(2)),
    Number(Number(l.cnssSalarieUSD).toFixed(2)),
    Number(Number(l.iprCalculeUSD).toFixed(2)),
    Number(Number(l.transportUSD).toFixed(2)),
    Number(Number(l.salNetUSD).toFixed(2)),
    Number(Number(l.salNetCDF).toFixed(0)),
    LIBELLE_STATUT[l.statutPaiement],
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([entete, ...rows]), "Paie");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Paie_${annee}-${String(mois).padStart(2, "0")}.xlsx"`,
    },
  });
}
