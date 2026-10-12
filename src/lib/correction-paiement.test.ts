import { describe, it, expect } from "vitest";
import {
  changementPaiement, commentaireCorrection, lireDateCorrection, lireModeCorrection, lireMotifCorrection, MODES_PAIEMENT,
  MOTIF_CORRECTION_MAX, paiementDeLigne, resumeCorrection, texteValeurPaiement,
} from "./correction-paiement";

const MAINTENANT = new Date("2026-10-12T10:00:00.000Z");
const SEPT = { mois: 9, annee: 2026 };

describe("moyens de paiement : la liste existante, mot pour mot", () => {
  it("espèces, virement, Mobile Money, chèque, autre", () => {
    expect(MODES_PAIEMENT.map((m) => [m.value, m.label])).toEqual([
      ["ESPECES", "Espèces"], ["VIREMENT", "Virement"], ["MOBILE_MONEY", "Mobile Money"], ["CHEQUE", "Chèque"], ["AUTRE", "Autre"],
    ]);
  });
  it("un moyen inconnu ou vide est refusé", () => {
    expect(lireModeCorrection("CHEQUE")).toBe("CHEQUE");
    for (const v of ["", null, undefined, "BITCOIN", "especes"]) expect(() => lireModeCorrection(v), String(v)).toThrow(/moyen de paiement/);
  });
});

describe("motif : obligatoire", () => {
  it("vide, espaces ou absent : refus", () => {
    for (const v of ["", "   ", null, undefined, "\n\t"]) expect(() => lireMotifCorrection(v), String(v)).toThrow("Le motif de la correction est obligatoire.");
  });
  it("normalisé (espaces) et borné", () => {
    expect(lireMotifCorrection("  Erreur   de saisie\n")).toBe("Erreur de saisie");
    expect(() => lireMotifCorrection("x".repeat(MOTIF_CORRECTION_MAX + 1))).toThrow(/trop long/);
  });
});

describe("date de versement corrigée : mêmes contrôles que « Marquer payé », et obligatoire", () => {
  it("une date valable du mois de la paie ou d'un mois suivant passe", () => {
    expect(lireDateCorrection("2026-09-30", SEPT, MAINTENANT)).toBe("2026-09-30");
    expect(lireDateCorrection("2026-10-12", SEPT, MAINTENANT)).toBe("2026-10-12");
  });
  it("vide : refus (jamais « aujourd'hui » par défaut)", () => {
    for (const v of ["", "  ", null, undefined]) expect(() => lireDateCorrection(v, SEPT, MAINTENANT), String(v)).toThrow("La date de versement est obligatoire.");
  });
  it("future, illisible, avant le 1er du mois de la paie : refus", () => {
    expect(() => lireDateCorrection("2026-10-13", SEPT, MAINTENANT)).toThrow(/futur/);
    expect(() => lireDateCorrection("2026-02-30", SEPT, MAINTENANT)).toThrow(/invalide/);
    expect(() => lireDateCorrection("12/10/2026", SEPT, MAINTENANT)).toThrow(/invalide/);
    expect(() => lireDateCorrection("2026-08-31", SEPT, MAINTENANT)).toThrow(/antérieure au 1er jour du mois de la paie/);
  });
});

describe("avant → après", () => {
  const avant = paiementDeLigne({ datePaiement: new Date("2026-10-03"), modePaiement: "VIREMENT" });
  it("lit le jour pur et le moyen de la ligne", () => {
    expect(avant).toEqual({ jour: "2026-10-03", mode: "VIREMENT" });
    expect(paiementDeLigne({ datePaiement: null, modePaiement: null })).toEqual({ jour: null, mode: null });
  });
  it("un très ancien paiement (instant, pas date pure) se lit au jour de KINSHASA, comme l'Exploitation : 23 h 30 UTC le 30/09 = 1er/10", () => {
    expect(paiementDeLigne({ datePaiement: new Date("2026-09-30T23:30:00.000Z"), modePaiement: null }).jour).toBe("2026-10-01");
    expect(paiementDeLigne({ datePaiement: new Date("2026-09-30T00:00:00.000Z"), modePaiement: null }).jour).toBe("2026-09-30"); // date pure : inchangée
  });
  it("ne signale que ce qui change", () => {
    expect(changementPaiement(avant, { jour: "2026-10-03", mode: "VIREMENT" })).toEqual({ dateChangee: false, modeChange: false });
    expect(changementPaiement(avant, { jour: "2026-10-04", mode: "VIREMENT" })).toEqual({ dateChangee: true, modeChange: false });
    expect(changementPaiement(avant, { jour: "2026-10-03", mode: "ESPECES" })).toEqual({ dateChangee: false, modeChange: true });
  });
  it("textes de la trace : ancienne → nouvelle valeur et motif", () => {
    expect(resumeCorrection(avant, { jour: "2026-10-07", mode: "ESPECES" })).toBe("date 03/10/2026 → 07/10/2026 ; moyen Virement → Espèces");
    expect(resumeCorrection(avant, { jour: "2026-10-07", mode: "VIREMENT" })).toBe("date 03/10/2026 → 07/10/2026");
    expect(commentaireCorrection(avant, { jour: "2026-10-03", mode: "CHEQUE" }, "Payé par chèque")).toBe("Correction du paiement : moyen Virement → Chèque. Motif : Payé par chèque");
    expect(texteValeurPaiement(avant)).toBe("03/10/2026 · Virement");
    expect(texteValeurPaiement({ jour: null, mode: null })).toBe("non renseignée · non renseigné");
  });
});
