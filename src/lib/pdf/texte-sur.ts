import { normaliserEspaces } from "@/lib/montant";

/**
 * Texte SAISI (nom de fiche, technique de préparation, libellé d'article…) rendu sûr pour la police
 * des PDF. Optima n'a ni l'espace fine insécable (U+202F), ni les flèches, ni le signe moins
 * typographique, ni les pictogrammes : un seul de ces caractères fait basculer react-pdf sur une
 * police standard qui dessine un glyphe faux (barre, carré, blanc). Un texte recopié d'un classeur
 * (« Verser → shaker », « ⚠ glace pilée ») en porte volontiers. On remplace ce qui a un équivalent
 * lisible, on retire le reste — jamais on ne laisse la police deviner.
 */
export function texteSurPdf(s: string): string {
  return normaliserEspaces(s)
    .replace(/[→⇒➔➜➝➞⟶]/g, "->")
    .replace(/[←⇐⟵]/g, "<-")
    .replace(/↑/g, "+")
    .replace(/↓/g, "-")
    .replace(/[−‑‒]/g, "-")
    .replace(/[\u200B-\u200D\u2060\uFE0F]/g, "")
    .replace(/[⚠✓✔✗✘★☆]/g, "")
    // Pictogrammes et émojis — sauf ©, ® et ™, que la police possède (une marque de spiritueux).
    .replace(/\p{Extended_Pictographic}/gu, (c) => ("©®™".includes(c) ? c : ""))
    .replace(/[ \t]{2,}/g, " ");
}
