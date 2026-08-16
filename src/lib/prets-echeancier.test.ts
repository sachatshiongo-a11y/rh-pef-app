import { describe, expect, it } from "vitest";
import { calculerEcheancePret, construireEcheancier, retenuePourDuree } from "./prets";

// L'échéancier est une PROJECTION : il déroule vers l'avant la règle que `calculerEcheancePret`
// applique mois par mois. Le test qui compte vraiment est le dernier — il vérifie que les deux
// disent la même chose, pour qu'une divergence future se voie ici plutôt que sur un bulletin.

const juillet = { mois: 7, annee: 2026 };

describe("construireEcheancier — historique des retenues déjà appliquées", () => {
  it("reprend les retenues passées dans l'ordre, avec le solde après chacune", () => {
    const e = construireEcheancier({
      montantUSD: 300,
      retenueMensuelleUSD: 50,
      retenues: [
        { mois: 6, annee: 2026, montantUSD: 50 },
        { mois: 5, annee: 2026, montantUSD: 50 }, // volontairement dans le désordre
      ],
      periodeCourante: juillet,
      actif: true,
    });
    const reglees = e.echeances.filter((x) => x.reglee);
    expect(reglees.map((x) => `${x.mois}/${x.annee}`)).toEqual(["5/2026", "6/2026"]);
    expect(reglees.map((x) => x.soldeApresUSD)).toEqual([250, 200]);
    expect(e.rembourseUSD).toBe(100);
    expect(e.soldeUSD).toBe(200);
  });
});

describe("construireEcheancier — projection", () => {
  it("projette les échéances restantes à partir de la période en cours", () => {
    const e = construireEcheancier({
      montantUSD: 300, retenueMensuelleUSD: 100, retenues: [], periodeCourante: juillet, actif: true,
    });
    expect(e.echeances.map((x) => `${x.mois}/${x.annee}`)).toEqual(["7/2026", "8/2026", "9/2026"]);
    expect(e.echeances.every((x) => !x.reglee)).toBe(true);
    expect(e.dureeMois).toBe(3);
    expect(e.moisSolde).toEqual({ mois: 9, annee: 2026 });
    expect(e.soldePrevisionnel).toBe(true);
  });

  it("enchaîne sur le mois SUIVANT quand la paie du mois courant est déjà retenue", () => {
    const e = construireEcheancier({
      montantUSD: 300, retenueMensuelleUSD: 100,
      retenues: [{ mois: 7, annee: 2026, montantUSD: 100 }],
      periodeCourante: juillet, actif: true,
    });
    expect(e.echeances.map((x) => `${x.mois}/${x.annee}`)).toEqual(["7/2026", "8/2026", "9/2026"]);
    expect(e.echeances[0].reglee).toBe(true);
    expect(e.echeances[1].reglee).toBe(false);
  });

  it("ne rattrape PAS un mois manqué : la projection repart de la période en cours", () => {
    // Retenue en avril, rien en mai/juin : la paie ne rattrapera pas ces mois-là, l'échéancier
    // ne doit donc pas les inventer.
    const e = construireEcheancier({
      montantUSD: 300, retenueMensuelleUSD: 100,
      retenues: [{ mois: 4, annee: 2026, montantUSD: 100 }],
      periodeCourante: juillet, actif: true,
    });
    expect(e.echeances.map((x) => `${x.mois}/${x.annee}`)).toEqual(["4/2026", "7/2026", "8/2026"]);
  });

  it("franchit le changement d'année", () => {
    const e = construireEcheancier({
      montantUSD: 300, retenueMensuelleUSD: 100,
      retenues: [], periodeCourante: { mois: 11, annee: 2026 }, actif: true,
    });
    expect(e.echeances.map((x) => `${x.mois}/${x.annee}`)).toEqual(["11/2026", "12/2026", "1/2027"]);
    expect(e.moisSolde).toEqual({ mois: 1, annee: 2027 });
  });

  it("plafonne la dernière échéance au solde restant", () => {
    const e = construireEcheancier({
      montantUSD: 250, retenueMensuelleUSD: 100, retenues: [], periodeCourante: juillet, actif: true,
    });
    expect(e.echeances.map((x) => x.montantUSD)).toEqual([100, 100, 50]);
    expect(e.echeances.at(-1)!.soldeApresUSD).toBe(0);
  });

  it("ne projette rien pour un prêt annulé, mais garde l'historique", () => {
    const e = construireEcheancier({
      montantUSD: 300, retenueMensuelleUSD: 100,
      retenues: [{ mois: 6, annee: 2026, montantUSD: 100 }],
      periodeCourante: juillet, actif: false,
    });
    expect(e.echeances).toHaveLength(1);
    expect(e.soldeUSD).toBe(200); // le solde reste dû, il n'est simplement plus prélevé
    expect(e.soldePrevisionnel).toBe(false);
  });

  it("ne projette rien pour un prêt déjà soldé", () => {
    const e = construireEcheancier({
      montantUSD: 300, retenueMensuelleUSD: 100,
      retenues: [{ mois: 6, annee: 2026, montantUSD: 300 }],
      periodeCourante: juillet, actif: true,
    });
    expect(e.soldeUSD).toBe(0);
    expect(e.echeances.every((x) => x.reglee)).toBe(true);
    expect(e.soldePrevisionnel).toBe(false);
  });

  it("ne boucle pas sans fin sur une retenue nulle", () => {
    const e = construireEcheancier({
      montantUSD: 300, retenueMensuelleUSD: 0, retenues: [], periodeCourante: juillet, actif: true,
    });
    expect(e.echeances).toHaveLength(0);
    expect(e.moisSolde).toBeNull();
  });

  it("solde un montant non divisible sans laisser de résidu", () => {
    const e = construireEcheancier({
      montantUSD: 300, retenueMensuelleUSD: retenuePourDuree(300, 7),
      retenues: [], periodeCourante: juillet, actif: true,
    });
    expect(e.dureeMois).toBe(7); // pas 8 : l'arrondi supérieur évite l'échéance résiduelle
    expect(e.echeances.at(-1)!.soldeApresUSD).toBe(0);
    expect(e.echeances.reduce((s, x) => s + x.montantUSD, 0)).toBeCloseTo(300, 2);
  });
});

