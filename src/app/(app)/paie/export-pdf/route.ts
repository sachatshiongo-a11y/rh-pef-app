import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { LIBELLE_STATUT } from "@/lib/paie-etats";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";
import { formaterNombre } from "@/lib/montant";
import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "@/lib/paie-net";

const usd = (n: number) => formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cdf = (n: number) => formaterNombre(Math.round(n));

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
  // Taux du bulletin — jamais déduit de salNetCDF / salNetUSD (voir src/lib/paie-net.ts).
  // `run` est forcément défini ici : lignes non vides implique run non null.
  const taux = Number(run!.tauxChangeUtilise);

  // Largeurs (%) : 10+16+8+9+9+9+8+11+10+10 = 100.
  const colonnes: Colonne[] = [
    { header: "Matricule", width: "10%" },
    { header: "Nom", width: "16%" },
    { header: "Cat.", width: "8%" },
    { header: "Brut $", width: "9%", align: "right" },
    { header: "Transport $", width: "9%", align: "right" },
    { header: "CNSS $", width: "9%", align: "right" },
    { header: "IPR $", width: "8%", align: "right" },
    { header: "Salaire net $", width: "11%", align: "right" },
    { header: "Net CDF", width: "10%", align: "right" },
    { header: "Versé $", width: "10%", align: "right" },
  ];

  const rows: (string | number)[][] = lignes.map((l) => [
    l.employee.matricule,
    l.employee.nom,
    l.employee.categorie === "BRIGADE" ? "Brigade" : "Back-off.",
    usd(Number(l.salBrutUSD)),
    usd(Number(l.transportUSD)),
    usd(Number(l.cnssSalarieUSD)),
    usd(Number(l.iprCalculeUSD)),
    usd(salaireNetUSD(l)),
    cdf(salaireNetCDF(l, taux)),
    usd(totalVerseUSD(l)),
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
    usd(somme((l) => salaireNetUSD(l))),
    cdf(somme((l) => salaireNetCDF(l, taux))),
    usd(somme((l) => totalVerseUSD(l))),
  ]);

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const buffer = await renderPdfBuffer(
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
