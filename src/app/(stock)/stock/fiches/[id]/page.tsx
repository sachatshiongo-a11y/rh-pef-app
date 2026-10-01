import { notFound } from "next/navigation";
import { FilAriane } from "@/components/fil-ariane";
import { chargerFichesVues, chargerArticlesSelectionnables, chargerStocksDesFiches } from "../_data/charger-fiche";
import { versFicheCalc, versFicheDispo } from "../_data/fiche-calc";
import { EditerFiche } from "./editer-fiche";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { exigerPageStock } from "@/lib/garde-page";
import { peutSupprimer } from "@/lib/suppression-direction";
import { ongletFiche } from "@/lib/fiches/famille-boisson";

export default async function FicheDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await exigerPageStock();
  const { id } = await params;

  const [vues, articles, stocks] = await Promise.all([chargerFichesVues(), chargerArticlesSelectionnables(), chargerStocksDesFiches()]);
  const vue = vues.find((v) => v.id === id);
  if (!vue) notFound();

  // Contexte du moteur : toutes les AUTRES fiches. La fiche courante est reconstruite en direct
  // depuis le formulaire, elle ne doit pas être lue dans sa version enregistrée.
  const mapArticles = new Map(articles.map((a) => [a.id, a]));
  const noms = new Map(vues.map((v) => [v.id, { nom: v.nom }]));
  const contexte = vues.filter((v) => v.id !== id).map((v) => versFicheCalc(v, mapArticles, noms));
  const contexteDispo = vues.filter((v) => v.id !== id).map((v) => versFicheDispo(v, mapArticles, noms));

  const autresFiches = vues
    .filter((v) => v.id !== id)
    .map((v) => ({ id: v.id, nom: v.nom, estSousRecette: v.estSousRecette }));

  return (
    <div className="w-full space-y-5">
      {/* Le retour mène à l'onglet de la fiche (Plats ou Boissons), pas toujours aux plats. */}
      <FilAriane segments={[{ label: "Fiches techniques", href: `/stock/fiches?vue=${ongletFiche(vue)}` }, { label: vue.nom }]} />
      {/* La clé remonte le composant dès que les données enregistrées changent : l'état local
          (entête + lignes en cours d'édition) repart toujours de ce que la base contient. */}
      <EditerFiche
        key={JSON.stringify(vue)}
        vue={vue}
        articles={articles}
        autresFiches={autresFiches}
        contexte={contexte}
        contexteDispo={contexteDispo}
        stocks={stocks}
        aujourdhui={jourCivilKinshasa(new Date()).toISOString().slice(0, 10)}
        peutSupprimer={peutSupprimer(user)}
      />
    </div>
  );
}
