import { RestaurantGrille, type Jour, type LigneResto } from "./restaurant-client";
import { PropositionsRattachement } from "./propositions-rattachement";
import type { Proposition } from "@/lib/fiches/rattachement-resto";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { BandeauLivraisons } from "./bandeau-livraisons";
import { MenuFichePdf, classeLienFiche } from "../_print/menu-fiche-pdf";
import { JourMobileProvider } from "@/components/jour-mobile";
import { BarreSemaineMobile } from "@/components/barre-semaine-mobile";
import { BasculeVueSemaine, SelecteurJour } from "@/components/selecteur-jour";
import { rangJourParDefaut } from "@/lib/jour-mobile";
import type { ArticleRestoSR, LivraisonSR, SignalementLivraison } from "@/lib/stock-restaurant";
import type { OptionCatalogue } from "./choix-article";
import { TelechargerLien } from "@/components/telecharger-lien";

/**
 * Écran Stock restaurant (haut de page + grille), sans accès aux données : la page les lit et les
 * passe ici (même principe que l'Inventaire). Ordinateur : les rangées d'origine. Téléphone : titre
 * et Cuisine / Bar sur une ligne, la semaine sur une ligne avec « Plus » (fiches, export, désactivés,
 * aide), le sélecteur de jour, puis le comptage du jour choisi.
 */
