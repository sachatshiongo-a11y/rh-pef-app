import { describe, it, expect } from "vitest";
import { analyserPrix, articlesEnHausse, pointDeLigne, SEUIL_HAUSSE_PRIX, type PointPrix, type LignePrix } from "./stock-prix";

const p = (jour: number, prix: number): PointPrix => ({ date: new Date(Date.UTC(2026, 0, jour)), prix, qte: 1, factureId: `f${jour}`, numero: `F${jour}` });
const ligne = (articleId: string | null, jour: number, prix: number): LignePrix => ({ articleId, prixUnitaireUSD: prix, quantite: 1, facture: { id: `f${articleId}${jour}`, numero: `F${jour}`, date: new Date(Date.UTC(2026, 0, jour)) } });

describe("analyserPrix", () => {
  it("trie du plus ancien au plus récent et calcule min/max", () => {
    const a = analyserPrix([p(10, 3), p(1, 2), p(5, 4)]);
    expect(a.points.map((x) => x.prix)).toEqual([2, 4, 3]); // ordre chronologique
    expect(a.min).toBe(2);
    expect(a.max).toBe(4);
    expect(a.dernier?.prix).toBe(3);
    expect(a.precedent?.prix).toBe(4);
    expect(a.variation).toBeCloseTo(((3 - 4) / 4) * 100); // -25%
  });

  it("signale une hausse quand le dernier prix dépasse le seuil vs moyenne précédente", () => {
    // moyenne des 3 premiers = 2 ; dernier = 3 → +50% > seuil
    const a = analyserPrix([p(1, 2), p(2, 2), p(3, 2), p(4, 3)]);
    expect(a.moyenneAnterieure).toBe(2);
    expect(a.hausse).not.toBeNull();
    expect(a.hausse!.pct).toBeCloseTo(50);
  });

  it("ne signale pas de hausse sous le seuil", () => {
    // moyenne précédente = 2 ; dernier = 2 × (1 + 10%) = 2.2 < seuil 15%
    const a = analyserPrix([p(1, 2), p(2, 2), p(3, 2.2)]);
    expect(a.hausse).toBeNull();
  });

  it("gère l'absence d'historique et l'achat unique", () => {
    expect(analyserPrix([]).min).toBeNull();
    const un = analyserPrix([p(1, 5)]);
    expect(un.dernier?.prix).toBe(5);
    expect(un.precedent).toBeNull();
    expect(un.variation).toBeNull();
    expect(un.hausse).toBeNull(); // pas de moyenne précédente
  });

  it("le seuil exporté est cohérent", () => {
    expect(SEUIL_HAUSSE_PRIX).toBeGreaterThan(0);
  });
});

describe("articlesEnHausse", () => {
  it("ne retient que les articles dont le dernier achat grimpe au-dessus du seuil", () => {
    const m = articlesEnHausse([
      // A : 2 → 2 → 3  = hausse (+50% vs moyenne 2)
      ligne("A", 1, 2), ligne("A", 2, 2), ligne("A", 3, 3),
      // B : stable → pas de hausse
      ligne("B", 1, 5), ligne("B", 2, 5),
      // C : un seul achat → pas de moyenne précédente
      ligne("C", 1, 9),
      // ligne sans article → ignorée
      ligne(null, 1, 100),
    ]);
    expect([...m.keys()].sort()).toEqual(["A"]);
    expect(m.get("A")).toBeCloseTo(50);
  });

  it("ignore les lignes sans date de facture", () => {
    const sansDate: LignePrix = { articleId: "X", prixUnitaireUSD: 3, quantite: 1, facture: { id: "fx", numero: null, date: null } };
    const m = articlesEnHausse([ligne("X", 1, 1), ligne("X", 2, 1), sansDate]);
    expect(m.has("X")).toBe(false); // sans la 3e ligne (datée), pas de hausse
  });
});

describe("ligne d'une facture en francs (2026-10-09)", () => {
  const facture = (t: number | null, d = "2026-10-01") => ({ id: "f", numero: "7", date: new Date(d), tauxChangeUtilise: t });
  it("francs ÷ taux figé de la facture, « prixCDF » gardé ; sans taux, aucun point (jamais 0)", () => {
    expect(pointDeLigne({ articleId: "a", prixUnitaireUSD: null, prixUnitaireCDF: "7000", quantite: "2", facture: facture(2800) })).toMatchObject({ prix: 2.5, prixCDF: 7000, qte: 2 });
    expect(pointDeLigne({ articleId: "a", prixUnitaireUSD: null, prixUnitaireCDF: "7000", quantite: "2", facture: facture(null) })).toBeNull();
    expect(pointDeLigne({ articleId: "a", prixUnitaireUSD: "3", quantite: "1", facture: facture(null) })).toMatchObject({ prix: 3 });
  });
  it("une ligne en francs sans taux ne fabrique pas de hausse", () => {
    const lignes = [
      { articleId: "a", prixUnitaireUSD: null, prixUnitaireCDF: "7000", quantite: "1", facture: facture(null, "2026-09-01") },
      { articleId: "a", prixUnitaireUSD: "3", quantite: "1", facture: facture(null, "2026-10-01") },
    ];
    expect(articlesEnHausse(lignes).size).toBe(0);
  });
});
