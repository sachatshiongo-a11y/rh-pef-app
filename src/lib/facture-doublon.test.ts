import { describe, it, expect } from "vitest";
import { chercherDoublonFacture, messageDoublonFacture, type FactureExistante, type FactureComparable } from "@/lib/facture-doublon";
import { fournisseurIdentique, fournisseursProches } from "@/lib/fournisseur-match";

const ex = (o: Partial<FactureExistante> = {}): FactureExistante => ({ id: "e1", fournisseurId: "f1", fournisseurNom: "ETS SENEVE", numero: "FA-001", date: "2026-09-10", annee: 2026, mois: 9, devise: "USD", montant: 100, ...o });
const nv = (o: Partial<FactureComparable> = {}): FactureComparable => ({ fournisseurId: "f1", fournisseurNom: "ETS SENEVE", numero: "FA-777", date: "2026-09-20", annee: 2026, mois: 9, devise: "USD", montant: 100, ...o });

describe("facture saisie deux fois", () => {
  it("même fournisseur + même numéro (écrit autrement) : MEME_NUMERO", () => {
    expect(chercherDoublonFacture(nv({ numero: "fa 001" }), [ex()])?.type).toBe("MEME_NUMERO");
    expect(chercherDoublonFacture(nv({ numero: "FA-001", montant: 5, date: "2027-01-01", annee: 2027, mois: 1 }), [ex()])?.type).toBe("MEME_NUMERO");
  });
  it("même numéro chez un AUTRE fournisseur : permis", () => {
    expect(chercherDoublonFacture(nv({ numero: "FA-001", fournisseurId: "f2", fournisseurNom: "AUTRE" }), [ex()])).toBeNull();
  });
  it("même fournisseur, même montant, à 10 jours : PROCHE (avertissement)", () => {
    expect(chercherDoublonFacture(nv(), [ex()])?.type).toBe("PROCHE");
  });
  it("à 14 jours pile : proche ; à 15 jours : non", () => {
    expect(chercherDoublonFacture(nv({ date: "2026-09-24" }), [ex()])?.type).toBe("PROCHE");
    expect(chercherDoublonFacture(nv({ date: "2026-09-25" }), [ex()])).toBeNull();
  });
  it("même montant mais autre devise (100 $ ≠ 100 FC) ou autre montant : rien", () => {
    expect(chercherDoublonFacture(nv({ devise: "CDF" }), [ex()])).toBeNull();
    expect(chercherDoublonFacture(nv({ montant: 100.5 }), [ex()])).toBeNull();
  });
  it("fournisseur reconnu par le nom quand l'identifiant manque d'un côté", () => {
    expect(chercherDoublonFacture(nv({ fournisseurId: null, fournisseurNom: "ets séneve" }), [ex({ fournisseurId: null })])?.type).toBe("PROCHE");
  });
  it("sans date : comparé au mois", () => {
    expect(chercherDoublonFacture(nv({ date: null }), [ex()])?.type).toBe("PROCHE");
    expect(chercherDoublonFacture(nv({ date: null, annee: 2026, mois: 10 }), [ex({ date: null })])).toBeNull();
  });
  it("le message dit ce qui existe", () => {
    const d = chercherDoublonFacture(nv({ numero: "FA-001" }), [ex()])!;
    expect(messageDoublonFacture(d, (dv, m) => `${m} ${dv}`)).toMatch(/n° FA-001[\s\S]*100 USD[\s\S]*10\/09\/2026/);
  });
});

describe("fournisseur : l'identique s'applique, le proche se propose", () => {
  const L = [{ id: "1", nom: "Maison Kathy" }, { id: "2", nom: "ETS SENEVE" }, { id: "3", nom: "Maman Kathy" }];
  it("nom identique à la casse, aux accents et aux espaces près : rattaché", () => {
    expect(fournisseurIdentique("ets  séneve", L)?.id).toBe("2");
  });
  it("nom qui ressemble seulement (« Kathy ») : pas de rattachement, des propositions", () => {
    expect(fournisseurIdentique("Kathy", L)).toBeNull();
    expect(fournisseursProches("Kathy", L).map((f) => f.nom).sort()).toEqual(["Maison Kathy", "Maman Kathy"]);
  });
  it("deux fournisseurs de même nom : rattachement refusé, les deux proposés", () => {
    const D = [{ id: "1", nom: "Seneve" }, { id: "2", nom: "SENEVE" }];
    expect(fournisseurIdentique("seneve", D)).toBeNull();
    expect(fournisseursProches("seneve", D)).toHaveLength(2);
  });
});
