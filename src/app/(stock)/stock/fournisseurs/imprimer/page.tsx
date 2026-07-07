import { prisma } from "@/lib/prisma";
import { PrintDoc } from "../../_print/print-doc";

export default async function FournisseursImprimerPage() {
  const fournisseurs = await prisma.fournisseur.findMany({
    orderBy: { nom: "asc" },
    include: { _count: { select: { articles: true, factures: true } } },
  });

  const lignes = fournisseurs.map((f) => [
    f.nom, f.contactNom ?? "", f.telephone ?? "", f.ville ?? "", f.rccm ?? "",
    f.delaiPaiement ?? "", f.modePaiement ?? "", f._count.articles, f._count.factures,
  ] as (string | number)[]);

  return (
    <PrintDoc
      titre="Fournisseurs"
      sousTitre={new Date().toLocaleDateString("fr-FR")}
      entete={["Nom", "Contact", "Téléphone", "Ville", "RCCM", "Délai paiement", "Mode", "Articles", "Factures"]}
      aligneDroite={[7, 8]}
      lignes={lignes}
    />
  );
}
