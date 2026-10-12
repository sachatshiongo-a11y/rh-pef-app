// Le corps des écrans « À valider » : compteurs cliquables en tête, rubriques vides repliées en une
// ligne, état vide commun. Rendu statique (le composant n'a pas d'état).
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RubriquesAValider, type RubriqueAValider } from "./rubriques-a-valider";

const R = (id: string, titre: string, nombre: number): RubriqueAValider => ({ id, titre, nombre, contenu: h("p", null, `liste-${id}`) });
const rendre = (rubriques: RubriqueAValider[]) => renderToStaticMarkup(h(RubriquesAValider, { rubriques }));

describe("RubriquesAValider", () => {
  it("un compteur par rubrique non vide, qui saute à la rubrique", () => {
    const html = rendre([R("conges", "Demandes de congé", 3), R("acomptes", "Demandes d'acompte", 0), R("fiches", "Modifications de fiches", 1)]);
    expect(html).toContain('href="#conges"');
    expect(html).toContain('href="#fiches"');
    expect(html).not.toContain('href="#acomptes"');
    expect(html).toContain('id="conges"');
    expect(html).toContain('id="fiches"');
  });

  it("les rubriques vides ne sont pas affichées : une seule ligne les nomme", () => {
    const html = rendre([R("conges", "Demandes de congé", 3), R("acomptes", "Demandes d'acompte", 0), R("attestations", "Demandes d'attestation", 0)]);
    expect(html).not.toContain("liste-acomptes");
    expect(html).not.toContain('id="acomptes"');
    expect(html).toContain("liste-conges");
    expect(html).toContain("Rien d&#x27;autre en attente : demandes d&#x27;acompte, demandes d&#x27;attestation.");
  });

  it("aucune ligne « Rien d'autre » quand toutes les rubriques sont pleines", () => {
    expect(rendre([R("a", "Alpha", 1), R("b", "Bravo", 2)])).not.toContain("Rien d&#x27;autre");
  });

  it("titres en casse normale (jamais de capitales criées) avec leur nombre", () => {
    const html = rendre([R("conges", "Demandes de congé", 3)]);
    expect(html).toContain("Demandes de congé (3)");
    expect(html).not.toMatch(/uppercase/);
  });

  it("rien en attente : l'état vide commun, sans rubrique ni émoji", () => {
    const html = rendre([R("conges", "Demandes de congé", 0), R("acomptes", "Demandes d'acompte", 0)]);
    expect(html).toContain("Rien en attente : tout est à jour.");
    expect(html).toContain("border-dashed"); // le dessin d'EtatVide
    expect(html).not.toContain("<section");
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}✅✔]/u);
  });

  it("monté dans un espace de la page unique : sans compteurs ni état vide, titres de niveau 3, rubriques repliables ouvertes", () => {
    const html = renderToStaticMarkup(h(RubriquesAValider, { rubriques: [R("conges", "Demandes de congé", 3), R("acomptes", "Demandes d'acompte", 0)], avecNavigation: false, avecEtatVide: false, niveauTitre: 3, repliables: true }));
    expect(html).not.toContain("<nav");
    expect(html).toMatch(/<details id="conges" open/);
    expect(html).toMatch(/<h3[^>]*>Demandes de congé \(3\)<\/h3>/);
    expect(html).toContain("Rien d&#x27;autre en attente");
    const vide = renderToStaticMarkup(h(RubriquesAValider, { rubriques: [R("a", "Alpha", 0)], avecEtatVide: false }));
    expect(vide).toBe("");
  });
});
