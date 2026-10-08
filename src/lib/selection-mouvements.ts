import "server-only";

import type { Prisma } from "@prisma/client";
import { BORNE_TOUT_LE_FILTRE, lireFiltreMouvements, whereColonne, type ColonneMouvements, type SelectionMouvements } from "@/lib/filtre-mouvements";

// Sélection d'une action groupée de l'écran Mouvements : les id cochés, ou TOUT le filtre (décision du
// 2026-09-29). Une seule résolution pour toutes les actions groupées (suppression, motif, date) : si
// l'une recomptait autrement, elle frapperait un ensemble différent de celui que la Direction a confirmé.

export const SELECT_SELECTION = {
  id: true, type: true, date: true, articleId: true, quantite: true, categorieSortie: true, raisonSortie: true, origine: true,
  factureId: true, receptionId: true,
  article: { select: { designation: true, unite: true } },
} satisfies Prisma.MouvementStockSelect;
export type MvtSelection = Prisma.MouvementStockGetPayload<{ select: typeof SELECT_SELECTION }>;
export type SelectionResolue = { mvs: MvtSelection[]; nbDemandes: number } | { erreur: string; nouveauNombre?: number };

/** Délai de la transaction : une action « tout le filtre » peut toucher jusqu'à BORNE_TOUT_LE_FILTRE lignes. */
export const DELAI_TOUT_LE_FILTRE = 60_000;

/**
 * Résout la sélection DANS la transaction d'écriture. Liste d'id : les mouvements existants.
 * Filtre : le `where` est RECONSTRUIT par la même fonction que la page (`whereColonne`), puis
 * RECOMPTÉ : au-delà de la borne, refus ; si le nombre diffère de celui que la Direction a confirmé,
 * rien n'est écrit et le nouveau nombre revient pour une nouvelle confirmation.
 */
export async function resoudreSelectionMouvements(tx: Prisma.TransactionClient, selection: SelectionMouvements, nom: string, videMsg: string): Promise<SelectionResolue> {
  if (Array.isArray(selection)) {
    const uniq = [...new Set(selection.map(String))].filter(Boolean);
    if (uniq.length === 0) return { erreur: videMsg };
    return { mvs: await tx.mouvementStock.findMany({ where: { id: { in: uniq } }, select: SELECT_SELECTION }), nbDemandes: uniq.length };
  }
  if (!selection || typeof selection !== "object") return { erreur: "Sélection invalide : rechargez la page." };
  const { attendu } = selection;
  const colonne: ColonneMouvements | null = selection.colonne === "SORTIES" || selection.colonne === "ENTREES" ? selection.colonne : null;
  if (!colonne || !Number.isInteger(attendu) || attendu <= 0) return { erreur: "Sélection invalide : rechargez la page." };
  const where = whereColonne(lireFiltreMouvements(selection.filtre, new Date()), colonne);
  const n = await tx.mouvementStock.count({ where });
  if (n > BORNE_TOUT_LE_FILTRE) {
    return { erreur: `Le filtre compte ${n} ${nom} : au-delà de ${BORNE_TOUT_LE_FILTRE}, une action groupée est refusée. Affinez par mois, produit ou motif.` };
  }
  const recompte = (k: number) => ({
    erreur: `Le filtre compte maintenant ${k} ${nom}, et non ${attendu} comme confirmé : rien n'a été modifié. Vérifiez, puis confirmez à nouveau.`,
    nouveauNombre: k,
  });
  if (n !== attendu) return recompte(n);
  const mvs = await tx.mouvementStock.findMany({ where, select: SELECT_SELECTION, take: BORNE_TOUT_LE_FILTRE + 1 });
  if (mvs.length !== attendu) return recompte(mvs.length); // écrit entre le comptage et la lecture
  return { mvs, nbDemandes: attendu };
}
