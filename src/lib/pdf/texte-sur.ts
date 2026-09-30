/**
 * Texte SAISI (nom de fiche, technique de préparation, libellé d'article…) rendu sûr pour la police
 * des PDF. Un seul caractère absent d'Optima fait basculer react-pdf sur une police standard qui
 * dessine un glyphe faux (barre, carré, blanc) — l'espace fine insécable des montants « barrés »,
 * mais aussi « № », « ² », « ① », les flèches, les pictogrammes qu'un classeur recopié porte
 * volontiers. On ne laisse JAMAIS la police deviner :
 *
 *  1. forme composée (NFC) : « é » en deux morceaux (e + accent combinant) redevient un caractère ;
 *  2. toute espace (`\p{Zs}` : insécable, fine, cadratin…) devient une espace ordinaire ;
 *  3. équivalents lisibles choisis : flèches → « -> », signe moins → « - » (règle maison) ;
 *  4. chaque caractère restant est comparé à la couverture RÉELLE d'Optima (ci-dessous) : présent,
 *     il reste ; absent, on essaie sa forme de compatibilité (NFKC : « № » → « No », « ² » → « 2 »,
 *     « ① » → « 1 ») si elle-même est couverte ; sinon il est retiré.
 */

/**
 * Caractères présents dans les TROIS fichiers Optima embarqués (normal, gras, italique), relevés
 * dans leur table `cmap` — `texte-sur.test.ts` relit les fichiers et échoue si cette liste diverge
 * de la police. Plages hexadécimales. Volontairement exclus de la table : caractères de contrôle,
 * accents combinants isolés (le NFC les a déjà recomposés), zone privée (logo Apple U+F8FF), U+FFFF.
 */
const COUVERTURE_OPTIMA = [
  "20-7e", "a0-ac", "ae-ff", "131", "141-142", "152-153", "160-161", "178", "17d-17e", "192",
  "2c6-2c7", "2d8-2dd", "2013-2014", "2018-201a", "201c-201e", "2020-2022", "2026", "2030",
  "2039-203a", "2044", "20ac", "2122", "2126", "2202", "2206", "220f", "2211-2212", "221a", "221e",
  "222b", "2248", "2260", "2264-2265", "25ca", "fb01-fb02",
];
const PLAGES: [number, number][] = COUVERTURE_OPTIMA.map((p) => {
  const [a, b = a] = p.split("-");
  return [parseInt(a, 16), parseInt(b, 16)];
});

/** Le caractère a-t-il un glyphe dans Optima ? (Retour à la ligne et tabulation : mise en page, pas glyphes.) */
export function dansOptima(c: string): boolean {
  if (c === "\n" || c === "\t") return true;
  const cp = c.codePointAt(0)!;
  return PLAGES.some(([a, b]) => cp >= a && cp <= b);
}

export function texteSurPdf(s: string): string {
  const pre = s
    .normalize("NFC")
    .replace(/\p{Zs}/gu, " ")
    .replace(/[→⇒➔➜➝➞⟶↦]/g, "->")
    .replace(/[←⇐⟵]/g, "<-")
    .replace(/↑/g, "+")
    .replace(/↓/g, "-")
    // Règle maison : jamais le signe moins typographique (ni ses cousins) dans un PDF.
    .replace(/[−‐‑‒]/g, "-");

  let sortie = "";
  for (const c of pre) {
    if (dansOptima(c)) { sortie += c; continue; }
    // (« ⁻ » exposant se décompose en « − » : la règle du signe moins s'applique aussi ici.)
    const compat = c.normalize("NFKC").replace(/\p{Zs}/gu, " ").replace(/[−‐‑‒]/g, "-");
    if (compat !== c && [...compat].every(dansOptima)) sortie += compat;
    // sinon : retiré (pictogramme, émoji, cerclé sans équivalent…)
  }
  return sortie.replace(/[ \t]{2,}/g, " ");
}
