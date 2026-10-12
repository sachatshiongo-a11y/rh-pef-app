// Le corps de la page « À valider » unique : un bloc repliable par espace, puis une rubrique repliable par nature ;
// un espace sans rien à valider n'est pas affiché ; un seul état vide quand tout est vide. Rendu statique.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EspacesAValider, type EspaceAfficher } from "./espaces-a-valider";
import type { RubriqueAValider } from "./rubriques-a-valider";

const R = (id: string, titre: string, nombre: number): RubriqueAValider => ({ id, titre, nombre, contenu: h("p", null, `liste-${id}`) });
const E = (espace: EspaceAfficher["espace"], nom: string, rubriques: RubriqueAValider[], apres: EspaceAfficher["apres"] = null): EspaceAfficher =>
  ({ espace, nom, rubriques, total: rubriques.reduce((n, r) => n + r.nombre, 0), apres });
const rendre = (espaces: EspaceAfficher[]) => renderToStaticMarkup(h(EspacesAValider, { espaces }));

describe("EspacesAValider", () => {
  it("un bloc repliable par espace non vide, puis une rubrique repliable par nature — tout ouvert au départ", () => {
    const html = rendre([E("rh", "RH", [R("conges", "Demandes de congé", 2)]), E("stock", "Stock", [R("demandes", "Mes demandes", 1)])]);
    expect(html).toMatch(/<details id="espace-rh" open/);
    expect(html).toMatch(/<details id="espace-stock" open/);
    expect(html).toMatch(/<details id="conges" open/);
    expect(html).toContain("RH <span");
    expect(html).toContain("Demandes de congé (2)");
    expect(html).toMatch(/<h3[^>]*>Demandes de congé/); // les natures sont un niveau sous l'espace
  });

  it("un espace sans rien à valider n'est ni affiché ni nommé ; ses rubriques vides non plus", () => {
    const html = rendre([E("rh", "RH", [R("conges", "Demandes de congé", 0)]), E("exploitation", "Exploitation", [R("demandes-ratios", "Modifications de ratios", 3)])]);
    expect(html).not.toContain('id="espace-rh"');
    expect(html).not.toContain("Demandes de congé");
    expect(html).toContain('id="espace-exploitation"');
  });

  it("les compteurs en tête sautent à chaque rubrique non vide, tous espaces confondus, UNE seule fois", () => {
    const html = rendre([E("rh", "RH", [R("conges", "Demandes de congé", 2)]), E("stock", "Stock", [R("demandes", "Mes demandes", 1)])]);
    expect(html.match(/<nav /g)).toHaveLength(1);
    expect(html).toContain('href="#conges"');
    expect(html).toContain('href="#demandes"');
  });

  it("tout est vide : UN seul état vide (pas un par espace), sans bloc d'espace", () => {
    const html = rendre([E("rh", "RH", [R("conges", "Demandes de congé", 0)]), E("stock", "Stock", [R("demandes", "Mes demandes", 0)])]);
    expect(html.match(/border-dashed/g)).toHaveLength(1);
    expect(html).toContain("Rien en attente : tout est à jour.");
    expect(html).not.toContain("<details");
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}✅✔]/u);
  });

  it("ce qui n'attend rien (réponses aux demandes traitées, annuler un paiement) reste visible même quand tout est vide", () => {
    const html = rendre([E("stock", "Stock", [R("demandes", "Mes demandes", 0)], h("p", null, "reponse-refusee"))]);
    expect(html).toContain("Rien en attente");
    expect(html).toContain("reponse-refusee");
  });
});
