// GARDE-FOU « UN BULLETIN SE DÉCIDE DANS À VALIDER, JAMAIS DEPUIS PAIE » (plan d'ergonomie, lot 8, V5).
//
// Approuver (état « Validé »), payer, rouvrir et annuler un paiement passent par deux actions serveur : `changerStatutPaie` (une
// ligne, formulaire) et `changerStatutEnLot` (un lot). Avant le lot 8 elles étaient appelées par l'écran Paie ET
// par À valider (deux listes pour un même geste, audit D8). Désormais seul « À valider » les appelle : si un
// écran de Paie (ou n'importe quel autre) se remet à les appeler, ce test échoue.
//
// Ce qu'il ne prouve pas : le rendu (preuve dans `(app)/a-valider/bulletins-seulement.integration.test.ts`) ni les
// droits par rôle, revérifiés côté serveur (`roleRequisPour`).
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
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const sansCommentaires = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Les écrans autorisés à décider d'un bulletin : la définition des actions, et « À valider ». */
const AUTORISES = new Set([
  "app/(app)/paie/actions.ts",
  "app/(app)/a-valider/bulletins-inbox.tsx",
  "app/(app)/a-valider/bulletins-payes.tsx",
]);
const DECISION = /\bchangerStatut(?:Paie|EnLot)\b/;

/** Les fichiers (hors tests) qui citent une action de décision de bulletin sans y être autorisés. */
function intrus(fichiers: { chemin: string; src: string }[]): string[] {
  return fichiers.filter((f) => !AUTORISES.has(f.chemin) && DECISION.test(sansCommentaires(f.src))).map((f) => f.chemin);
}
const depot = sources(SRC).map((f) => ({ chemin: rel(f), src: readFileSync(f, "utf8") }));

describe("décider d'un bulletin : À valider seulement", () => {
  it("le parcours trouve bien les fichiers et les trois appelants autorisés (garde contre un faux vert)", () => {
    expect(depot.length).toBeGreaterThan(500);
    for (const a of AUTORISES) expect(depot.map((f) => f.chemin), a).toContain(a);
    const appelants = depot.filter((f) => DECISION.test(sansCommentaires(f.src))).map((f) => f.chemin).sort();
    expect(appelants).toEqual([...AUTORISES].sort());
  });

  it("aucun écran, composant ou page hors À valider n'appelle changerStatutPaie ni changerStatutEnLot", () => {
    expect(intrus(depot)).toEqual([]);
  });

  it("les gestes de décision ne sont plus dans l'écran Paie : ni formulaire « versStatut », ni lot, ni composant de statut", () => {
    const paie = depot.filter((f) => f.chemin.startsWith("app/(app)/paie/") && f.chemin !== "app/(app)/paie/actions.ts");
    expect(paie.length).toBeGreaterThan(5);
    for (const f of paie) {
      const src = sansCommentaires(f.src);
      expect(src, f.chemin).not.toMatch(/name="versStatut"/);
      expect(src, f.chemin).not.toMatch(/StatusActions|PaieBulk|prochainsEtatsPour/);
    }
    expect(depot.map((f) => f.chemin)).not.toContain("app/(app)/paie/status-actions.tsx");
    expect(depot.map((f) => f.chemin)).not.toContain("app/(app)/paie/paie-bulk.tsx");
  });

  it("Paie renvoie vers les ancres d'À valider, qui existent, et lit les chiffres du chargeur du badge", () => {
    const paie = sansCommentaires(depot.find((f) => f.chemin === "app/(app)/paie/page.tsx")!.src);
    const aValider = sansCommentaires(depot.find((f) => f.chemin === "app/(app)/a-valider/page.tsx")!.src);
    for (const ancre of ["bulletins-a-valider", "bulletins-a-payer"]) {
      expect(paie, ancre).toContain(`href="/a-valider#${ancre}"`);
      expect(aValider, ancre).toContain(`id: "${ancre}"`);
    }
    expect(paie).toContain('from "@/lib/a-valider-chargeurs"');
    expect(paie).toMatch(/chargerAValiderRH\(user\)/);
    // Les liens de Paie sont de la famille d'actions (même géométrie que le reste de la barre, action-buttons.test.ts).
    expect(paie).toMatch(/href="\/a-valider#bulletins-a-valider" className=\{CLASSES_NEUTRE\}/);
    expect(paie).toMatch(/href="\/a-valider#bulletins-a-payer" className=\{CLASSES_NEUTRE\}/);
  });

  it("la notification « bulletins à payer » mène à À valider (pas à Paie, qui ne sait plus payer)", () => {
    const n = readFileSync(path.join(SRC, "lib", "paie-notifications.ts"), "utf8");
    expect(/export const LIEN_A_PAYER = "([^"]+)"/.exec(n)?.[1]).toBe("/a-valider");
  });

  it("le garde-fou se falsifie : un écran de Paie qui rappelle l'action est signalé, un commentaire non", () => {
    const faux = [{ chemin: "app/(app)/paie/nouveau.tsx", src: 'import { changerStatutEnLot } from "./actions";' }];
    expect(intrus(faux)).toEqual(["app/(app)/paie/nouveau.tsx"]);
    expect(intrus([{ chemin: "app/(app)/paie/ok.tsx", src: "// changerStatutPaie se décide dans À valider\nexport const x = 1;" }])).toEqual([]);
    expect(intrus([{ chemin: "app/(app)/a-valider/bulletins-inbox.tsx", src: "changerStatutEnLot(ids)" }])).toEqual([]);
  });
});
