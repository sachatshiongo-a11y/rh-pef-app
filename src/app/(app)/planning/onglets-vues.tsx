"use client";

import { OngletsDefilants } from "@/components/onglets-defilants";

/** Vues du planning (Semaine / Mois / Modèle hebdo / Écart) — le segment commun des vues, sous le titre
 *  (avant : une liste déroulante dans la barre d'actions). Conserve la période affichée. */
export function OngletsVues({
  vue,
  semaineHref,
  moisHref,
  ecartHref = "/planning?vue=ecart",
}: {
  vue: string;
  semaineHref: string;
  moisHref: string;
  ecartHref?: string;
}) {
  return (
    <OngletsDefilants
      libelle="Vues du planning"
      onglets={[
        { href: semaineHref, label: "Semaine", actif: vue === "semaine" },
        { href: moisHref, label: "Mois", actif: vue === "mois" },
        { href: "/planning?vue=modele", label: "Modèle hebdo", actif: vue === "modele" },
        { href: ecartHref, label: "Écart prévu/réalisé", actif: vue === "ecart" },
      ]}
    />
  );
}
