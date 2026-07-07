import { prisma } from "@/lib/prisma";

export default async function FournisseursPage() {
  const fournisseurs = await prisma.fournisseur.findMany({
    orderBy: { nom: "asc" },
    include: { _count: { select: { articles: true, factures: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Fournisseurs</h1>
        <span className="text-sm text-muted-foreground">{fournisseurs.length} fournisseur(s)</span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Nom</th>
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Téléphone</th>
              <th className="px-3 py-2">Ville</th>
              <th className="px-3 py-2">RCCM</th>
              <th className="px-3 py-2">Délai paiement</th>
              <th className="px-3 py-2 text-right">Articles</th>
              <th className="px-3 py-2 text-right">Factures</th>
            </tr>
          </thead>
          <tbody>
            {fournisseurs.map((f) => (
              <tr key={f.id} className="border-t align-top">
                <td className="px-3 py-2 font-medium">{f.nom}</td>
                <td className="px-3 py-2 text-muted-foreground">{f.contactNom ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground whitespace-pre-line">{f.telephone ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{f.ville ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{f.rccm ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{f.delaiPaiement ?? "—"}</td>
                <td className="px-3 py-2 text-right">{f._count.articles}</td>
                <td className="px-3 py-2 text-right">{f._count.factures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
