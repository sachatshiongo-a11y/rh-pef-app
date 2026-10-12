import { describe, it, expect } from "vitest";
import { decisionFournisseur } from "./fournisseur-doublon";

const F = [{ id: "1", nom: "ETS SENEVE" }, { id: "2", nom: "Maison Kathy" }, { id: "3", nom: "Boulangerie Ndoki" }];

describe("decisionFournisseur — même logique que les articles", () => {
  it("nom identique (casse, accents, ponctuation) : c'est le même fournisseur", () => {
    expect(decisionFournisseur("ets.seneve", F)).toEqual({ type: "auto", fournisseur: F[0] });
    expect(decisionFournisseur("  MAISON  KATHY ", F)).toEqual({ type: "auto", fournisseur: F[1] });
  });
  it("nom proche : choix, avec « Créer quand même » possible", () => {
    const d = decisionFournisseur("Kathy", F);
    expect(d).toMatchObject({ type: "choix", creationPossible: true });
    expect(d.type === "choix" && d.candidats.map((c) => c.id)).toEqual(["2"]);
  });
  it("même nom déjà deux fois en base : choix entre eux, sans « Créer quand même »", () => {
    const d = decisionFournisseur("Kathy Shop", [{ id: "a", nom: "Kathy Shop" }, { id: "b", nom: "KATHY SHOP" }]);
    expect(d).toMatchObject({ type: "choix", creationPossible: false });
  });
  it("nom sans rapport, vide ou illisible : nouveau", () => {
    expect(decisionFournisseur("Quincaillerie Lumumba", F)).toEqual({ type: "nouveau" });
    expect(decisionFournisseur("   ", F)).toEqual({ type: "nouveau" });
    expect(decisionFournisseur("--", F)).toEqual({ type: "nouveau" });
  });
});
