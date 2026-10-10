import { describe, it, expect } from "vitest";
import { congesDuBulletin, categorieDuType, type TypeCongeInfo } from "./conges-bulletin";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

const TYPES: TypeCongeInfo[] = [
  { nom: "Congé annuel", tauxPct: 100, compteDansSolde: true },
  { nom: "Congé maladie", tauxPct: null, compteDansSolde: false },
  { nom: "Congé sans solde", tauxPct: 0, compteDansSolde: false },
];

describe("congés du bulletin — bornés au mois, jours par lib/jours-ouvrables", () => {
  it("un congé du 21/09 au 17/10 sur le bulletin de septembre : période rognée au 30/09 et 9 jours (pas 24)", () => {
    const [c] = congesDuBulletin([{ dateDebut: d("2026-09-21"), dateFin: d("2026-10-17") }], [], 9, 2026);
    expect(iso(c.dateDebut)).toBe("2026-09-21");
    expect(iso(c.dateFin)).toBe("2026-09-30");
    // 21 → 26 (samedi compris) = 6, dimanche 27 exclu, 28 → 30 = 3.
    expect(c.jours).toBe(9);
    expect(c.rogne).toBe(true);
  });

  it("le même congé sur le bulletin d'octobre : du 01/10 au 17/10", () => {
    const [c] = congesDuBulletin([{ dateDebut: d("2026-09-21"), dateFin: d("2026-10-17") }], [], 10, 2026);
    expect(iso(c.dateDebut)).toBe("2026-10-01");
    expect(iso(c.dateFin)).toBe("2026-10-17");
    // 1 → 17 octobre 2026 : 17 jours, dimanches 4 et 11 exclus.
    expect(c.jours).toBe(15);
  });

  it("les fériés fournis ne comptent pas", () => {
    const [c] = congesDuBulletin([{ dateDebut: d("2026-06-29"), dateFin: d("2026-07-05") }], ["2026-06-30"], 6, 2026);
    // Du 29/06 au 30/06 sur juin : 2 jours dont un férié.
    expect(c.jours).toBe(1);
  });

  it("un congé hors du mois est écarté ; un congé entier dans le mois n'est pas marqué rogné", () => {
    const sortie = congesDuBulletin(
      [{ dateDebut: d("2026-08-03"), dateFin: d("2026-08-07") }, { dateDebut: d("2026-09-14"), dateFin: d("2026-09-19") }],
      [],
      9,
      2026,
    );
    expect(sortie).toHaveLength(1);
    expect(sortie[0].jours).toBe(6);
    expect(sortie[0].rogne).toBe(false);
  });

  it("est idempotent : un congé déjà rogné et compté (instantané figé) ressort identique, jours figés conservés", () => {
    const fige = { dateDebut: d("2026-09-21"), dateFin: d("2026-09-30"), type: "Congé annuel", categorie: "CONGE" as const, jours: 8, rogne: true };
    const [c] = congesDuBulletin([fige], ["2026-09-22"], 9, 2026);
    expect(c.jours).toBe(8); // les fériés d'aujourd'hui ne réécrivent pas ce qui a été figé
    expect(c.rogne).toBe(true);
  });

  it("maladie et sans solde ne sont pas rangés sous « Congés » (règle des paramètres du type, jamais le nom)", () => {
    expect(categorieDuType("Congé annuel", TYPES)).toBe("CONGE");
    expect(categorieDuType("Congé maladie", TYPES)).toBe("AUTRE");
    expect(categorieDuType("Congé sans solde", TYPES)).toBe("SANS_SOLDE");
    expect(categorieDuType("Type supprimé depuis", TYPES)).toBe("CONGE"); // inconnu : comme avant
    expect(categorieDuType(undefined, TYPES)).toBe("CONGE");
    const sortie = congesDuBulletin(
      [
        { dateDebut: d("2026-09-01"), dateFin: d("2026-09-02"), type: "Congé maladie" },
        { dateDebut: d("2026-09-08"), dateFin: d("2026-09-09"), type: "Congé sans solde" },
        { dateDebut: d("2026-09-15"), dateFin: d("2026-09-16"), type: "Congé annuel" },
      ],
      [],
      9,
      2026,
      TYPES,
    );
    expect(sortie.map((c) => c.categorie)).toEqual(["AUTRE", "SANS_SOLDE", "CONGE"]);
  });
});
