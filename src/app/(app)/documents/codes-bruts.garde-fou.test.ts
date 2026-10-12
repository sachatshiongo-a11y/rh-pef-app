// Garde-fou (audit du 10/10/2026, ergonomie 6) : l'écran Documents et la chronologie de la fiche employé
// montraient des codes bruts (« CARTE_IDENTITE », « EN ATTENTE » obtenu par un replace du code, « CDI » sans
// libellé…). Tout passe par les libellés existants (libelles-espace, conges-liste, contrats-classement).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const lire = (rel: string) => readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

describe("Documents : pas de code brut à l'écran", () => {
  const page = lire("app/(app)/documents/page.tsx");
  it("le type d'un document passe par libelleTypeDocument", () => {
    expect(page).not.toMatch(/\{d\.type\}/);
    expect(page).toContain("libelleTypeDocument(d.type)");
  });
  it("le statut d'un congé passe par LIBELLE_STATUT_CONGE (plus de .statut.replace)", () => {
    expect(page).not.toMatch(/\.statut\.replace\(/);
    expect(page).toContain("LIBELLE_STATUT_CONGE");
  });
  it("le type de contrat des titres d'aperçu passe par libelleTypeContrat", () => {
    expect(page).not.toMatch(/Contrat — \$\{c\.type\}|Contrat \$\{c\.type\}/);
  });
});

describe("Chronologie de la fiche employé : pas de code brut", () => {
  const fiche = lire("app/(app)/employes/[id]/page.tsx");
  it("contrat, sanction, congé et catégorie sont en clair", () => {
    expect(fiche).not.toMatch(/titre: `Contrat \$\{c\.type\}`/);
    expect(fiche).not.toMatch(/Sanction — \$\{d\.type\}/);
    expect(fiche).not.toMatch(/\.statut\.replace\(/);
    expect(fiche).not.toMatch(/\$\{employee\.categorie\}`/);
    expect(fiche).toContain("libelleTypeSanction(d.type)");
  });
});
