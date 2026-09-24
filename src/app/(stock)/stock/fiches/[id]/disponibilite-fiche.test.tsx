import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArticleOption, FicheVue } from "../_data/fiche-calc";

// Page d'une fiche : bloc « Disponibilité » et colonnes « Stock » / « Portions possibles ». On rend
// le VRAI composant d'édition, avec un stock connu, et on lit ce que la Direction verra.
vi.mock("../actions", () => ({
  ajouterIngredient: async () => {}, dupliquerFiches: async () => ({ ids: [] }), modifierFiche: async () => {},
  remplacerIngredients: async () => {}, supprimerFiches: async () => {}, supprimerIngredients: async () => {},
}));
vi.mock("../photo-actions", () => ({ envoyerPhotoFiche: async () => {}, supprimerPhotoFiche: async () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const { EditerFiche } = await import("./editer-fiche");

const articles: ArticleOption[] = [
  { id: "farine", designation: "Farine", unite: "kg", prixUnitaireUSD: "1", actif: true },
  { id: "oeuf", designation: "Œuf", unite: "pièce", prixUnitaireUSD: "0.2", actif: true },
  { id: "basilic", designation: "Basilic", unite: "kg", prixUnitaireUSD: "9", actif: true },
];
const vue = (lignes: FicheVue["lignes"]): FicheVue => ({
  id: "f1", nom: "Pâtes fraîches", categorie: "", type: "PLAT", nbPortions: 2, tauxTVA: "0.16", prixVenteTTC: "",
  coefficientMargeCible: "", estSousRecette: false, rendementQuantite: "", rendementUnite: "", recette: "",
  actif: true, photoUrl: null, lignes,
});
const ligne = (id: string, articleId: string, unite: string, quantite: string, ordre: number) => ({ id, articleId, sousFicheId: null, unite, quantite, ordre });
const rendre = (v: FicheVue, stocks: Record<string, { depot: string | null; restaurant: null | { etat: "OK"; quantite: string; dateComptage: string } }>) =>
  renderToStaticMarkup(<EditerFiche vue={v} articles={articles} autresFiches={[]} contexte={[]} contexteDispo={[]} stocks={stocks} />);

describe("page d'une fiche — disponibilité", () => {
  it("disponible : portions, ingrédient limitant nommé et mis en évidence, stock dépôt + restaurant", () => {
    // 2 portions : 0,5 kg de farine, 4 œufs. Farine 3 kg (dépôt 2 + resto 1) → 12 ; œufs 9 → 4.
    const html = rendre(vue([ligne("l1", "farine", "kg", "0.5", 1), ligne("l2", "oeuf", "pièce", "4", 2)]), {
      farine: { depot: "2", restaurant: { etat: "OK", quantite: "1", dateComptage: "2026-09-22" } },
      oeuf: { depot: "9", restaurant: null },
    });
    expect(html).toContain("Disponibilité selon le stock");
    expect(html).toContain("Disponible");
    expect(html).toContain("4 portion(s)");
    expect(html).toMatch(/Ingrédient limitant :[\s\S]*Œuf/);
    expect(html).toContain("3 kg");
    expect(html).toContain("dépôt 2 · resto 1 (compté le 22/09/2026)");
    // La ligne limitante (œufs) porte le filet, pas la farine.
    const lignesHtml = html.split("<tr").slice(2);
    expect(lignesHtml[1]).toContain("border-l-amber-500");
    expect(lignesHtml[0]).not.toContain("border-l-amber-500");
  });

  it("à vérifier : chaque raison est écrite en clair, jamais un nombre de portions", () => {
    const html = rendre(vue([ligne("l1", "farine", "kg", "0.5", 1), ligne("l2", "basilic", "kg", "0.01", 2)]), {
      farine: { depot: "2", restaurant: null },
    });
    expect(html).toContain("À vérifier");
    // Deux fois : dans le bloc « Disponibilité » ET dans la cellule de la ligne concernée.
    expect(html.split("Basilic : pas de stock enregistré").length - 1).toBe(2);
    expect(html).not.toContain("portion(s)");
  });
});
