"use client";

import { useRouter } from "next/navigation";

/** Sélecteur de vue du planning (Semaine / Mois / Modèle hebdo / Écart) en liste déroulante compacte —
 *  remplace les onglets pour dégager la barre d'en-tête. Conserve la période affichée. */
export function VueSelect({
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
  const router = useRouter();
  const options = [
    { v: "semaine", label: "Vue : Semaine", href: semaineHref },
    { v: "mois", label: "Vue : Mois", href: moisHref },
    { v: "modele", label: "Vue : Modèle hebdo", href: "/planning?vue=modele" },
    { v: "ecart", label: "Vue : Écart prévu/réalisé", href: ecartHref },
  ];
  return (
    <select
      value={vue}
      onChange={(e) => {
        const o = options.find((x) => x.v === e.target.value);
        if (o) router.push(o.href);
      }}
      aria-label="Choisir la vue du planning"
      className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>{o.label}</option>
      ))}
    </select>
  );
}
