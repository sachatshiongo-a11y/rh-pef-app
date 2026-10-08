// GARDE-FOU « PAGINATION » (décision de la Direction, 2026-10-08 : « les tableaux sont devenus longs »).
// Les règles qui ne se voient pas à l'écran et qui se perdent au premier écran ajouté :
//   1. UN EXPORT EXPORTE TOUT L'ENSEMBLE FILTRÉ, jamais la page : aucune route d'export / de PDF / de page
//      imprimable ne lit `?page=` / `?par=` ni n'importe le module de pagination (sinon un Excel de 50 lignes
//      passerait pour « l'inventaire » ou « la liste des employés ») ;
//   2. UNE SEULE BARRE : tout fichier qui découpe en pages (`fenetrePage` / `usePagination`) rend la barre
//      PARTAGÉE `components/pagination` — personne ne refabrique ses boutons ni ne construit `?page=` à la main ;
//   3. la barre garde ses engagements d'ergonomie : cibles de 44 px, aucun `backdrop-filter` (il décroche sur
//      iOS, cf. tableaux-normaux), tailles 50 / 100 / Tout, 50 par défaut.
// Ce que ce fichier ne couvre PAS : que chaque écran trop long soit paginé (la liste des écrans est dans le
// compte rendu de la livraison) ni les totaux affichés — chaque écran paginé a ses tests de rendu.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PAR_DEFAUT, TAILLES_PAGE } from "@/lib/pagination";

const SRC = path.join(__dirname, "..");
function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");
const tous = fichiers(path.join(SRC, "app")).map((p) => ({ chemin: rel(p), src: readFileSync(p, "utf8") }));
/** Le code sans les lignes de commentaire (les consignes citent volontairement `?page=`). */
const code = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const estExport = (chemin: string) => /(^|\/)route\.ts$/.test(chemin) || /\/imprimer\/page\.tsx$/.test(chemin);

describe("pagination — un export exporte tout l'ensemble filtré", () => {
  const exports = tous.filter((f) => estExport(f.chemin));

  it("la liste des exports n'est pas vide (le scan trouve bien les routes)", () => {
    expect(exports.length).toBeGreaterThan(40);
    expect(exports.some((f) => f.chemin.includes("catalogue/export"))).toBe(true);
    expect(exports.some((f) => f.chemin.includes("employes/export"))).toBe(true);
  });

  it("aucune route d'export / PDF / page imprimable ne lit la page ou la taille de page", () => {
    const fautifs = exports.filter((f) => /lib\/pagination|components\/pagination|lirePagination|fenetrePage|PARAM_PAGE|PARAM_PAR|get\(["']page["']\)|get\(["']par["']\)|\.page\b.*searchParams|sp\.par\b/.test(code(f.src))).map((f) => f.chemin);
    expect(fautifs).toEqual([]);
  });
});

describe("pagination — une seule barre, partagée", () => {
  const paginants = tous.filter((f) => /\bfenetrePage\(|\busePagination\(/.test(code(f.src)));

  it("le scan trouve les écrans paginés", () => {
    expect(paginants.length).toBeGreaterThanOrEqual(15);
  });

  it("tout fichier qui découpe en pages rend la barre partagée", () => {
    const sansBarre = paginants.filter((f) => !/<Pagination\b/.test(f.src)).map((f) => f.chemin);
    expect(sansBarre).toEqual([]);
  });

  it("personne ne construit « ?page= » à la main hors du module partagé", () => {
    const fautifs = tous.filter((f) => /[?&]page=/.test(code(f.src))).map((f) => f.chemin);
    expect(fautifs).toEqual([]);
  });
});

describe("pagination — « Tout » ne lit jamais sans borne en base", () => {
  it("tout fichier qui lit une page en base (skip / take) donne le plafond de « Tout » à fenetrePage et à la barre", () => {
    const serveur = tous.filter((f) => /\bfen[a-zA-Z]*\.(skip|take)\b/.test(code(f.src)));
    expect(serveur.length).toBeGreaterThanOrEqual(7);
    const sansPlafond = serveur.filter((f) => !/fenetrePage\([^)]*PLAFOND_TOUT\)/.test(code(f.src)) || !/plafondTout=\{[^}]*PLAFOND_TOUT/.test(code(f.src))).map((f) => f.chemin);
    expect(sansPlafond).toEqual([]);
  });
});

describe("pagination — la barre tient ses engagements", () => {
  const barre = readFileSync(path.join(SRC, "components/pagination.tsx"), "utf8");
  it("50 / 100 / Tout, 50 par défaut", () => {
    expect([...TAILLES_PAGE]).toEqual([50, 100, "tout"]);
    expect(PAR_DEFAUT).toBe(50);
  });
  it("cibles tactiles de 44 px (min-h-11 / min-w-11)", () => {
    expect(barre).toMatch(/min-h-11/);
    expect(barre).toMatch(/min-w-11/);
  });
  it("aucun backdrop-filter", () => {
    expect(code(barre)).not.toMatch(/backdrop/i); // le commentaire de tête le cite : on ne lit que le code
  });
});
