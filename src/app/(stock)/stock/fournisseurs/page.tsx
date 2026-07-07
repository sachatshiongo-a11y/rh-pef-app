import { prisma } from "@/lib/prisma";
import { FournisseursClient, type FournRow } from "./fournisseurs-client";

export default async function FournisseursPage() {
  const fournisseurs = await prisma.fournisseur.findMany({
    orderBy: { nom: "asc" },
    include: { _count: { select: { articles: true, factures: true } } },
  });

  const rows: FournRow[] = fournisseurs.map((f) => ({
    id: f.id,
    nom: f.nom,
    contactNom: f.contactNom ?? "",
    telephone: f.telephone ?? "",
    ville: f.ville ?? "",
    rccm: f.rccm ?? "",
    delaiPaiement: f.delaiPaiement ?? "",
    modePaiement: f.modePaiement ?? "",
    email: f.email ?? "",
    nbArticles: f._count.articles,
    nbFactures: f._count.factures,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Fournisseurs</h1>
        <span className="text-sm text-muted-foreground">{rows.length} fournisseur(s)</span>
      </div>
      <FournisseursClient fournisseurs={rows} />
    </div>
  );
}
