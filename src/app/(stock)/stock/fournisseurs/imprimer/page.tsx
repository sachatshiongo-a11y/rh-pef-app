import { prisma } from "@/lib/prisma";
import { PrintDoc } from "../../_print/print-doc";
import { exigerPageStock } from "@/lib/garde-page";
import { jourKinshasa } from "@/lib/heure-kinshasa";

export default async function FournisseursImprimerPage() {
  await exigerPageStock();
  const fournisseurs = await prisma.fournisseur.findMany({
    orderBy: { nom: "asc" },
    include: { _count: { select: { articles: true, factures: true } } },
  });

  const lignes = fournisseurs.map((f) => [
    f.nom, f.contactNom ?? "", f.telephone ?? "", f.ville ?? "", f.rccm ?? "", f.idNational ?? "",
    f.delaiPaiement ?? "", f.modePaiement ?? "", f._count.articles, f._count.factures,
  ] as (string | number)[]);

  return (
    <PrintDoc
      titre="Fournisseurs"
      sousTitre={jourKinshasa(new Date())}
      entete={["Nom", "Contact", "Téléphone", "Ville", "RCCM", "N° Id national", "Délai paiement", "Mode", "Articles", "Factures"]}
      aligneDroite={[8, 9]}
      lignes={lignes}
    />
  );
}
