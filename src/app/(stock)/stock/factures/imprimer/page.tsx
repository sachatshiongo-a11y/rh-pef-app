import { prisma } from "@/lib/prisma";
import { formaterMontantFacture } from "@/lib/facture-devise";
import { STATUT_FACTURE_LABEL } from "@/lib/stock";
import { PrintDoc } from "../../_print/print-doc";
import { exigerPageStock } from "@/lib/garde-page";
import { jourKinshasa } from "@/lib/heure-kinshasa";

const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "");
const u = (v: unknown) => Number(v).toFixed(2);

export default async function FacturesImprimerPage() {
  await exigerPageStock();
  const factures = await prisma.factureFournisseur.findMany({
    orderBy: [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }],
    include: { fournisseur: { select: { nom: true } } },
  });

  // Montant et reste dans la devise de chaque facture (2026-10-09) : « 280 000 FC » pour une facture en francs.
  const avecFC = factures.some((f) => f.devise === "CDF");
  const lignes = factures.map((f) => [
    f.fournisseur?.nom ?? f.fournisseurNom,
    f.numero ?? "",
    d(f.date),
    d(f.dateEcheance),
    f.devise === "CDF" ? formaterMontantFacture(Number(f.montantCDF), "CDF") : avecFC ? `${u(f.montantUSD)} $` : u(f.montantUSD),
    f.devise === "CDF" ? formaterMontantFacture(Number(f.resteAPayerCDF), "CDF") : avecFC ? `${u(f.resteAPayerUSD)} $` : u(f.resteAPayerUSD),
    STATUT_FACTURE_LABEL[f.statut] ?? f.statut,
    f.modePaiement ?? "",
  ] as (string | number)[]);

  return (
    <PrintDoc
      titre="Factures fournisseurs"
      sousTitre={jourKinshasa(new Date())}
      entete={["Fournisseur", "N°", "Date", "Échéance", avecFC ? "Montant" : "Montant USD", avecFC ? "Reste" : "Reste USD", "Statut", "Mode"]}
      aligneDroite={[4, 5]}
      lignes={lignes}
    />
  );
}
