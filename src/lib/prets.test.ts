import { describe, expect, it } from "vitest";
import { calculerEcheancePret } from "./prets";

// #7 — calculerEcheancePret : échéance = min(retenue mensuelle, solde AVANT ce mois), le solde
// exclut la retenue déjà enregistrée pour le mois courant (idempotence du recalcul), 0 si le
// prêt est déjà soldé, et détection du dernier mois qui solde le prêt.

describe("calculerEcheancePret — échéance = min(retenue mensuelle, solde avant ce mois)", () => {
  it("aucune retenue antérieure : échéance = retenue mensuelle, solde avant = montant du prêt", () => {
    const r = calculerEcheancePret(300, 50, [], 7, 2026);
    expect(r.echeanceUSD).toBe(50);
    expect(r.soldeAvantUSD).toBe(300);
  });

  it("retenues des mois précédents déduites du solde avant", () => {
    const retenues = [
      { mois: 5, annee: 2026, montantUSD: 50 },
      { mois: 6, annee: 2026, montantUSD: 50 },
    ];
    const r = calculerEcheancePret(300, 50, retenues, 7, 2026);
    expect(r.soldeAvantUSD).toBe(200); // 300 − 100 déjà remboursé
    expect(r.echeanceUSD).toBe(50);
  });

  it("IDEMPOTENCE : la retenue déjà enregistrée pour LE MOIS COURANT est exclue du solde avant (un recalcul du même mois ne double-compte pas)", () => {
    const retenues = [
      { mois: 6, annee: 2026, montantUSD: 50 },
      { mois: 7, annee: 2026, montantUSD: 50 }, // déjà écrite pour juillet (mois qu'on recalcule)
    ];
    const r = calculerEcheancePret(300, 50, retenues, 7, 2026);
    // Le solde avant juillet ne doit PAS soustraire la retenue de juillet elle-même — seule
    // celle de juin (mois "hors" juillet) compte.
    expect(r.soldeAvantUSD).toBe(250); // 300 − 50 (juin uniquement, juillet exclu du solde "avant")
    expect(r.echeanceUSD).toBe(50);
  });

  it("dernière échéance : plafonnée au solde restant (< retenue mensuelle)", () => {
    const retenues = [{ mois: 6, annee: 2026, montantUSD: 270 }];
    const r = calculerEcheancePret(300, 50, retenues, 7, 2026);
    expect(r.soldeAvantUSD).toBe(30);
    expect(r.echeanceUSD).toBe(30); // pas 50 : plafonné au solde restant
  });

  it("prêt déjà soldé avant ce mois : échéance = 0 (solde avant ≤ 0)", () => {
    const retenues = [{ mois: 6, annee: 2026, montantUSD: 300 }];
    const r = calculerEcheancePret(300, 50, retenues, 7, 2026);
    expect(r.soldeAvantUSD).toBe(0);
    expect(r.echeanceUSD).toBe(0);
  });

  it("solde avant négatif (trop remboursé par erreur) : échéance toujours 0, jamais négative", () => {
    const retenues = [{ mois: 6, annee: 2026, montantUSD: 320 }];
    const r = calculerEcheancePret(300, 50, retenues, 7, 2026);
    expect(r.soldeAvantUSD).toBe(-20);
    expect(r.echeanceUSD).toBe(0);
  });

  it("solde du prêt qui tombe exactement à 0 après cette échéance", () => {
    const retenues = [{ mois: 6, annee: 2026, montantUSD: 250 }];
    const r = calculerEcheancePret(300, 50, retenues, 7, 2026);
    expect(r.soldeAvantUSD).toBe(50);
    expect(r.echeanceUSD).toBe(50);
    expect(r.soldeAvantUSD - r.echeanceUSD).toBe(0); // le prêt est soldé après cette échéance
  });
});
