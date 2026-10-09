import { TelechargerLien } from "@/components/telecharger-lien";

export type DomaineFiche = "NOURRITURE" | "BOISSON" | "AUTRE";

/** Les trois fiches vierges, dans l'ordre des pilules de l'Inventaire. `label` : le nom du domaine à l'écran. */
export const FICHES_VIERGES: { domaine: DomaineFiche; label: string }[] = [
  { domaine: "NOURRITURE", label: "Nourriture" },
  { domaine: "BOISSON", label: "Boissons" },
  { domaine: "AUTRE", label: "Autre" },
];

/** Adresse de la fiche (Excel, générée à la demande) d'un domaine : la route filtre sur les articles actifs, comme l'écran. */
export const ficheHref = (domaine: DomaineFiche) => `/stock/reconciliation/fiche/excel?domaine=${domaine}`;

const articlesDe = (n: number) => `${n.toLocaleString("fr-FR")} article${n > 1 ? "s" : ""}`;

/**
 * Bloc « Imprimer une fiche de comptage vierge », en tête de la Réconciliation : une carte par domaine,
 * avec le nombre d'articles qu'elle contient et son téléchargement. La fiche n'existe qu'en Excel
 * (génération instantanée : un PDF serveur saturait Render sur des centaines d'articles) ; elle s'imprime
 * depuis le classeur. Le fichier passe par `TelechargerLien` : l'application ne quitte jamais son écran.
 * Ce bloc ne dépend pas des pilules de domaine du tableau : il liste toujours les trois fiches.
 */
export function FichesVierges({ nombres }: { nombres: Record<DomaineFiche, number> }) {
  return (
    <section aria-labelledby="titre-fiches-vierges" data-fiches-vierges="" className="rounded-xl border bg-card p-3 sm:p-4">
      <h2 id="titre-fiches-vierges" className="text-base font-semibold">Imprimer une fiche de comptage vierge</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Un classeur Excel par domaine, articles groupés par catégorie, avec les colonnes Physique et Écart à remplir à la main.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {FICHES_VIERGES.map((f) => (
          <li key={f.domaine} className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
            <div className="min-w-0">
              <p className="font-medium">Fiche {f.label}</p>
              <p className="text-xs tabular-nums text-muted-foreground">{articlesDe(nombres[f.domaine])}</p>
            </div>
            <TelechargerLien
              href={ficheHref(f.domaine)}
              title={`Télécharger la fiche de comptage vierge ${f.label} (Excel)`}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Excel<span className="sr-only"> — fiche vierge {f.label}</span>
            </TelechargerLien>
          </li>
        ))}
      </ul>
    </section>
  );
}
