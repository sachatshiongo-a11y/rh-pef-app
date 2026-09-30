import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { fusionnerChangements, lireCharge, lireChargeOuNull, texteDecimal, valeursEgales, type Changement } from "./charge";
import { etatLigneAValider } from "./comptage";
import { messageReglements } from "./reglement";

// Tests PURS du contrat des demandes : relecture validée de la charge (une charge non conforme ne
// s'exécute jamais), fusion des retouches, règle « écart appliqué au stock actuel », messages.

const paiement = { v: 1, mode: "SOLDE", date: "2026-09-10", factures: [{ id: "f1", fournisseurNom: "SENEVE", numero: "12", resteUSD: "100" }], reglement: null };

describe("lireCharge — jamais lue de confiance", () => {
  it("accepte une charge conforme", () => {
    expect(lireCharge("PAIEMENT_FACTURE", paiement)).toEqual(paiement);
  });
  it.each([
    ["version inconnue", { ...paiement, v: 2 }],
    ["mode inconnu", { ...paiement, mode: "TOUT" }],
    ["date illisible", { ...paiement, date: "10/09/2026" }],
    ["montant non décimal", { ...paiement, factures: [{ ...paiement.factures[0], resteUSD: "1e3" }] }],
    ["montant en nombre (flottant)", { ...paiement, factures: [{ ...paiement.factures[0], resteUSD: 100 }] }],
    ["aucune facture", { ...paiement, factures: [] }],
    ["SOLDE sur deux factures", { ...paiement, factures: [paiement.factures[0], { ...paiement.factures[0], id: "f2" }] }],
    ["règlement sans son détail", { ...paiement, mode: "REGLEMENT" }],
    ["règlement glissé dans un SOLDE", { ...paiement, reglement: { type: "PAIEMENT", montantUSD: "1", montantCDF: null, taux: null, modePaiement: null, note: null } }],
  ])("refuse : %s", (_nom, brut) => {
    expect(() => lireCharge("PAIEMENT_FACTURE", brut)).toThrow(/Demande illisible/);
    expect(lireChargeOuNull("PAIEMENT_FACTURE", brut)).toBeNull();
  });
  it("refuse un champ d'article inconnu, en double, ou une valeur du mauvais type", () => {
    const art = (changements: unknown[]) => ({ v: 1, libelle: "x", articles: [{ id: "a", designation: "Riz", changements }] });
    const ok = { champ: "prixUnitaireUSD", avant: "2", apres: "3", avantLibelle: "2", apresLibelle: "3" };
    expect(lireCharge("MODIF_ARTICLE", art([ok])).articles[0].changements).toEqual([ok]);
    expect(() => lireCharge("MODIF_ARTICLE", art([{ ...ok, champ: "id" }]))).toThrow(/champ inconnu/);
    expect(() => lireCharge("MODIF_ARTICLE", art([ok, ok]))).toThrow(/champ en double/);
    expect(() => lireCharge("MODIF_ARTICLE", art([{ ...ok, champ: "actif", apres: "oui" }]))).toThrow(/illisible/);
    expect(() => lireCharge("MODIF_ARTICLE", art([{ ...ok, apres: 3 }]))).toThrow(/illisible/);
  });
  it("comptage : domaine et nombres contrôlés", () => {
    const l = { articleId: "a", designation: "Riz", unite: null, theorique: "10", physique: "8", explication: "", prixUnitaireUSD: null };
    expect(lireCharge("RECONCILIATION", { v: 1, domaine: null, origine: "C", lignes: [l] }).lignes).toEqual([l]);
    expect(() => lireCharge("RECONCILIATION", { v: 1, domaine: "VIANDE", origine: "C", lignes: [l] })).toThrow(/domaine/);
    expect(() => lireCharge("RECONCILIATION", { v: 1, domaine: null, origine: "C", lignes: [{ ...l, physique: "huit" }] })).toThrow(/physique/);
  });
});

