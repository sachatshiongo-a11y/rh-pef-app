import { TelechargerLien } from "@/components/telecharger-lien";

export type DomaineFiche = "NOURRITURE" | "BOISSON" | "AUTRE";

/** Les trois fiches vierges, dans l'ordre des pilules de l'Inventaire. `label` : le nom du domaine à l'écran. */
export const FICHES_VIERGES: { domaine: DomaineFiche; label: string }[] = [
  { domaine: "NOURRITURE", label: "Nourriture" },
  { domaine: "BOISSON", label: "Boissons" },
  { domaine: "AUTRE", label: "Autre" },
];

export type FormatFiche = "pdf" | "excel";

/** Adresse de la fiche d'un domaine, dans le format voulu : les deux routes lisent les mêmes articles actifs, comme l'écran. */
export const ficheHref = (domaine: DomaineFiche, format: FormatFiche = "excel") => `/stock/reconciliation/fiche/${format}?domaine=${domaine}`;
const FORMATS: { format: FormatFiche; label: string }[] = [{ format: "pdf", label: "PDF" }, { format: "excel", label: "Excel" }];

const articlesDe = (n: number) => `${n.toLocaleString("fr-FR")} article${n > 1 ? "s" : ""}`;

/**
 * Bloc « Imprimer une fiche de comptage vierge », en tête de la Réconciliation : une carte par domaine,
 * avec le nombre d'articles qu'elle contient et ses deux téléchargements : PDF (A4, à imprimer tel quel) et Excel
 * (à retoucher avant d'imprimer). Même contenu dans les deux. Chaque fichier passe par `TelechargerLien` :
 * l'application ne quitte jamais son écran.
 * Ce bloc ne dépend pas des pilules de domaine du tableau : il liste toujours les trois fiches.
 */
export function FichesVierges({ nombres }: { nombres: Record<DomaineFiche, number> }) {
  return (
    <section aria-labelledby="titre-fiches-vierges" data-fiches-vierges="" className="rounded-xl border bg-card p-3 sm:p-4">
      <h2 id="titre-fiches-vierges" className="text-base font-semibold">Imprimer une fiche de comptage vierge</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Une fiche par domaine, en PDF ou en Excel : colonnes Physique et Écart à remplir à la main.
      </p>
      {/* Trois cartes côte à côte, même sur téléphone (empilées elles repoussaient le tableau hors de l'écran). */}
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {FICHES_VIERGES.map((f) => (
          <li key={f.domaine} className="flex flex-col justify-between gap-2 rounded-lg border bg-background p-2.5 sm:p-3 xl:flex-row xl:items-center xl:gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium"><span className="max-sm:hidden">Fiche </span>{f.label}</p>
              <p className="text-xs tabular-nums text-muted-foreground">{articlesDe(nombres[f.domaine])}</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {FORMATS.map((x) => (
                <TelechargerLien
                  key={x.format}
                  href={ficheHref(f.domaine, x.format)}
                  title={`Télécharger la fiche de comptage vierge ${f.label} (${x.label})`}
                  className="inline-flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 xl:flex-none"
                >
                  {x.label}<span className="sr-only"> — fiche vierge {f.label}</span>
                </TelechargerLien>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
