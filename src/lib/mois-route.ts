/**
 * Mois et année demandés à une route d'export (`?mois=9&annee=2026`).
 *
 * Absents : le mois courant de la paie (`repli`), comme avant. Présents : validés (mois 1 à 12, année
 * à quatre chiffres) — une valeur illisible est REFUSÉE, jamais remplacée en silence par le mois
 * courant (la Direction croirait avoir exporté le mois qu'elle a choisi). Sert à rouvrir en PDF, ZIP
 * ou Excel un mois CLÔTURÉ depuis l'historique, au lieu de n'offrir que le mois courant.
 */
export function lireMoisAnnee(
  recherche: URLSearchParams,
  repli: { mois: number; annee: number },
): { ok: true; mois: number; annee: number } | { ok: false; message: string } {
  const m = recherche.get("mois");
  const a = recherche.get("annee");
  if (m === null && a === null) return { ok: true, mois: repli.mois, annee: repli.annee };
  const mois = Number(m);
  const annee = Number(a);
  if (m === null || a === null || !Number.isInteger(mois) || mois < 1 || mois > 12 || !Number.isInteger(annee) || annee < 2000 || annee > 2100) {
    return { ok: false, message: "Mois ou année invalide" };
  }
  return { ok: true, mois, annee };
}
