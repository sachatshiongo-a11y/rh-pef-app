import { prisma } from "@/lib/prisma";
import { STATUT_FACTURE_LABEL } from "@/lib/stock";
import { PrintDoc } from "../../_print/print-doc";

const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "");
const u = (v: unknown) => Number(v).toFixed(2);

export default async function FacturesImprimerPage() {
  const factures = await prisma.factureFournisseur.findMany({
    orderBy: [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }],
    include: { fournisseur: { select: { nom: true } } },
  });

  const lignes = factures.map((f) => [
    f.fournisseur?.nom ?? f.fournisseurNom,
    f.numero ?? "",
    d(f.date),
    d(f.dateEcheance),
    u(f.montantUSD),
    u(f.resteAPayerUSD),
    STATUT_FACTURE_LABEL[f.statut] ?? f.statut,
    f.modePaiement ?? "",
  ] as (string | number)[]);

  return (
    <PrintDoc
      titre="Factures fournisseurs"
      sousTitre={new Date().toLocaleDateString("fr-FR")}
      entete={["Fournisseur", "N°", "Date", "Échéance", "Montant USD", "Reste USD", "Statut", "Mode"]}
      aligneDroite={[4, 5]}
      lignes={lignes}
    />
  );
}
