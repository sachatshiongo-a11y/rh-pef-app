import { describe, it, expect } from "vitest";
import { lignesSuivi } from "./lignes-suivi";

// Le Suivi des pointages — décision d'argent de la Direction du 2026-09-29 : la pause par défaut
// s'affiche « non déduite » et ne retire rien ; une pause saisie se déduit. Le total du jour est la
// somme des heures PAYÉES, les mêmes que celles écrites aux présences.

const employes = [
  { id: "a", nom: "Alice", photoUrl: null },
  { id: "b", nom: "Bruno", photoUrl: null },
  { id: "c", nom: "Chantal", photoUrl: null },
  { id: "d", nom: "Didier", photoUrl: null },
];
const ARRIVEE = new Date("2026-09-15T07:00:00Z"); // 8 h à Kinshasa
const DEPART = new Date("2026-09-15T16:00:00Z"); // 17 h
const pointage = (employeeId: string, o: { pauseMinutes: number; pauseParDefaut: boolean; heureFin?: Date | null }) => ({
  id: `p-${employeeId}`, employeeId, heureDebut: ARRIVEE, heureFin: o.heureFin === undefined ? DEPART : o.heureFin,
  pauseMinutes: o.pauseMinutes, pauseParDefaut: o.pauseParDefaut, source: "QR" as const, scans: [],
});

describe("lignesSuivi — heures, pause et total du jour", () => {
  const r = lignesSuivi(employes, [
    pointage("a", { pauseMinutes: 0, pauseParDefaut: true }), // pause par défaut
    pointage("b", { pauseMinutes: 45, pauseParDefaut: false }), // pause saisie 45 min
    pointage("c", { pauseMinutes: 0, pauseParDefaut: false, heureFin: null }), // en cours
  ]);
  const ligne = (id: string) => r.lignes.find((l) => l.employeeId === id)!;

  it("pause par défaut : 9 h (départ − arrivée), libellée « par défaut 30 min (non déduite) »", () => {
    expect(ligne("a")).toMatchObject({ heuresLabel: "9 h", pauseLabel: "pause par défaut 30 min (non déduite)", statut: "TERMINE" });
  });

  it("pause saisie 45 min : déduite (8,25 h), libellée en minutes", () => {
    expect(ligne("b")).toMatchObject({ heuresLabel: "8,25 h", pauseLabel: "45 min", statut: "TERMINE" });
  });

  it("journée en cours et absent : pas d'heures", () => {
    expect(ligne("c")).toMatchObject({ heuresLabel: "—", statut: "EN_COURS" });
    expect(ligne("d")).toMatchObject({ heuresLabel: "—", pauseLabel: "—", statut: "ABSENT" });
  });

  it("total du jour = 9 + 8,25 = 17,25 h ; compteurs justes", () => {
    expect(r.totalHeures).toBe(17.25);
    expect({ t: r.nbTermine, e: r.nbEnCours, a: r.nbAbsent }).toEqual({ t: 2, e: 1, a: 1 });
  });

  it("une ligne ancienne qui porterait encore 30 min AVEC le drapeau : rien n'est retiré non plus", () => {
    const ancien = lignesSuivi([employes[0]], [pointage("a", { pauseMinutes: 30, pauseParDefaut: true })]);
    expect(ancien.lignes[0].heuresLabel).toBe("9 h");
    expect(ancien.totalHeures).toBe(9);
  });
});
