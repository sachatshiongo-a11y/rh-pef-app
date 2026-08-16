import { describe, expect, it } from "vitest";
import {
  calculerPlafondAcompte,
  libelleSourcePlafond,
  verifierMontantAcompte,
} from "@/lib/acompte-plafond";

const sansAcompte = { acomptesEngagesUSD: [] as number[] };

describe("calculerPlafondAcompte — quelle référence est retenue", () => {
  it("prend le net du mois précédent quand il existe", () => {
    const p = calculerPlafondAcompte({ netMoisPrecedentUSD: 320, salaireFicheUSD: 400, ...sansAcompte });
    expect(p.source).toBe("NET_MOIS_PRECEDENT");
    expect(p.plafondUSD).toBe(320);
  });

  it("retombe sur le salaire de la fiche quand il n'y a pas de bulletin le mois précédent", () => {
    const p = calculerPlafondAcompte({ netMoisPrecedentUSD: null, salaireFicheUSD: 400, ...sansAcompte });
    expect(p.source).toBe("SALAIRE_FICHE");
    expect(p.plafondUSD).toBe(400);
  });

  it("traite un net nul ou négatif comme une absence de référence (retombe sur la fiche)", () => {
    for (const net of [0, -12.5]) {
      const p = calculerPlafondAcompte({ netMoisPrecedentUSD: net, salaireFicheUSD: 400, ...sansAcompte });
      expect(p.source).toBe("SALAIRE_FICHE");
      expect(p.plafondUSD).toBe(400);
    }
  });

  it("ne descend jamais sous zéro, même sans salaire renseigné", () => {
    const p = calculerPlafondAcompte({ netMoisPrecedentUSD: null, salaireFicheUSD: -50, ...sansAcompte });
    expect(p.plafondUSD).toBe(0);
    expect(p.disponibleUSD).toBe(0);
  });
});

describe("calculerPlafondAcompte — cumul du mois", () => {
  it("déduit les acomptes déjà engagés du disponible", () => {
    const p = calculerPlafondAcompte({
      netMoisPrecedentUSD: 300,
      salaireFicheUSD: 400,
      acomptesEngagesUSD: [100, 50],
    });
    expect(p.dejaEngageUSD).toBe(150);
    expect(p.disponibleUSD).toBe(150);
  });

  it("ramène le disponible à zéro quand le plafond est déjà consommé, sans passer en négatif", () => {
    const p = calculerPlafondAcompte({
      netMoisPrecedentUSD: 300,
      salaireFicheUSD: 400,
      acomptesEngagesUSD: [250, 100],
    });
    expect(p.disponibleUSD).toBe(0);
  });
});

describe("verifierMontantAcompte", () => {
  const plafond300 = calculerPlafondAcompte({
    netMoisPrecedentUSD: 300,
    salaireFicheUSD: 400,
    ...sansAcompte,
  });

  it("accepte un montant sous le plafond", () => {
    expect(verifierMontantAcompte(120, plafond300)).toEqual({ ok: true });
  });

  it("accepte un montant EXACTEMENT égal au disponible", () => {
    expect(verifierMontantAcompte(300, plafond300)).toEqual({ ok: true });
  });

  it("refuse un montant au-dessus du plafond en citant la référence", () => {
    const v = verifierMontantAcompte(300.5, plafond300);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain("300,00 $");
    expect(v.message).toContain("net du mois précédent");
  });

  it("refuse le cumul du mois même si la demande isolée tient dans le plafond", () => {
    // Le piège que la règle existe pour attraper : 3 × 150 $ contre un plafond de 300 $.
    const p = calculerPlafondAcompte({
      netMoisPrecedentUSD: 300,
      salaireFicheUSD: 400,
      acomptesEngagesUSD: [150, 150],
    });
    const v = verifierMontantAcompte(150, p);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain("300,00 $ déjà engagé");
    expect(v.message).toContain("il reste 0,00 $");
  });

  it("refuse un montant nul, négatif ou non numérique", () => {
    for (const m of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(verifierMontantAcompte(m, plafond300).ok).toBe(false);
    }
  });

  it("refuse tout acompte quand il n'y a ni bulletin ni salaire de référence", () => {
    const p = calculerPlafondAcompte({ netMoisPrecedentUSD: null, salaireFicheUSD: 0, ...sansAcompte });
    const v = verifierMontantAcompte(10, p);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain("Aucun acompte possible");
  });

  it("tolère l'arrondi au demi-centime plutôt que de refuser une saisie exacte", () => {
    const p = calculerPlafondAcompte({
      netMoisPrecedentUSD: 0.1 + 0.2, // 0.30000000000000004
      salaireFicheUSD: 400,
      ...sansAcompte,
    });
    expect(verifierMontantAcompte(0.3, p)).toEqual({ ok: true });
  });
});

describe("libelleSourcePlafond", () => {
  it("nomme la référence de façon compréhensible dans les deux cas", () => {
    expect(libelleSourcePlafond("NET_MOIS_PRECEDENT")).toBe("net du mois précédent");
    expect(libelleSourcePlafond("SALAIRE_FICHE")).toContain("aucun bulletin");
  });
});
