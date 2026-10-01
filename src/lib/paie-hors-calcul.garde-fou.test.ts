import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : une ligne de paie HORS CALCUL ne compte nulle part (décision de Sacha du 2026-10-01).
 *
 * Tout fichier de src/ qui LIT les lignes d'une paie (une PayrollRun avec ses `lignes`, ou
 * `payrollLine.findMany/count/…`) les fait passer par `@/lib/paie-hors-calcul` (lignesComptees,
 * separerHorsCalcul, compterPasValideComptees) — sauf les lecteurs NOMMÉS ci-dessous, qui ne font ni
 * total, ni livre, ni déclaration, ni export (une ligne précise, la fiche d'un salarié, le moteur).
 * Un nouvel écran ou un nouvel export qui additionne des lignes sans ce filtre est signalé ici.
 */

const SRC = path.join(__dirname, "..");
const LIT_LA_PAIE = /payrollRun\.(?:findUnique|findFirst|findMany)\(\{[\s\S]{0,400}?\blignes\s*:|payrollLine\.(?:findMany|findFirst|count|aggregate|groupBy)\(/;
const FILTRE = /from\s+["']@\/lib\/paie-hors-calcul["']/;

const LECTEURS_SANS_FILTRE: Record<string, string> = {
  "lib/paie-hors-calcul.ts": "Le module lui-même.",
  "lib/paie-refresh.ts": "Recalcul : écrit les lignes, ne les additionne pas.",
  "lib/paie-validation.ts": "Contrôle de validation : refuse nommément une ligne hors calcul (messageNonCalcules).",
  "lib/signature.ts": "Une ligne précise (empreinte du bulletin signé).",
  "lib/bulletin-salarie.ts": "Le bulletin d'UN salarié (espace salarié).",
  "lib/attestations.ts": "Une ligne précise (attestation de salaire : dernière ligne VALIDE ou PAYE).",
  "lib/acompte-plafond.ts": "Une ligne précise (plafond d'acompte d'un salarié).",
  "app/(app)/employes/[id]/page.tsx": "Fiche d'UN salarié : toutes ses lignes, y compris rouvertes, et ses bulletins remis.",
  "app/(app)/employes/[id]/fiche/route.ts": "Fiche PDF d'UN salarié.",
  "app/(app)/employes/[id]/modifier/page.tsx": "Simulation du salaire d'UN salarié (dernière paie de référence).",
  "app/(app)/employes/nouveau/page.tsx": "Simulation d'embauche (dernière paie de référence, pas un total).",
  "app/(app)/documents/page.tsx": "Registre des documents par salarié (un bulletin par ligne, pas un total).",
  "app/espace/documents/page.tsx": "Espace salarié : ses propres bulletins.",
};

function lister(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? lister(p) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");

/** Fichiers qui lisent des lignes de paie SANS passer par le filtre « hors calcul ». */
export function lecteursNonFiltres(fichiers: { rel: string; source: string }[]): string[] {
  return fichiers.filter((f) => LIT_LA_PAIE.test(sansCommentaires(f.source)) && !FILTRE.test(f.source)).map((f) => f.rel).sort();
}

const TOUS = lister(SRC).map((p) => ({ rel: rel(p), source: fs.readFileSync(p, "utf8") }));

describe("lignes hors calcul : tout lecteur de lignes de paie passe par le filtre, sauf exceptions nommées", () => {
  it("le parcours voit les lecteurs connus (garde contre un faux vert)", () => {
    const lecteurs = TOUS.filter((f) => LIT_LA_PAIE.test(sansCommentaires(f.source))).map((f) => f.rel);
    for (const r of ["app/(app)/paie/export/route.ts", "app/(app)/paie/export-pdf/route.ts", "lib/declarations.ts", "lib/paie-bulletins.ts", "app/(app)/paie/page.tsx", "lib/indicateurs/rh.ts"]) expect(lecteurs).toContain(r);
  });
  it("aucun lecteur non filtré hors de la liste", () => {
    expect(lecteursNonFiltres(TOUS).filter((r) => !(r in LECTEURS_SANS_FILTRE))).toEqual([]);
  });
  it("la liste est fermée : chaque exception lit encore la paie sans filtre", () => {
    const non = lecteursNonFiltres(TOUS);
    for (const r of Object.keys(LECTEURS_SANS_FILTRE)) expect(non, r).toContain(r);
  });
  it("mord : le filtre retiré d'un export → signalé", () => {
    const f = TOUS.find((x) => x.rel === "app/(app)/paie/export/route.ts")!;
    const casse = { ...f, source: f.source.replace(/^import \{ lignesComptees \} from "@\/lib\/paie-hors-calcul";\n/m, "") };
    expect(casse.source).not.toBe(f.source);
    expect(lecteursNonFiltres([casse])).toEqual(["app/(app)/paie/export/route.ts"]);
  });
});
