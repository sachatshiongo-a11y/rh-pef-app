import type { ReactNode } from "react";

export type DomaineCle = "NOURRITURE" | "BOISSON" | "AUTRE";

/** Les pilules de domaine, dans l'ordre de l'Inventaire (clé vide = tous les domaines). */
export const DOMAINES_PILULES: { cle: DomaineCle | ""; label: string }[] = [
  { cle: "", label: "Tous" },
  { cle: "NOURRITURE", label: "Nourriture" },
  { cle: "BOISSON", label: "Boissons" },
  { cle: "AUTRE", label: "Autre" },
];

/** `?domaine=` brut → domaine (toute valeur inconnue = tous). */
export const lireDomaine = (v: string | null | undefined): DomaineCle | "" =>
  v === "NOURRITURE" || v === "BOISSON" || v === "AUTRE" ? v : "";

/**
 * Pilules de domaine « Tous · Nourriture · Boissons · Autre » — UNE seule présentation pour l'Inventaire
 * (pilules-liens, la page se recharge) et la Réconciliation (pilules-boutons, le comptage tapé reste en
 * place : voir ReconciliationForm). `pilule` rend la pilule NON active : c'est lui qui choisit le lien ou
 * le bouton ; il reçoit la classe commune et le contenu. `comptes` (facultatif) ajoute le nombre d'articles
 * de chaque domaine, la clé « » valant pour « Tous ».
 */
export function PilulesDomaine({ actif, comptes, pilule, className = "" }: {
  actif: DomaineCle | "";
  comptes?: Partial<Record<DomaineCle | "TOUS", number>>;
  pilule: (d: { cle: DomaineCle | ""; label: string }, p: { className: string; children: ReactNode }) => ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Domaine" data-pilules-domaine="" className={`flex overflow-hidden rounded-md border text-sm ${className}`}>
      {DOMAINES_PILULES.map((d) => {
        const n = comptes?.[d.cle || "TOUS"];
        // Avec un compteur : sous le nom sur téléphone (quatre pilules + chiffres ne tiennent pas sur une ligne), à côté dès `sm`.
        const contenu = n === undefined ? d.label : (
          <span className="flex flex-col items-center leading-tight sm:flex-row sm:gap-1">{d.label}<span className="text-xs tabular-nums opacity-70">{n.toLocaleString("fr-FR")}</span></span>
        );
        return d.cle === actif ? (
          <span key={d.label} aria-current="true" className="bg-primary px-2.5 py-1.5 font-medium text-primary-foreground lg:px-3">{contenu}</span>
        ) : (
          <span key={d.label} className="contents">{pilule(d, { className: "px-2.5 py-1.5 hover:bg-accent lg:px-3", children: contenu })}</span>
        );
      })}
    </div>
  );
}
