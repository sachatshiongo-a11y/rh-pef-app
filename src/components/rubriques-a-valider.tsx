import type { ReactNode } from "react";
import { EtatVide } from "@/components/etat-vide";

/** Une rubrique d'un écran « À valider » : sa liste (avec ses actions groupées) et son nombre d'éléments. */
export type RubriqueAValider = {
  /** Ancre de la rubrique (`#id`) : les compteurs en tête et les liens d'autres écrans y sautent. */
  id: string;
  titre: string;
  nombre: number;
  contenu: ReactNode;
};

/**
 * Le corps des écrans « À valider » (RH et Stock) — un seul dessin (plan d'ergonomie, H4) :
 *   - en tête, un compteur par rubrique NON VIDE ; un toucher saute à la rubrique ;
 *   - ensuite seulement les rubriques non vides, titre en casse normale ;
 *   - les rubriques vides tiennent en UNE ligne, « Rien d'autre en attente : … » ;
 *   - rien du tout en attente : l'état vide commun.
 * Composant serveur : pas d'état, les listes sont celles de chaque écran.
 */
export function RubriquesAValider({ rubriques, videMessage = "Rien en attente : tout est à jour." }: {
  rubriques: RubriqueAValider[];
  videMessage?: string;
}) {
  const pleines = rubriques.filter((r) => r.nombre > 0);
  const vides = rubriques.filter((r) => r.nombre === 0);
  if (pleines.length === 0) return <EtatVide message={videMessage} />;
  return (
    <>
      <nav aria-label="Rubriques en attente" className="mb-6 flex flex-wrap gap-2 text-sm">
        {pleines.map((r) => (
          <a key={r.id} href={`#${r.id}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            {r.titre} <span className="font-semibold tabular-nums">{r.nombre}</span>
          </a>
        ))}
      </nav>
      {pleines.map((r) => (
        <section key={r.id} id={r.id} className="mb-8 scroll-mt-[calc(var(--hauteur-entete,0px)+0.75rem)]">
          <h2 className="mb-3 text-base font-semibold">{r.titre} ({r.nombre})</h2>
          {r.contenu}
        </section>
      ))}
      {vides.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Rien d&apos;autre en attente : {vides.map((r) => r.titre.charAt(0).toLowerCase() + r.titre.slice(1)).join(", ")}.
        </p>
      )}
    </>
  );
}
