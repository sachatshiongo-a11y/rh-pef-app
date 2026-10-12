import { describe, expect, it } from "vitest";
import {
  calculerHeuresDepuisPointages,
  apparierPointages,
  ajusterHeuresJour,
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

describe("ajusterHeuresJour — pause + shift normal", () => {
  const D = (iso: string) => new Date(iso);
  const shift = { shiftDebut: "08:00", shiftFin: "17:00" }; // journée 9 h

  it("sans shift : retire seulement la pause de 30 min", () => {
    // 08:00 → 17:00 = 9 h ; − 0,5 = 8,5
    expect(ajusterHeuresJour({ premier: D("2026-06-01T08:00:00Z"), dernier: D("2026-06-01T17:00:00Z") })).toBe(8.5);
  });

  it("journée pile dans le shift : 9 h − 0,5 pause = 8,5", () => {
    expect(ajusterHeuresJour({ premier: D("2026-06-01T08:00:00Z"), dernier: D("2026-06-01T17:00:00Z"), ...shift })).toBe(8.5);
  });

  it("arrivée en avance : les minutes avant le début du shift ne comptent pas", () => {
    // badge 07:30 mais shift à 08:00 → compté depuis 08:00 : 9 h − 0,5 = 8,5
    expect(ajusterHeuresJour({ premier: D("2026-06-01T07:30:00Z"), dernier: D("2026-06-01T17:00:00Z"), ...shift })).toBe(8.5);
  });

  it("départ dans l'heure de tolérance : aucune heure supp créditée", () => {
    // parti 17:45 (< fin+1h) → traité comme 17:00 : 8,5
    expect(ajusterHeuresJour({ premier: D("2026-06-01T08:00:00Z"), dernier: D("2026-06-01T17:45:00Z"), ...shift })).toBe(8.5);
  });

  it("heures supp seulement au-delà de fin+1h", () => {
    // parti 19:00 : fin 17:00, tolérance jusqu'à 18:00, +1 h supp → 9 + 1 − 0,5 = 9,5
    expect(ajusterHeuresJour({ premier: D("2026-06-01T08:00:00Z"), dernier: D("2026-06-01T19:00:00Z"), ...shift })).toBe(9.5);
  });

  it("départ anticipé : les heures réelles (moindres) sont conservées", () => {
    // parti 12:00 : 4 h − 0,5 = 3,5
    expect(ajusterHeuresJour({ premier: D("2026-06-01T08:00:00Z"), dernier: D("2026-06-01T12:00:00Z"), ...shift })).toBe(3.5);
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

// ── Lecture explicite des dates du rapport (audit RH 2026-10-10) ──────────────────────────────
import { extrairePointagesRapport, lireHorodatage, lireJourSeul, lireHeureSeule } from "./pointage";

describe("lecture des dates du rapport IVMS : JJ/MM/AAAA explicite, rien de deviné", () => {
  const iso = (d: Date | null) => d?.toISOString().slice(0, 16) ?? null;
  it("05/10/2026 est le 5 octobre (jamais le 10 mai) ; 13/10/2026 est lu ; AAAA-MM-JJ aussi", () => {
    expect(iso(lireHorodatage("05/10/2026 08:00"))).toBe("2026-10-05T08:00");
    expect(iso(lireHorodatage("13/10/2026 17:30:12"))).toBe("2026-10-13T17:30");
    expect(iso(lireHorodatage("2026-10-14 09:05"))).toBe("2026-10-14T09:05");
    expect(iso(lireHorodatage("2026/10/14 09:05:00"))).toBe("2026-10-14T09:05");
    expect(iso(lireHorodatage("5.10.2026 8h05"))).toBe("2026-10-05T08:05");
  });
  it("illisible : jour impossible, mois 13, sans heure, texte libre, format AM/PM", () => {
    for (const v of ["31/02/2026 08:00", "05/13/2026 08:00", "05/10/2026", "hier 8h", "10/05/2026 08:00 PM", "", null]) {
      expect(lireHorodatage(v)).toBeNull();
    }
  });
  it("cellule de date du tableur (numéro de série) : lue sans fuseau", () => {
    // 46300 = 2026-10-05 ; + 8 h = 0,333…
    expect(iso(lireHorodatage(46300 + 8 / 24))).toBe("2026-10-05T08:00");
    expect(lireJourSeul(46300)).toBe("2026-10-05");
    expect(lireHeureSeule(8.5 / 24)).toBe(8.5 * 3_600_000);
    expect(lireHeureSeule("17:45")).toBe((17 * 60 + 45) * 60_000);
    expect(lireHeureSeule("25:00")).toBeNull();
  });
  it("toute ligne illisible est signalée avec son numéro ; date + heure séparées", () => {
    const r = extrairePointagesRapport([
      { ID: "17", "Date/Heure": "05/10/2026 08:00" },
      { ID: "17", "Date/Heure": "31/02/2026 08:00" },
      { ID: "", "Date/Heure": "05/10/2026 09:00" },
      { ID: "", "Date/Heure": "" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pointages).toHaveLength(1);
    expect(r.illisibles.map((a) => a.detail)).toEqual([
      expect.stringContaining("Ligne 3 : date/heure « 31/02/2026 08:00 » illisible"),
      expect.stringContaining("Ligne 4 : identifiant vide"),
    ]);
    const s = extrairePointagesRapport([{ Matricule: "AB12-PEF", Date: "13/10/2026", Time: "07:58" }]);
    expect(s.ok && s.pointages[0].dateHeure.toISOString().slice(0, 16)).toBe("2026-10-13T07:58");
  });
});

describe("rapport IVMS — colonne « Time » seule (relecture 2026-10-12)", () => {
  it("sans colonne de date, « Time » porte la date ET l'heure (comme avant l'audit)", () => {
    const r = extrairePointagesRapport([{ "Person ID": "12", Name: "A", Time: "2026/10/05 08:05:12" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.illisibles).toHaveLength(0);
    expect(r.pointages[0].dateHeure.toISOString().slice(0, 19)).toBe("2026-10-05T08:05:12");
  });
});
