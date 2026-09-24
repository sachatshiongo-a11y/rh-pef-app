import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MENTION_REFERENCE_PLANNING } from "./mention-reference-planning";

// Garde-fou : chaque écran qui estime un taux horaire sur heures/semaine × 52/12 dit que la paie de
// la brigade suit en réalité le planning du mois (spec 2026-09-23). Sinon l'écran et la paie
// racontent deux histoires.
const ECRANS = [
  "src/app/(app)/employes/employee-form.tsx",
  "src/app/(app)/employes/simulation-salaire.tsx",
  "src/app/(app)/employes/[id]/page.tsx",
  "src/app/(app)/planning/modele-grid.tsx",
];

describe("mention « la paie suit le planning »", () => {
  it("texte unique", () => {
    expect(MENTION_REFERENCE_PLANNING).toBe(
      "Estimation sur le contrat. La paie de la brigade suit les heures planifiées du mois : le taux horaire réel varie d'un mois à l'autre.",
    );
  });
  it.each(ECRANS)("%s affiche la mention", (fichier) => {
    const source = fs.readFileSync(path.join(process.cwd(), fichier), "utf8");
    expect(source).toMatch(/\{MENTION_REFERENCE_PLANNING\}/);
  });
});
