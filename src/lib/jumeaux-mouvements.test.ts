import { describe, it, expect } from "vitest";
import { cleJumeau, apparierUnAUn, controleApresRetrait } from "./jumeaux-mouvements";

// Un « jumeau » est un mouvement STRICTEMENT identique : même article, même date (date pure),
// même type, même quantité. Jamais deviné, jamais apparié deux fois.

const m = (id: string, articleId: string, date: string | Date, type: string, quantite: number | string) =>
  ({ id, articleId, date, type, quantite });

describe("cleJumeau — égalité stricte, formats normalisés", () => {
  it("une quantité Decimal « 5.000 », « 5 » et 5 donnent la même clé", () => {
    expect(cleJumeau(m("a", "A", "2026-09-10", "ENTREE", "5.000"))).toBe(cleJumeau(m("b", "A", "2026-09-10", "ENTREE", 5)));
    expect(cleJumeau(m("a", "A", "2026-09-10", "ENTREE", "5"))).toBe(cleJumeau(m("b", "A", "2026-09-10", "ENTREE", 5)));
  });

  it("une date @db.Date (minuit UTC) et la chaîne AAAA-MM-JJ donnent la même clé", () => {
    expect(cleJumeau(m("a", "A", new Date("2026-09-10T00:00:00.000Z"), "SORTIE", 2))).toBe(cleJumeau(m("b", "A", "2026-09-10", "SORTIE", 2)));
  });

  it("l'arrondi flottant ne crée pas de faux écart (0,1 + 0,2)", () => {
    expect(cleJumeau(m("a", "A", "2026-09-10", "SORTIE", 0.1 + 0.2))).toBe(cleJumeau(m("b", "A", "2026-09-10", "SORTIE", "0.300")));
  });

  it("article, date, type ou quantité différents → clés différentes", () => {
    const base = cleJumeau(m("a", "A", "2026-09-10", "ENTREE", 5));
    expect(cleJumeau(m("b", "B", "2026-09-10", "ENTREE", 5))).not.toBe(base);
    expect(cleJumeau(m("b", "A", "2026-09-11", "ENTREE", 5))).not.toBe(base);
    expect(cleJumeau(m("b", "A", "2026-09-10", "SORTIE", 5))).not.toBe(base);
    expect(cleJumeau(m("b", "A", "2026-09-10", "ENTREE", 5.001))).not.toBe(base);
  });
});

describe("apparierUnAUn", () => {
  it("apparie les jumeaux exacts et laisse les autres de chaque côté", () => {
    const refs = [m("r1", "A", "2026-09-10", "ENTREE", 5), m("r2", "B", "2026-09-10", "SORTIE", 1)];
    const cands = [m("c1", "A", "2026-09-10", "ENTREE", 5), m("c2", "B", "2026-09-10", "SORTIE", 2)];
    const r = apparierUnAUn(refs, cands);
    expect(r.paires.map((p) => [p.reference.id, p.candidat.id])).toEqual([["r1", "c1"]]);
    expect(r.candidatsSeuls.map((c) => c.id)).toEqual(["c2"]);
    expect(r.referencesSeules.map((c) => c.id)).toEqual(["r2"]);
  });

  it("plusieurs candidats identiques : un à un, jamais deux fois la même référence", () => {
    const refs = [m("r1", "A", "2026-09-10", "SORTIE", 3), m("r2", "A", "2026-09-10", "SORTIE", 3)];
    const cands = [m("c1", "A", "2026-09-10", "SORTIE", 3), m("c2", "A", "2026-09-10", "SORTIE", 3), m("c3", "A", "2026-09-10", "SORTIE", 3)];
    const r = apparierUnAUn(refs, cands);
    expect(r.paires.map((p) => [p.reference.id, p.candidat.id])).toEqual([["r1", "c1"], ["r2", "c2"]]);
    expect(r.candidatsSeuls.map((c) => c.id)).toEqual(["c3"]);
    expect(new Set(r.paires.map((p) => p.reference.id)).size).toBe(r.paires.length);
    expect(new Set(r.paires.map((p) => p.candidat.id)).size).toBe(r.paires.length);
  });

  it("plus de références que de candidats : les références en trop restent seules", () => {
    const refs = [m("r1", "A", "2026-09-10", "ENTREE", 1), m("r2", "A", "2026-09-10", "ENTREE", 1)];
    const r = apparierUnAUn(refs, [m("c1", "A", "2026-09-10", "ENTREE", 1)]);
    expect(r.paires).toHaveLength(1);
    expect(r.referencesSeules.map((x) => x.id)).toEqual(["r2"]);
  });

  it("listes vides", () => {
    expect(apparierUnAUn([], [])).toEqual({ paires: [], candidatsSeuls: [], referencesSeules: [] });
  });
});

describe("controleApresRetrait — chaque mouvement compté une seule fois", () => {
  const refs = [m("r1", "A", "2026-09-10", "ENTREE", 5), m("r2", "A", "2026-09-11", "SORTIE", 2)];
  const cands = [m("c1", "A", "2026-09-10", "ENTREE", 5), m("c2", "A", "2026-09-11", "SORTIE", 2), m("c3", "A", "2026-09-12", "SORTIE", 1)];

  it("retirer exactement les copies appariées → aucun écart", () => {
    const c = controleApresRetrait(refs, cands, new Set(["c1", "c2"]));
    expect(c.ecarts).toEqual([]);
    expect(c.verifies).toBeGreaterThan(0);
  });

  it("oublier une copie → écart signalé (le mouvement compterait deux fois)", () => {
    expect(controleApresRetrait(refs, cands, new Set(["c1"])).ecarts.length).toBe(1);
  });

  it("retirer un mouvement SANS jumeau → écart signalé (il disparaîtrait)", () => {
    expect(controleApresRetrait(refs, cands, new Set(["c1", "c2", "c3"])).ecarts.length).toBe(1);
  });
});
