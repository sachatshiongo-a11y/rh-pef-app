import { describe, it, expect } from "vitest";
import { lireDateAchat, fournisseurDuMouvement, memeQuantite, SOUS_ONGLETS_ACHATS, sousOngletActif } from "./achats-liste";

// 2026-09-28 à 23 h 30 UTC = 29/09 à 0 h 30 à Kinshasa (UTC+1) : le piège du serveur en UTC.
const MINUIT_PASSE_KIN = new Date("2026-09-28T23:30:00.000Z");
const MIDI = new Date("2026-09-28T11:00:00.000Z");

describe("lireDateAchat — date d'un achat de la Liste d'achat", () => {
  it("vide → aujourd'hui À KINSHASA (pas le jour UTC du serveur)", () => {
    expect(lireDateAchat("", MIDI)).toBe("2026-09-28");
    expect(lireDateAchat(null, MINUIT_PASSE_KIN)).toBe("2026-09-29");
    expect(lireDateAchat("   ", MINUIT_PASSE_KIN)).toBe("2026-09-29");
  });

  it("une date passée est acceptée telle quelle (rattrapage)", () => {
    expect(lireDateAchat("2026-09-12", MIDI)).toBe("2026-09-12");
    expect(lireDateAchat("2026-09-28", MIDI)).toBe("2026-09-28");
  });

  it("refuse une date dans le futur, avec un message lisible", () => {
    expect(() => lireDateAchat("2026-09-29", MIDI)).toThrow("La date de l'achat ne peut pas être dans le futur.");
    // À 0 h 30 à Kinshasa le 29, le 29 est AUJOURD'HUI : accepté ; le 30 reste refusé.
    expect(lireDateAchat("2026-09-29", MINUIT_PASSE_KIN)).toBe("2026-09-29");
    expect(() => lireDateAchat("2026-09-30", MINUIT_PASSE_KIN)).toThrow(/futur/);
  });

  it("refuse une date illisible ou hors calendrier", () => {
    expect(() => lireDateAchat("28/09/2026", MIDI)).toThrow("Date de l'achat invalide.");
    expect(() => lireDateAchat("2026-02-30", MIDI)).toThrow("Date de l'achat invalide.");
    expect(() => lireDateAchat("n'importe quoi", MIDI)).toThrow("Date de l'achat invalide.");
  });
});

describe("fournisseurDuMouvement — le fournisseur affiché dans Mouvements", () => {
  const base = { facture: null, reception: null, fournisseur: null };

  it("achat direct : le fournisseur porté par le mouvement", () => {
    expect(fournisseurDuMouvement({ ...base, fournisseur: { id: "f1", nom: "Maman Épiphanie" } })).toEqual({ id: "f1", nom: "Maman Épiphanie" });
  });

  it("facture : le fournisseur de la facture prime", () => {
    expect(fournisseurDuMouvement({ ...base, facture: { fournisseurId: "f2", fournisseurNom: "Kin Marché" }, fournisseur: { id: "f1", nom: "Autre" } })).toEqual({ id: "f2", nom: "Kin Marché" });
  });

  it("réception : le fournisseur du bon de commande", () => {
    expect(fournisseurDuMouvement({ ...base, reception: { bonDeCommande: { fournisseurId: "f3", fournisseur: { nom: "Sodeico" } } } })).toEqual({ id: "f3", nom: "Sodeico" });
  });

  it("aucun fournisseur connu → null (jamais un lien vide)", () => {
    expect(fournisseurDuMouvement(base)).toBeNull();
    expect(fournisseurDuMouvement({ ...base, facture: { fournisseurId: null, fournisseurNom: "Sans fiche" } })).toBeNull();
  });
});

describe("memeQuantite — comparaison au millième (Decimal(14,3))", () => {
  it("égalité au millième près, pas au-delà", () => {
    expect(memeQuantite(10, 10)).toBe(true);
    expect(memeQuantite(2.5, "2.500")).toBe(true);
    expect(memeQuantite(2.5, 2.501)).toBe(false);
    expect(memeQuantite(10, 11)).toBe(false);
  });
});

describe("sous-onglets « Achats & mouvements »", () => {
  it("trois sous-onglets, dans l'ordre décidé, sur les routes existantes", () => {
    expect(SOUS_ONGLETS_ACHATS.map((o) => [o.label, o.href])).toEqual([
      ["Mouvements", "/stock/mouvements"],
      ["Liste d'achat", "/stock/entree"],
      ["Légumes frais", "/stock/legumes"],
    ]);
  });

  it("le sous-onglet actif suit la page, y compris ses sous-chemins", () => {
    expect(sousOngletActif("/stock/mouvements")).toBe("/stock/mouvements");
    expect(sousOngletActif("/stock/entree")).toBe("/stock/entree");
    expect(sousOngletActif("/stock/legumes/pdf")).toBe("/stock/legumes");
    expect(sousOngletActif("/stock/entrees-bidon")).toBeNull();
    expect(sousOngletActif("/stock/catalogue")).toBeNull();
  });
});
