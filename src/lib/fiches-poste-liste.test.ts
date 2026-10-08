import { describe, it, expect } from "vitest";
import { estDocumentee, filtrerFichesPoste, grouperParDepartement, lignesFichesPoste, premiereLigne, SANS_DEPARTEMENT, type FicheDePoste } from "./fiches-poste-liste";

const fiche = (poste: string, extra: Partial<FicheDePoste> = {}): FicheDePoste => ({
  id: `f-${poste}`, poste, descriptionPoste: null, description: null, typeContrat: null, echelleSalariale: null, categorieProfessionnelle: null,
  superieurHierarchique: null, tempsTravail: null, competencesTechniques: null, savoirEtre: null, formationsRequises: null, diplomesRequis: null,
  experiencesExigees: null, fichierUrl: null, fichierNom: null, ...extra,
});
const emp = (id: string, nom: string, poste: string, secteur: string) => ({ id, nom, photoUrl: null, poste, secteur });

const EMPLOYES = [
  emp("1", "Aimée Mutita", "Cuisinière", "Cuisine"),
  emp("2", "Zoé Kabeya", "Cuisinière", "Cuisine"),
  emp("3", "Esther Nsundi", "Serveuse", "Salle"),
  emp("4", "Jean Kabila", "Barman ", "Bar"), // espace final : même poste que « Barman »
  emp("5", "Paul Mbuyi", "Plongeur", "Cuisine"),
  emp("6", "Rose Ilunga", "Plongeur", "Salle"),
  emp("7", "Marc Tshibangu", "Plongeur", "Salle"),
];
const FICHES = [fiche("Cuisinière", { descriptionPoste: "\n• Prépare les plats\nVeille à l'hygiène" }), fiche("Barman", { fichierUrl: "/fichiers/b.pdf" }), fiche("Chef de cuisine")];

describe("lignes de l'écran Fiches de poste", () => {
  const lignes = lignesFichesPoste(EMPLOYES, FICHES);

  it("une ligne par poste (salariés actifs ∪ fiches sans salarié), triée, avec ses occupants", () => {
    expect(lignes.map((l) => l.poste)).toEqual(["Barman", "Chef de cuisine", "Cuisinière", "Plongeur", "Serveuse"]);
    expect(lignes.find((l) => l.poste === "Cuisinière")!.occupants.map((o) => o.nom)).toEqual(["Aimée Mutita", "Zoé Kabeya"]);
    expect(lignes.find((l) => l.poste === "Barman")!.occupants).toHaveLength(1);
  });

  it("département = secteur le plus fréquent des occupants ; aucun sans salarié actif", () => {
    expect(lignes.find((l) => l.poste === "Plongeur")!.departement).toBe("Salle");
    expect(lignes.find((l) => l.poste === "Chef de cuisine")!.departement).toBeNull();
  });

  it("documentée : même règle qu'avant (missions, activités ou document joint)", () => {
    expect(lignes.filter((l) => l.documentee).map((l) => l.poste)).toEqual(["Barman", "Cuisinière"]);
    expect(estDocumentee(null)).toBe(false);
  });

  it("groupes par département, « Sans salarié actif » en dernier", () => {
    expect(grouperParDepartement(lignes).map((g) => [g.departement, g.lignes.map((l) => l.poste)])).toEqual([
      ["Bar", ["Barman"]],
      ["Cuisine", ["Cuisinière"]],
      ["Salle", ["Plongeur", "Serveuse"]],
      [SANS_DEPARTEMENT, ["Chef de cuisine"]],
    ]);
  });

  it("recherche sans accents, mots dans le désordre, sur l'intitulé, le département ou un occupant ; filtre d'état", () => {
    expect(filtrerFichesPoste(lignes, "cuisiniere", "tous").map((l) => l.poste)).toEqual(["Cuisinière"]);
    expect(filtrerFichesPoste(lignes, "salle", "tous").map((l) => l.poste)).toEqual(["Plongeur", "Serveuse"]);
    expect(filtrerFichesPoste(lignes, "kabila jean", "tous").map((l) => l.poste)).toEqual(["Barman"]);
    expect(filtrerFichesPoste(lignes, "", "a-faire").map((l) => l.poste)).toEqual(["Chef de cuisine", "Plongeur", "Serveuse"]);
    expect(filtrerFichesPoste(lignes, "", "documentees").map((l) => l.poste)).toEqual(["Barman", "Cuisinière"]);
  });

  it("aperçu : première mission, puce retirée", () => {
    expect(premiereLigne(FICHES[0].descriptionPoste)).toBe("Prépare les plats");
    expect(premiereLigne(null)).toBe("");
  });
});
