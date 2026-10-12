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
      /if \(vers === "VALIDE"\) \{\s*const message = messageConfirmationValidation\(lignesAValiderDuLot\(rows, new Set\(ids\)\)\);\s*if \(message && !window\.confirm\(message\)\) return;\s*\}/,
    );
  });

  it("les deux boutons « Valider » (lot et ligne) passent par cette confirmation", () => {
    const boutons = [...s.matchAll(/<BoutonValider onClick=\{\(\) => ([^}]+)\}/g)].map((m) => m[1]);
    expect(boutons).toEqual(["lancer(idsSelection)", "lancer([r.id])"]);
  });

  it("rien de recopié : ni message ni filtre maison", () => {
    expect(s).not.toContain("Avant de valider");
    expect(s).not.toContain('statutPaiement === "PAS_VALIDE"'); // (le « vers === "PAS_VALIDE" » de Rouvrir n'est pas un filtre de lignes)
  });

  it("la page fournit statut et avertissements enregistrés de chaque ligne", () => {
    const p = src("page.tsx");
    expect(p).toContain("statutPaiement: l.statutPaiement,");
    expect(p).toContain("avertissements: lireAvertissements(l.avertissementsPaie),");
  });
});

describe("/a-valider : le paiement (Direction et RH, 2026-10-01)", () => {
  const s = src("bulletins-inbox.tsx");
  it("lot payé : moyen de paiement « Auto (selon la fiche) » par défaut, jamais « Virement » imposé à tous", () => {
    expect(s).toContain('useState("")');
    expect(s).toContain('{ value: "", label: "Auto (selon la fiche)" }');
    expect(s).toContain("((mode || null) as ModePaiement | null)");
    expect(s).not.toContain('useState("VIREMENT")');
  });
  it("la RH voit les bulletins non validés en lecture seule (libellé à la place des cases et boutons)", () => {
    const p = src("page.tsx");
    expect(p).toContain('lectureSeule="En attente de validation par la Direction"');
    expect(s).toMatch(/\{!lectureSeule && <input type="checkbox"/);
  });
});

// Lot 8 (V5) : les gestes de l'écran Paie arrivent ici — rouvrir (ligne et lot), moyen de paiement choisi AVANT de
// payer une ligne. Composant à état : vérifié sur la source ; le rendu, par rôle, l'est dans
// `bulletins-seulement.integration.test.ts`.
describe("/a-valider : rouvrir un bulletin validé (Direction), repris de l'écran Paie", () => {
  const s = src("bulletins-inbox.tsx");
  it("deux boutons « ↩ Rouvrir » (lot et ligne), de la famille action-buttons, derrière peutRouvrir, qui visent « Pas validé »", () => {
    const boutons = [...s.matchAll(/\{peutRouvrir (&& !r\.periode )?&& <BoutonNeutre onClick=\{\(\) => (lancer\([^)]*\))\} disabled=\{isPending\}>↩ Rouvrir<\/BoutonNeutre>\}/g)].map((m) => `${m[1] ?? ""}${m[2]}`);
    // La ligne d'un mois clôturé (« Paie de septembre 2026 ») n'a pas de « Rouvrir » (relecture du lot 8).
    expect(boutons).toEqual(['lancer(idsSelection, "PAS_VALIDE")', '&& !r.periode lancer([r.id], "PAS_VALIDE")']);
    expect(s).toContain('import { BoutonValider, BoutonNeutre } from "@/components/action-buttons";');
  });
  it("un lot « Rouvrir » écarte les bulletins d'un mois clôturé (le serveur les refuse de toute façon)", () => {
    expect(s).toMatch(/if \(vers === "PAS_VALIDE"\) \{[\s\S]*?ids = ids\.filter\(\(id\) => !rows\.find\(\(x\) => x\.id === id\)\?\.periode\);[\s\S]*?window\.confirm\(question\)/);
  });
  it("une confirmation avant de rouvrir, et ni avertissements ni date de versement envoyés", () => {
    expect(s).toMatch(/if \(vers === "PAS_VALIDE"\) \{[\s\S]*?window\.confirm\(question\)/);
    expect(s).toContain('vers === "PAYE" ? dateVersement : null');
  });
  it("la page n'offre « Rouvrir » qu'à la Direction, et seulement sur la liste des bulletins à payer", () => {
    const p = src("page.tsx");
    expect(p.match(/peutRouvrir=\{peutValider\}/g)).toHaveLength(1);
    expect(p).toMatch(/id: "bulletins-a-payer"[^\n]*peutRouvrir=\{peutValider\}/);
    expect(p).toMatch(/\{estDirection && payeRows\.length > 0 && \(/); // annuler un paiement : Direction seule
  });
  it("le moyen de paiement est visible AVANT toute sélection (le bouton de chaque ligne s'en sert)", () => {
    expect(s).toMatch(/\{cible === "PAYE" && \(\s*<select value=\{mode\}/);
    expect(s).not.toMatch(/cible === "PAYE" && idsSelection\.length > 0 &&/);
  });
});
