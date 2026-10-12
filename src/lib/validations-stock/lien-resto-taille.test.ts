import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ journaliserPlusieurs: async () => {} }));
import { obstaclesLiens } from "./lien-resto";
import type { OperationLien } from "./charge";

// Deux marques de MÊME unité (Pièce) mais de tailles différentes ne s'additionnent pas au restaurant.
type Art = { id: string; designation: string; unite: string; contenance: string | null; contenanceUnite: string | null };
const P: Art = { id: "P", designation: "Président 250 g", unite: "Pièce", contenance: "250", contenanceUnite: "g" };
const L: Art = { id: "L", designation: "Lurpak 500 g", unite: "Pièce", contenance: "500", contenanceUnite: "g" };
const L2: Art = { id: "L2", designation: "Autre 250 g", unite: "Pièce", contenance: "250", contenanceUnite: "g" };
const KG1: Art = { id: "K1", designation: "Sel A", unite: "kg", contenance: null, contenanceUnite: null };
const KG2: Art = { id: "K2", designation: "Sel B", unite: "Kg", contenance: null, contenanceUnite: null };
const OEUF1: Art = { id: "O1", designation: "Oeufs A", unite: "Pièce", contenance: null, contenanceUnite: null };
const OEUF2: Art = { id: "O2", designation: "Oeufs B", unite: "Pièce", contenance: null, contenanceUnite: null };

function tx(uniteResto: string, deja: Art[], catalogue: Art[]) {
  return {
    articleResto: { findMany: async () => [{ id: "R", espace: "CUISINE", unite: uniteResto }] },
    articleStock: { findMany: async () => catalogue.map((a) => ({ ...a, actif: true })) },
    articleRestoStock: { findMany: async (q: { where: Record<string, unknown> }) => ("articleRestoId" in q.where ? deja.map((a) => ({ articleRestoId: "R", articleStock: a })) : []) },
  } as never;
}
const ajout = (a: Art): OperationLien => ({ op: "AJOUT", articleRestoId: "R", articleRestoDesignation: "Beurre", espace: "CUISINE", articleStockId: a.id, articleStockDesignation: a.designation });

describe("rattacher une marque : même taille d'unité", () => {
  it("Pièce de 500 g sur un article déjà rattaché à une Pièce de 250 g : refusé", async () => {
    const o = await obstaclesLiens(tx("Pièce", [P], [L]), [ajout(L)]);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatch(/contenance/);
  });
  it("même taille (250 g / 250 g), kg / Kg, ou comptage pur sans contenance : accepté", async () => {
    expect(await obstaclesLiens(tx("Pièce", [P], [L2]), [ajout(L2)])).toEqual([]);
    expect(await obstaclesLiens(tx("kg", [KG1], [KG2]), [ajout(KG2)])).toEqual([]);
    expect(await obstaclesLiens(tx("Pièce", [OEUF1], [OEUF2]), [ajout(OEUF2)])).toEqual([]);
  });
  it("deux marques de tailles différentes ajoutées DANS LE MÊME lot : la seconde est refusée", async () => {
    const o = await obstaclesLiens(tx("Pièce", [], [P, L]), [ajout(P), ajout(L)]);
    expect(o).toHaveLength(1);
  });
  it("Pièce sans contenance face à une Pièce de 250 g : refusé (taille inconnue)", async () => {
    expect(await obstaclesLiens(tx("Pièce", [P], [OEUF1]), [ajout(OEUF1)])).toHaveLength(1);
  });
});
