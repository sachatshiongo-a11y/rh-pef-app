import { describe, it, expect } from "vitest";
import { aCommander, decalerISO, libelleEcheance, lireDelai, prevoir, HORIZON_JOURS } from "./prevision";

// QUAND COMMANDER (2026-10-18) — la règle de la rubrique « À commander » du courriel du matin, sur des cas calculés à la main.
const AUJ = "2026-10-18";

describe("lireDelai : le délai de livraison du fournisseur, tel qu'il est saisi", () => {
  it("lit le nombre dans les textes réels (« 1 jour(s) », « 7  jour(s) », « 3 »)", () => {
    expect(lireDelai("1 jour(s)")).toBe(1);
    expect(lireDelai("7  jour(s)")).toBe(7);
    expect(lireDelai("3")).toBe(3);
  });
  it("non renseigné ou sans chiffre : null (jamais supposé)", () => {
    expect(lireDelai(null)).toBeNull();
    expect(lireDelai(undefined)).toBeNull();
    expect(lireDelai("")).toBeNull();
    expect(lireDelai("à la demande")).toBeNull();
  });
});

describe("prevoir : consommation, rupture, date limite, quantité suggérée", () => {
  it("28 kg sortis en 28 jours (1 kg/j), 5 kg en stock, livraison 1 j → rupture le 23, commander avant le 22, suggéré 10 kg", () => {
    const p = prevoir({ quantite: 5, sorties: 28, joursSortie: 10, delaiLivraison: "1 jour(s)" }, AUJ)!;
    expect(p.consoParJour).toBe(1);
    expect(p.joursRestants).toBe(5);
    expect(p.ruptureISO).toBe("2026-10-23");
    expect(p.commanderAvantISO).toBe("2026-10-22");
    expect(p.joursAvantCommande).toBe(4);
    expect(p.quantiteSuggeree).toBe(10); // 1 × (1 + 14) − 5
    expect(aCommander(p)).toBe(false); // 4 j > horizon de 3 j
  });

  it("délai de 7 jours : la date limite est déjà passée → en retard, retenu", () => {
    const p = prevoir({ quantite: 5, sorties: 28, joursSortie: 10, delaiLivraison: "7" }, AUJ)!;
    expect(p.commanderAvantISO).toBe("2026-10-16");
    expect(p.joursAvantCommande).toBe(-2);
    expect(aCommander(p)).toBe(true);
    expect(p.quantiteSuggeree).toBe(16); // 1 × 21 − 5
  });

  it("délai non renseigné : compté 0 jour, et signalé (delai null)", () => {
    const p = prevoir({ quantite: 2, sorties: 14, joursSortie: 4, delaiLivraison: null }, AUJ)!;
    expect(p.delai).toBeNull();
    expect(p.consoParJour).toBe(0.5);
    expect(p.commanderAvantISO).toBe("2026-10-22"); // 2 ÷ 0,5 = 4 j
    expect(p.joursAvantCommande).toBe(4);
  });

  it("jours restants fractionnaires : arrondis à l'entier inférieur (prudence)", () => {
    const p = prevoir({ quantite: 3.9, sorties: 28, joursSortie: 5, delaiLivraison: "1" }, AUJ)!;
    expect(p.ruptureISO).toBe("2026-10-21");
    expect(p.joursAvantCommande).toBe(HORIZON_JOURS - 1);
    expect(p.quantiteSuggeree).toBe(12); // 15 − 3,9 = 11,1 → 12
  });

  it("stock déjà suffisant pour couvrir : quantité suggérée 0, jamais négative", () => {
    const p = prevoir({ quantite: 2, sorties: 1, joursSortie: 2, delaiLivraison: "1" }, AUJ)!;
    expect(p.quantiteSuggeree).toBe(0);
  });

  it("pas de prévision : un seul jour de sortie, aucune sortie, ou stock déjà à 0 (en rupture, autre rubrique)", () => {
    expect(prevoir({ quantite: 5, sorties: 10, joursSortie: 1, delaiLivraison: "1" }, AUJ)).toBeNull();
    expect(prevoir({ quantite: 5, sorties: 0, joursSortie: 0, delaiLivraison: "1" }, AUJ)).toBeNull();
    expect(prevoir({ quantite: 0, sorties: 10, joursSortie: 5, delaiLivraison: "1" }, AUJ)).toBeNull();
    expect(prevoir({ quantite: -2, sorties: 10, joursSortie: 5, delaiLivraison: "1" }, AUJ)).toBeNull();
    expect(aCommander(null)).toBe(false);
  });
});

describe("dates et libellés", () => {
  it("decalerISO franchit les mois et les années", () => {
    expect(decalerISO("2026-10-30", 3)).toBe("2026-11-02");
    expect(decalerISO("2027-01-01", -1)).toBe("2026-12-31");
  });
  it("libelleEcheance", () => {
    expect(libelleEcheance(-2)).toBe("EN RETARD de 2 j");
    expect(libelleEcheance(0)).toBe("AUJOURD'HUI");
    expect(libelleEcheance(1)).toBe("demain");
    expect(libelleEcheance(3)).toBe("dans 3 j");
  });
});
