import { verifySession, requireModule } from "@/lib/auth";
import { calculerCout, arrondirCentime } from "@/lib/fiches/cout";
import { chargerFichesVues, chargerArticlesDesFiches } from "./_data/charger-fiche";
import { construireContexte } from "./_data/fiche-calc";
import { FichesClient, type FicheRow } from "./fiches-client";
import { BoutonRapport } from "../_rapport/bouton-rapport";

export default async function FichesPage() {
  const user = await verifySession();
  requireModule(user, "stock");

  const [vues, articles] = await Promise.all([chargerFichesVues(), chargerArticlesDesFiches()]);
  const contexte = construireContexte(vues, new Map(articles.map((a) => [a.id, a])));

  // Le coût n'est JAMAIS stocké : il est recalculé ici par le moteur, pour chaque fiche, avec le
  // même contexte (les sous-recettes se résolvent entre elles).
  const rows: FicheRow[] = vues.map((v) => {
    const calc = contexte.fiches.get(v.id)!;
    const r = calculerCout(calc, contexte);
    return {
      id: v.id,
      nom: v.nom,
      categorie: v.categorie,
      type: v.type,
      estSousRecette: v.estSousRecette,
      actif: v.actif,
      photoUrl: v.photoUrl,
      nbPortions: v.nbPortions,
      nbIngredients: v.lignes.length,
      // Arrondi UNIQUE au centime, par le moteur : jamais de `.toFixed(2)` maison.
      coutPortion: arrondirCentime(r.coutParPortion),
      // Aucune ligne valorisée = pas un coût de 0, un coût inconnu. On n'affiche alors aucun chiffre.
      coutConnu: r.lignes.some((l) => l.cout !== null),
      // Coût minoré par des ingrédients non valorisés : c'est CE cas qui justifie le « ≥ » devant le
      // montant. `incomplet` couvre en plus un nombre de portions inexploitable, où le coût total
      // reste exact — on ne mélange pas les deux.
      coutPartiel: r.ingredientsSansPrix.length > 0 || r.cycle,
      incomplet: r.incomplet,
      nbIndetermines: r.ingredientsSansPrix.length,
      prixVenteHT: r.prixVenteHT,
      prixEstConseille: r.prixEstConseille,
      tauxMarque: r.tauxMarque,
    };
  });

  const partielles = rows.filter((r) => r.incomplet).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Fiches techniques</h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {rows.length} fiche(s){partielles > 0 && ` · ${partielles} au coût partiel`}
          </span>
          <BoutonRapport excelHref="/stock/fiches/export" />
        </div>
      </div>
      <FichesClient fiches={rows} />
    </div>
  );
}
