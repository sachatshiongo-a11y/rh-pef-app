import { prisma } from "@/lib/prisma";
import { niveauAlerte, ALERTE_CLASSE, ALERTE_LABEL, usd, qte, type NiveauAlerte } from "@/lib/stock";
import type { Prisma } from "@prisma/client";

type SP = { q?: string; domaine?: string; alerte?: string };

export default async function CataloguePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" ? sp.domaine : undefined;
  const alerte = sp.alerte === "URGENT" || sp.alerte === "APPRO" || sp.alerte === "OK" ? sp.alerte : undefined;

  const where: Prisma.ArticleStockWhereInput = {
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const articles = await prisma.articleStock.findMany({
    where,
    orderBy: { designation: "asc" },
    include: {
      categorie: { select: { nom: true } },
      fournisseur: { select: { nom: true } },
      stock: true,
    },
  });

  const lignes = articles
    .map((a) => {
      const niveau: NiveauAlerte | null = a.stock
        ? niveauAlerte(a.stock.quantite, a.stock.seuilUrgent, a.stock.stockMinimum)
        : null;
      return { a, niveau };
    })
    .filter((l) => (alerte ? l.niveau === alerte : true));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Catalogue</h1>
        <span className="text-sm text-muted-foreground">{lignes.length} article(s)</span>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <input name="q" defaultValue={q} placeholder="Rechercher un article…" className="min-w-48 flex-1 rounded-md border border-input bg-background px-3 py-1.5" />
        <select name="domaine" defaultValue={domaine ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous domaines</option>
          <option value="NOURRITURE">Nourriture</option>
          <option value="BOISSON">Boisson</option>
        </select>
        <select name="alerte" defaultValue={alerte ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Toutes alertes</option>
          <option value="URGENT">Urgent</option>
          <option value="APPRO">À réapprovisionner</option>
          <option value="OK">Satisfaisant</option>
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Désignation</th>
              <th className="px-3 py-2">Catégorie</th>
              <th className="px-3 py-2">Fournisseur</th>
              <th className="px-3 py-2 text-right">Prix (USD)</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2">Alerte</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map(({ a, niveau }) => (
              <tr key={a.id} className="border-t">
                <td className="px-3 py-2 font-medium">{a.designation}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.categorie?.nom ?? <span className="text-amber-700">— à classer</span>}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.fournisseur?.nom ?? "—"}</td>
                <td className="px-3 py-2 text-right">{usd(a.prixUnitaireUSD)}</td>
                <td className="px-3 py-2 text-right">{a.stock ? qte(a.stock.quantite) : "—"}</td>
                <td className="px-3 py-2">
                  {niveau && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[niveau]}`}>
                      {ALERTE_LABEL[niveau]}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {lignes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun article pour ces filtres.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
