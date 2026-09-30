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

/** Position de l'argument « article du catalogue » de chaque fonction qui convertit vers lui. */
const ARG_ARTICLE: Record<string, number> = { convertirVersUniteArticle: 2, convertirDepuisUniteArticle: 1, etatRattachementLivraison: 1, alerteUnite: 1 };

/** Arguments de premier niveau de l'appel qui commence à `debut` (parenthèse ouvrante incluse). */
function argumentsDe(code: string, debut: number): string[] {
  const args: string[] = [];
  let prof = 0, courant = "";
  for (let i = debut; i < code.length; i++) {
    const c = code[i]!;
    if ("([{".includes(c)) { prof++; if (prof === 1) continue; }
    if (")]}".includes(c)) { prof--; if (prof === 0) { args.push(courant.trim()); break; } }
    if (c === "," && prof === 1) { args.push(courant.trim()); courant = ""; continue; }
    courant += c;
  }
  return args;
}

/** Appels dont l'argument « article » est une chaîne d'unité (ou un objet réduit à `{ unite }`). */
function appelsFautifs(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\b(convertirVersUniteArticle|convertirDepuisUniteArticle|etatRattachementLivraison|alerteUnite)\(/g)) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index! - 20), m.index!))) continue; // la déclaration elle-même
    const arg = argumentsDe(code, m.index! + m[1]!.length)[ARG_ARTICLE[m[1]!]!] ?? "";
    const chaine = /^["'`]/.test(arg) || /\?\?\s*["'`]/.test(arg) || /(\.unite|uniteCatalogue|uniteArticle)$/.test(arg);
    const objetSansContenance = arg.startsWith("{") && /\bunite\b/.test(arg) && !/contenance/.test(arg);
    if (chaine || objetSansContenance) out.push(`${m[1]}(… ${arg} …)`);
  }
  return out;
}

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

  it("règle 4 — les conversions vers un article reçoivent l'ARTICLE (unité + contenance), jamais une simple unité", () => {
    const fautifs = sources.flatMap((f) => appelsFautifs(f.code).map((a) => `${f.rel} : ${a}`));
    expect(fautifs).toEqual([]);
  });

  it("le motif de la règle 4 attrape bien une chaîne d'unité ou un objet sans contenance (contrôle du garde-fou lui-même)", () => {
    const fautifs = [
      'convertirVersUniteArticle(q, r.unite ?? "", r.uniteCatalogue ?? "")',
      'convertirDepuisUniteArticle(1, uniteCatalogue ?? "", r.unite ?? "")',
      'convertirVersUniteArticle(1, "cl", { unite: a.unite })',
      'etatRattachementLivraison(a.id, a.unite, restos, a.domaine)',
      'alerteUnite(r.unite, a.unite)',
    ];
    for (const v of fautifs) expect([v, appelsFautifs(v).length]).toEqual([v, 1]);
    const bons = [
      'convertirVersUniteArticle(q, r.unite ?? "", articleCatalogue(r))',
      'convertirDepuisUniteArticle(l.quantite, articleCatalogue(l), u)',
      'etatRattachementLivraison(a.id, { unite: a.unite, contenance: c, contenanceUnite: u }, restos)',
      'versUniteArticle(q, ing.unite, article)',
    ];
    for (const v of bons) expect([v, appelsFautifs(v).length]).toEqual([v, 0]);
  });

  it("le motif de la règle 2 attrape bien l'ancienne recette (contrôle du garde-fou lui-même)", () => {
    const vieux = ["const direct = facteur(uniteConsommee, article.unite);", "const f = facteur(uniteSource, uniteArticle);", "facteur(r.unite, a.unite)"];
    for (const v of vieux) expect([v, [...v.matchAll(CIBLE_ARTICLE)].length]).toEqual([v, 1]);
    for (const ok of ['facteur(unite, "g")', "facteur(uniteConsommee, rendement)", "facteur(u, cible)"]) expect([ok, [...ok.matchAll(CIBLE_ARTICLE)].length]).toEqual([ok, 0]);
  });
});
