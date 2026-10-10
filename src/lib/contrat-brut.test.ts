import { describe, it, expect } from "vitest";
import { reconstituerBrutDepuisNet, type ParametresPaie } from "./payroll";
import { brutDepuisNetContrat } from "./contrat-brut";

const params: ParametresPaie = {
  tauxChangeCDF: 2800, cnssSalarie: 0.05, cnssPatronalPensions: 0.05, cnssPatronalRisques: 0.015, cnssPatronalFamille: 0.065,
  plafondCnssMensuelCDF: null,
  iprTranchesAnnuellesCDF: [
    { ordre: 1, plafondAnnuelCDF: 1_944_000, taux: 0.03 }, { ordre: 2, plafondAnnuelCDF: 21_600_000, taux: 0.15 },
    { ordre: 3, plafondAnnuelCDF: 43_200_000, taux: 0.3 }, { ordre: 4, plafondAnnuelCDF: null, taux: 0.4 },
  ],
  iprPlancherMensuelCDF: 2000, iprPlafondTaux: 0.3, iprReductionFamilleTaux: 0.02, iprReductionFamilleMax: 9, iprBase: 2,
  inppTaux: 0.03, onemTaux: 0.002, hsSeuilHebdoH: 6, hsMajTranche1: 0.3, hsMajTranche2: 0.6, hsMajDimancheFerie: 1,
  allocFamilialeParEnfantUSD: 1.5, joursOuvrablesMois: 26, droitsCongesAnnuel: 18, salairesSaisisEnNet: true,
};

describe("contrat en CDF, salaire saisi en net : brut reconstitué en dollars puis reconverti", () => {
  it("600 000 FC net au taux 2 800 : brut = brut($) de 214,29 $ net × 2 800, et reste du même ordre que le net", () => {
    const brut = brutDepuisNetContrat(600_000, "CDF", params, 0)!;
    const attendu = reconstituerBrutDepuisNet(600_000 / 2800, params, 0) * 2800;
    expect(brut).toBeCloseTo(attendu, 6);
    // Un brut en francs est un peu plus grand que le net en francs (cotisations + impôt) : jamais le
    // brut d'un net de 600 000 DOLLARS reconverti, ni un brut dérivé d'un net lu en dollars.
    expect(brut).toBeCloseTo(718_984, 0); // 256,78 $ × 2 800 : le montant imprimé sur le contrat
    expect(brut).toBeGreaterThan(600_000);
    expect(brut).toBeLessThan(600_000 * 1.5);
  });

  it("l'ancien calcul (le montant en francs lu comme des dollars) donnait un brut absurde", () => {
    const absurde = reconstituerBrutDepuisNet(600_000, params, 0);
    const juste = brutDepuisNetContrat(600_000, "CDF", params, 0)!;
    expect(absurde).toBeCloseTo(902_255.64, 1); // l'ancien brut imprimé : 902 255,64 CDF
    expect(Math.abs(absurde - juste)).toBeGreaterThan(100_000);
  });

  it("contrat en dollars : inchangé", () => {
    expect(brutDepuisNetContrat(300, "USD", params, 1)).toBe(reconstituerBrutDepuisNet(300, params, 1));
  });

  it("taux de change inexploitable : pas de brut plutôt qu'un faux", () => {
    expect(brutDepuisNetContrat(600_000, "CDF", { ...params, tauxChangeCDF: 0 }, 0)).toBeNull();
  });
});
