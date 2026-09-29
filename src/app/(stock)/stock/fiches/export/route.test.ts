import { describe, it, expect, vi, beforeEach } from "vitest";

// Export Excel des fiches : il suit l'onglet affiché (`?vue=plats|boissons`). Les chargements
// et le classeur sont remplacés : on vérifie QUELLES fiches partent, et dans quel ordre.

const recu = vi.hoisted(() => ({ classeur: null as null | { titre: string; feuilles: { nom: string; entete: string[]; lignes: unknown[][] }[] } }));

vi.mock("@/lib/garde-route", () => ({ exigerEspaceStock: async () => ({ ok: true }) }));
vi.mock("@/lib/export-excel", () => ({
  classeurExcel: async (c: NonNullable<typeof recu.classeur>) => { recu.classeur = c; return Buffer.from(""); },
}));

const vue = (id: string, nom: string, categorie: string, type: "PLAT" | "BAR", estSousRecette = false) => ({
  id, nom, categorie, type, nbPortions: 1, tauxTVA: "", prixVenteTTC: "", coefficientMargeCible: "",
  estSousRecette, rendementQuantite: "", rendementUnite: "", recette: "", actif: true, photoUrl: null, lignes: [],
});
// Ordre du chargement réel : catégorie puis nom.
const VUES = [
  vue("sauce", "Sauce tomate", "Bases", "PLAT", true),
  vue("rhum", "Rhum arrangé", "Rhum", "BAR"),
  vue("mojito", "Mojito", "Cocktail", "BAR"),
  vue("virgin", "Virgin colada", "Mocktail", "BAR"),
  vue("bolo", "Bolognaise", "Pâtes classiques", "PLAT"),
  vue("bordeaux", "Bordeaux", "Vin rouge", "BAR"),
];
vi.mock("../_data/charger-fiche", () => ({
  chargerFichesVues: async () => VUES,
  chargerArticlesDesFiches: async () => [],
}));

const { GET } = await import("./route");
const exporter = async (qs: string) => {
  const r = await GET(new Request(`http://x/stock/fiches/export${qs}`));
  return { r, feuille: recu.classeur!.feuilles[0], titre: recu.classeur!.titre };
};

beforeEach(() => { recu.classeur = null; });

describe("export des fiches — il suit l'onglet", () => {
  it("?vue=plats : les plats et les sous-recettes, aucune boisson", async () => {
    const { r, feuille, titre } = await exporter("?vue=plats");
    expect(feuille.lignes.map((l) => l[0])).toEqual(["Sauce tomate", "Bolognaise"]);
    expect(feuille.entete).not.toContain("Famille");
    expect(titre).toContain("(Plats)");
    expect(r.headers.get("Content-Disposition")).toContain("Fiches_techniques_Plats_");
  });

  it("?vue=boissons : les boissons seules, cocktails & mocktails d'abord, avec leur famille", async () => {
    const { feuille, titre } = await exporter("?vue=boissons");
    expect(feuille.lignes.map((l) => l[0])).toEqual(["Mojito", "Virgin colada", "Rhum arrangé", "Bordeaux"]);
    const iFamille = feuille.entete.indexOf("Famille");
    expect(iFamille).toBe(2);
    expect(feuille.lignes.map((l) => l[iFamille])).toEqual(["Cocktails & mocktails", "Cocktails & mocktails", "Boissons", "Boissons"]);
    // L'en-tête et les lignes gardent la même largeur (aucune colonne décalée).
    for (const l of feuille.lignes) expect(l.length).toBe(feuille.entete.length);
    expect(titre).toContain("(Boissons)");
  });

  it("la sélection (?ids=) exporte exactement les fiches choisies", async () => {
    const { feuille } = await exporter("?vue=boissons&ids=bordeaux,mojito");
    expect(feuille.lignes.map((l) => l[0])).toEqual(["Mojito", "Bordeaux"]);
  });

  it("sans onglet (ancien lien) : toutes les fiches, sans colonne Famille", async () => {
    const { feuille } = await exporter("");
    expect(feuille.lignes).toHaveLength(VUES.length);
    expect(feuille.entete).not.toContain("Famille");
  });
});
