import { usd } from "@/lib/stock";
import { ExportInventaire } from "./export-inventaire";
import type { ManqueKey } from "@/lib/filtre-inventaire";
import { CatalogueTable, type ArticleRow } from "./catalogue-table";
import { PAR_DEFAUT, type ParPage } from "@/lib/pagination";
import { LienGardantTaille } from "@/components/pagination";
import { PilulesDomaine, type DomaineCle as Domaine } from "@/components/stock/pilules-domaine";

/**
 * Écran Inventaire (en-tête + tableau), sans accès aux données : `CatalogueView` les lit et les
 * passe ici. Sur téléphone, le haut de page est COMPACT — titre et domaines sur une seule ligne,
 * puis recherche/tri/« Plus », puis une rangée de pilules qui défile de côté (voir CatalogueTable) —
 * pour montrer les articles dès l'ouverture. La valeur du stock, le compteur et l'export y passent
 * dans le menu « Plus ». Sur ordinateur, rien ne change.
 */
export function CatalogueEcran({ rows, categories, fournisseurs, domaine, q, alerte, manque = "", hausse = false, pageInit = 1, parInit = PAR_DEFAUT, estDirection = true }: {
  rows: ArticleRow[];
  categories: { id: string; nom: string; domaine: string; actif?: boolean }[];
  fournisseurs: { id: string; nom: string }[];
  domaine?: Domaine;
  q: string;
  alerte?: "URGENT" | "APPRO" | "OK";
  /** Filtres « À compléter » et « hausse de prix » lus dans l'adresse (le tableau les réécrit à chaque changement). */
  manque?: ManqueKey;
  hausse?: boolean;
  /** Page et taille de page lues dans l'URL (le tableau pagine les lignes déjà chargées). */
  pageInit?: number;
  parInit?: ParPage;
  /** Hors Direction : Inventaire en lecture, modifications proposées (voir CatalogueTable). */
  estDirection?: boolean;
}) {
  // Bascule de domaine en conservant recherche et filtre d'alerte (la page repart à 1, la taille de page est gardée par le lien).
  const lienDomaine = (cle: Domaine | "") => {
    return `/stock/catalogue${cle ? `?domaine=${cle}` : ""}`; // recherche, alerte, « À compléter » et hausse sont reportés par le lien (adresse affichée)
  };
  // L'export suit le filtre AFFICHÉ (recherche, alerte, « À compléter », hausse) : le menu relit l'adresse en direct.
  const exporter = <ExportInventaire domaine={domaine} />;

  return (
    <div className="space-y-3 lg:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-lg font-semibold sm:text-2xl">Inventaire</h1>
          <PilulesDomaine actif={domaine ?? ""} pilule={(d, p) => (
            <LienGardantTaille doux={false} garder={["q", "alerte", "manque", "hausse"]} href={lienDomaine(d.cle)} className={p.className}>{p.children}</LienGardantTaille>
          )} />
        </div>
        <div className="flex flex-wrap items-center gap-2 max-lg:hidden">
          <span className="rounded-md border bg-muted/40 px-2.5 py-1 text-sm"><span className="text-muted-foreground">Valeur du stock&nbsp;: </span><span className="font-semibold tabular-nums">{rows.some((r) => r.valeurApprox) ? "≈ " : ""}{usd(rows.reduce((t, r) => t + (r.valeurUSD !== undefined ? r.valeurUSD ?? 0 : (Number(r.prix) || 0) * (Number(r.quantite) || 0)), 0))}{(() => { const n = rows.filter((r) => r.devisePrix === "CDF" && r.prixCDF && r.valeurUSD === null).length; return n ? ` (hors ${n} en FC : taux non défini)` : ""; })()}</span></span>
          <span className="mr-1 text-sm text-muted-foreground">{rows.length} article(s)</span>
          {exporter}
        </div>
      </div>

      <CatalogueTable articles={rows} categories={categories} fournisseurs={fournisseurs} lockedDomaine={domaine} initialQ={q} initialAlerte={alerte} initialManque={manque} initialHausse={hausse} pageInit={pageInit} parInit={parInit} actionsPlus={exporter} estDirection={estDirection} />
    </div>
  );
}
