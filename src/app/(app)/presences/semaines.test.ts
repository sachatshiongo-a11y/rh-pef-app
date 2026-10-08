import { describe, it, expect } from "vitest";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { libelleSemaine, lundiDeIso, semaineDuJour, semaineParDefaut, semainesDuMois } from "./semaines";

describe("semaines (lundi → dimanche) de la période", () => {
  it("octobre 2026 (le 1er est un jeudi) : 5 semaines, la première commence le lundi 28 septembre", () => {
    const s = semainesDuMois(2026, 10);
    expect(s).toHaveLength(5);
    expect(s[0].isos).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    // Les jours d'une autre période restent visibles mais hors période (null) : on ne les saisit pas ici.
    expect(s[0].jours).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(s[1].jours).toEqual([5, 6, 7, 8, 9, 10, 11]);
    expect(s[4].jours).toEqual([26, 27, 28, 29, 30, 31, null]);
  });

  it("chaque jour du mois apparaît dans exactement une semaine", () => {
    for (const [a, m, n] of [[2026, 2, 28], [2024, 2, 29], [2026, 3, 31], [2026, 11, 30]] as const) {
      const jours = semainesDuMois(a, m).flatMap((s) => s.jours).filter((j): j is number => j !== null);
      expect(jours).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it("un mois qui commence un lundi n'a pas de jours hors période en tête", () => {
    const s = semainesDuMois(2026, 6); // le 1er juin 2026 est un lundi
    expect(s[0].jours[0]).toBe(1);
    expect(s[0].lundi).toBe("2026-06-01");
  });

  it("la période peut être bornée aux premiers jours (les semaines ne dépassent pas le dernier jour)", () => {
    const s = semainesDuMois(2026, 9, 2);
    expect(s).toHaveLength(1);
    expect(s[0].jours).toEqual([null, 1, 2, null, null, null, null]);
  });

  it("lundiDeIso : un dimanche appartient à la semaine qui finit, pas à la suivante", () => {
    expect(lundiDeIso("2026-10-04")).toBe("2026-09-28"); // dimanche
    expect(lundiDeIso("2026-10-05")).toBe("2026-10-05"); // lundi
    expect(lundiDeIso("2026-10-11")).toBe("2026-10-05"); // dimanche
  });

  it("semaineParDefaut : la semaine d'aujourd'hui, sinon la première (période à venir) ou la dernière (passée)", () => {
    const s = semainesDuMois(2026, 10);
    expect(semaineParDefaut(s, "2026-10-08")).toBe(1);
    expect(semaineParDefaut(s, "2026-10-04")).toBe(0); // dimanche : encore la semaine du 28 sept.
    expect(semaineParDefaut(s, "2026-09-01")).toBe(0);
    expect(semaineParDefaut(s, "2026-12-25")).toBe(4);
    expect(semaineParDefaut([], "2026-10-08")).toBe(0);
  });

  it("minuit à Kinshasa : à 23 h 30 UTC le dimanche, c'est déjà lundi là-bas, donc la semaine suivante", () => {
    const s = semainesDuMois(2026, 10);
    const instant = new Date("2026-10-04T23:30:00Z"); // dimanche 23 h 30 UTC = lundi 5 octobre 00 h 30 à Kinshasa
    expect(jourCourantKinshasaISO(instant)).toBe("2026-10-05");
    expect(semaineParDefaut(s, jourCourantKinshasaISO(instant))).toBe(1);
    // L'horloge brute (UTC) aurait ouvert la semaine d'avant.
    expect(semaineParDefaut(s, instant.toISOString().slice(0, 10))).toBe(0);
  });

  it("semaineDuJour : la semaine qui contient le jour du mois", () => {
    const s = semainesDuMois(2026, 10);
    expect(semaineDuJour(s, 1)).toBe(0);
    expect(semaineDuJour(s, 8)).toBe(1);
    expect(semaineDuJour(s, 31)).toBe(4);
  });

  it("libellé d'une semaine : dans un mois, à cheval sur deux mois", () => {
    const s = semainesDuMois(2026, 10);
    expect(libelleSemaine(s[1])).toBe("5 → 11 octobre 2026");
    expect(libelleSemaine(s[0])).toBe("28 sept. → 4 oct. 2026");
  });
});
