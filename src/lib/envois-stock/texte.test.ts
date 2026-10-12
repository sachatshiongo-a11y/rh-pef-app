import { describe, it, expect, beforeEach } from "vitest";
import { LIGNES_MAX, plafonner, rendreCourriel, rendreRubrique, type Ligne, type Rubrique } from "./texte";
import { baseSite, exemplesDeLiens, lienAbsolu, LIENS } from "./liens";

// Mise en forme des courriels du Stock — module pur : le plafond ne coupe jamais en silence, chaque puce a son lien.
const lignes = (n: number): Ligne[] => Array.from({ length: n }, (_, i) => ({ texte: `Article ${i + 1}`, lien: `/stock/catalogue/${i + 1}` }));

beforeEach(() => { delete process.env.NEXT_PUBLIC_SITE_URL; });

describe("plafonner : le reste est DIT, avec le lien de la liste complète", () => {
  it("sous le plafond : tout est gardé, rien n'est omis", () => {
    expect(plafonner(lignes(LIGNES_MAX), "/stock/catalogue")).toEqual({ lignes: lignes(LIGNES_MAX) });
  });
  it("au-dessus : les premières lignes, et le nombre exact d'omises avec le lien", () => {
    const g = plafonner(lignes(LIGNES_MAX + 7), "/stock/catalogue?alerte=URGENT");
    expect(g.lignes).toHaveLength(LIGNES_MAX);
    expect(g.omises).toEqual({ nombre: 7, lien: "/stock/catalogue?alerte=URGENT" });
  });
  it("un plafond propre à la rubrique (5 écarts)", () => {
    const g = plafonner(lignes(8), "/stock/journalier?vue=ecarts", 5);
    expect([g.lignes.length, g.omises?.nombre]).toEqual([5, 3]);
  });
});

describe("rendreRubrique / rendreCourriel : le style des rappels RH (puces, flèche, capitales)", () => {
  const rubrique: Rubrique = {
    cle: "x", titre: "Stocks négatifs", nombre: 2, resume: "Un résumé.",
    groupes: [{ titre: "Cuisine (2)", lignes: lignes(2), omises: { nombre: 3, lien: "/stock/catalogue?manque=negatif" } }],
    suite: { libelle: "Voir les stocks négatifs", lien: "/stock/catalogue?manque=negatif" },
  };

  it("titre en capitales avec le nombre, puces, lien absolu sur la ligne suivante, omises dites, lien de la suite", () => {
    expect(rendreRubrique(rubrique)).toBe([
      "STOCKS NÉGATIFS — 2",
      "Un résumé.",
      "",
      "Cuisine (2)",
      "• Article 1",
      "  → https://gestion.patesenfolie.cd/stock/catalogue/1",
      "• Article 2",
      "  → https://gestion.patesenfolie.cd/stock/catalogue/2",
      "… et 3 autre(s) : https://gestion.patesenfolie.cd/stock/catalogue?manque=negatif",
      "",
      "Voir les stocks négatifs : https://gestion.patesenfolie.cd/stock/catalogue?manque=negatif",
    ].join("\n"));
  });

  it("une rubrique de synthèse (sans nombre) n'affiche pas de nombre", () => {
    expect(rendreRubrique({ cle: "v", titre: "Valeur du stock", groupes: [{ lignes: lignes(1) }] }).split("\n")[0]).toBe("VALEUR DU STOCK");
  });

  it("le courriel : Bonjour, ouverture, rubriques, lien de connexion — jamais un lien relatif", () => {
    const c = rendreCourriel("Voici le point :", [rubrique, rubrique], ["Une note de bas de page."]);
    expect(c.startsWith("Bonjour,\n\nVoici le point :\n\nSTOCKS NÉGATIFS — 2")).toBe(true);
    expect(c).toContain("Une note de bas de page.");
    expect(c.endsWith("Se connecter : https://gestion.patesenfolie.cd/stock")).toBe(true);
    expect(c).not.toMatch(/→ \//);
  });
});

describe("liens : le domaine de production par défaut, NEXT_PUBLIC_SITE_URL s'il est défini (barre finale retirée)", () => {
  it("par défaut le domaine actuel", () => {
    expect(baseSite()).toBe("https://gestion.patesenfolie.cd");
    expect(lienAbsolu(LIENS.aValider())).toBe("https://gestion.patesenfolie.cd/stock/a-valider");
  });
  it("configurable", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://test.exemple.cd//";
    expect(lienAbsolu("/stock")).toBe("https://test.exemple.cd/stock");
  });
  it("chaque constructeur a un exemple, et tous les exemples visent l'espace Stock", () => {
    expect(exemplesDeLiens().length).toBeGreaterThanOrEqual(Object.keys(LIENS).length);
    expect(exemplesDeLiens().every((l) => l.startsWith("/stock"))).toBe(true);
  });
  it("les paramètres des filtres de l'écran sont ceux que l'écran lit (mois « AAAA-M », motif, alerte, domaine)", () => {
    expect(LIENS.mouvementsDuMois(2026, 9, "perte")).toBe("/stock/mouvements?mois=2026-9&motif=perte");
    expect(LIENS.alertesCatalogue("URGENT", "BOISSON")).toBe("/stock/catalogue?alerte=URGENT&domaine=BOISSON");
    expect(LIENS.ecartsVentes("2026-10-26")).toBe("/stock/journalier?vue=ecarts&semaine=2026-10-26");
  });
});
