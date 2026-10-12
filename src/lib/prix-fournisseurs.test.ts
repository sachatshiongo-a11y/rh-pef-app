import { describe, it, expect } from "vitest";
import { achatDeLigneBon, achatDeLigneFacture, achatDeMouvement, comparerPrix, dernierPrixParFournisseur, prixALUniteArticle, type AchatFournisseur } from "./prix-fournisseurs";
import Decimal from "decimal.js";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const achat = (o: Partial<AchatFournisseur> & { fournisseurId: string; prixUnitaire: string | number }): AchatFournisseur =>
  ({ date: d("2026-09-01"), origine: "FACTURE", refId: "r", refLibelle: "n", devise: "USD", uniteLigne: null, ...o });

describe("lecture des trois sources", () => {
  it("achat direct en FRANCS : montant saisi ÷ quantité, sans repasser par les dollars", () => {
    // montantUSD volontairement « faux » : il ne doit jamais servir pour un achat saisi en francs.
    const a = achatDeMouvement({ fournisseurId: "f", date: d("2026-09-01"), quantite: "10", devise: "CDF", montantOrigine: "28000", montantUSD: "999" })!;
    expect(a.devise).toBe("CDF");
    expect(new Decimal(String(a.prixUnitaire)).toString()).toBe("2800");
  });
  it("achat direct en dollars (ancienne ligne sans devise : montantUSD)", () => {
    expect(String(achatDeMouvement({ fournisseurId: "f", date: d("2026-09-01"), quantite: "4", devise: null, montantOrigine: null, montantUSD: "10" })!.prixUnitaire)).toBe("2.5");
  });
  it("sans fournisseur, sans quantité ou sans montant : pas d'achat (jamais un prix à 0)", () => {
    const base = { fournisseurId: "f", date: d("2026-09-01"), quantite: "4", devise: "USD" as const, montantOrigine: "8", montantUSD: "8" };
    expect(achatDeMouvement({ ...base, fournisseurId: null })).toBeNull();
    expect(achatDeMouvement({ ...base, quantite: "0" })).toBeNull();
    expect(achatDeMouvement({ ...base, montantOrigine: null, montantUSD: null })).toBeNull();
    expect(achatDeMouvement({ ...base, devise: "CDF", montantOrigine: null })).toBeNull(); // francs sans montant en francs : on ne reprend pas le dollar
  });
  it("ligne de facture : le prix dans la devise de sa facture ; sans date ou sans fournisseur : rien ; 0 = pas de prix", () => {
    const l = { prixUnitaireUSD: null, prixUnitaireCDF: "7000", unite: "kg", facture: { id: "F", numero: "12", date: d("2026-09-02"), fournisseurId: "f", devise: "CDF" as const } };
    expect(achatDeLigneFacture(l)).toMatchObject({ devise: "CDF", origine: "FACTURE", refId: "F", refLibelle: "12" });
    expect(achatDeLigneFacture({ ...l, facture: { ...l.facture, date: null } })).toBeNull();
    expect(achatDeLigneFacture({ ...l, facture: { ...l.facture, fournisseurId: null } })).toBeNull();
    expect(achatDeLigneFacture({ ...l, prixUnitaireCDF: "0" })).toBeNull();
  });
  it("ligne de bon : seulement un bon ENGAGÉ (ni brouillon ni annulé), dans la devise du bon", () => {
    const l = { prixUnitaireUSD: "3", prixUnitaireCDF: null, unite: null, bon: { id: "B", numero: "001/PEF", date: d("2026-09-03"), fournisseurId: "f", devise: "USD" as const, statut: "VALIDE" } };
    expect(achatDeLigneBon(l)).toMatchObject({ origine: "BON_COMMANDE", devise: "USD" });
    for (const statut of ["BROUILLON", "ANNULE"]) expect(achatDeLigneBon({ ...l, bon: { ...l.bon, statut } })).toBeNull();
    expect(achatDeLigneBon({ ...l, prixUnitaireUSD: null })).toBeNull();
  });
});

describe("prix ramené à l'unité de l'article", () => {
  const kg = { unite: "kg" };
  it("même unité ou unité de ligne vide : tel quel", () => {
    expect(prixALUniteArticle(new Decimal(5), null, kg)).toEqual({ ok: true, prix: new Decimal(5) });
    expect(prixALUniteArticle(new Decimal(5), "Kg", kg)).toEqual({ ok: true, prix: new Decimal(5) });
  });
  it("gramme → kilo, litre → centilitre (porte unique des conversions)", () => {
    const r = prixALUniteArticle(new Decimal("0.0012"), "g", kg);
    expect(r.ok && r.prix.toString()).toBe("1.2");
    const b = prixALUniteArticle(new Decimal(2), "l", { unite: "cl" });
    expect(b.ok && b.prix.toString()).toBe("0.02");
  });
  it("carton → ÷ unités par carton ; sans ce nombre, refus qui l'explique", () => {
    const ok = prixALUniteArticle(new Decimal(24), "Carton", { unite: "pièce", uniteParCarton: 12 });
    expect(ok.ok && ok.prix.toString()).toBe("2");
    expect(prixALUniteArticle(new Decimal(24), "Carton", { unite: "pièce" })).toMatchObject({ ok: false, motif: expect.stringMatching(/unités par carton/) });
  });
  it("conversion impossible : refus qui nomme les deux unités, jamais un prix deviné", () => {
    expect(prixALUniteArticle(new Decimal(3), "botte", kg)).toMatchObject({ ok: false, motif: expect.stringMatching(/« botte ».*« kg »/) });
    expect(prixALUniteArticle(new Decimal(3), "kg", { unite: null })).toMatchObject({ ok: false });
  });
});

