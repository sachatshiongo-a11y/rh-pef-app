// GARDE-FOU « ÉTATS VIDES SANS ÉMOJI » (plan d'ergonomie H10, 2026-10-12).
//
// Un écran sans élément dit « Aucune … » avec le composant commun `EtatVide` (cadre pointillé, icône
// discrète) et sans émoji : « Aucune alerte. Tout est à jour ✅ », « Aucune demande de congé en
// attente. 🎉 » et « Aucune sanction ni avertissement. ✔ » juraient avec le reste de l'application.
// Ce fichier fait échouer la suite si un texte « Aucun… / Rien… » porte encore un émoji ou une coche
// décorative. Il ne juge PAS le dessin (un `<p>` simple dans une ligne de tableau reste permis) ;
// les écrans qui ont leur propre boîte pointillée passent par `EtatVide`.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.join(__dirname, "..");
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const EMOJI = /[\u{1F300}-\u{1FAFF}✅✔✨❌⭐]/u;
const MOT_VIDE = /\b(Aucun|Aucune|Rien|Pas de)\b/;

describe("états vides — pas d'émoji", () => {
  const fichiers = [...sources(path.join(SRC, "app")), ...sources(path.join(SRC, "components"))];

  it("le garde-fou lit des fichiers", () => {
    expect(fichiers.length).toBeGreaterThan(300);
  });

  it("aucun texte « Aucun… / Rien… » ne porte d'émoji ni de coche décorative", () => {
    const fautifs: string[] = [];
    for (const f of fichiers) {
      readFileSync(f, "utf8").split("\n").forEach((ligne, i) => {
        const code = ligne.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (MOT_VIDE.test(ligne) && EMOJI.test(ligne)) fautifs.push(`${path.relative(SRC, f)}:${i + 1}`);
      });
    }
    expect(fautifs).toEqual([]);
  });

  it("l'état vide commun n'a pas d'émoji dans son dessin", () => {
    const src = readFileSync(path.join(SRC, "components/etat-vide.tsx"), "utf8");
    expect(src).not.toMatch(EMOJI);
  });
});
