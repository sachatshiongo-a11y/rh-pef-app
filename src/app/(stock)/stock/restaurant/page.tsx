import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { RestaurantGrille, type Jour, type LigneResto } from "./restaurant-client";
import { joursSemaine, lundiDe } from "./semaine";
import { BoutonRapport } from "../_rapport/bouton-rapport";

type SP = { espace?: string; semaine?: string };

export default async function RestaurantPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const espace = sp.espace === "BAR" ? "BAR" : "CUISINE";
  const base = sp.semaine ? new Date(sp.semaine) : new Date();
  const lundi = lundiDe(base);
  const jours: Jour[] = joursSemaine(base);
  const debut = new Date(jours[0].iso), fin = new Date(jours[6].iso);

  const [articles, livraisons] = await Promise.all([
    prisma.articleResto.findMany({
      where: { espace, actif: true },
      orderBy: [{ categorie: "asc" }, { ordre: "asc" }, { designation: "asc" }],
      include: { comptages: { where: { date: { gte: debut, lte: fin } } } },
    }),
    // Livraisons au restaurant (sorties de stock « Livraison restaurant ») de la semaine affichée.
    prisma.mouvementStock.findMany({
      where: { categorieSortie: "LIVRAISON_RESTAURANT", date: { gte: debut, lte: fin } },
      orderBy: { date: "desc" },
      include: { article: { select: { designation: true } } },
    }),
  ]);

  // Regroupe les livraisons par jour.
  const livParJour = new Map<string, { designation: string; quantite: number }[]>();
  for (const m of livraisons) {
    const k = new Date(m.date).toISOString().slice(0, 10);
    (livParJour.get(k) ?? livParJour.set(k, []).get(k)!).push({ designation: m.article.designation, quantite: Number(m.quantite) });
  }

  const lignes: LigneResto[] = articles.map((a) => {
    const comptages: Record<string, string> = {};
    for (const c of a.comptages) comptages[new Date(c.date).toISOString().slice(0, 10)] = Number(c.quantite).toString();
    return {
      id: a.id, categorie: a.categorie, designation: a.designation, unite: a.unite,
      base: a.stockBaseJournalier !== null ? Number(a.stockBaseJournalier).toString() : "",
      comptages,
    };
  });

  const categories = [...new Set(articles.map((a) => a.categorie).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr"));

  const semLien = (offset: number) => {
    const d = new Date(lundi); d.setUTCDate(d.getUTCDate() + offset * 7);
    return `/stock/restaurant?espace=${espace}&semaine=${d.toISOString().slice(0, 10)}`;
  };
  const exportQs = `espace=${espace}&semaine=${jours[0].iso}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Stock restaurant</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5 text-sm">
            <a href={`/stock/restaurant?espace=CUISINE&semaine=${jours[0].iso}`} className={`rounded-full border px-3 py-1 ${espace === "CUISINE" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Cuisine</a>
            <a href={`/stock/restaurant?espace=BAR&semaine=${jours[0].iso}`} className={`rounded-full border px-3 py-1 ${espace === "BAR" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Bar</a>
          </div>
          <BoutonRapport pdfHref={`/stock/restaurant/pdf?${exportQs}`} excelHref={`/stock/restaurant/excel?${exportQs}`} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm sm:gap-3">
        <a href={semLien(-1)} className="rounded-md border px-3 py-1 hover:bg-accent">← Semaine préc.</a>
        <span className="font-medium">Semaine du {jours[0].num} au {jours[6].num}</span>
        <a href={semLien(1)} className="rounded-md border px-3 py-1 hover:bg-accent">Semaine suiv. →</a>
      </div>

      {livParJour.size > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm">
          <p className="mb-1 font-semibold text-emerald-800">Livraisons reçues cette semaine</p>
          <ul className="space-y-1">
            {[...livParJour.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([iso, arts]) => (
              <li key={iso} className="text-emerald-900">
                <span className="font-medium">{new Date(iso).toLocaleDateString("fr-FR")}</span> — {arts.map((a) => `${a.designation} (${a.quantite})`).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-muted-foreground">Tableur éditable : modifiez catégorie, désignation, unité et stock de base, et saisissez la quantité comptée pour chaque jour. « Stock de base » = niveau cible par jour.{estDirection ? "" : " Seule la Direction peut supprimer un article."}</p>

      <RestaurantGrille espace={espace} jours={jours} lignes={lignes} categories={categories} estDirection={estDirection} />
    </div>
  );
}
