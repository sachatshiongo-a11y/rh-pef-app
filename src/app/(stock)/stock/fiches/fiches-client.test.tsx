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
  estSousRecette: false, actif: true, photoUrl: null, nbPortions: 1, nbIngredients: 2,
  coutPortion: 1.61, coutConnu: true, coutPartiel: false, incomplet: false,
  nbIndetermines: 0, prixVenteHT: 20.24, prixEstConseille: true, tauxMarque: 0.875,
  dispo: { etat: "DISPONIBLE", portions: 23, limitant: "Bœuf haché", enRupture: [], raisons: [], rendement: null },
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

  it("une fiche VIDE dit « Aucun ingrédient saisi », jamais « Portions inexploitables »", () => {
    // Cas de « + Nouvelle fiche » : l'entête est renseignée avant les ingrédients. Le moteur la
    // dit incomplète ; le motif affiché doit envoyer saisir la recette, pas corriger les portions.
    const vide: FicheRow = {
      ...base, nbIngredients: 0, coutConnu: false, coutPortion: 0,
      coutPartiel: false, incomplet: true, nbIndetermines: 0,
    };
    const markup = renderToStaticMarkup(<FichesClient fiches={[vide]} />);
    const visible = partieVisibleSurTelephone(markup);
    expect(visible).toContain("Aucun ingrédient saisi");
    expect(visible).not.toContain("Portions inexploitables");
    expect(visible).not.toContain("≥");
    // La marge de 100 % ne doit nulle part s'afficher comme un chiffre acquis.
    expect(markup).not.toContain("taux de marque");
    expect(markup).toContain("Prix et marge non fiables : aucun ingrédient saisi");
  });

  it("une fiche dont aucun ingrédient n'est valorisé affiche « — », jamais « 0,00 $ »", () => {
    const muette: FicheRow = { ...base, coutConnu: false, coutPortion: 0, coutPartiel: true, incomplet: true, nbIndetermines: 2 };
    const visible = partieVisibleSurTelephone(renderToStaticMarkup(<FichesClient fiches={[muette]} />));
    expect(visible).toContain("—");
    expect(visible).not.toContain("0,00 $");
    expect(visible).toContain("Coût partiel");
  });
});

describe("liste des fiches — disponibilité selon le stock", () => {
  it("un plat disponible annonce ses portions ET, sur téléphone, son ingrédient limitant", () => {
    const visible = partieVisibleSurTelephone(renderToStaticMarkup(<FichesClient fiches={[base]} />));
    expect(visible).toContain("Disponible · 23 portions");
    expect(visible).toContain('title="Limité par Bœuf haché"');
    expect(visible).toContain("Limité par Bœuf haché</span>");
  });

  it("en rupture : l'ingrédient manquant est nommé ; à vérifier : la première raison et le nombre", () => {
    const rupture: FicheRow = { ...base, id: "f2", dispo: { etat: "RUPTURE", portions: 0, limitant: "Crème", enRupture: ["Crème", "Parmesan"], raisons: [], rendement: null } };
    const verifier: FicheRow = { ...base, id: "f3", dispo: { etat: "A_VERIFIER", portions: null, limitant: null, enRupture: [], raisons: ["Basilic : pas de stock enregistré", "Sauce : sous-recette sans rendement renseigné"], rendement: null } };
    const visible = partieVisibleSurTelephone(renderToStaticMarkup(<FichesClient fiches={[rupture]} />));
    expect(visible).toContain("En rupture · Crème, Parmesan");
    const v2 = partieVisibleSurTelephone(renderToStaticMarkup(<FichesClient fiches={[verifier]} />));
    expect(v2).toContain("À vérifier · Basilic : pas de stock enregistré · 2 raisons");
    expect(v2).not.toContain("portions");
  });

  it("une sous-recette se lit en rendements (« 3 × 1 000 g »)", () => {
    const sauce: FicheRow = { ...base, estSousRecette: true, dispo: { etat: "DISPONIBLE", portions: 3, limitant: "Crème", enRupture: [], raisons: [], rendement: "1 000 g" } };
    expect(renderToStaticMarkup(<FichesClient fiches={[sauce]} />)).toContain("Disponible · 3 × 1 000 g");
  });

  it("le filtre d'état reçu de l'URL ne montre que les fiches de cet état", () => {
    const rupture: FicheRow = { ...base, id: "f2", nom: "Carbonara", dispo: { etat: "RUPTURE", portions: 0, limitant: "Crème", enRupture: ["Crème"], raisons: [], rendement: null } };
    const markup = renderToStaticMarkup(<FichesClient fiches={[base, rupture]} etatInitial="RUPTURE" />);
    expect(markup).toContain("Carbonara");
    expect(markup).not.toContain("Bolognaise");
  });
});
