// GARDE-FOU DE L'EN-TÊTE MOBILE (décision de la Direction, 2026-09-30 : « corrige partout »).
//
// Le défaut : sur téléphone, une barre collée en haut par une PAGE (barre d'actions groupées,
// sous-onglets…) passait DEVANT l'en-tête de la coquille (« ← », titre, cloche) au défilement — les
// deux étaient collés en haut, avec le même z-index. La règle unique (components/entete-mobile.ts) :
// la coquille pose `--hauteur-entete`, et toute barre collante de page se colle SOUS elle par la
// classe `colle-sous-entete`. Ce fichier fait échouer la suite si :
//   1. une coquille (tout `*-shell.tsx` sous src/app, énumérés sur le disque) ne pose pas la
//      variable ou refabrique son en-tête au lieu d'utiliser le socle commun ;
//   2. le socle perd ce qui le rend exact (hauteur imposée, `shrink-0`) ou son rang d'empilement
//      (au-dessus du contenu et de la barre du bas, sous le voile et le tiroir) ;
//   3. la classe `colle-sous-entete` n'est plus compilée telle quelle (haut = 0 sur ordinateur,
//      la variable sous `lg`) ;
//   4. une page recolle une barre par `sticky top-…` : seuls les en-têtes de tableau qui vivent
//      dans un conteneur à défilement PROPRE sont admis, et ils sont listés ci-dessous.
// Ce qu'il ne couvre PAS : le rendu (hauteurs réelles, encoche de l'iPhone) — se vérifie à l'œil.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { ENTETE_COLLANT, HAUTEUR_ENTETE, HAUTEUR_ENTETE_ESPACE } from "@/components/entete-mobile";

const SRC = path.join(__dirname, "..");
const lire = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
const FLOU = /\bbackdrop-(?:blur|saturate|brightness|contrast|grayscale|hue-rotate|invert|opacity|sepia)\b|backdropFilter/;

