import { formaterMontantFacture } from "@/lib/facture-devise";
import { Suspense, type ReactNode } from "react";
import { Indicateur, type TeinteIndicateur } from "@/components/indicateur";
import { montantSigne } from "@/lib/montant";
import { chargerIndicateursEntrees, type IndicateursEntrees, type SommeEntrees } from "@/lib/indicateurs/entrees-stock";
import { moisCourantKinshasa } from "@/lib/heure-kinshasa";

/** Le droit à passer en props (`voitMontants`), réexporté pour un seul import côté page. */
export { voitIndicateursEntrees } from "@/lib/indicateurs/entrees-stock";

/**
 * Cartes « Entrées de stock » du tableau de bord Stock (demande Direction 2026-09-30).
 *
 * Composant AUTONOME : il reçoit le mois (`annee`, `mois` 1..12) et les droits en props, charge
 * ses chiffres (`chargerIndicateursEntrees`) et ne lit jamais l'URL — le tableau de bord décide
 * du mois. Sans droit, rien n'est lu ni affiché.
 *
 * Chargé sous `Suspense` : le tableau de bord s'affiche sans attendre ces agrégats (derrière le
 * VPN du client, un aller-retour de plus se sent), les cartes arrivent dans le même flux.
 */
export function CartesEntreesStock({ annee, mois, voitMontants }: { annee: number; mois: number; voitMontants: boolean }) {
  if (!voitMontants) return null;
  return (
    <Suspense fallback={<p className="text-xs text-muted-foreground" data-cartes-entrees-stock>Entrées de stock : chargement…</p>}>
      <CartesEntreesStockChargees annee={annee} mois={mois} />
    </Suspense>
  );
}

async function CartesEntreesStockChargees({ annee, mois }: { annee: number; mois: number }) {
  const donnees = await chargerIndicateursEntrees(annee, mois);
  return <CartesEntreesStockVue donnees={donnees} moisEnCours={moisCourantKinshasa() === `${annee}-${String(mois).padStart(2, "0")}`} />;
}

/**
 * Présentation (sans lecture) :
 * - « Total = Liste d'achat + Factures + Autres » est écrit en tête ; « Autres » n'apparaît que
 *   s'il existe de telles entrées (sinon l'égalité à deux termes se lit d'elle-même).
 * - Une entrée sans valeur connue : la carte dit « partiel » et combien (jamais un zéro muet) ;
 *   le montant affiché est celui des entrées valorisées, les autres n'y sont pas.
 * - Les légumes frais n'entrent pas en stock : ils ont leur propre carte plus haut sur le tableau
 *   de bord, et l'en-tête rappelle qu'ils ne sont pas dans ce total.
 * - Chaque carte ouvre Mouvements filtré sur SON mois et sa catégorie (même `where` que le calcul).
 * - Téléphone : grille 2 × 2 comme les autres indicateurs du tableau de bord ; une rangée au-delà.
 */
export function CartesEntreesStockVue({ donnees: d, moisEnCours }: { donnees: IndicateursEntrees; moisEnCours: boolean }) {
  const avecAutres = d.autres.nb > 0;
  const lien = (motif: string) => `/stock/mouvements?mois=${encodeURIComponent(d.cleMois)}&motif=${motif}`;
  // Factures en francs : leur montant est en francs, leurs entrées valorisées en dollars au taux de
  // l'enregistrement — le facturé se dit alors par devise, jamais additionné.
  const factureCDF = d.facture.montantCDF ?? 0;
  const factureDiffere = d.facture.nb > 0 && (d.facture.montant !== d.factures.montant || factureCDF !== 0);
  const libelleFacture = factureCDF !== 0
    ? (d.facture.montant !== 0 ? `${montantSigne(d.facture.montant, "USD").texte} + ${formaterMontantFacture(factureCDF, "CDF")}` : formaterMontantFacture(factureCDF, "CDF"))
    : montantSigne(d.facture.montant, "USD").texte;
  const egalite = avecAutres ? "Total = Liste d'achat + Factures + Autres" : "Total = Liste d'achat + Factures";

  // `essentiel` : la ligne de détail reste visible sur téléphone ; les autres sont masquées pour ne
  // pas allonger les cartes (seul le facturé qui diffère reste).
  const cartes: { cle: string; libelle: string; somme: SommeEntrees; href: string; teinte?: TeinteIndicateur; detail?: ReactNode; essentiel?: boolean; large?: boolean }[] = [
    // Sans « Autres », trois cartes : le total prend toute la largeur de la grille 2 × 2.
    { cle: "total", libelle: "Total des entrées de stock", somme: d.total, href: lien("entrees"), teinte: "entree", large: !avecAutres },
    { cle: "achats", libelle: "dont Liste d'achat", somme: d.achats, href: lien("achats"), detail: "achats sans facture" },
    {
      cle: "factures", libelle: "dont Factures fournisseurs", somme: d.factures, href: lien("factures"), essentiel: factureDiffere,
      detail: factureDiffere ? `facturé ce mois : ${libelleFacture}` : "lignes de factures entrées en stock",
    },
    ...(avecAutres ? [{ cle: "autres", libelle: "dont Autres entrées", somme: d.autres, href: lien("autres"), detail: "réceptions, entrées manuelles, corrections, imports" }] : []),
  ];

  return (
    <section aria-label="Entrées de stock" className="space-y-2" data-cartes-entrees-stock>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Entrées de stock · {d.libellePeriode}</span>
        {moisEnCours ? " (mois en cours)" : ""}
        {" · "}{egalite}{" · "}légumes frais hors stock, non compris
      </p>
      <div className={`grid grid-cols-2 gap-3 ${avecAutres ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {cartes.map((c) => {
          const partiel = c.somme.nbSansValeur > 0;
          const valeur = c.somme.nb - c.somme.nbSansValeur > 0 ? montantSigne(c.somme.montant, "USD") : null;
          return (
            <div key={c.cle} data-carte={c.cle} className={`min-w-0 ${c.large ? "col-span-2 lg:col-span-1" : ""}`}>
              <Indicateur
                libelle={c.libelle}
                valeur={valeur ? valeur.texte : "—"}
                teinte={valeur?.negatif ? "alerte" : partiel ? "attention" : c.teinte}
                href={c.href}
                sousTexte={
                  <>
                    {c.somme.nb} entrée(s)
                    {partiel && <span className="font-medium text-amber-800"> · partiel : {c.somme.nbSansValeur} sans valeur</span>}
                    {c.detail && <span className={c.essentiel ? "block" : "hidden sm:block"}>{c.detail}</span>}
                  </>
                }
              />
            </div>
          );
        })}
      </div>
      {d.ecart && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          Écart de classement : {d.ecart.nb} entrée(s) et {montantSigne(d.ecart.montant, "USD").texte} ne tombent pas dans une seule
          catégorie. Le total affiché est la somme des catégories ; signalez cet écart.
        </p>
      )}
    </section>
  );
}
