import { describe, expect, it } from "vitest";
import {
  calculerHeuresDepuisPointages,
  apparierPointages,
  type PointageBrut,
} from "./pointage";

function p(idExterne: string, iso: string): PointageBrut {
  return { idExterne, dateHeure: new Date(iso) };
}

describe("calculerHeuresDepuisPointages — méthode première/dernière", () => {
  it("calcule la durée entre première entrée et dernière sortie", () => {
    const r = calculerHeuresDepuisPointages([
      p("A1", "2026-06-01T08:00:00Z"),
      p("A1", "2026-06-01T12:00:00Z"),
      p("A1", "2026-06-01T13:00:00Z"),
      p("A1", "2026-06-01T17:30:00Z"),
    ]);
    expect(r.jours).toHaveLength(1);
    expect(r.jours[0].heures).toBe(9.5); // 08:00 → 17:30
    expect(r.anomalies).toHaveLength(0);
  });

  it("signale un pointage unique sans l'appliquer", () => {
    const r = calculerHeuresDepuisPointages([p("A1", "2026-06-01T08:00:00Z")]);
    expect(r.jours).toHaveLength(0);
    expect(r.anomalies[0].type).toBe("POINTAGE_UNIQUE");
  });

  it("signale une durée aberrante sans l'appliquer", () => {
    const r = calculerHeuresDepuisPointages(
      [p("A1", "2026-06-01T06:00:00Z"), p("A1", "2026-06-01T23:59:00Z")],
      { dureeMaxH: 16 }
    );
    expect(r.jours).toHaveLength(0);
    expect(r.anomalies[0].type).toBe("DUREE_ABERRANTE");
  });

  it("sépare les jours et les employés", () => {
    const r = calculerHeuresDepuisPointages([
      p("A1", "2026-06-01T08:00:00Z"),
      p("A1", "2026-06-01T16:00:00Z"),
      p("A1", "2026-06-02T08:00:00Z"),
      p("A1", "2026-06-02T17:00:00Z"),
      p("B2", "2026-06-01T09:00:00Z"),
      p("B2", "2026-06-01T18:00:00Z"),
    ]);
    expect(r.jours).toHaveLength(3);
    expect(r.jours.find((j) => j.idExterne === "A1" && j.date === "2026-06-01")?.heures).toBe(8);
    expect(r.jours.find((j) => j.idExterne === "B2")?.heures).toBe(9);
  });
});

describe("calculerHeuresDepuisPointages — méthode paires (entrées/sorties)", () => {
  it("somme les durées de chaque paire entrée/sortie", () => {
    const r = calculerHeuresDepuisPointages(
      [
        p("A1", "2026-06-01T08:00:00Z"),
        p("A1", "2026-06-01T12:00:00Z"), // matin 4h
        p("A1", "2026-06-01T13:00:00Z"),
        p("A1", "2026-06-01T17:00:00Z"), // après-midi 4h
      ],
      { methode: "PAIRES" }
    );
    expect(r.jours[0].heures).toBe(8); // 4 + 4, pas de pause comptée
  });
});

describe("apparierPointages", () => {
  it("relie les ID IVMS aux employés et signale les non appariés", () => {
    const resultat = calculerHeuresDepuisPointages([
      p("IVMS-1", "2026-06-01T08:00:00Z"),
      p("IVMS-1", "2026-06-01T16:00:00Z"),
      p("INCONNU", "2026-06-01T08:00:00Z"),
      p("INCONNU", "2026-06-01T16:00:00Z"),
    ]);
    const correspondance = new Map([["IVMS-1", "emp-123"]]);
    const { apparies, anomalies } = apparierPointages(resultat, correspondance);

    expect(apparies).toHaveLength(1);
    expect(apparies[0].employeeId).toBe("emp-123");
    expect(anomalies.some((a) => a.type === "NON_APPARIE" && a.idExterne === "INCONNU")).toBe(true);
  });
});
