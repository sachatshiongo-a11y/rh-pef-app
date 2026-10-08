import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { annonceCloture, messageClotureReussie, moisSuivant, valeurJournal, messageRefusPassageApresCloture } = await import("@/lib/changement-mois");
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
