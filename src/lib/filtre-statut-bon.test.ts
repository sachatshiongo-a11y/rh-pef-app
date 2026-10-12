import { describe, it, expect } from "vitest";
import { FILTRE_STATUT_BON, lireStatutBon } from "./filtre-statut-bon";
import { STATUT_BC_LABEL } from "./stock";

describe("filtre d'état des bons de commande", () => {
  it("« VALIDE » se lit « Validés » (l'ancienne vue des Archives)", () => {
    expect(lireStatutBon("VALIDE")).toBe("VALIDE");
    expect(FILTRE_STATUT_BON.VALIDE).toBe("Validés");
  });

  it("une valeur inconnue, vide ou piégée vaut « tous les états »", () => {
    for (const v of [undefined, "", "valide", "TOUS", "constructor", "__proto__", "toString", 3, null]) expect(lireStatutBon(v)).toBeUndefined();
  });

  it("couvre exactement les six états d'un bon (aucun état introuvable depuis l'écran)", () => {
    expect(Object.keys(FILTRE_STATUT_BON).sort()).toEqual(Object.keys(STATUT_BC_LABEL).sort());
  });
});
