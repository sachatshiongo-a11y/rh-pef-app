import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Ce test vérifie une règle d'ARGENT, pas une mise en page : partout où un coût s'affiche, sa
// mention de partialité s'affiche AVEC lui — y compris en largeur téléphone (l'app est installée en
// PWA). Il rend le composant réel et vérifie la STRUCTURE du markup : la qualification doit se
// trouver avant toute cellule masquée sous 640 px (`class="hidden … sm:block"`), donc dans la partie
// visible à toute largeur.

vi.mock("./actions", () => ({
  creerFiche: async () => ({ id: "x" }),
  supprimerFiches: async () => {},
  dupliquerFiches: async () => ({ ids: [] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const { FichesClient } = await import("./fiches-client");
type FicheRow = Parameters<typeof FichesClient>[0]["fiches"][number];

const base: FicheRow = {
  id: "f1", nom: "Bolognaise", categorie: "Pâtes classiques", type: "PLAT",
  estSousRecette: false, actif: true, nbPortions: 1, nbIngredients: 2,
  coutPortion: 1.61, coutConnu: true, coutPartiel: false, incomplet: false,
  nbIndetermines: 0, prixVenteHT: 20.24, prixEstConseille: true, tauxMarque: 0.875,
};

/** Partie du markup rendue AVANT la première cellule masquée sous 640 px = ce que voit un téléphone. */
function partieVisibleSurTelephone(markup: string): string {
  const i = markup.indexOf('class="hidden');
  return i === -1 ? markup : markup.slice(0, i);
}

describe("liste des fiches — le coût partiel ne s'affiche jamais en chiffre nu", () => {
  it("sur téléphone, un coût partiel porte le « ≥ » ET le badge dans la cellule du montant", () => {
    const partielle: FicheRow = { ...base, coutPartiel: true, incomplet: true, nbIndetermines: 3 };
    const visible = partieVisibleSurTelephone(renderToStaticMarkup(<FichesClient fiches={[partielle]} />));

    expect(visible).toContain("≥");
    expect(visible).toContain("Coût partiel");
    expect(visible).toContain("3 ingrédient(s)");
  });

  it("un coût complet ne porte ni « ≥ » ni badge (pas de bruit inutile)", () => {
    const markup = renderToStaticMarkup(<FichesClient fiches={[base]} />);
    expect(markup).not.toContain("≥");
    expect(markup).not.toContain("Coût partiel —");
  });

  it("des portions inexploitables sont annoncées, sans « ≥ » (le coût total, lui, est exact)", () => {
    const cassee: FicheRow = { ...base, coutPartiel: false, incomplet: true, nbIndetermines: 0 };
    const visible = partieVisibleSurTelephone(renderToStaticMarkup(<FichesClient fiches={[cassee]} />));
    expect(visible).toContain("Portions inexploitables");
    expect(visible).not.toContain("≥");
  });

  it("une fiche dont aucun ingrédient n'est valorisé affiche « — », jamais « 0,00 $ »", () => {
    const muette: FicheRow = { ...base, coutConnu: false, coutPortion: 0, coutPartiel: true, incomplet: true, nbIndetermines: 2 };
    const visible = partieVisibleSurTelephone(renderToStaticMarkup(<FichesClient fiches={[muette]} />));
    expect(visible).toContain("—");
    expect(visible).not.toContain("0,00 $");
    expect(visible).toContain("Coût partiel");
  });
});
