// GARDE-FOU « TABLEAUX NORMAUX » (décision de la Direction, 2026-10-08 : « tous les tableaux incrustés
// sur les écrans peuvent juste devenir des tableaux normaux ? »).
//
// Le défaut : un tableau enfermé dans une boîte à défilement interne (`max-h-[70vh] overflow-auto`) —
// deux barres de défilement imbriquées (la page, puis le tableau), un défilement qui « s'accroche », et
// sur téléphone un tableau dont on ne sort plus. La règle : c'est la PAGE qui défile, le tableau prend sa
// hauteur naturelle ; son en-tête de colonnes se colle au défilement de la page (`en-tete-collante`,
// sous la barre d'actions groupées). Seul le défilement HORIZONTAL d'un tableau trop large subsiste.
// Ce fichier fait échouer la suite si :
//   1. les classes `tableau-normal(-xl)` / `en-tete-collante(-xl)` ne sont plus compilées telles quelles ;
//   2. une classe combine une hauteur bornée (`max-h-…`) et un défilement vertical (`overflow-auto`,
//      `overflow-y-auto`…) hors des exceptions NOMMÉES ci-dessous (menus, tiroirs, panneaux — jamais un
//      tableau) ;
//   3. un fichier qui emploie un en-tête collant n'a pas, dans le même fichier, le conteneur sans zone
//      de défilement qui le rend effectif (un `overflow-x-auto` sur un ancêtre casse le `sticky` vertical).
// Ce qu'il ne couvre PAS : la largeur réelle (un tableau qui ne tient pas en `lg`/`xl` serait coupé par
// `overflow: clip`) — se vérifie à l'œil, aux deux largeurs.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const SRC = path.join(__dirname, "..");
const lire = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (/\.tsx$/.test(n) && !/\.test\.tsx$/.test(n)) out.push(p);
  }
  return out;
}
const tous = [...fichiers(path.join(SRC, "app")), ...fichiers(path.join(SRC, "components"))].map((p) => path.relative(SRC, p).split(path.sep).join("/"));

describe("tableaux normaux — les classes sont compilées telles quelles", () => {
  it("tableau-normal / tableau-normal-xl : `overflow: clip` dès lg / xl, défilement horizontal en deçà", async () => {
    const feuille = path.join(SRC, "app/globals.css");
    const res = await postcss([tailwind()]).process(readFileSync(feuille, "utf8"), { from: feuille });
    const css = res.css.replace(/\s+/g, " ");
    for (const [nom, seuil] of [["tableau-normal", "64rem"], ["tableau-normal-xl", "80rem"]] as const) {
      expect(css, nom).toMatch(new RegExp(`\\.${nom} \\{ overflow: clip; @media \\(width < ${seuil}\\) \\{ overflow-x: auto; overflow-y: hidden; \\} \\}`));
    }
  });

  it("en-tete-collante / en-tete-collante-xl : collant dès lg / xl, SOUS la barre d'actions (repli 0px)", async () => {
    const feuille = path.join(SRC, "app/globals.css");
    const res = await postcss([tailwind()]).process(readFileSync(feuille, "utf8"), { from: feuille });
    const css = res.css.replace(/\s+/g, " ");
    for (const [nom, seuil] of [["en-tete-collante", "64rem"], ["en-tete-collante-xl", "80rem"]] as const) {
      expect(css, nom).toMatch(new RegExp(`\\.${nom} \\{ @media \\(width >= ${seuil}\\) \\{ position: sticky; top: var\\(--hauteur-barre-actions, 0px\\); z-index: 20; \\} \\}`));
    }
  });
});