describe("retenuePourDuree", () => {
  it("divise le montant par la durée voulue", () => {
    expect(retenuePourDuree(300, 6)).toBe(50);
  });

  it("arrondit au centime SUPÉRIEUR pour ne pas créer d'échéance résiduelle", () => {
    expect(retenuePourDuree(300, 7)).toBe(42.86); // et non 42,85
  });

  it("renvoie 0 sur une saisie inexploitable plutôt qu'un NaN", () => {
    expect(retenuePourDuree(0, 6)).toBe(0);
    expect(retenuePourDuree(300, 0)).toBe(0);
    expect(retenuePourDuree(Number.NaN, 6)).toBe(0);
  });
});

describe("l'échéancier dit la MÊME chose que le moteur de paie", () => {
  it("mois après mois, la projection coïncide avec calculerEcheancePret", () => {
    // On simule 8 mois de paie en appliquant le moteur, et on vérifie à chaque tour que la
    // première échéance NON réglée de l'échéancier annonçait exactement ce qui va être retenu.
    const montant = 275;
    const retenueMensuelle = 60;
    const retenues: { mois: number; annee: number; montantUSD: number }[] = [];

    for (let i = 0; i < 8; i++) {
      const mois = ((6 + i) % 12) + 1;
      const annee = 2026 + Math.floor((6 + i) / 12);

      const projete = construireEcheancier({
        montantUSD: montant, retenueMensuelleUSD: retenueMensuelle, retenues,
        periodeCourante: { mois, annee }, actif: true,
      }).echeances.find((e) => !e.reglee);

      const { echeanceUSD } = calculerEcheancePret(montant, retenueMensuelle, retenues, mois, annee);

      if (echeanceUSD === 0) {
        expect(projete, `mois ${mois}/${annee} : plus rien à retenir, rien ne doit être projeté`).toBeUndefined();
        continue;
      }
      expect(projete, `mois ${mois}/${annee}`).toBeDefined();
      expect(projete!.mois).toBe(mois);
      expect(projete!.annee).toBe(annee);
      expect(projete!.montantUSD).toBeCloseTo(echeanceUSD, 2);

      if (echeanceUSD > 0) retenues.push({ mois, annee, montantUSD: echeanceUSD });
    }

    expect(retenues.reduce((s, r) => s + r.montantUSD, 0)).toBeCloseTo(montant, 2);
  });
});
