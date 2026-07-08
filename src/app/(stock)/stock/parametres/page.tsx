import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function StockParametresPage() {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold sm:text-2xl">Paramètres</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/stock/restaurant/parametres" className="rounded-lg border p-5 transition-colors hover:border-primary">
          <h2 className="font-semibold">Articles du stock restaurant</h2>
          <p className="mt-1 text-sm text-muted-foreground">Gérer les produits Cuisine / Bar : catégorie, désignation, unité, stock de base et ordre d’affichage.</p>
        </Link>

        <div className="rounded-lg border p-5">
          <h2 className="font-semibold">Taux de change</h2>
          <p className="mt-1 text-lg font-semibold">1 USD = {taux ? taux.toLocaleString("fr-FR") : "—"} CDF</p>
          <p className="mt-1 text-xs text-muted-foreground">Taux partagé avec la paie. Il se modifie dans les Paramètres de l’espace RH (Direction).</p>
        </div>
      </div>
    </div>
  );
}
