import { prisma } from "@/lib/prisma";
import { ListeAchatForm } from "./entree-client";

export default async function EntreePage() {
  const articles = await prisma.articleStock.findMany({
    where: { actif: true },
    orderBy: { designation: "asc" },
    select: { id: true, designation: true },
  });

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Liste d&apos;achat → entrée en stock</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Saisissez les articles achetés et leurs quantités : chaque ligne crée une entrée de stock
          et met à jour l&apos;inventaire directement.
        </p>
      </div>
      <ListeAchatForm articles={articles} />
    </div>
  );
}
