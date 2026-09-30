import { decompterEtats, recetteACompleter, type EtatDispo, type ResultatDisponibilite } from "@/lib/fiches/disponibilite";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { chargerArticlesDesFiches, chargerFichesVues, chargerStocksDesFiches } from "./charger-fiche";
import { disponibilitesDesFiches, type FicheVue } from "./fiche-calc";

// « Plats (disponibilité selon le stock) » : LE calcul du bloc, partagé par le tableau de bord de
// l'Exploitation et celui du Stock (demande de la Direction, 2026-09-30). Aucun des deux écrans n'en
// refait le décompte : les mêmes chiffres, par construction. Ils disent l'état d'AUJOURD'HUI — la
// disponibilité se recalcule au stock du jour, elle n'a pas d'historique.

export type DecompteDispo = {
  /** Fiches dont la recette est complète, par état. */
  etats: Record<EtatDispo, number>;
  /** Fiches sans recette (import du classeur des ventes) : comptées à part, jamais « à vérifier ». */
  recettesACompleter: number;
  /** Fiches vendues de ce type (recettes à compléter comprises). */
  nbVendues: number;
};

export type DisponibilitePlats = { plats: DecompteDispo; bar: DecompteDispo };

/**
 * Décompte pur, à partir des fiches et de leur disponibilité déjà calculée. « Plats » = fiches PLAT
 * seulement ; les fiches Bar (verre, cocktail…) ont leur propre décompte, jamais additionné aux plats.
 * Les sous-recettes et les fiches inactives ne sont pas « vendues ».
 */
export function resumerDisponibilitePlats(vues: Pick<FicheVue, "id" | "actif" | "estSousRecette" | "type">[], dispos: Map<string, ResultatDisponibilite>): DisponibilitePlats {
  const decompter = (type: string): DecompteDispo => {
    const vendues = vues.filter((v) => v.actif && !v.estSousRecette && v.type === type).map((v) => dispos.get(v.id)!);
    return {
      etats: decompterEtats(vendues.filter((d) => !recetteACompleter(d))),
      recettesACompleter: vendues.filter((d) => recetteACompleter(d)).length,
      nbVendues: vendues.length,
    };
  };
  return { plats: decompter("PLAT"), bar: decompter("BAR") };
}

/** Lit les fiches, les articles et les stocks (une fois chacun) puis décompte. `aujourdhui` : AAAA-MM-JJ, jour civil de Kinshasa. */
export async function chargerDisponibilitePlats(aujourdhui: string = jourCivilKinshasa(new Date()).toISOString().slice(0, 10)): Promise<DisponibilitePlats> {
  const [vues, articles, stocks] = await Promise.all([chargerFichesVues(), chargerArticlesDesFiches(), chargerStocksDesFiches()]);
  return resumerDisponibilitePlats(vues, disponibilitesDesFiches(vues, articles, stocks, aujourdhui));
}
