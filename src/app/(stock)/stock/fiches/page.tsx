import { calculerCout, arrondirCentime } from "@/lib/fiches/cout";
import type { EtatDispo } from "@/lib/fiches/disponibilite";
import { chargerFichesVues, chargerArticlesDesFiches, chargerStocksDesFiches } from "./_data/charger-fiche";
import { construireContexte, disponibilitesDesFiches, resumerDispo } from "./_data/fiche-calc";
import type { FicheRow } from "./fiches-client";
import { EcranFiches } from "./ecran-fiches";
import { lireOngletFiches } from "@/lib/fiches/famille-boisson";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { exigerPageStock } from "@/lib/garde-page";

const ETATS: EtatDispo[] = ["DISPONIBLE", "RUPTURE", "A_VERIFIER"];

export default async function FichesPage({ searchParams }: { searchParams: Promise<{ etat?: string; vue?: string }> }) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const etatInitial = ETATS.find((e) => e === sp.etat);
  // Onglet « Plats » par défaut : les liens existants (`?etat=RUPTURE` depuis Exploitation, qui
  // compte des PLATS) y arrivent donc sans rien changer.
  const vue = lireOngletFiches(sp.vue);

  // Stock (dépôt + restaurant) lu UNE fois pour toutes les fiches, jamais une requête par fiche.
  const [vues, articles, stocks] = await Promise.all([chargerFichesVues(), chargerArticlesDesFiches(), chargerStocksDesFiches()]);
  const contexte = construireContexte(vues, new Map(articles.map((a) => [a.id, a])));
  const dispos = disponibilitesDesFiches(vues, articles, stocks, jourCivilKinshasa(new Date()).toISOString().slice(0, 10));

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
      dispo: resumerDispo(dispos.get(v.id)!, v),
    };
  });

  return <EcranFiches rows={rows} vue={vue} etatInitial={etatInitial} />;
}