/** Segments de classes (chaînes entre guillemets, apostrophes ou accents graves) d'un source. */
function segments(src: string): string[] {
  return src.split(/["'`]/);
}
const HAUTEUR_BORNEE = /(?:^|\s)(?:[a-z-]+:)*max-h-/;
const DEFILE_EN_Y = /(?:^|\s)(?:[a-z-]+:)*overflow-(?:y-)?(?:auto|scroll)(?=\s|$)/;
/** Nombre de segments qui bornent la hauteur ET font défiler en vertical. */
function boitesADefilement(src: string): number {
  return segments(src).filter((s) => HAUTEUR_BORNEE.test(s) && DEFILE_EN_Y.test(s)).length;
}

/**
 * Les boîtes à défilement interne ADMISES : jamais un tableau — menus déroulants, fenêtres flottantes,
 * tiroirs, panneaux maître-détail collés à côté d'une visionneuse, sélecteurs d'une liste de choix.
 * Nombre d'occurrences par fichier ; la raison est écrite en face.
 */
const ADMISES: Record<string, { n: number; raison: string }> = {
  "app/(app)/employes/employee-form.tsx": { n: 1, raison: "aperçu latéral collé du formulaire (aside sticky, borné à l'écran)" },
  "app/(app)/planning/planning-semaine.tsx": { n: 1, raison: "menu flottant « Choisir un shift » (fixed, max-h-72) — la grille (hauteur bornée par `style` + ternaire) est À MIGRER en lot 2, branche presences-ecran" },
  "app/(app)/paie/page.tsx": { n: 1, raison: "menu déroulant des filtres (absolute, max-h-[70vh])" },
  "app/(app)/paie/bulletins-validation.tsx": { n: 1, raison: "liste de navigation des bulletins à côté de la visionneuse (panneau maître-détail collé, borné à l'écran)" },
  "app/espace/cloche-salarie.tsx": { n: 1, raison: "fenêtre de la cloche de notifications" },
  "app/(stock)/stock/_rapport/bouton-rapport.tsx": { n: 1, raison: "fenêtre flottante du rapport (fixed, max-h-[80vh])" },
  "app/(stock)/stock/imports/doublons-client.tsx": { n: 1, raison: "cases des imports à comparer (sélecteur de 3-4 lots, pas un tableau)" },
  "app/(stock)/stock/restaurant/choix-article.tsx": { n: 1, raison: "liste déroulante de recherche d'un article du catalogue" },
  "components/notification-bell.tsx": { n: 1, raison: "fenêtre de la cloche de notifications" },
  // À MIGRER — fichiers touchés par des branches en cours au moment du lot 1 ; cette rubrique doit se vider.
  "app/(app)/planning/modele-grid.tsx": { n: 2, raison: "À MIGRER (lot 2, branche presences-ecran) : la grille + le menu flottant « Choisir un shift » (admis)" },
  "app/(app)/presences/import-pointage.tsx": { n: 2, raison: "À MIGRER (lot 2, branche presences-ecran)" },
  "app/(app)/presences/temps-grid.tsx": { n: 1, raison: "À MIGRER (lot 2, branche presences-ecran)" },
  "app/(stock)/stock/catalogue/catalogue-table.tsx": { n: 1, raison: "À MIGRER (lot 2, branche francs-prix-factures)" },
  "app/(stock)/stock/commandes/nouveau/nouveau-client.tsx": { n: 1, raison: "À MIGRER (lot 2, branche francs-prix-factures)" },
  "app/(stock)/stock/factures/[id]/page.tsx": { n: 2, raison: "À MIGRER (lot 2, branche francs-prix-factures)" },
  "app/(stock)/stock/factures/nouveau/nouveau-client.tsx": { n: 1, raison: "À MIGRER (lot 2, branche francs-prix-factures)" },
  "app/(stock)/stock/factures/page.tsx": { n: 1, raison: "À MIGRER (lot 2, branche francs-prix-factures)" },
  "app/(stock)/stock/fournisseurs/[id]/page.tsx": { n: 1, raison: "À MIGRER (lot 2, branche francs-prix-factures)" },
};

describe("aucun tableau dans une boîte à hauteur bornée qui défile", () => {
  it("les seules boîtes `max-h-… overflow-auto` sont les exceptions nommées (menus, fenêtres, tiroirs)", () => {
    const trouves = Object.fromEntries(tous.map((f) => [f, boitesADefilement(lire(f))]).filter(([, n]) => (n as number) > 0));
    expect(trouves).toEqual(Object.fromEntries(Object.entries(ADMISES).map(([f, v]) => [f, v.n])));
  });

  it("le détecteur reconnaît les formes fautives (témoin)", () => {
    expect(boitesADefilement(`<div className="max-h-[70vh] overflow-auto rounded-lg border">`)).toBe(1);
    expect(boitesADefilement(`<div className="hidden max-h-[74vh] overflow-auto rounded-2xl lg:block">`)).toBe(1);
    expect(boitesADefilement(`<ul className="max-h-64 divide-y overflow-y-auto">`)).toBe(1);
    expect(boitesADefilement(`<div className="lg:max-h-[82vh] lg:overflow-y-auto">`)).toBe(1);
    expect(boitesADefilement(`<div className="overflow-x-auto rounded-lg border">`)).toBe(0);
    expect(boitesADefilement(`<div className="tableau-normal rounded-lg border">`)).toBe(0);
  });

  it("une hauteur bornée posée par `style` sur un conteneur à défilement ne contourne pas la règle", () => {
    // `style={{ maxHeight }}` + `overflow-auto` : le détecteur ci-dessus ne le voit pas dans les classes.
    const fautifs = tous.filter((f) => {
      const src = lire(f);
      return /style=\{[^}]*maxHeight/.test(src) && /(?:<table|role="(?:table|grid)")/.test(src) && !(f in ADMISES);
    });
    expect(fautifs).toEqual([]);
  });
});

describe("un en-tête collant a son conteneur sans zone de défilement", () => {
  /** Le fichier emploie la classe dans une vraie chaîne de classes (pas dans un commentaire qui la cite seule). */
  const emploie = (src: string, jeton: string) => segments(src).some((s) => s.trim().includes(" ") && s.split(/\s+/).includes(jeton));
  const avecCollant = tous.filter((f) => emploie(lire(f), "en-tete-collante"));
  const avecCollantXl = tous.filter((f) => emploie(lire(f), "en-tete-collante-xl"));

  it("les écrans migrés sont bien repérés (plancher anti-silence)", () => {
    expect(avecCollant.length).toBeGreaterThan(3);
    expect(avecCollantXl.length).toBeGreaterThan(5);
  });

  it.each(avecCollant)("%s : `en-tete-collante` va avec `tableau-normal`", (f) => {
    expect(lire(f)).toMatch(/\btableau-normal\b(?!-xl)/);
  });

  it.each(avecCollantXl)("%s : `en-tete-collante-xl` va avec `tableau-normal-xl`", (f) => {
    expect(lire(f)).toMatch(/\btableau-normal-xl\b/);
  });

  it("un tableau-normal n'est jamais combiné à un défilement vertical ou à une hauteur bornée", () => {
    for (const f of tous) {
      for (const s of segments(lire(f))) {
        if (!/\btableau-normal(?:-xl)?\b/.test(s)) continue;
        expect(s, `${f} : « ${s} »`).not.toMatch(HAUTEUR_BORNEE);
        expect(s, `${f} : « ${s} »`).not.toMatch(DEFILE_EN_Y);
        expect(s, `${f} : « ${s} » — un overflow-x-auto casse le collant`).not.toMatch(/(?:^|\s)overflow-x-auto(?=\s|$)/);
      }
    }
  });
});
