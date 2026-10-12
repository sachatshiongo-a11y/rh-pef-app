import { describe, it, expect } from "vitest";
import { controlerDateSortie, lireDateSortieSaisie, resoudreDateSortie, sourceDateSortie } from "./sortie-salarie";

const j = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const fiche = (o: Partial<{ actif: boolean; dateSortie: Date | null }> = {}) => ({ actif: false, dateEmbauche: j("2024-02-01"), dateSortie: null, ...o });

describe("lireDateSortieSaisie — la date de sortie est OBLIGATOIRE", () => {
  it("vide, absente ou en blancs : refus lisible, jamais une date par défaut", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(() => lireDateSortieSaisie(v), String(v)).toThrow(/La date de sortie est obligatoire/);
    }
  });
  it("illisible ou inexistante : refus", () => {
    for (const v of ["demain", "12/03/2026", "2026-02-30"]) expect(() => lireDateSortieSaisie(v), v).toThrow(/Date de sortie invalide/);
  });
  it("AAAA-MM-JJ : le jour civil, en date pure", () => {
    expect(lireDateSortieSaisie("2026-03-12").toISOString()).toBe("2026-03-12T00:00:00.000Z");
  });
});

describe("controlerDateSortie", () => {
  it("avant l'embauche : refus ; le jour de l'embauche, après, ou dans le futur (départ annoncé) : accepté", () => {
    expect(controlerDateSortie(j("2024-02-01"), j("2024-01-31"))).toMatch(/ne peut pas précéder la date d'embauche/);
    expect(controlerDateSortie(j("2024-02-01"), j("2024-02-01"))).toBeNull();
    expect(controlerDateSortie(j("2024-02-01"), j("2031-12-31"))).toBeNull();
  });
});

describe("resoudreDateSortie — une seule réponse", () => {
  it("fiche active : pas de sortie, quoi que disent les autres dates", () => {
    expect(resoudreDateSortie(fiche({ actif: true, dateSortie: j("2026-01-01") }), [{ dateFin: j("2026-02-02") }])).toBeNull();
  });
  it("la fin de contrat fait foi (la plus tardive), la date de la fiche ne la double pas", () => {
    const r = resoudreDateSortie(fiche({ dateSortie: j("2026-05-05") }), [{ dateFin: j("2026-03-01") }, { dateFin: j("2026-04-10") }]);
    expect(r?.toISOString().slice(0, 10)).toBe("2026-04-10");
    expect(sourceDateSortie(fiche({ dateSortie: j("2026-05-05") }), [{ dateFin: j("2026-03-01") }])).toBe("FIN_CONTRAT");
  });
  it("une fin de contrat antérieure à l'embauche de la fiche ne compte pas (ancienne sortie, fiche réembauchée à la main)", () => {
    expect(resoudreDateSortie(fiche(), [{ dateFin: j("2023-12-31") }])).toBeNull();
  });
  it("sans fin de contrat : la date de la fiche ; sans rien : null (fiche inactive à compléter)", () => {
    expect(resoudreDateSortie(fiche({ dateSortie: j("2026-05-05") }), [])?.toISOString().slice(0, 10)).toBe("2026-05-05");
    expect(sourceDateSortie(fiche({ dateSortie: j("2026-05-05") }), [])).toBe("FICHE");
    expect(resoudreDateSortie(fiche(), [])).toBeNull();
    expect(sourceDateSortie(fiche(), [])).toBeNull();
  });
});
