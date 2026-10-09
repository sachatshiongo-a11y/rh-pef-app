import { FilAriane } from "@/components/fil-ariane";
import { prisma } from "@/lib/prisma";
import { exigerPageStock } from "@/lib/garde-page";
import { CategoriesClient } from "./categories-client";

/**
 * Inventaire › Catégories. Tout le monde de l'espace Stock LIT la liste ; créer, renommer, ordonner,
 * archiver et supprimer sont réservés à la Direction (les actions serveur l'exigent aussi).
 */
export default async function CategoriesPage() {
  const user = await exigerPageStock();
  const categories = await prisma.categorieStock.findMany({
    orderBy: [{ domaine: "asc" }, { ordre: "asc" }, { nom: "asc" }],
    select: { id: true, nom: true, domaine: true, actif: true, _count: { select: { articles: true } } },
  });
  return (
    <div className="space-y-3 lg:space-y-4">
      <FilAriane segments={[{ label: "Inventaire", href: "/stock/catalogue" }, { label: "Catégories" }]} />
      <CategoriesClient
        categories={categories.map((c) => ({ id: c.id, nom: c.nom, domaine: c.domaine, actif: c.actif, nbArticles: c._count.articles }))}
        estDirection={user.role === "ADMIN"}
      />
    </div>
  );
}
