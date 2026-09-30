import { formaterNombre } from "@/lib/montant";
import type { EcartJour } from "@/lib/journalier-restaurant";

// Mise en forme partagée par le tableau de la semaine et la liste du jour (téléphone) de l'onglet
// Comparaison : mêmes couleurs d'écart, même « — » pour une consommation inconnue.

export const FOND_ECART: Record<EcartJour, string> = {
  LIVRE_NON_CONSOMME: "bg-sky-100",
  CONSOMME_PLUS_QUE_LIVRE: "bg-violet-100",
};

/** Pastille de l'écart signé (« -1 », « +1,5 ») : plus soutenue que le fond de la cellule, lisible sans la couleur. */
export const PASTILLE_ECART: Record<EcartJour | "LIVRE_DIFFERE", string> = {
  LIVRE_NON_CONSOMME: "bg-sky-200 text-sky-900",
  CONSOMME_PLUS_QUE_LIVRE: "bg-violet-200 text-violet-900",
  LIVRE_DIFFERE: "bg-orange-200 text-orange-900",
};

/** Quantité consommée : « — » quand elle est inconnue (jamais 0). */
export const qteConso = (v: string | null) => (v === null ? "—" : formaterNombre(Number(v), { maximumFractionDigits: 3 }));
