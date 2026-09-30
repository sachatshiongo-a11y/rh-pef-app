"use client";

import type { ReactNode } from "react";
import { useVueSemaine } from "./jour-mobile";

/**
 * Téléphone : la liste du jour (`jour`) OU, si la Direction a choisi « Vue semaine », le tableau de
 * la semaine (`semaine`, qui défile de côté, première colonne figée). Ordinateur : toujours le
 * tableau. Le choix est CSS (rien n'est monté ou démonté selon la largeur) ; les deux vues lisent
 * les mêmes lignes et écrivent par les mêmes actions.
 */
export function VueJourOuSemaine({ jour, semaine }: { jour: ReactNode; semaine: ReactNode }) {
  const [vueSemaine] = useVueSemaine();
  return (
    <>
      <div data-vue="jour" className={vueSemaine ? "hidden" : "lg:hidden"}>{jour}</div>
      <div data-vue="semaine" className={vueSemaine ? "" : "max-lg:hidden"}>{semaine}</div>
    </>
  );
}