describe("dernier prix par fournisseur", () => {
  it("le plus récent de chaque fournisseur ; à date égale la facture prime sur la Liste d'achat puis le bon", () => {
    const r = dernierPrixParFournisseur([
      achat({ fournisseurId: "f1", prixUnitaire: 1, date: d("2026-08-01") }),
      achat({ fournisseurId: "f1", prixUnitaire: 2, date: d("2026-09-01"), origine: "BON_COMMANDE" }),
      achat({ fournisseurId: "f1", prixUnitaire: 3, date: d("2026-09-01"), origine: "FACTURE" }),
      achat({ fournisseurId: "f2", prixUnitaire: 9, date: d("2026-07-01") }),
    ], { unite: "kg" });
    const p = Object.fromEntries(r.map((x) => [x.fournisseurId, x]));
    expect(p.f1).toMatchObject({ prix: "3", origine: "FACTURE", nbAchats: 3 });
    expect(p.f2).toMatchObject({ prix: "9", nbAchats: 1 });
    expect(r.map((x) => x.fournisseurId)).toEqual(["f1", "f2"]); // le plus récent d'abord
  });
  it("un achat sans prix n'est pas un prix : le fournisseur n'apparaît pas", () => {
    expect(dernierPrixParFournisseur([achat({ fournisseurId: "f1", prixUnitaire: 0 })], { unite: "kg" })).toEqual([]);
  });
  it("une unité non convertible garde le prix SAISI et est marquée (prix null)", () => {
    const [x] = dernierPrixParFournisseur([achat({ fournisseurId: "f1", prixUnitaire: 5, uniteLigne: "botte" })], { unite: "kg" });
    expect(x).toMatchObject({ prix: null, prixSaisi: "5", uniteLigne: "botte", motif: expect.any(String) });
  });
});

describe("comparaison : qui est le moins cher", () => {
  const dp = (fournisseurId: string, devise: "USD" | "CDF", prixUnitaire: string) => dernierPrixParFournisseur([achat({ fournisseurId, devise, prixUnitaire })], { unite: "kg" })[0]!;
  it("même devise : classement direct, sans taux ; écart en % au moins cher", () => {
    const c = comparerPrix([dp("a", "USD", "1.2"), dp("b", "USD", "1"), dp("c", "USD", "1.5")], null);
    expect(c.etat).toBe("COMPARE");
    expect(c.lignes.filter((l) => l.moinsCher).map((l) => l.fournisseurId)).toEqual(["b"]);
    expect(Object.fromEntries(c.lignes.map((l) => [l.fournisseurId, Math.round(l.ecartPct ?? -1)]))).toEqual({ a: 20, b: 0, c: 50 });
    expect(c.lignes.every((l) => l.autre === null)).toBe(true); // pas de taux : pas d'« ≈ »
  });
  it("devises mêlées avec taux : comparées en dollars (« ≈ ») ; chaque prix reste dans sa devise de saisie", () => {
    const c = comparerPrix([dp("a", "CDF", "2800"), dp("b", "USD", "1.2")], 2800);
    expect(c.lignes.find((l) => l.fournisseurId === "a")).toMatchObject({ moinsCher: true, devise: "CDF", prix: "2800", autre: { devise: "USD", valeur: 1 } });
    expect(c.lignes.find((l) => l.fournisseurId === "b")).toMatchObject({ moinsCher: false, devise: "USD", prix: "1.2" });
  });
  it("devises mêlées SANS taux : comparaison impossible, aucun « moins cher » inventé", () => {
    const c = comparerPrix([dp("a", "CDF", "2800"), dp("b", "USD", "1.2")], null);
    expect(c.etat).toBe("DEVISES_SANS_TAUX");
    expect(c.lignes.some((l) => l.moinsCher || l.ecartPct !== null)).toBe(false);
  });
  it("un seul prix comparable : rien à comparer ; une unité non convertible ne participe pas", () => {
    const hors = dernierPrixParFournisseur([achat({ fournisseurId: "x", prixUnitaire: 0.1, uniteLigne: "botte" })], { unite: "kg" })[0]!;
    const c = comparerPrix([dp("a", "USD", "1.2"), hors], null);
    expect(c.etat).toBe("UN_SEUL");
    expect(c.lignes.some((l) => l.moinsCher)).toBe(false);
    expect(comparerPrix([], 2800).etat).toBe("AUCUN");
  });
  it("égalité : les deux sont « moins cher »", () => {
    const c = comparerPrix([dp("a", "USD", "1"), dp("b", "USD", "1.00")], null);
    expect(c.lignes.every((l) => l.moinsCher)).toBe(true);
  });
});
