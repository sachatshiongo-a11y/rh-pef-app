import Link from "next/link";
import type { DisponibilitePlats } from "@/app/(stock)/stock/fiches/_data/disponibilite-plats";

/** Titre du bloc — le même sur les tableaux de bord Exploitation et Stock. */
export const TITRE_DISPONIBILITE_PLATS = "Plats (disponibilité selon le stock)";

/**
 * Lignes du bloc « Plats (disponibilité selon le stock) », partagées par l'Exploitation et le Stock
 * (le titre et le cadre restent à l'écran appelant). Présentation seule : les chiffres viennent de
 * `chargerDisponibilitePlats`, jamais recalculés ici.
 *
 * - `avecLiens` : chaque ligne mène à la liste des fiches filtrée (Stock → Fiches techniques). Faux
 *   pour qui n'a pas accès à l'espace Stock (la Comptabilité voit les chiffres, sans lien).
 * - Les fiches Bar vivent dans l'onglet « Boissons » ; leur ligne ne s'affiche que s'il y en a.
 * - Téléphone : le libellé et le chiffre passent à la ligne plutôt que de se chevaucher.
 */
export function ListeDisponibilitePlats({ donnees, avecLiens }: { donnees: DisponibilitePlats; avecLiens: boolean }) {
  const { plats, bar } = donnees;
  const libelle = (texte: string, href: string) =>
    avecLiens ? <Link href={href} className="min-w-0 text-primary hover:underline">{texte}</Link> : <span className="min-w-0">{texte}</span>;
  return (
    <ul className="mt-1 space-y-1 text-sm" data-disponibilite-plats>
      <li className="flex flex-wrap items-baseline justify-between gap-x-2">
        {libelle("Plats en rupture", "/stock/fiches?etat=RUPTURE")}
        <span className={`font-semibold tabular-nums ${plats.etats.RUPTURE > 0 ? "text-red-700" : ""}`}>{plats.etats.RUPTURE}</span>
      </li>
      <li className="flex flex-wrap items-baseline justify-between gap-x-2">
        {libelle("Plats à vérifier", "/stock/fiches?etat=A_VERIFIER")}
        <span className={`font-semibold tabular-nums ${plats.etats.A_VERIFIER > 0 ? "text-amber-800" : ""}`}>{plats.etats.A_VERIFIER}</span>
      </li>
      <li className="flex flex-wrap items-baseline justify-between gap-x-2 text-muted-foreground">
        {libelle("Plats disponibles", "/stock/fiches?etat=DISPONIBLE")}
        <span className="tabular-nums">{plats.etats.DISPONIBLE}</span>
      </li>
      {plats.recettesACompleter > 0 && (
        <li className="flex flex-wrap items-baseline justify-between gap-x-2 text-muted-foreground">
          {libelle("Recettes à compléter", "/stock/fiches")}
          <span className="tabular-nums">{plats.recettesACompleter}</span>
        </li>
      )}
      {bar.nbVendues > 0 && (
        <li className="flex flex-wrap items-baseline justify-between gap-x-2 text-muted-foreground" data-ligne="fiches-bar">
          {libelle("Fiches Bar (à part des plats)", "/stock/fiches?vue=boissons")}
          <span className="ml-auto text-right tabular-nums">
            {bar.etats.DISPONIBLE} dispo. · {bar.etats.RUPTURE} rupture · {bar.etats.A_VERIFIER} à vérifier{bar.recettesACompleter > 0 ? ` · ${bar.recettesACompleter} recette(s) à compléter` : ""}
          </span>
        </li>
      )}
    </ul>
  );
}
