import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Qui peut quoi sur les factures (2026-11-12) : l'employé du Stock enregistre une facture + son entrée de
// stock en une saisie ; paiement, suppression, correction restent à la Direction. Lecture du source
// (les gardes sont dans le corps de chaque action) — aucun accès base.
const src = readFileSync(join(__dirname, "actions.ts"), "utf8");

function corps(nom: string): string {
  const i = src.indexOf(`export const ${nom} = `);
  expect(i, `action ${nom} introuvable`).toBeGreaterThan(-1);
  const suite = src.indexOf("\nexport ", i + 10);
  return src.slice(i, suite === -1 ? undefined : suite);
}

describe("Factures : rôles", () => {
  it.each(["creerFactureAvecLignes", "analyserFacturePDF"])("%s : ouverte à l'espace Stock (aucun requireRole ADMIN)", (n) => {
    const c = corps(n);
    expect(c).not.toMatch(/requireRole\(/);
    expect(c).toMatch(/verifySession\(\)|garde\(\)/);
  });

  it.each(["supprimerFacture", "supprimerFacturesEnLot", "attacherDocumentFacture"])("%s : reste réservée à la Direction", (n) => {
    expect(corps(n)).toMatch(/requireRole\(user, \["ADMIN"\]\)/);
  });

  it("la création refuse un montant déjà payé hors Direction", () => {
    expect(corps("creerFactureAvecLignes")).toMatch(/montantRegle !== 0 && !estDirection\(user\)/);
  });
});
