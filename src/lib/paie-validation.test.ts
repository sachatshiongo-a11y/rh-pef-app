import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  champsDifferents,
  ligneDiffere,
  messagePaieChangee,
  CHAMPS_COMPARES,
  CHAMPS_NON_COMPARES,
  LIBELLES_CHAMPS_COMPARES,
  type LigneEnregistree,
} from "./paie-validation";
import type { DonneesLignePaie } from "./paie-batch";

// Comparaison « au centime près » d'une ligne enregistrée (Decimal(·, 2)) et de son recalcul (nombre
// JavaScript non arrondi) : un centime d'écart refuse, l'arrondi de la base n'en est pas un.
// Depuis la relecture du 2026-10-13 : TOUT ce que le calcul fige sur la ligne est comparé (CNSS
// patronale, INPP, ONEM, avantages en nature… compris), et le refus nomme le champ qui a bougé.
const D = (v: string) => new Prisma.Decimal(v);

/** Recalcul « brut » (valeurs non arrondies quand le moteur en produit). */
const recalculee = (surcharge: Partial<DonneesLignePaie> = {}): DonneesLignePaie => ({
  joursPayes100: 21,
  joursPayes2_3: 0,
  joursNonPayes: 1,
  nombreAbsences: 1,
  remuneration100: 300,
  joursPayesNonTravailles: 1,
  remunerationJoursPayesUSD: 13.846153846153847,
  remuneration2_3: 0,
  hsValorisee: 12.5,
  heuresTravaillees: 216,
  heuresContractuelles: 216.66666666666666,
  sourceReference: "PLANNING",
  motifReference: null,
  heuresPayeesNonTravaillees: 0,
  avertissementsPaie: [],
  heuresSupp30: 6,
  heuresSupp60: 1.5,
  heuresSupp100: 0,
  joursAbsenceRetenus: 0,
  retenueAbsencesUSD: 0,
  joursMaladieJustifies: 0,
  joursMaladieNonJustifies: 0,
  retenueMaladieUSD: 0,
  remunerationMaladieJustifieeUSD: 0,
  prorataJoursTravailles: null,
  prorataJoursMois: null,
  joursCongePris: 0,
  indemniteCongesUSD: 0,
  fraisMedicauxUSD: 0,
  transportUSD: 38.59649122807018,
  primesUSD: 20,
  avantagesNatureUSD: 15,
  acompteUSD: 50,
  retenuePretUSD: 25,
  salBrutUSD: 452.345, // enregistré 452.35 : arrondi à mi-chemin loin de zéro, comme Postgres
  cnssSalarieUSD: 22.6,
  netImposableUSD: 429.7288,
  iprCalculeUSD: 18.4,
  allocFamilialeUSD: 0,
  salNetUSD: 400,
  salNetCDF: 920000,
  cnssPatronalUSD: 54.66,
  inppUSD: 12.6141,
  onemUSD: 0.8409,
  coutEmployeurUSD: 520.4,
  coutEmployeurCDF: 1196920,
  ...surcharge,
});

// Champs comparés qui ne sont pas des Decimal(·, 2) en base : entiers (jours) et énumération (source).
const ENTIERS_OU_ENUM = new Set<string>([
  "sourceReference", "joursPayes100", "joursPayes2_3", "joursNonPayes", "nombreAbsences", "joursPayesNonTravailles",
  "joursAbsenceRetenus", "joursMaladieJustifies", "joursMaladieNonJustifies", "joursCongePris", "prorataJoursTravailles", "prorataJoursMois",
]);

/** La même ligne telle que la base l'a enregistrée : montants et heures en Decimal(·, 2). */
function enBase(r: DonneesLignePaie): LigneEnregistree {
  const arrondi = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
  return Object.fromEntries(CHAMPS_COMPARES.map((k) => [k, ENTIERS_OU_ENUM.has(k) ? r[k] : D(arrondi(r[k] as number))])) as LigneEnregistree;
}

const enregistree = enBase(recalculee());

