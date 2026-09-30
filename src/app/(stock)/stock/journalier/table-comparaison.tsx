import type { LigneComparaison } from "@/lib/journalier-restaurant";
import { VueJourOuSemaine } from "@/components/vue-jour-semaine";
import { ComparaisonJour } from "./comparaison-jour";
import { ComparaisonSemaine } from "./comparaison-semaine";

// Onglet « Comparaison » : commandé, livré au restaurant et consommé au restaurant, jour par jour,
// avec les écarts. Téléphone : la liste d'UN jour (`ComparaisonJour`) ; le tableau de la semaine
// (`ComparaisonSemaine`, avec son filtre « seulement les écarts ») sert l'ordinateur et la « Vue semaine ».

type Jour = { iso: string; label: string };

export function TableComparaison({ jours, lignes, sansMotif }: { jours: Jour[]; lignes: LigneComparaison[]; sansMotif: number }) {
  return (
    <VueJourOuSemaine
      jour={<ComparaisonJour jours={jours} lignes={lignes} sansMotif={sansMotif} />}
      semaine={<ComparaisonSemaine jours={jours} lignes={lignes} sansMotif={sansMotif} />}
    />
  );
}
