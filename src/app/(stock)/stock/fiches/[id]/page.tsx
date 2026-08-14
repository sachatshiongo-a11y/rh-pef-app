import { notFound } from "next/navigation";
import { FilAriane } from "@/components/fil-ariane";
import { verifySession, requireModule } from "@/lib/auth";
import { chargerFichesVues, chargerArticlesSelectionnables } from "../_data/charger-fiche";
import { versFicheCalc } from "../_data/fiche-calc";
import { EditerFiche } from "./editer-fiche";

export default async function FicheDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await verifySession();
  requireModule(user, "stock");

  const [vues, articles] = await Promise.all([chargerFichesVues(), chargerArticlesSelectionnables()]);
  const vue = vues.find((v) => v.id === id);
  if (!vue) notFound();

  // Contexte du moteur : toutes les AUTRES fiches. La fiche courante est reconstruite en direct
  // depuis le formulaire, elle ne doit pas être lue dans sa version enregistrée.
  const mapArticles = new Map(articles.map((a) => [a.id, a]));
  const noms = new Map(vues.map((v) => [v.id, { nom: v.nom }]));
  const contexte = vues.filter((v) => v.id !== id).map((v) => versFicheCalc(v, mapArticles, noms));

  const autresFiches = vues
    .filter((v) => v.id !== id)
    .map((v) => ({ id: v.id, nom: v.nom, estSousRecette: v.estSousRecette }));

  return (
    <div className="max-w-5xl space-y-5">
      <FilAriane segments={[{ label: "Fiches techniques", href: "/stock/fiches" }, { label: vue.nom }]} />
      {/* La clé remonte le composant dès que les données enregistrées changent : l'état local
          (entête + lignes en cours d'édition) repart toujours de ce que la base contient. */}
      <EditerFiche
        key={JSON.stringify(vue)}
        vue={vue}
        articles={articles}
        autresFiches={autresFiches}
        contexte={contexte}
      />
    </div>
  );
}
