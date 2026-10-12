import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { annonceCloture, messageClotureReussie, moisSuivant, valeurJournal, messageRefusPassageApresCloture, ligneClotureAnticipee } = await import("@/lib/changement-mois");
const { messageClotureParRH } = await import("@/lib/paie-notifications");

describe("passage au mois suivant (pur)", () => {
  it("mois suivant : +1, et décembre → janvier de l'année suivante", () => {
    expect(moisSuivant({ mois: 9, annee: 2026 })).toEqual({ mois: 10, annee: 2026 });
    expect(moisSuivant({ mois: 11, annee: 2026 })).toEqual({ mois: 12, annee: 2026 });
    expect(moisSuivant({ mois: 12, annee: 2026 })).toEqual({ mois: 1, annee: 2027 });
  });

  it("textes de l'écran, du journal et de la notification", () => {
    expect(annonceCloture({ mois: 9, annee: 2026 })).toBe("La paie de septembre 2026 sera clôturée et l'espace RH passera à octobre 2026.");
    expect(annonceCloture({ mois: 12, annee: 2026 })).toBe("La paie de décembre 2026 sera clôturée et l'espace RH passera à janvier 2027.");
    expect(messageClotureReussie({ mois: 9, annee: 2026 }, { mois: 10, annee: 2026 })).toBe("Paie de septembre 2026 clôturée — l'espace RH est passé à octobre 2026.");
    expect(valeurJournal({ mois: 10, annee: 2026 }, "CLOTURE")).toBe("octobre 2026 — automatique (clôture de la paie)");
    expect(valeurJournal({ mois: 10, annee: 2026 }, "MANUEL")).toBe("octobre 2026 — manuel (Paramètres)");
    expect(messageRefusPassageApresCloture(["Ada Kalala"], { mois: 10, annee: 2026 })).toBe("1 bulletin(s) compté(s) resteraient « pas validé » (Ada Kalala) : l'espace RH ne peut pas passer à octobre 2026.");
    expect(messageClotureParRH(9, 2026, "Responsable RH", 0, { mois: 10, annee: 2026 })).toBe("Paie de septembre 2026 clôturée par Responsable RH — l'espace RH est passé à octobre 2026");
    expect(messageClotureParRH(9, 2026, "Responsable RH", 0)).toBe("Paie de septembre 2026 clôturée par Responsable RH");
  });
});

describe("clôture anticipée : une ligne de plus dans la confirmation (décision Direction 2026-10-12)", () => {
  const sept = { mois: 9, annee: 2026 };
  it("avant le dernier jour du mois : les jours restants, aujourd'hui compris, sont annoncés", () => {
    expect(ligneClotureAnticipee(sept, "2026-09-28")).toBe("Les jours du 28 au 30/09 ne pourront plus recevoir de présences ni d'heures.");
    expect(ligneClotureAnticipee(sept, "2026-09-29")).toBe("Les jours du 29 au 30/09 ne pourront plus recevoir de présences ni d'heures.");
    expect(ligneClotureAnticipee({ mois: 2, annee: 2028 }, "2028-02-03")).toBe("Les jours du 03 au 29/02 ne pourront plus recevoir de présences ni d'heures.");
  });
  it("le dernier jour du mois et après : rien (aucun jour n'est perdu)", () => {
    expect(ligneClotureAnticipee(sept, "2026-09-30")).toBeNull();
    expect(ligneClotureAnticipee(sept, "2026-10-01")).toBeNull();
    expect(ligneClotureAnticipee(sept, "2026-10-12")).toBeNull();
    expect(ligneClotureAnticipee({ mois: 12, annee: 2026 }, "2027-01-05")).toBeNull();
  });
  it("mois pas encore commencé (cas limite) : tout le mois est annoncé", () => {
    expect(ligneClotureAnticipee({ mois: 11, annee: 2026 }, "2026-10-30")).toBe("Les jours du 01 au 30/11 ne pourront plus recevoir de présences ni d'heures.");
  });
});
