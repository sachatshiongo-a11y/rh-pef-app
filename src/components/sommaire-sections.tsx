"use client";

import { useEffect, useState, type ReactNode } from "react";
import { OngletsDefilants } from "@/components/onglets-defilants";

/**
 * Sommaire d'une LONGUE page de saisie (fiche employé…) : les sections en onglets (`OngletsDefilants`,
 * mêmes onglets que partout) qui mènent à leur ancre, et l'onglet de la section lue s'allume au
 * défilement. Barre collée SOUS l'en-tête de la coquille sur téléphone (`colle-sous-entete`), fond
 * plein, sans flou (piège PWA iOS). `children` : action à garder sous la main (« Enregistrer »).
 *
 * Les sections restent toutes dans la page (pas d'onglets qui masquent) : un champ obligatoire
 * caché bloquerait l'envoi sans qu'on le voie, et tout le formulaire part en un seul envoi.
 * Chaque section porte `scroll-mt-…` pour ne pas finir sous cette barre.
 */
export function SommaireSections({ sections, libelle, children }: { sections: { id: string; label: string }[]; libelle: string; children?: ReactNode }) {
  const [actif, setActif] = useState(sections[0]?.id);
  const cle = sections.map((s) => s.id).join(",");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = cle.split(",");
    const visibles = new Set<string>();
    // Bande de lecture : entre 20 % et 35 % de la hauteur de l'écran. La première section (dans
    // l'ordre de la page) qui la traverse est « la section lue ».
    const obs = new IntersectionObserver(
      (entrees) => {
        for (const e of entrees) {
          if (e.isIntersecting) visibles.add(e.target.id);
          else visibles.delete(e.target.id);
        }
        const premiere = ids.find((id) => visibles.has(id));
        if (premiere) setActif(premiere);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [cle]);

  return (
    <div className="sticky colle-sous-entete z-20 -mx-4 flex items-center gap-2 border-b bg-background px-4 py-2 lg:mx-0 lg:rounded-lg lg:border lg:px-2">
      {/* overflow-hidden : la rangée d'onglets déborde de 1 rem de chaque côté (`OngletsDefilants`) ; ici elle
          défile dans sa case, sans passer sous le bouton voisin. */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <OngletsDefilants libelle={libelle} onglets={sections.map((s) => ({ href: `#${s.id}`, label: s.label, actif: s.id === actif }))} />
      </div>
      {children}
    </div>
  );
}

/** Classe d'une section ciblée par le sommaire : l'ancre s'arrête sous l'en-tête (téléphone) et sous la barre du sommaire. */
export const SECTION_ANCREE = "scroll-mt-[calc(var(--hauteur-entete,0px)+4.5rem)] lg:scroll-mt-20";
