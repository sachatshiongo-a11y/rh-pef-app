import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { FournisseursClient, type FournRow } from "./fournisseurs-client";

export default async function FournisseursPage() {
  const user = await verifySession();
  const [fournisseurs, soldes] = await Promise.all([
    prisma.fournisseur.findMany({
      orderBy: { nom: "asc" },
      include: { _count: { select: { articles: true, factures: true } } },
    }),
    prisma.factureFournisseur.groupBy({
      by: ["fournisseurId"],
      where: { statut: { not: "REGLEE" } },
      _sum: { resteAPayerUSD: true },
    }),
  ]);
  const soldeParFourn = new Map(soldes.map((s) => [s.fournisseurId, Number(s._sum.resteAPayerUSD ?? 0)]));

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
    soldeDu: soldeParFourn.get(f.id) ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Fournisseurs</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{rows.length} fournisseur(s)</span>
          <a href="/stock/fournisseurs/imprimer" target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">PDF</a>
          <a href="/stock/fournisseurs/export" download className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Excel</a>
        </div>
      </div>
      <FournisseursClient fournisseurs={rows} estDirection={user.role === "ADMIN"} />
    </div>
  );
}
