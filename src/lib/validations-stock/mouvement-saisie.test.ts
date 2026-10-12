import { describe, it, expect } from "vitest";
import { lireMouvementSaisi } from "./mouvement";
import { lireDateJour } from "@/lib/achats-liste";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";

// Lecture du formulaire « Mouvement manuel » : date jamais future, motif obligatoire d'une ENTRÉE
// comme celui d'une sortie (audit du 10/10/2026, stock 13 et 20).

const formulaire = (champs: Record<string, string>) => {
  const fd = new FormData();
  fd.append("articleId", "a1");
  fd.append("quantite", "2");
  for (const [k, v] of Object.entries(champs)) fd.append(k, v);
  return fd;
};
const demain = () => { const d = new Date(`${jourCourantKinshasaISO()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

describe("date d'un mouvement manuel", () => {
  it("refuse une date future", () => {
    expect(() => lireMouvementSaisi(formulaire({ type: "ENTREE", origine: "don", date: demain() }))).toThrow(/futur/);
  });
  it("accepte aujourd'hui et une date passée, et date du jour de Kinshasa quand elle est vide", () => {
    expect(lireMouvementSaisi(formulaire({ type: "ENTREE", origine: "don", date: jourCourantKinshasaISO() })).date.toISOString().slice(0, 10)).toBe(jourCourantKinshasaISO());
    expect(lireMouvementSaisi(formulaire({ type: "ENTREE", origine: "don", date: "2026-01-05" })).date.toISOString().slice(0, 10)).toBe("2026-01-05");
    expect(lireMouvementSaisi(formulaire({ type: "ENTREE", origine: "don" })).date.toISOString().slice(0, 10)).toBe(jourCourantKinshasaISO());
  });
  it("lireDateJour nomme ce qui est daté", () => {
    expect(() => lireDateJour(demain(), "de la facture")).toThrow("La date de la facture ne peut pas être dans le futur.");
    expect(() => lireDateJour("31/12/2026", "du mouvement")).toThrow("Date du mouvement invalide.");
  });
});

describe("motif d'une entrée manuelle", () => {
  it("refuse une entrée sans motif", () => {
    expect(() => lireMouvementSaisi(formulaire({ type: "ENTREE" }))).toThrow(/motif de l'entrée/);
    expect(() => lireMouvementSaisi(formulaire({ type: "ENTREE", origine: "   " }))).toThrow(/motif de l'entrée/);
  });
  it("accepte un motif écrit, ou « Retour restaurant »", () => {
    expect(lireMouvementSaisi(formulaire({ type: "ENTREE", origine: "don du voisin" })).origine).toBe("don du voisin");
    const r = lireMouvementSaisi(formulaire({ type: "ENTREE", motifEntree: "RETOUR_RESTAURANT" }));
    expect(r.retourRestaurant).toBe(true);
    expect(r.origine).toBe("Retour restaurant");
  });
});
