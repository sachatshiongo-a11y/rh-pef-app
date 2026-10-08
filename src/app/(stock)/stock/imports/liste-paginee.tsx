"use client";

import type { ReactNode } from "react";
import { Pagination, usePagination } from "@/components/pagination";

/**
 * Liste d'un aperçu d'import, paginée (50 / 100 / Tout) : avant le 2026-10-08, ces listes s'arrêtaient en
 * silence à 50 ou 200 lignes. La page reste en état local (un aperçu vient d'un fichier : il n'existe plus
 * au rechargement, une adresse avec ?page= n'aurait rien à retrouver).
 */
export function ListePaginee<T>({ items, ligne, libelle, className = "mt-1 list-disc pl-5" }: {
  items: readonly T[];
  ligne: (item: T, index: number) => ReactNode;
  libelle: string;
  className?: string;
}) {
  const p = usePagination({ total: items.length, cleFiltre: String(items.length), synchroUrl: false });
  return (
    <>
      <ul className={className}>{items.slice(p.debut, p.fin).map((it, i) => ligne(it, p.debut + i))}</ul>
      <Pagination className="mt-2" total={items.length} page={p.page} par={p.par} onChange={p.aller} libelle={libelle} defiler={false} />
    </>
  );
}
