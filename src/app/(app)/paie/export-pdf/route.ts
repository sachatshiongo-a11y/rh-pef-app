import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { LIBELLE_STATUT } from "@/lib/paie-etats";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";

const usd = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Espaces insécables fins de fr-FR mal rendus par la police PDF → espace normale.
const cdf = (n: number) => Math.round(n).toLocaleString("fr-FR").replace(/[  ]/g, " ");

/** Livre de paie du mois courant en PDF (mêmes lignes/colonnes que l'onglet Paie). */
export async function GET() {
  await verifySession();
  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const { moisCourant: mois, anneeCourante: annee } = config;

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: { include: { employee: true } } },
  });
  const lignes = (run?.lignes ?? []).sort((a, b) =>
    a.employee.categorie !== b.employee.categorie
      ? a.employee.categorie.localeCompare(b.employee.categorie)
      : a.employee.nom.localeCompare(b.employee.nom)
  );
  if (lignes.length === 0) return new Response("Aucune paie calculée pour ce mois", { status: 404 });

  const colonnes: Colonne[] = [
    { header: "Matricule", width: "11%" },
    { header: "Nom", width: "18%" },
    { header: "Cat.", width: "8%" },
    { header: "Brut $", width: "11%", align: "right" },
    { header: "Transport $", width: "11%", align: "right" },
    { header: "CNSS $", width: "10%", align: "right" },
    { header: "IPR $", width: "9%", align: "right" },
    { header: "Net $", width: "11%", align: "right" },
    { header: "Net CDF", width: "11%", align: "right" },
  ];

  const rows: (string | number)[][] = lignes.map((l) => [
    l.employee.matricule,
    l.employee.nom,
    l.employee.categorie === "BRIGADE" ? "Brigade" : "Back-off.",
    usd(Number(l.salBrutUSD)),
    usd(Number(l.transportUSD)),
    usd(Number(l.cnssSalarieUSD)),
    usd(Number(l.iprCalculeUSD)),
    usd(Number(l.salNetUSD)),
    cdf(Number(l.salNetCDF)),
  ]);
  // Ligne de total.
  const somme = (f: (l: (typeof lignes)[number]) => number) => lignes.reduce((s, l) => s + f(l), 0);
  rows.push([
    "TOTAL",
    `${lignes.length} salarié(s)`,
    "",
    usd(somme((l) => Number(l.salBrutUSD))),
    usd(somme((l) => Number(l.transportUSD))),
    usd(somme((l) => Number(l.cnssSalarieUSD))),
    usd(somme((l) => Number(l.iprCalculeUSD))),
    usd(somme((l) => Number(l.salNetUSD))),
    cdf(somme((l) => Number(l.salNetCDF))),
  ]);

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const buffer = await renderToBuffer(
    TableauDocument({
      titre: "Livre de paie",
      sousTitre: periode,
      colonnes,
      lignes: rows,
      totalDerniereLigne: true,
      pied: `Statuts : ${lignes.map((l) => LIBELLE_STATUT[l.statutPaiement]).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}. Document interne — TOLYA SARL.`,
    })
  );
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Livre_paie_${annee}-${String(mois).padStart(2, "0")}.pdf"`,
    },
  });
}