export function RestaurantEcran({
  espace, jours, aujourdhui, estDirection, afficherDesactives, lignes, categories, catalogue,
  livraisonsParJour, nonRattachees, signalements, articlesResto, propositions,
}: {
  espace: "CUISINE" | "BAR"; jours: Jour[]; aujourdhui: string; estDirection: boolean; afficherDesactives: boolean;
  lignes: LigneResto[]; categories: string[]; catalogue: OptionCatalogue[];
  /** Livraisons reçues de la semaine, regroupées par jour (iso → articles). */
  livraisonsParJour: [string, { designation: string; quantite: number }[]][];
  nonRattachees: LivraisonSR[]; signalements: SignalementLivraison[]; articlesResto: ArticleRestoSR[];
  propositions: Proposition[];
}) {
  const semLien = (offset: number) => {
    const d = new Date(jours[0].iso); d.setUTCDate(d.getUTCDate() + offset * 7);
    return `/stock/restaurant?espace=${espace}&semaine=${d.toISOString().slice(0, 10)}${afficherDesactives ? "&desactives=1" : ""}`;
  };
  const exportQs = `espace=${espace}&semaine=${jours[0].iso}`;
  const isos = jours.map((j) => j.iso);
  const jourM = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
  const libelleCourt = `Sem. du ${jourM(jours[0].iso)} au ${jourM(jours[6].iso)}`;
  const lienDesactives = (afficher: boolean) => `/stock/restaurant?espace=${espace}&semaine=${jours[0].iso}${afficher ? "&desactives=1" : ""}`;
  const listeLivraisons = (
    <ul className="space-y-1">
      {livraisonsParJour.map(([iso, arts]) => (
        <li key={iso} className="text-emerald-900">
          <span className="font-medium">{new Date(iso).toLocaleDateString("fr-FR")}</span> — {arts.map((a) => `${a.designation} (${a.quantite})`).join(", ")}
        </li>
      ))}
    </ul>
  );
  const note = <>Tableur éditable : modifiez catégorie, désignation, unité et stock de base, et saisissez la quantité comptée pour chaque jour. « Stock de base » = niveau cible par jour.{estDirection ? " Un article désactivé disparaît des saisies et garde son historique." : " Seule la Direction peut désactiver ou supprimer un article."}</>;
  const lienEspace = (e: "CUISINE" | "BAR") => `/stock/restaurant?espace=${e}&semaine=${jours[0].iso}`;
  const pilule = (e: "CUISINE" | "BAR", label: string) => (
    <a href={lienEspace(e)} className={`rounded-full border px-3 py-1 max-lg:flex max-lg:min-h-11 max-lg:items-center ${espace === e ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</a>
  );
  const fichesEtExport = (
    <>
      <MenuFichePdf libelle="Fiche d'inventaire (PDF)">
        <TelechargerLien href={`/stock/restaurant/fiche-inventaire?espace=${espace}`} className={classeLienFiche}>Fiche {espace === "BAR" ? "Bar" : "Cuisine"}</TelechargerLien>
        <TelechargerLien href="/stock/restaurant/fiche-inventaire?espace=TOUS" className={classeLienFiche}>Cuisine et Bar</TelechargerLien>
      </MenuFichePdf>
      <BoutonRapport pdfHref={`/stock/restaurant/pdf?${exportQs}`} excelHref={`/stock/restaurant/excel?${exportQs}`} />
    </>
  );

  return (
    // Un seul état « jour choisi » (téléphone) pour le haut de page et la liste du jour ; il repart du jour courant à chaque semaine.
    <JourMobileProvider key={`${espace}-${jours[0].iso}`} defaultIdx={rangJourParDefaut(isos, aujourdhui)}>
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 lg:flex-wrap">
        <h1 className="text-lg font-semibold sm:text-2xl">Stock restaurant</h1>
        <div className="flex items-center gap-2 lg:flex-wrap">
          <div className="flex gap-1.5 text-sm lg:flex-wrap">
            {pilule("CUISINE", "Cuisine")}
            {pilule("BAR", "Bar")}
          </div>
          <div className="flex flex-wrap items-center gap-2 max-lg:hidden">{fichesEtExport}</div>
        </div>
      </div>

      {/* Ordinateur : semaine et désactivés. */}
      <div className="flex flex-wrap items-center gap-2 text-sm sm:gap-3 max-lg:hidden">
        <a href={semLien(-1)} className="rounded-md border px-3 py-1 hover:bg-accent">← Semaine préc.</a>
        <span className="font-medium">Semaine du {jours[0].num} au {jours[6].num}</span>
        <a href={semLien(1)} className="rounded-md border px-3 py-1 hover:bg-accent">Semaine suiv. →</a>
        {estDirection && (
          <a href={lienDesactives(!afficherDesactives)}
            className={`rounded-full border px-3 py-1 ${afficherDesactives ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>
            {afficherDesactives ? "Masquer les désactivés" : "Afficher les désactivés"}
          </a>
        )}
      </div>

      {/* Téléphone : la semaine sur une ligne, « Plus » pour le reste, puis le jour. */}
      <BarreSemaineMobile
        precedente={semLien(-1)} suivante={semLien(1)} libelle={libelleCourt}
        filtre={afficherDesactives ? { libelle: "articles désactivés affichés", retirer: lienDesactives(false) } : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/stock/restaurant?espace=${espace}&semaine=${aujourdhui}${afficherDesactives ? "&desactives=1" : ""}`} className="flex min-h-11 items-center rounded-md border bg-background px-3 font-medium hover:bg-accent">Cette semaine</a>
          <BasculeVueSemaine />
          {estDirection && !afficherDesactives && (
            <a href={lienDesactives(true)} className="flex min-h-11 items-center rounded-md border bg-background px-3 font-medium hover:bg-accent">Afficher les désactivés</a>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2">{fichesEtExport}</div>
        <p className="border-t pt-2 text-xs text-muted-foreground">
          {note} Sous chaque article : le stock théorique (dernier comptage + livraisons reçues depuis) et le « reçu du dépôt » du jour, en lecture seule.
        </p>
      </BarreSemaineMobile>
      <SelecteurJour jours={jours} aujourdhui={aujourdhui} />

      {livraisonsParJour.length > 0 && (
        <>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm max-lg:hidden">
            <p className="mb-1 font-semibold text-emerald-800">Livraisons reçues cette semaine</p>
            {listeLivraisons}
          </div>
          <details className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 text-sm lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold text-emerald-800 [&::-webkit-details-marker]:hidden">
              Livraisons reçues cette semaine ({livraisonsParJour.length} jour{livraisonsParJour.length > 1 ? "s" : ""}) <span aria-hidden className="text-[10px]">▼</span>
            </summary>
            <div className="pb-3">{listeLivraisons}</div>
          </details>
        </>
      )}

      <p className="text-sm text-muted-foreground max-lg:hidden">{note}</p>

      <BandeauLivraisons nonRattachees={nonRattachees} signalements={signalements} articles={articlesResto} />

      <PropositionsRattachement propositions={propositions} />

      <div id="grille-restaurant" />
      <RestaurantGrille
        espace={espace} jours={jours} lignes={lignes} categories={categories} estDirection={estDirection}
        catalogue={catalogue.map((a) => ({ id: a.id, designation: a.designation, unite: a.unite ?? "" }))}
      />
    </div>
    </JourMobileProvider>
  );
}
