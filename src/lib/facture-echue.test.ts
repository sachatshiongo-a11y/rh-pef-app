import { describe, it, expect } from "vitest";
import { estEchue, statutAffiche, whereEchues, whereAReglerNonEchues, whereSelonFiltreStatut } from "@/lib/facture-echue";

const base = { montantUSD: "100", montantRegleUSD: "0", resteAPayerUSD: "100" };
const AUJ = "2026-10-10";

describe("statut « échue » calculé à la lecture", () => {
  it("une facture « À régler » stockée dont l'échéance est passée est ÉCHUE (le défaut d'origine)", () => {
    const f = { ...base, statut: "A_REGLER", dateEcheance: new Date("2026-09-30") };
    expect(statutAffiche(f, AUJ)).toBe("ECHUE_NON_REGLEE");
    expect(estEchue(f, AUJ)).toBe(true);
  });
  it("le jour même de l'échéance, elle n'est pas encore échue (strictement antérieure)", () => {
    expect(estEchue({ ...base, statut: "A_REGLER", dateEcheance: new Date("2026-10-10") }, AUJ)).toBe(false);
    expect(estEchue({ ...base, statut: "A_REGLER", dateEcheance: new Date("2026-10-09") }, AUJ)).toBe(true);
  });
  it("sans échéance : jamais échue", () => {
    expect(statutAffiche({ ...base, statut: "A_REGLER", dateEcheance: null }, AUJ)).toBe("A_REGLER");
  });
  it("une facture soldée n'est jamais échue, même échéance passée", () => {
    expect(statutAffiche({ ...base, resteAPayerUSD: "0", montantRegleUSD: "100", statut: "REGLEE", dateEcheance: new Date("2026-01-01") }, AUJ)).toBe("REGLEE");
    expect(statutAffiche({ ...base, resteAPayerUSD: "0", statut: "A_REGLER", dateEcheance: new Date("2026-01-01") }, AUJ)).toBe("REGLEE");
  });
  it("une ancienne valeur stockée « échue » dont l'échéance est à venir n'est plus échue", () => {
    expect(statutAffiche({ ...base, statut: "ECHUE_NON_REGLEE", dateEcheance: new Date("2026-12-01") }, AUJ)).toBe("A_REGLER");
  });
  it("facture en francs : le reste se lit en francs", () => {
    const f = { devise: "CDF" as const, montantCDF: "280000", montantRegleCDF: "0", resteAPayerCDF: "280000", statut: "A_REGLER", dateEcheance: new Date("2026-10-01") };
    expect(estEchue(f, AUJ)).toBe(true);
    expect(estEchue({ ...f, resteAPayerCDF: "0" }, AUJ)).toBe(false);
  });
  it("les filtres Prisma suivent la même règle", () => {
    expect(whereEchues(AUJ)).toMatchObject({ statut: { not: "REGLEE" }, dateEcheance: { lt: new Date("2026-10-10") } });
    expect(JSON.stringify(whereAReglerNonEchues(AUJ))).toContain('"dateEcheance":null');
    expect(whereSelonFiltreStatut("ECHUE_NON_REGLEE", AUJ)).toEqual(whereEchues(AUJ));
    expect(whereSelonFiltreStatut("REGLEE", AUJ)).toEqual({ statut: "REGLEE" });
    expect(whereSelonFiltreStatut(undefined, AUJ)).toEqual({});
  });
});
