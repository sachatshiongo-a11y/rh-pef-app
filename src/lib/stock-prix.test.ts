import { describe, it, expect } from "vitest";
import { analyserPrix, SEUIL_HAUSSE_PRIX, type PointPrix } from "./stock-prix";

const p = (jour: number, prix: number): PointPrix => ({ date: new Date(Date.UTC(2026, 0, jour)), prix, qte: 1, factureId: `f${jour}`, numero: `F${jour}` });

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
