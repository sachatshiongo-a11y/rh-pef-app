import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { calculerSoldeConge } from "./solde-conge-salarie";

const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const debutAnnee = jour("2026-01-01");

describe("calculerSoldeConge", () => {
  it("ne décompte que les types cochés, depuis le 1er janvier", () => {
    const r = calculerSoldeConge({
      acquis: 18,
      demandesApprouvees: [
        { type: "Congé annuel", nbJours: 5, dateDebut: jour("2026-03-02") },
        { type: "Maladie", nbJours: 3, dateDebut: jour("2026-04-01") },
        { type: "Congé annuel", nbJours: 4, dateDebut: jour("2025-12-20") },
        // Type RETIRÉ depuis (absent des actifs) mais qui comptait : il entame toujours le solde.
        { type: "Ancien congé", nbJours: 1.5, dateDebut: jour("2026-05-04") },
      ],
      compteDansSolde: new Map([
        ["Congé annuel", true],
        ["Maladie", false],
        ["Ancien congé", true],
      ]),
      debutAnnee,
    });
    expect(r).toEqual({ acquis: 18, pris: 6.5, solde: 11.5 });
  });

  it("un type inconnu n'entame pas le solde", () => {
    const r = calculerSoldeConge({
      acquis: 3,
      demandesApprouvees: [{ type: "Texte libre", nbJours: 2, dateDebut: jour("2026-02-02") }],
      compteDansSolde: new Map(),
      debutAnnee,
    });
    expect(r.solde).toBe(3);
  });
});

// Garde-fou : le solde se lit à UN endroit. Aucune page de l'espace salarié ne le recalcule — sinon
// deux écrans affichent de nouveau deux chiffres (défaut corrigé au lot 6).
function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("l'espace salarié lit le solde de congé à une seule source", () => {
  const racine = path.resolve(__dirname, "../app/espace");

  it("aucun fichier de src/app/espace ne calcule les congés acquis lui-même", () => {
    const fautifs = fichiers(racine).filter((f) => /\bcalculerCongesAcquis\b|\bcongeDeductibleDuSolde\b/.test(readFileSync(f, "utf8")));
    expect(fautifs.map((f) => path.relative(racine, f))).toEqual([]);
  });

  it("l'Accueil et « Mes congés » passent par chargerSoldeCongeSalarie", () => {
    for (const rel of ["page.tsx", "conges/page.tsx"]) {
      expect(readFileSync(path.join(racine, rel), "utf8"), rel).toMatch(/\bchargerSoldeCongeSalarie\(/);
    }
  });
});
