import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { niveauAlerte, ALERTE_CLASSE, ALERTE_LABEL, usd, qte, type NiveauAlerte } from "@/lib/stock";

export default async function FournisseurDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await prisma.fournisseur.findUnique({
    where: { id },
    include: {
      articles: { orderBy: { designation: "asc" }, include: { stock: true, categorie: { select: { nom: true } } } },
      _count: { select: { articles: true, factures: true, bonsCommande: true } },
    },
  });
  if (!f) notFound();

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/stock/fournisseurs" className="underline">Fournisseurs</Link>
        <span>/</span>
        <span>{f.nom}</span>
      </div>

      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{f.nom}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[f.contactNom, f.telephone, f.ville, f.rccm].filter(Boolean).join(" · ") || "—"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {f._count.articles} article(s) · {f._count.bonsCommande} bon(s) de commande · {f._count.factures} facture(s)
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-base font-semibold">Articles fournis</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Désignation</th>
                <th className="px-3 py-2">Catégorie</th>
                <th className="px-3 py-2 text-right">Prix USD</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2">Alerte</th>
              </tr>
            </thead>
            <tbody>
              {f.articles.map((a) => {
                const niv: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.seuilUrgent, a.stock.stockMinimum) : null;
                return (
                  <tr key={a.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{a.designation}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.categorie?.nom ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{usd(a.prixUnitaireUSD)}</td>
                    <td className="px-3 py-2 text-right">{a.stock ? qte(a.stock.quantite) : "—"}</td>
                    <td className="px-3 py-2">{niv && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[niv]}`}>{ALERTE_LABEL[niv]}</span>}</td>
                  </tr>
                );
              })}
              {f.articles.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucun article rattaché à ce fournisseur. Rattachez-en depuis le catalogue.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
