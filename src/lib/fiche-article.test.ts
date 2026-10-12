import { describe, it, expect } from "vitest";
import {
  lireOngletArticle, lireFiltreMouvements, typeDuFiltre, lienFicheArticle,
  ONGLETS_ARTICLE, FILTRES_MOUVEMENTS,
} from "./fiche-article";

describe("fiche article — onglet et filtre lus dans l'adresse", () => {
  it("onglet : valeur connue gardée ; absente, inconnue ou en tableau → Mouvements / première valeur", () => {
    for (const o of ONGLETS_ARTICLE) expect(lireOngletArticle(o)).toBe(o);
    expect(lireOngletArticle(undefined)).toBe("mouvements");
    expect(lireOngletArticle("n-importe-quoi")).toBe("mouvements");
    expect(lireOngletArticle(["prix", "informations"])).toBe("prix");
  });
  it("filtre : valeur connue gardée ; sinon Tous", () => {
    for (const f of FILTRES_MOUVEMENTS) expect(lireFiltreMouvements(f)).toBe(f);
    expect(lireFiltreMouvements("xx")).toBe("tous");
    expect(lireFiltreMouvements(undefined)).toBe("tous");
  });
  it("chaque filtre répond à un type de mouvement ; Tous n'en filtre aucun", () => {
    expect(typeDuFiltre("entrees")).toBe("ENTREE");
    expect(typeDuFiltre("sorties")).toBe("SORTIE");
    expect(typeDuFiltre("ajustements")).toBe("AJUSTEMENT");
    expect(typeDuFiltre("tous")).toBeUndefined();
  });
  it("adresses : toujours ?onglet= explicite ; filtre par défaut omis ; « plus anciens » conservé", () => {
    expect(lienFicheArticle("a1", "informations")).toBe("/stock/catalogue/a1?onglet=informations");
    expect(lienFicheArticle("a1", "mouvements", { filtre: "tous" })).toBe("/stock/catalogue/a1?onglet=mouvements");
    expect(lienFicheArticle("a1", "mouvements", { filtre: "sorties" })).toBe("/stock/catalogue/a1?onglet=mouvements&filtre=sorties");
    expect(lienFicheArticle("a1", "mouvements", { filtre: "sorties", tousMouvements: true })).toBe("/stock/catalogue/a1?onglet=mouvements&filtre=sorties&mouvements=tous");
    expect(lienFicheArticle("a1", "prix", { tousPrix: true })).toBe("/stock/catalogue/a1?onglet=prix&prix=tous");
    // un paramètre d'un autre onglet ne fuit pas
    expect(lienFicheArticle("a1", "fournisseurs", { filtre: "sorties", tousPrix: true })).toBe("/stock/catalogue/a1?onglet=fournisseurs");
  });
});
