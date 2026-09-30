import Link from "next/link";
import type { ReactNode } from "react";
import type { EtatDispo } from "@/lib/fiches/disponibilite";
import { ongletFiche, ONGLETS_FICHES, type OngletFiches } from "@/lib/fiches/famille-boisson";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { FichesClient, type FicheRow } from "./fiches-client";

/** Lien d'un onglet : l'onglet vit dans l'URL (`?vue=plats|boissons`), il survit au rechargement. */
export const lienOngletFiches = (vue: OngletFiches) => `/stock/fiches?vue=${vue}`;

/**
 * Écran Fiches techniques : onglets « Plats » / « Boissons » (mêmes onglets que la Consommation
 * journalière), compteurs et export de l'onglet affiché, puis la liste de CET onglet seulement.
 *
 * Le rangement vient de `ongletFiche` (type ; sous-recettes toujours avec les plats) : une
 * boisson n'est jamais transmise à la liste des plats, et inversement.
 */
export function EcranFiches({ rows, vue, etatInitial, importBar }: { rows: FicheRow[]; vue: OngletFiches; etatInitial?: EtatDispo; importBar?: ReactNode }) {
  const fiches = rows.filter((r) => ongletFiche(r) === vue);
  const nbParOnglet = (o: OngletFiches) => rows.filter((r) => ongletFiche(r) === o).length;

  // Une fiche SANS recette n'a pas un coût partiel : elle n'a pas de coût (« — », recette à compléter).
  const partielles = fiches.filter((r) => r.incomplet && r.nbIngredients > 0).length;
  const sansRecette = fiches.filter((r) => r.nbIngredients === 0 && !r.estSousRecette).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Fiches techniques</h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground" data-compteur-onglet>
            {fiches.length} fiche(s){partielles > 0 && ` · ${partielles} au coût partiel`}{sansRecette > 0 && ` · ${sansRecette} recette(s) à compléter`}
          </span>
          {/* PDF : une fiche par page, chiffrée ou « sans prix » (affichée au poste) — mêmes fiches,
              même ordre que l'Excel. */}
          <BoutonRapport
            pdfHref={`/stock/fiches/pdf?vue=${vue}&prix=avec`}
            pdfSansPrixHref={`/stock/fiches/pdf?vue=${vue}&prix=sans`}
            excelHref={`/stock/fiches/export?vue=${vue}`}
          />
        </div>
      </div>

      {/* Sélecteur d'onglet — même facture que la Consommation journalière : pleine largeur et gros
          onglets sur mobile, compact sur ordinateur. */}
      <nav aria-label="Onglets des fiches" className="flex w-full overflow-hidden rounded-lg border text-sm font-medium sm:w-fit">
        {ONGLETS_FICHES.map(({ valeur, libelle }) => (
          <Link
            key={valeur}
            href={lienOngletFiches(valeur)}
            aria-current={vue === valeur ? "page" : undefined}
            className={`flex-1 border-l px-3 py-2.5 text-center first:border-l-0 sm:flex-none sm:py-1.5 ${vue === valeur ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {libelle} <span className="tabular-nums opacity-75">· {nbParOnglet(valeur)}</span>
          </Link>
        ))}
      </nav>

      {/* « Importer les fiches du bar » (Direction seulement : l'appelant ne le passe qu'à elle) :
          onglet Boissons uniquement, là où vivent les fiches qu'il remplit. */}
      {vue === "boissons" && importBar}

      {/* Clé = onglet : changer d'onglet remonte la liste, donc vide la sélection et les filtres.
          Une action groupée ne peut ainsi jamais emporter des fiches de l'onglet qu'on a quitté. */}
      <FichesClient key={vue} fiches={fiches} etatInitial={etatInitial} vue={vue} />
    </div>
  );
}