describe("texteDecimal / valeursEgales", () => {
  it("écrit sans notation exponentielle et compare exactement", () => {
    expect(texteDecimal(1e-7)).toBe("0.0000001");
    expect(texteDecimal(0.1 + 0.2)).toBe("0.30000000000000004");
    expect(valeursEgales("prixUnitaireUSD", "2.50", "2.5")).toBe(true);
    expect(valeursEgales("prixUnitaireUSD", "2.5", null)).toBe(false);
    expect(valeursEgales("code", "007", "7")).toBe(false);
  });
});

describe("fusionnerChangements — une retouche avant décision", () => {
  const c = (champ: Changement["champ"], avant: string | null, apres: string | null): Changement => ({ champ, avant, apres, avantLibelle: String(avant), apresLibelle: String(apres) });
  it("garde l'AVANT d'origine, prend le nouvel APRÈS, retire un champ revenu à sa valeur, ordre de la fiche", () => {
    const r = fusionnerChangements([c("prixUnitaireUSD", "2", "3"), c("code", null, "7")], [c("prixUnitaireUSD", "2", "4"), c("unite", "Sac", "Kg"), c("code", null, null)]);
    expect(r.map((x) => [x.champ, x.avant, x.apres])).toEqual([["unite", "Sac", "Kg"], ["prixUnitaireUSD", "2", "4"]]);
  });
});

describe("etatLigneAValider — l'écart constaté appliqué au stock actuel", () => {
  const rien = { entrees: new Decimal(0), sorties: new Decimal(0), ajustements: 0, tardifs: 0 };
  const l = { theorique: "10", physique: "8" };
  it("rien n'a bougé : la quantité comptée (écriture du geste direct)", () => {
    expect(etatLigneAValider(l, new Decimal(10), rien)).toMatchObject({ etat: "inchange", final: new Decimal(8) });
  });
  it("entrées/sorties enregistrées depuis : stock actuel + écart", () => {
    const e = etatLigneAValider(l, new Decimal(14), { entrees: new Decimal(5), sorties: new Decimal(1), ajustements: 0, tardifs: 0 });
    expect(e).toMatchObject({ etat: "mouvemente" });
    expect(e.etat === "mouvemente" && e.final.toString()).toBe("12");
  });
  it("changement inexpliqué ou autre ajustement : conflit (jamais d'écart compté deux fois)", () => {
    expect(etatLigneAValider(l, new Decimal(11), rien).etat).toBe("conflit");
    expect(etatLigneAValider(l, new Decimal(14), { entrees: new Decimal(3), sorties: new Decimal(0), ajustements: 0, tardifs: 0 }).etat).toBe("conflit");
    expect(etatLigneAValider(l, new Decimal(10), { ...rien, ajustements: 1 }).etat).toBe("conflit");
    // Saisie tardive (sortie datée d'avant le comptage, saisie après) : même expliquée, conflit.
    expect(etatLigneAValider(l, new Decimal(7), { ...rien, sorties: new Decimal(3), tardifs: 1 }).etat).toBe("conflit");
  });
});

describe("messageReglements — la notification « payée »", () => {
  const r = { factureId: "f", fournisseurNom: "SENEVE", numero: "12", montant: 1250.5, type: "PAIEMENT" as const, date: "2026-09-30", solde: true, reste: 0 };
  it("dit la facture, le fournisseur, la date et le montant", () => {
    expect(messageReglements([r])).toBe("Facture n° 12 de SENEVE payée le 30/09/2026 — 1 250,50 $");
    expect(messageReglements([{ ...r, numero: null, solde: false, montant: 50, reste: 20 }])).toBe("Paiement partiel de 50,00 $ sur la facture sans numéro de SENEVE le 30/09/2026 — reste 20,00 $");
    expect(messageReglements([{ ...r, type: "AVOIR", montant: 10, solde: false, reste: 5 }])).toBe("Avoir de 10,00 $ sur la facture n° 12 de SENEVE le 30/09/2026 — reste 5,00 $");
    expect(messageReglements([r, { ...r, numero: "13", montant: 10 }])).toBe("2 factures payées le 30/09/2026 — 1 260,50 $ (SENEVE n° 12, SENEVE n° 13)");
  });
});