function fichiers(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...fichiers(p, ext));
    else if (ext.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const coquilles = () => fichiers(path.join(SRC, "app"), /-shell\.tsx$/).map((p) => path.relative(SRC, p)).sort();

/** z-index numérique d'une chaîne de classes (`z-20`, `z-[35]`), ou null. */
const zDe = (classes: string) => {
  const m = classes.match(/(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?=\s|$)/);
  return m ? Number(m[1] ?? m[2]) : null;
};

describe("en-tête mobile — chaque coquille pose la variable et utilise le socle commun", () => {
  it("les quatre coquilles connues sont bien énumérées (plancher anti-silence)", () => {
    for (const f of ["app/(app)/app-shell.tsx", "app/(stock)/stock-shell.tsx", "app/(exploitation)/exploitation-shell.tsx", "app/espace/espace-shell.tsx"]) {
      expect(coquilles()).toContain(f);
    }
  });

  it.each(coquilles())("%s : pose --hauteur-entete sur son conteneur et son en-tête est le socle", (f) => {
    const src = lire(f);
    expect(src, "import du socle").toMatch(/import \{[^}]*\bENTETE_COLLANT\b[^}]*\} from "@\/components\/entete-mobile";/);
    expect(src, "la variable est posée sur le conteneur de la coquille").toMatch(/\$\{HAUTEUR_ENTETE(?:_ESPACE)?\}/);
    expect(src, "l'en-tête utilise le socle").toMatch(/<header className=\{`\$\{ENTETE_COLLANT\}/);
    expect(src, "en-tête collant refabriqué à la main").not.toMatch(/<header[^>]*\bsticky\b/);
    expect(src, "hauteur d'en-tête recopiée en dur").not.toMatch(/safe-area-inset-top\)\)?\s*\+\s*\d/);
  });

  it("chaque valeur de hauteur pose bien la variable, avec l'encoche comptée une fois", () => {
    for (const v of [HAUTEUR_ENTETE, HAUTEUR_ENTETE_ESPACE]) {
      expect(v).toMatch(/^\[--hauteur-entete:calc\(max\(0\.5rem,env\(safe-area-inset-top\)\)_\+_[\d.]+rem\)\]$/);
    }
  });
});

describe("en-tête mobile — le socle", () => {
  it("hauteur IMPOSÉE par la variable, sans rétrécir, sans flou", () => {
    expect(ENTETE_COLLANT).toContain("h-[var(--hauteur-entete)]");
    // Sans `shrink-0`, dans un <main> flex en colonne, l'en-tête perd 1 px dès que la page est longue
    // et la barre collée dessous laisse une fente (mesuré au navigateur : 51 px pour 52 attendus).
    expect(ENTETE_COLLANT).toMatch(/(^|\s)shrink-0(\s|$)/);
    expect(ENTETE_COLLANT).toMatch(/(^|\s)sticky(\s|$)/);
    expect(ENTETE_COLLANT).toContain("env(safe-area-inset-top)");
    expect(ENTETE_COLLANT).not.toMatch(FLOU);
    expect(ENTETE_COLLANT, "fond translucide sur un élément collant (piège PWA iOS)").not.toMatch(/bg-[a-z-]+\/\d+/);
  });

  it("empilement : au-dessus du contenu et de la barre du bas, sous le voile et le tiroir", () => {
    const entete = zDe(ENTETE_COLLANT)!;
    const barreDuBas = zDe(lire("components/barre-du-bas.tsx").match(/className="(fixed inset-x-0 bottom-0[^"]*)"/)![1]);
    const voile = zDe(lire("components/tiroir-mobile.tsx").match(/data-voile-tiroir className="([^"]*)"/)![1]);
    const tiroir = zDe(lire("components/tiroir-mobile.tsx").match(/className=\{`(fixed inset-y-0 left-0[^`]*)/)![1]);
    const barreActions = zDe(lire("components/bulk-bar.tsx").match(/className="(sticky [^"]*)"/)![1]);
    expect(entete).not.toBeNull();
    expect(entete, "au-dessus de la barre du bas").toBeGreaterThan(barreDuBas!);
    expect(entete, "au-dessus de la barre d'actions").toBeGreaterThan(barreActions!);
    expect(entete, "sous le voile du tiroir").toBeLessThan(voile!);
    expect(voile, "le voile est sous le tiroir").toBeLessThan(tiroir!);
    // La barre d'actions est donc, elle aussi, sous le voile : jamais cliquable tiroir ouvert.
    expect(barreActions).toBeLessThan(voile!);
  });
});

describe("la classe colle-sous-entete", () => {
  it("compilée par la vraie chaîne PostCSS : top 0 partout, la variable sous `lg`, repli 0px", async () => {
    const feuille = path.join(SRC, "app/globals.css");
    const res = await postcss([tailwind()]).process(readFileSync(feuille, "utf8"), { from: feuille });
    const css = res.css.replace(/\s+/g, " ");
    // « .colle-sous-entete { top: 0; @media (width < 64rem) { top: var(--hauteur-entete, 0px); } } »
    expect(css).toMatch(/\.colle-sous-entete \{ top: 0; @media \(width < 64rem\) \{ top: var\(--hauteur-entete, 0px\); \} \}/);
  });

  it("BulkBar (et ses variantes maison) l'emploient, jamais un `top-0` brut", () => {
    const src = lire("components/bulk-bar.tsx");
    expect(src).toMatch(/className="sticky colle-sous-entete z-\d+ /);
    expect(src).not.toMatch(/sticky[^"]*\btop-/);
  });
});

/**
 * EXCEPTIONS au garde-fou « aucun `sticky top-…` dans le contenu des pages » : les en-têtes de
 * tableau (ou de grille) qui vivent dans un conteneur `overflow-auto` à hauteur bornée. Leur
 * `top-0` est celui de CE conteneur, qui défile seul : ils ne passent jamais sous l'en-tête de la
 * coquille (c'est le conteneur entier qui défile avec la page). Y appliquer le décalage de
 * l'en-tête les décalerait à tort DANS leur conteneur. Nombre d'occurrences par fichier : en
 * ajouter une fait échouer ce test — décider alors, consciemment, entre `colle-sous-entete`
 * (barre de page) et une nouvelle exception ici.
 */
const EXCEPTIONS: Record<string, number> = {
  "app/(app)/conges/calendrier.tsx": 1,
  "app/(app)/declarations/page.tsx": 1,
  "app/(app)/documents/page.tsx": 1, // <Thead> partagé, tous les onglets dans le même conteneur
  "app/(app)/employes/[id]/page.tsx": 2,
  "app/(app)/employes/page.tsx": 1,
  "app/(app)/heures-supp/weekly-breakdown-table.tsx": 1,
  "app/(app)/historique/[id]/page.tsx": 1,
  "app/(app)/paie/historique-paie.tsx": 1,
  "app/(app)/paie/paie-bulk.tsx": 1,
  "app/(app)/parametres/types-conges-admin.tsx": 1,
  "app/(app)/parametres/users-admin.tsx": 1,
  "app/(app)/planning/modele-grid.tsx": 1,
  "app/(app)/planning/planning-semaine.tsx": 1,
  "app/(app)/presences/import-pointage.tsx": 1,
  "app/(app)/presences/temps-grid.tsx": 1,
  "app/(app)/transport/_grille.tsx": 1,
  "app/(stock)/stock/archives/[id]/page.tsx": 1,
  "app/(stock)/stock/catalogue/catalogue-table.tsx": 1,
  "app/(stock)/stock/commandes/nouveau/nouveau-client.tsx": 1,
  "app/(stock)/stock/factures/[id]/page.tsx": 2,
  "app/(stock)/stock/factures/nouveau/nouveau-client.tsx": 1,
  "app/(stock)/stock/factures/page.tsx": 1,
  "app/(stock)/stock/fournisseurs/[id]/page.tsx": 1,
  "app/(stock)/stock/imports/import-mouvements-client.tsx": 1,
  "app/(stock)/stock/journalier/commande-grid.tsx": 1,
  "app/(stock)/stock/journalier/table-comparaison.tsx": 1,
  "app/(stock)/stock/journalier/table-conso.tsx": 1,
  "app/(stock)/stock/journalier/ventes-grid.tsx": 1,
  "app/(stock)/stock/reconciliation/reconciliation-client.tsx": 1,
  "app/(stock)/stock/restaurant/restaurant-client.tsx": 1,
};

/** Occurrences de `sticky` NU (sans préfixe de variante) accompagné d'un `top-…` (même préfixé, sauf `lg:` seul : ordinateur) dans la même chaîne de classes. */
function collantsEnHaut(src: string): number {
  let n = 0;
  for (const ligne of src.split("\n")) {
    for (const segment of ligne.split(/["'`]/)) {
      const jetons = segment.split(/\s+/);
      if (jetons.includes("sticky") && jetons.some((j) => /^(?!lg:)(?:[a-z-]+:)*top-/.test(j))) n++;
    }
  }
  return n;
}

describe("aucun `sticky top-…` dans le contenu des pages", () => {
  const tous = fichiers(SRC, /\.tsx?$/).map((p) => path.relative(SRC, p)).filter((f) => f !== "components/entete-mobile.ts");
  const trouves = Object.fromEntries(tous.map((f) => [f, collantsEnHaut(lire(f))]).filter(([, n]) => (n as number) > 0));

  it("seuls les en-têtes de tableau à défilement propre gardent un `top-…` — et exactement ceux listés", () => {
    expect(trouves).toEqual(EXCEPTIONS);
  });

  it.each(Object.keys(EXCEPTIONS))("%s : l'exception vit bien dans un conteneur `overflow-auto`", (f) => {
    expect(lire(f)).toMatch(/overflow-auto/);
  });

  it("le détecteur reconnaît les formes fautives (témoin)", () => {
    expect(collantsEnHaut(`<div className="sticky top-0 z-20 flex">`)).toBe(1);
    expect(collantsEnHaut("<div className={`sticky top-[calc(env(safe-area-inset-top)_+_52px)] z-10`}>")).toBe(1);
    expect(collantsEnHaut(`<div className="sticky max-lg:top-[3rem] z-10">`)).toBe(1); // la valeur magique recopiée, sous sa forme « téléphone »
    expect(collantsEnHaut(`<div className="sticky colle-sous-entete z-20">`)).toBe(0);
    expect(collantsEnHaut(`<aside className="lg:sticky lg:top-4">`)).toBe(0);
  });
});
