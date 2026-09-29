import { describe, it, expect } from "vitest";
import { dateDuSolde, joursDuSolde, libelleSolde, soldeFigeDe } from "./solde-conge-imprime";

// Le solde imprimé sur une demande de congé (décision Direction 2026-09-29) : figé à l'approbation,
// sinon celui du jour d'édition — et la date dit toujours lequel des deux on lit.
const fige = { soldeFigeJours: 12.5, soldeFigeLe: new Date("2026-09-29T10:00:00Z") };

describe("soldeFigeDe — le chiffre figé ne fait foi que sur une demande APPROUVÉE", () => {
  it("demande approuvée avec instantané : le figé, daté de l'approbation", () => {
    expect(soldeFigeDe({ statut: "APPROUVE", ...fige })).toEqual({
      jours: 12.5, au: new Date("2026-09-29T10:00:00Z"), origine: "APPROBATION",
    });
  });
  it("un Decimal Prisma (objet à toString) est lu comme un nombre", () => {
    expect(soldeFigeDe({ statut: "APPROUVE", soldeFigeJours: { toString: () => "-1.5" }, soldeFigeLe: fige.soldeFigeLe })?.jours).toBe(-1.5);
  });
  it("demande approuvée AVANT le changement (aucun instantané) : rien de figé, rien de reconstitué", () => {
    expect(soldeFigeDe({ statut: "APPROUVE", soldeFigeJours: null, soldeFigeLe: null })).toBeNull();
  });
  it("instantané incomplet : ignoré", () => {
    expect(soldeFigeDe({ statut: "APPROUVE", soldeFigeJours: 3, soldeFigeLe: null })).toBeNull();
    expect(soldeFigeDe({ statut: "APPROUVE", soldeFigeJours: null, soldeFigeLe: fige.soldeFigeLe })).toBeNull();
  });
  it("demande EN ATTENTE ou REFUSÉE : jamais le figé, même s'il en restait un", () => {
    expect(soldeFigeDe({ statut: "EN_ATTENTE", ...fige })).toBeNull();
    expect(soldeFigeDe({ statut: "REFUSE", ...fige })).toBeNull();
  });
});

describe("présentation", () => {
  it("figé : « après approbation », daté de l'approbation", () => {
    const s = { jours: 12.5, au: new Date("2026-09-29T10:00:00Z"), origine: "APPROBATION" as const };
    expect(libelleSolde(s)).toBe("Solde de congé annuel après approbation");
    expect(dateDuSolde(s)).toBe("au 29/09/2026, date d'approbation");
    expect(joursDuSolde(s)).toBe("12,5 jours");
  });
  it("du jour : « disponible », daté de l'édition", () => {
    const s = { jours: 18, au: new Date("2026-10-15T09:00:00Z"), origine: "EDITION" as const };
    expect(libelleSolde(s)).toBe("Solde de congé annuel disponible");
    expect(dateDuSolde(s)).toBe("au 15/10/2026, date d'édition");
    expect(joursDuSolde(s)).toBe("18 jours");
  });
  it("« jour » au singulier jusqu'à 1 inclus (en valeur absolue), « jours » au-delà", () => {
    const j = (jours: number) => joursDuSolde({ jours, au: new Date("2026-09-29T10:00:00Z"), origine: "APPROBATION" });
    expect(j(0)).toBe("0 jour");
    expect(j(0.5)).toBe("0,5 jour");
    expect(j(1)).toBe("1 jour");
    expect(j(1.5)).toBe("1,5 jours");
    expect(j(2)).toBe("2 jours");
    expect(j(-0.5)).toBe("-0,5 jour");
    expect(j(-3)).toBe("-3 jours");
  });
  it("la date est le jour de KINSHASA (UTC+1), pas celui du serveur", () => {
    // 23 h 30 UTC le 28 = 0 h 30 le 29 à Kinshasa : l'approbation a eu lieu le 29.
    expect(dateDuSolde({ jours: 1, au: new Date("2026-09-28T23:30:00Z"), origine: "APPROBATION" })).toBe("au 29/09/2026, date d'approbation");
  });
  it("aucun caractère absent d'Optima (espace fine insécable, flèche, symbole d'alerte)", () => {
    const s = { jours: -1234.5, au: new Date("2026-09-29T10:00:00Z"), origine: "APPROBATION" as const };
    for (const t of [libelleSolde(s), dateDuSolde(s), joursDuSolde(s)]) expect(t).not.toMatch(/[  →⚠]/);
  });
});
