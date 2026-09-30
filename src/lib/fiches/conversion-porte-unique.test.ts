import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// GARDE-FOU DE SOURCE — une quantité ne se ramène à l'unité de stock d'un ARTICLE que par
// `facteurVersArticle` (src/lib/fiches/conversion.ts). Avant la contenance (2026-09-30), le coût
// et la disponibilité recopiaient chacun « facteur(), puis poids d'emballage » : un troisième
// appelant qui recopierait l'ancienne recette ignorerait la contenance d'une bouteille et
// déclarerait « inconvertible » (ou pire, compterait autrement) ce que le coût sait valoriser.
//
// Règles, sur tout src/ hors tests et hors conversion.ts :
//  1. `poidsEmballage(` n'est appelé nulle part (l'emballage est une conversion d'article) ;
//  2. aucun `facteur(…)` n'a pour cible l'unité d'un article (`article.unite`, `uniteArticle`,
//     `uniteCatalogue`, `a.unite`…) ;
//  3. le coût et la disponibilité passent bien par `facteurVersArticle(`.

const RACINE = join(__dirname, "..", "..");
const CONVERSION = "lib/fiches/conversion.ts";

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((n) => {
    const p = join(dossier, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n.startsWith(".") ? [] : fichiers(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const sources = fichiers(RACINE).map((p) => ({ rel: relative(RACINE, p).replace(/\\/g, "/"), code: readFileSync(p, "utf-8") })).filter((f) => f.rel !== CONVERSION);

/** Appels `facteur(a, b)` dont la cible `b` désigne l'unité d'un article. */
const CIBLE_ARTICLE = /\bfacteur\(\s*[^,()]+,\s*([^)]*(?:article|uniteArticle|uniteCatalogue|\b[a-z]\.unite\b)[^)]*)\)/g;

describe("conversion vers l'unité d'un article : une seule porte (facteurVersArticle)", () => {
  it("règle 1 — poidsEmballage n'est appelé qu'à l'intérieur de conversion.ts", () => {
    expect(sources.filter((f) => /\bpoidsEmballage\(/.test(f.code)).map((f) => f.rel)).toEqual([]);
  });

  it("règle 2 — aucun facteur(…) vers l'unité d'un article hors de la porte", () => {
    const fautifs = sources.flatMap((f) => [...f.code.matchAll(CIBLE_ARTICLE)].map((m) => `${f.rel} : ${m[0]}`));
    expect(fautifs).toEqual([]);
  });

  it("règle 3 — le coût et la disponibilité passent par facteurVersArticle", () => {
    for (const rel of ["lib/fiches/cout.ts", "lib/fiches/disponibilite.ts", "lib/fiches/classeur-bar.ts"]) {
      expect([rel, sources.find((f) => f.rel === rel)!.code.includes("facteurVersArticle(")]).toEqual([rel, true]);
    }
  });

  it("le motif de la règle 2 attrape bien l'ancienne recette (contrôle du garde-fou lui-même)", () => {
    const vieux = ["const direct = facteur(uniteConsommee, article.unite);", "const f = facteur(uniteSource, uniteArticle);", "facteur(r.unite, a.unite)"];
    for (const v of vieux) expect([v, [...v.matchAll(CIBLE_ARTICLE)].length]).toEqual([v, 1]);
    for (const ok of ['facteur(unite, "g")', "facteur(uniteConsommee, rendement)", "facteur(u, cible)"]) expect([ok, [...ok.matchAll(CIBLE_ARTICLE)].length]).toEqual([ok, 0]);
  });
});
