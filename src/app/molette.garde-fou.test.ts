// GARDE-FOU « LA MOLETTE TRAVERSE LES TABLEAUX » (signalement de la Direction, 2026-10-09, Inventaire en
// application de bureau Chrome sur Mac : « on doit pouvoir scroller la page avec la souris dans le tableau »).
//
// Le défaut, MESURÉ sous Chrome sur le vrai catalogue (150 articles, coquille Stock fidèle, molette à la
// souris au-dessus d'une cellule, d'un champ, d'une liste, d'une case) : la page ne bougeait pas
// (main.scrollTop 226 → 226) ; hors du tableau elle défilait (300 → 700). La cause : `overflow-x: auto` fait
// de la boîte un défileur vertical sans rien à défiler, et une règle globale posait
// `overscroll-behavior: contain` sur `.overflow-x-auto` — la molette y restait prisonnière au lieu de
// remonter à la page. Retirer `contain` de l'axe Y (on le garde sur X, pour le geste « page précédente » du
// trackpad) rend la molette à la page : 226 → 626 partout dans le tableau.
//
// Ce fichier fait échouer la suite si :
//   1. une règle CSS compilée qui vise `.overflow-x-auto` / `.tableau-normal(-xl)` retient l'axe Y
//      (`overscroll-behavior` ou `-y` à `contain` / `none`) ;
//   2. une classe combine `overflow-x-auto` / `tableau-normal(-xl)` et `overscroll-contain` / `-none` / `-y-…` ;
//   3. un écouteur `wheel` apparaît dans le code sans être déclaré ici (il pourrait avaler la molette).
// Ce qu'il ne couvre PAS : le comportement réel du navigateur — le banc Chrome (CDP) a servi à l'établir,
// il n'est pas rejoué par la suite (pas de navigateur dans vitest).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const SRC = path.join(__dirname, "..");

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (/\.(tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const tous = [...fichiers(path.join(SRC, "app")), ...fichiers(path.join(SRC, "components")), ...fichiers(path.join(SRC, "lib"))];

const DEFILEUR_HORIZONTAL = /\.(?:overflow-x-auto|overflow-x-scroll|tableau-normal(?:-xl)?)(?![\w-])/;
const RETIENT_Y = /^overscroll-behavior(?:-y|-block)?$/;

/** Déclarations `overscroll-behavior` qui retiennent l'axe Y d'un défileur horizontal, dans un CSS compilé. */
function reglesFautives(css: string): string[] {
  const fautives: string[] = [];
  postcss.parse(css).walkRules((regle) => {
    if (!regle.selectors.some((s) => DEFILEUR_HORIZONTAL.test(s))) return;
    regle.walkDecls((d) => {
      if (RETIENT_Y.test(d.prop) && /\b(?:contain|none)\b/.test(d.value)) fautives.push(`${regle.selector} { ${d.prop}: ${d.value} }`);
    });
  });
  return fautives;
}

const compile = async () => {
  const feuille = path.join(SRC, "app/globals.css");
  return (await postcss([tailwind()]).process(readFileSync(feuille, "utf8"), { from: feuille })).css;
};

describe("la molette traverse les tableaux larges", () => {
  it("aucune règle CSS compilée ne retient l'axe Y d'un défileur horizontal (.overflow-x-auto, .tableau-normal)", async () => {
    expect(reglesFautives(await compile())).toEqual([]);
  });

  it("l'axe X reste retenu (geste « page précédente » du trackpad) — la correction n'a pas tout retiré", async () => {
    const css = (await compile()).replace(/\s+/g, " ");
    expect(css).toMatch(/\.overflow-x-auto \{ overscroll-behavior-x: contain; \}/);
  });

  it("le détecteur reconnaît la forme fautive d'origine (témoin)", () => {
    expect(reglesFautives(".overflow-x-auto, .overflow-y-auto, .overflow-auto { overscroll-behavior: contain; }")).toHaveLength(1);
    expect(reglesFautives(".overflow-x-auto { overscroll-behavior-y: none; }")).toHaveLength(1);
    expect(reglesFautives(".tableau-normal { overscroll-behavior: contain; }")).toHaveLength(1);
    expect(reglesFautives(".overflow-x-auto { overscroll-behavior-x: contain; }")).toEqual([]);
    expect(reglesFautives(".overflow-y-auto, .overflow-auto { overscroll-behavior: contain; }")).toEqual([]);
  });

  it("aucune classe ne combine un défileur horizontal et `overscroll-contain` / `overscroll-none` / `overscroll-y-…`", () => {
    const fautifs: string[] = [];
    for (const f of tous.filter((p) => /\.tsx$/.test(p))) {
      for (const s of readFileSync(f, "utf8").split(/["'`]/)) {
        if (/(?:^|\s)(?:[a-z-]+:)*(?:overflow-x-auto|overflow-x-scroll|tableau-normal(?:-xl)?)(?=\s|$)/.test(s) && /(?:^|\s)(?:[a-z-]+:)*overscroll-(?:contain|none|y-contain|y-none)(?=\s|$)/.test(s)) {
          fautifs.push(`${path.relative(SRC, f)} : ${s.trim().slice(0, 100)}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("aucun écouteur `wheel` / `onWheel` n'est ajouté sans être déclaré (il pourrait avaler la molette)", () => {
    const ECOUTEURS_ADMIS: string[] = []; // aucun aujourd'hui
    const trouves = tous.filter((f) => /\.tsx?$/.test(f) && /(?:["'`]wheel["'`]|\bonWheel\b)/.test(readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    expect(trouves).toEqual(ECOUTEURS_ADMIS);
  });
});
