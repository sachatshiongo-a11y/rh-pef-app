import { describe, it, expect } from "vitest";
import { libelleJoursVides, messageViderPlanning } from "./vider-message";

const SEMAINE = Array.from({ length: 7 }, (_, i) => ({ iso: `2026-10-${String(5 + i).padStart(2, "0")}` })); // lun. 5 → dim. 11 oct. 2026

describe("message de confirmation de « Vider »", () => {
  it("la semaine entière : exactement le texte demandé par la Direction", () => {
    expect(messageViderPlanning(3, SEMAINE)).toBe("Vider 3 salariés sur 7 jours (lun. 5 → dim. 11 oct.) ?");
  });
  it("singulier : 1 salarié, 1 jour", () => {
    expect(messageViderPlanning(1, [SEMAINE[2]])).toBe("Vider 1 salarié sur 1 jour (mer. 7 oct.) ?");
  });
  it("deux jours qui se suivent : listés ; trois : une plage", () => {
    expect(libelleJoursVides(SEMAINE.slice(2, 4))).toBe("2 jours (mer. 7, jeu. 8 oct.)");
    expect(libelleJoursVides(SEMAINE.slice(2, 5))).toBe("3 jours (mer. 7 → ven. 9 oct.)");
  });
  it("jours épars et plages mélangées", () => {
    expect(libelleJoursVides([SEMAINE[0], SEMAINE[2], SEMAINE[4]])).toBe("3 jours (lun. 5, mer. 7, ven. 9 oct.)");
    expect(libelleJoursVides([SEMAINE[0], SEMAINE[1], SEMAINE[2], SEMAINE[4], SEMAINE[5]])).toBe("5 jours (lun. 5 → mer. 7, ven. 9, sam. 10 oct.)");
  });
  it("semaine à cheval sur deux mois : le mois est dit à chaque borne", () => {
    const j = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((iso) => ({ iso }));
    expect(messageViderPlanning(2, j)).toBe("Vider 2 salariés sur 7 jours (lun. 28 sept. → dim. 4 oct.) ?");
  });
  it("vue mois (31 jours) : une seule plage", () => {
    const mois = Array.from({ length: 31 }, (_, i) => ({ iso: `2026-10-${String(i + 1).padStart(2, "0")}` }));
    expect(libelleJoursVides(mois)).toBe("31 jours (jeu. 1 → sam. 31 oct.)");
  });
  it("aucun jour : dit « aucun jour » (le bouton est alors désactivé)", () => {
    expect(libelleJoursVides([])).toBe("aucun jour");
  });
});
