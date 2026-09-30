import { formaterNombre } from "@/lib/montant";
import type { EcartJour } from "@/lib/journalier-restaurant";

// Mise en forme partagée par le tableau de la semaine et la liste du jour (téléphone) de l'onglet
// Comparaison : mêmes couleurs d'écart, même « — » pour une consommation inconnue.

export const FOND_ECART: Record<EcartJour, string> = {
  LIVRE_NON_CONSOMME: "bg-sky-100",
  CONSOMME_PLUS_QUE_LIVRE: "bg-violet-100",
};

/** Quantité consommée : « — » quand elle est inconnue (jamais 0). */
export const qteConso = (v: string | null) => (v === null ? "—" : formaterNombre(Number(v), { maximumFractionDigits: 3 }));