describe("ligneDiffere / champsDifferents", () => {
  it("recalcul identique à l'arrondi de la base près : pas d'écart", () => {
    expect(champsDifferents(enregistree, recalculee())).toEqual([]);
    expect(ligneDiffere(enregistree, recalculee())).toBe(false);
  });

  it("un centime d'écart sur le net, le brut ou la base imposable : écart", () => {
    expect(ligneDiffere(enregistree, recalculee({ salNetUSD: 400.01 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ salNetUSD: 399.99 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ salBrutUSD: 452.36 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ netImposableUSD: 429.72 }))).toBe(true);
  });

  it("moins d'un demi-centime (arrondi de la base) : pas d'écart, sur n'importe quel montant", () => {
    expect(champsDifferents(enregistree, recalculee({ cnssPatronalUSD: 54.6649, inppUSD: 12.6099, onemUSD: 0.8350001 }))).toEqual([]);
  });

  it("heures de référence, faites ou payées non travaillées changées : écart", () => {
    expect(ligneDiffere(enregistree, recalculee({ heuresContractuelles: 225.67 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ heuresTravaillees: 207 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ heuresPayeesNonTravaillees: 9 }))).toBe(true);
  });

  it("source de la référence changée (planning → repli contrat) : écart, même à montant égal", () => {
    expect(champsDifferents(enregistree, recalculee({ sourceReference: "CONTRAT_REPLI" }))).toEqual(["sourceReference"]);
  });

  it("charges patronales et avantages en nature (défaut du 2026-10-13) : un centime suffit, le champ est nommé", () => {
    expect(champsDifferents(enregistree, recalculee({ cnssPatronalUSD: 54.67 }))).toEqual(["cnssPatronalUSD"]);
    expect(champsDifferents(enregistree, recalculee({ inppUSD: 12.62 }))).toEqual(["inppUSD"]);
    expect(champsDifferents(enregistree, recalculee({ onemUSD: 0.83 }))).toEqual(["onemUSD"]);
    expect(champsDifferents(enregistree, recalculee({ avantagesNatureUSD: 15.01 }))).toEqual(["avantagesNatureUSD"]);
  });

  it.each(CHAMPS_COMPARES.map((k) => [k]))("%s changé seul : écart, et c'est lui qui est nommé", (k) => {
    const base = recalculee();
    const v = base[k];
    const change =
      k === "sourceReference" ? "CONTRAT_REPLI"
      : v === null ? 26
      : ENTIERS_OU_ENUM.has(k) ? (v as number) + 1
      : (v as number) + 0.01;
    expect(champsDifferents(enregistree, { ...base, [k]: change } as DonneesLignePaie)).toEqual([k]);
  });

  it("compteurs que rien n'imprime ni ne déclare (congé approuvé sans effet sur un montant) : pas d'écart", () => {
    expect(champsDifferents(enregistree, recalculee({ joursCongePris: 9, joursPayes100: 12, joursPayes2_3: 3, joursNonPayes: 4, nombreAbsences: 5 }))).toEqual([]);
    expect(champsDifferents(enregistree, recalculee({ motifReference: "autre motif", avertissementsPaie: [{ code: "X" } as never] }))).toEqual([]);
  });

  it("jours imprimés sur le bulletin (maladie, absences retenues, prorata) : écart, même à montant égal", () => {
    expect(champsDifferents(enregistree, recalculee({ joursMaladieJustifies: 2 }))).toEqual(["joursMaladieJustifies"]);
    expect(champsDifferents(enregistree, recalculee({ prorataJoursTravailles: 13, prorataJoursMois: 26 }))).toEqual(["prorataJoursTravailles", "prorataJoursMois"]);
  });

  it("plusieurs champs changés : nommés dans l'ordre cause → conséquence", () => {
    const r = recalculee({ coutEmployeurUSD: 521, primesUSD: 30, cnssPatronalUSD: 55 });
    expect(champsDifferents(enregistree, r)).toEqual(["primesUSD", "cnssPatronalUSD", "coutEmployeurUSD"]);
  });
});

describe("liste des champs : chaque colonne de la ligne est tranchée", () => {
  // Colonnes que le calcul n'écrit pas : identité, état du paiement, taux figé à la validation.
  const HORS_CALCUL = ["id", "payrollRunId", "employeeId", "tauxChangeFige", "statutPaiement", "datePaiement", "modePaiement", "payeParId"];

  it("toute colonne de PayrollLine est comparée, exclue avec raison, ou hors calcul", () => {
    const colonnes = Object.values(Prisma.PayrollLineScalarFieldEnum) as string[];
    const tranchees = [...CHAMPS_COMPARES, ...Object.keys(CHAMPS_NON_COMPARES), ...HORS_CALCUL];
    expect([...tranchees].sort()).toEqual([...colonnes].sort());
  });

  it("chaque exclusion a une raison, chaque champ comparé un libellé", () => {
    for (const r of Object.values(CHAMPS_NON_COMPARES)) expect(r.length).toBeGreaterThan(10);
    for (const k of CHAMPS_COMPARES) expect(LIBELLES_CHAMPS_COMPARES[k]).toBeTruthy();
  });

  it("ce qui part dans une déclaration ou sur le bulletin est comparé", () => {
    for (const k of ["cnssSalarieUSD", "cnssPatronalUSD", "iprCalculeUSD", "inppUSD", "onemUSD", "netImposableUSD", "salBrutUSD", "avantagesNatureUSD", "transportUSD", "hsValorisee", "allocFamilialeUSD", "retenuePretUSD", "acompteUSD", "fraisMedicauxUSD", "primesUSD", "salNetUSD", "salNetCDF", "coutEmployeurUSD"]) {
      expect(CHAMPS_COMPARES).toContain(k);
    }
  });
});

describe("messagePaieChangee", () => {
  it("nomme le salarié et le champ qui a changé", () => {
    expect(messagePaieChangee([{ nom: "Dieudonné Tshala", champs: ["cnssPatronalUSD", "coutEmployeurUSD"] }])).toBe(
      "La paie de Dieudonné Tshala (CNSS patronale, coût employeur) a changé depuis son calcul : rechargez la page Paie avant d'approuver.",
    );
  });

  it("plusieurs salariés : chacun avec ses champs", () => {
    expect(messagePaieChangee([{ nom: "Ada Kalala", champs: ["avantagesNatureUSD"] }, { nom: "Béatrice Mbuyi", champs: ["inppUSD"] }])).toBe(
      "La paie de Ada Kalala (avantages en nature), Béatrice Mbuyi (INPP) a changé depuis son calcul : rechargez la page Paie avant d'approuver.",
    );
  });

  it("au-delà de six champs : les six premiers (les causes) et le compte du reste", () => {
    const champs = ["primesUSD", "salBrutUSD", "cnssSalarieUSD", "netImposableUSD", "iprCalculeUSD", "salNetUSD", "salNetCDF", "cnssPatronalUSD"];
    expect(messagePaieChangee([{ nom: "Dieudonné Tshala", champs }])).toBe(
      "La paie de Dieudonné Tshala (primes, salaire brut, CNSS salariale, base imposable, IPR, net à payer et 2 autres) a changé depuis son calcul : rechargez la page Paie avant d'approuver.",
    );
  });
});
