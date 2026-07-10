import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { FournisseursClient, type FournRow } from "./fournisseurs-client";
import { BoutonRapport } from "../_rapport/bouton-rapport";

export default async function FournisseursPage() {
  const user = await verifySession();
  const fournisseurs = await prisma.fournisseur.findMany({
    orderBy: { nom: "asc" },
    include: { _count: { select: { articles: true } } },
  });

  const rows: FournRow[] = fournisseurs.map((f) => ({
    id: f.id,
    nom: f.nom,
    contactNom: f.contactNom ?? "",
    telephone: f.telephone ?? "",
    ville: f.ville ?? "",
    rccm: f.rccm ?? "",
    idNational: f.idNational ?? "",
    delaiPaiement: f.delaiPaiement ?? "",
    delaiLivraison: f.delaiLivraison ?? "",
    nbArticles: f._count.articles,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Fournisseurs</h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{rows.length} fournisseur(s)</span>
          <BoutonRapport pdfHref="/stock/fournisseurs/imprimer" excelHref="/stock/fournisseurs/export" />
        </div>
      </div>
      <FournisseursClient fournisseurs={rows} estDirection={user.role === "ADMIN"} />
    </div>
  );
}
