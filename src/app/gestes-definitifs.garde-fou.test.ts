// Garde-fou (audit du 10/10/2026, ergonomie 2, 4 et 5) :
//  1. un formulaire dont l'action SUPPRIME / ANNULE / RETIRE ne part jamais sans confirmation
//     (ConfirmSubmitButton ou confirm()) — ✕ de prime, avantage, frais, acompte, prêt annulé, membre de la
//     famille, shift, jour férié, bon de commande…
//  2. un formulaire qui CRÉE de l'argent ou un document passe par FormulaireGarde (la saisie survit à un refus,
//     le bouton attend la réponse) — jamais par un <form action={…}> brut, que React remet à zéro.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(__dirname, "..");
function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : tsx(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}
const SOURCES = tsx(path.join(RACINE, "app")).map((p) => ({ chemin: path.relative(RACINE, p), source: readFileSync(p, "utf8") }));

/** Blocs <form …>…</form> dont l'attribut action vérifie `motif`. */
function formulaires(motif: RegExp) {
  const trouves: { chemin: string; ligne: number; action: string; bloc: string }[] = [];
  for (const { chemin, source } of SOURCES) {
    for (const m of source.matchAll(/<form\b[^>]*?action=\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
      if (!motif.test(m[1])) continue;
      const fin = source.indexOf("</form>", m.index!);
      trouves.push({ chemin, ligne: source.slice(0, m.index).split("\n").length, action: m[1], bloc: source.slice(m.index!, fin) });
    }
  }
  return trouves;
}

// Formulaires de mot de passe : on saisit un nouveau mot de passe, ce n'est pas un geste définitif sur des données.
const SANS_CONFIRMATION = new Set(["app/(app)/parametres/users-admin.tsx"]);

describe("gestes définitifs : confirmation avant d'envoyer", () => {
  const destructifs = formulaires(/supprimer|annuler|retirer|rompre|desactiver/i);

  it("le garde-fou voit bien les formulaires (pas de faux vert)", () => {
    expect(destructifs.length).toBeGreaterThanOrEqual(12);
    expect(destructifs.some((f) => f.action.includes("supprimerPrime"))).toBe(true);
    expect(destructifs.some((f) => f.action.includes("annulerPret"))).toBe(true);
    expect(destructifs.some((f) => f.action.includes("supprimerMembreFamille"))).toBe(true);
  });

  it("chacun passe par ConfirmSubmitButton ou confirm()", () => {
    const sans = destructifs
      .filter((f) => !SANS_CONFIRMATION.has(f.chemin) && !/ConfirmSubmitButton|confirm\(/.test(f.bloc))
      .map((f) => `${f.chemin}:${f.ligne} ${f.action}`);
    expect(sans).toEqual([]);
  });
});

describe("formulaires qui créent de l'argent ou un document : la saisie survit à un refus", () => {
  const CREATIONS = "ajouterPrime|demanderAcompte|ajouterFraisMedical|ajouterAvantageNature|ajouterContrat|changerSalaire|ajouterDocument|ajouterEvaluation|ajouterDisciplinaire|creerPret|ajouterMembreFamille|enregistrerFichePoste|creerEmploye|modifierEmploye";
  it("aucun <form action={…}> brut ne les appelle (FormulaireGarde, ou onSubmit de l'écran)", () => {
    const bruts = formulaires(new RegExp(`\\b(${CREATIONS})\\b`)).map((f) => `${f.chemin}:${f.ligne} ${f.action}`);
    expect(bruts).toEqual([]);
  });
  it("et la fiche employé / les fiches de poste emploient bien FormulaireGarde", () => {
    for (const [chemin, motif] of [
      ["app/(app)/employes/[id]/page.tsx", /<FormulaireGarde action=\{ajouterFraisMedical/],
      ["app/(app)/employes/[id]/dossier.tsx", /<FormulaireGarde action=\{ajouterContrat/],
      ["app/(app)/employes/composition-familiale.tsx", /<FormulaireGarde action=\{ajouterMembreFamille/],
      ["app/(app)/fiches-poste/liste-fiches-poste.tsx", /<FormulaireGarde action=\{enregistrerFichePoste/],
    ] as const) {
      expect(SOURCES.find((s) => s.chemin === chemin)!.source).toMatch(motif);
    }
  });
});
