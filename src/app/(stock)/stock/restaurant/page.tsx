import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { RestaurantGrille, type Jour, type LigneResto } from "./restaurant-client";

type SP = { espace?: string; semaine?: string };
const JLABEL = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function lundiDe(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

export default async function RestaurantPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const espace = sp.espace === "BAR" ? "BAR" : "CUISINE";
  const base = sp.semaine ? new Date(sp.semaine) : new Date();
  const lundi = lundiDe(base);
  const jours: Jour[] = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(lundi); d.setUTCDate(d.getUTCDate() + i);
    return { iso: d.toISOString().slice(0, 10), label: JLABEL[i], num: `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}` };
  });
  const debut = new Date(jours[0].iso), fin = new Date(jours[6].iso);

  const articles = await prisma.articleResto.findMany({
    where: { espace, actif: true },
    orderBy: [{ ordre: "asc" }, { designation: "asc" }],
    include: { comptages: { where: { date: { gte: debut, lte: fin } } } },
  });

  const lignes: LigneResto[] = articles.map((a) => {
    const comptages: Record<string, string> = {};
    for (const c of a.comptages) comptages[new Date(c.date).toISOString().slice(0, 10)] = Number(c.quantite).toString();
    return {
      id: a.id, categorie: a.categorie, designation: a.designation, unite: a.unite,
      base: a.stockBaseJournalier !== null ? Number(a.stockBaseJournalier).toString() : "",
      comptages,
    };
  });

  const semLien = (offset: number) => {
    const d = new Date(lundi); d.setUTCDate(d.getUTCDate() + offset * 7);
    return `/stock/restaurant?espace=${espace}&semaine=${d.toISOString().slice(0, 10)}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Stock restaurant</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 text-sm">
            <a href={`/stock/restaurant?espace=CUISINE&semaine=${jours[0].iso}`} className={`rounded-full border px-3 py-1 ${espace === "CUISINE" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Cuisine</a>
            <a href={`/stock/restaurant?espace=BAR&semaine=${jours[0].iso}`} className={`rounded-full border px-3 py-1 ${espace === "BAR" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Bar</a>
          </div>
          <Link href={`/stock/restaurant/parametres?espace=${espace}`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Paramètres</Link>
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <a href={semLien(-1)} className="rounded-md border px-3 py-1 hover:bg-accent">← Semaine préc.</a>
        <span className="font-medium">Semaine du {jours[0].num} au {jours[6].num}</span>
        <a href={semLien(1)} className="rounded-md border px-3 py-1 hover:bg-accent">Semaine suiv. →</a>
      </div>

      <p className="text-sm text-muted-foreground">Comptage journalier par produit (Cuisine / Bar). « Stock de base » = niveau cible par jour ; saisissez la quantité comptée pour chaque jour de la semaine.</p>

      <RestaurantGrille espace={espace} jours={jours} lignes={lignes} />
    </div>
  );
}
