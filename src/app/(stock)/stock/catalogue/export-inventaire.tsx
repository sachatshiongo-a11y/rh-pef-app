"use client";

import { useSearchParams } from "next/navigation";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { lireFiltreInventaire, paramsFiltreInventaire } from "@/lib/filtre-inventaire";

/**
 * Menu « Exporter » de l'Inventaire : le PDF et l'Excel sortent EXACTEMENT l'ensemble filtré affiché — domaine,
 * recherche, alerte, « À compléter », hausse de prix — tout, jamais la page (2026-10-08). Le tableau écrit son
 * filtre dans l'adresse à chaque changement (`history.replaceState`, que `useSearchParams` suit) : les liens
 * se recalculent donc sans rechargement.
 */
export function ExportInventaire({ domaine }: { domaine?: string }) {
  const sp = useSearchParams();
  const p = paramsFiltreInventaire(lireFiltreInventaire((k) => sp?.get(k)));
  if (domaine) p.set("domaine", domaine);
  const qs = p.toString() ? `?${p}` : "";
  return <BoutonRapport pdfHref={`/stock/catalogue/pdf${qs}`} excelHref={`/stock/catalogue/export${qs}`} />;
}
