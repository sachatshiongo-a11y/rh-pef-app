import type { ReactNode } from "react";

/** Accordéon mensuel réutilisable (même présentation que les historiques : liste d'achat, légumes, mouvements). */
export function MoisAccordeon({ titre, compteur, resume, defaultOpen, children }: {
  titre: string; compteur: string; resume?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-muted/50 px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
          <span className="capitalize">{titre}</span> <span className="font-normal text-muted-foreground">· {compteur}</span>
        </span>
        {resume != null && <span className="shrink-0 font-normal text-muted-foreground">{resume}</span>}
      </summary>
      {children}
    </details>
  );
}
