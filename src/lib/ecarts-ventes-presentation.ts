import { formaterMontant, formaterNombre } from "@/lib/montant";
import { LIBELLE_ECART_INCONNU, type EcartPeriode } from "@/lib/stock-restaurant";
import type { EcartsVentes, LigneEcart, ValeurEcart } from "@/lib/ecarts-ventes";

// Mise en forme du contrôle « Écarts ventes / consommation », partagée par l'écran et ses exports
// Excel / PDF. Aucun calcul : « — » pour l'inconnu, jamais 0.

const jjmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const num = (v: string) => Math.round(Number(v) * 1000) / 1000;

/** Quantité lisible (3 décimales au plus) ; `avecSigne` : « +0,571 » / « −0,2 » pour un écart. */
export function texteQuantiteEcart(v: string, avecSigne = false): string {
  const n = num(v);
  const base = formaterNombre(Math.abs(n), { maximumFractionDigits: 3 });
  if (!avecSigne || n === 0) return n < 0 && !avecSigne ? `-${base}` : base;
  return `${n > 0 ? "+" : "−"}${base}`;
}

/** Valeur signée dans SA devise de saisie : « +20,00 $ », « ≈ −98 000 FC ». */
export function texteValeurEcart(v: ValeurEcart): string {
  const n = Number(v.montant);
  const signe = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${v.approx ? "≈ " : ""}${signe}${formaterMontant(Math.abs(n), v.devise)}`;
}

export const texteTotalDevise = (montant: string, devise: "USD" | "CDF") => texteValeurEcart({ devise, montant, approx: false });

/** « du 04/10 au 11/10 » : la fenêtre RÉELLEMENT comparée (entre deux comptages). */
export const texteFenetre = (p: Extract<EcartPeriode, { etat: "CONNUE" }>) => `du ${jjmm(p.de)} au ${jjmm(p.a)}`;

export const texteInconnu = (p: Extract<EcartPeriode, { etat: "INCONNUE" }>) => LIBELLE_ECART_INCONNU[p.raison];

export const NOM_ESPACE = { CUISINE: "Cuisine", BAR: "Bar" } as const;

/** En-têtes et lignes d'export (Excel / PDF) : une section par espace, totaux nets par devise. */
export const ENTETE_EXPORT_ECARTS = ["Article", "Unité", "Comparé", "Réel", "Théorique", "Écart", "Valeur de l'écart", "Devise"];

export function lignesExportEcarts(r: EcartsVentes, espaces: readonly ("CUISINE" | "BAR")[]): { lignes: string[][]; sectionRows: number[] } {
  const lignes: string[][] = [];
  const sectionRows: number[] = [];
  const ligne = (l: LigneEcart) => {
    const p = l.periode;
    if (p.etat !== "CONNUE") return [l.designation, l.unite ?? "", "—", "—", "—", "—", "—", texteInconnu(p)];
    return [
      l.designation, l.unite ?? "", texteFenetre(p), texteQuantiteEcart(p.reelle), texteQuantiteEcart(p.theorique), texteQuantiteEcart(p.ecart, true),
      l.valeur ? texteValeurEcart(l.valeur) : "—", l.valeur ? l.valeur.devise : "sans prix",
    ];
  };
  for (const esp of espaces) {
    if (r[esp].length === 0) continue;
    sectionRows.push(lignes.length);
    lignes.push([`${NOM_ESPACE[esp]} — écart = réel − théorique (positif : consommé en plus de ce que les ventes expliquent)`]);
    for (const l of r[esp]) lignes.push(ligne(l));
    for (const devise of ["USD", "CDF"] as const) {
      const t = r.totaux[esp][devise];
      if (t !== undefined) lignes.push([`Total net ${NOM_ESPACE[esp]}`, "", "", "", "", "", texteTotalDevise(t, devise), devise]);
    }
  }
  return { lignes, sectionRows };
}
