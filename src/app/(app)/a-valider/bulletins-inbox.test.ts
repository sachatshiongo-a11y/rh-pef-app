import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// « Bulletins à valider » (/a-valider) valide des lignes de paie, une par une ou en lot : même rappel
// des avertissements que l'écran Paie (tâche 9), par la MÊME fonction, sans boîte quand il n'y a rien
// à signaler. Composant à état et page serveur : vérifiés sur la source, faute de DOM dans ce dépôt.
const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("/a-valider : la validation rappelle les avertissements", () => {
  const s = src("bulletins-inbox.tsx");

  it("validation (ligne ou lot) : avertissements des lignes réellement validées, puis window.confirm, avant l'envoi", () => {
    expect(s).toContain('from "../paie/avertissements-validation"');
    const lancer = s.slice(s.indexOf("function lancer("), s.indexOf("startTransition(", s.indexOf("function lancer(")));
    expect(lancer).toMatch(
      /if \(cible === "VALIDE"\) \{\s*const message = messageConfirmationValidation\(lignesAValiderDuLot\(rows, new Set\(ids\)\)\);\s*if \(message && !window\.confirm\(message\)\) return;\s*\}/,
    );
  });

  it("les deux boutons « Valider » (lot et ligne) passent par cette confirmation", () => {
    const boutons = [...s.matchAll(/<BoutonValider onClick=\{\(\) => ([^}]+)\}/g)].map((m) => m[1]);
    expect(boutons).toEqual(["lancer([...selection])", "lancer([r.id])"]);
  });

  it("rien de recopié : ni message ni filtre maison", () => {
    expect(s).not.toContain("Avant de valider");
    expect(s).not.toContain('=== "PAS_VALIDE"');
  });

  it("la page fournit statut et avertissements enregistrés de chaque ligne", () => {
    const p = src("page.tsx");
    expect(p).toContain("statutPaiement: l.statutPaiement,");
    expect(p).toContain("avertissements: lireAvertissements(l.avertissementsPaie),");
  });
});
