import { describe, it, expect } from "vitest";
import type { Employee, PayrollLine, PayrollRun } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { BulletinDocument } from "./bulletin";

/**
 * Le bas du bulletin dit le SALAIRE NET (hors transport), l'indemnité de transport à part, puis le
 * TOTAL VERSÉ — décision Direction 2026-09-22. Avant, « SALAIRE NET À PAYER » portait le total
 * versé et le net de la fiche ne s'y retrouvait jamais. Ligne réelle : Aimée Mutita, sept. 2026.
 */
async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

const employee = {
  id: "e1", matricule: "PEF-007", nom: "Aimée Mutita", sexe: "F", poste: "Cuisinière", secteur: "Cuisine",
  categorie: "BRIGADE", contrat: "CDD", enfants: 0, salaireMensuel: 250, dateEmbauche: new Date("2025-01-06"),
  heuresHebdomadaires: 48, transportJourCDF: 10000,
} as unknown as Employee;

const run = { id: "r1", mois: 9, annee: 2026, tauxChangeUtilise: 2800, statut: "BROUILLON" } as unknown as PayrollRun;

function ligne(surcharges: Partial<Record<keyof PayrollLine, unknown>> = {}): PayrollLine {
  return {
    id: "l1", employeeId: "e1", payrollRunId: "r1", statutPaiement: "PAS_VALIDE",
    remuneration100: 264.94, remuneration2_3: 0, remunerationJoursPayesUSD: 0, hsValorisee: 1.96,
    heuresTravaillees: 208, heuresContractuelles: 208, heuresSupp30: 1, heuresSupp60: 0, heuresSupp100: 0,
    joursPayes100: 26, joursPayes2_3: 0, joursNonPayes: 0, joursPayesNonTravailles: 0, joursCongePris: 0,
    indemniteCongesUSD: 0, fraisMedicauxUSD: 0, transportUSD: 114.78, primesUSD: 0, avantagesNatureUSD: 0,
    acompteUSD: 0, retenuePretUSD: 0, salBrutUSD: 418.51, cnssSalarieUSD: 15.19, netImposableUSD: 288.54,
    iprCalculeUSD: 34.83, allocFamilialeUSD: 0, salNetUSD: 368.5, salNetCDF: 368.5 * 2800,
    cnssPatronalUSD: 36.46, inppUSD: 9.11, onemUSD: 0.61, coutEmployeurUSD: 464.69, coutEmployeurCDF: 464.69 * 2800,
    datePaiement: null, modePaiement: null, payeParId: null,
    ...surcharges,
  } as unknown as PayrollLine;
}

const rendre = (l: PayrollLine, devise: "USD" | "CDF" = "USD") =>
  renderPdfBuffer(BulletinDocument({ employee, ligne: l, run, devise, congesPeriode: [], feries: [], primes: [], codesParJour: {} }));

describe("bulletin — le bas de page distingue salaire net, transport et total versé", () => {
  it("avec transport : SALAIRE NET 253,72 $, Indemnité de transport 114,78 $, TOTAL VERSÉ 368,50 $", async () => {
    const t = await texteDu(await rendre(ligne()));
    expect(t).toMatch(/SALAIRE NET\s*253,72 \$/);
    // Le libellé réel porte la mention « (non imposable, non cotisable) » avant le montant
    // (même <Text>, cf. bulletin.tsx) — chaîne attendue ajustée au rendu réel, montant inchangé.
    expect(t).toMatch(/Indemnité de transport \(non imposable, non cotisable\)\s*114,78 \$/);
    expect(t).toMatch(/TOTAL VERSÉ\s*368,50 \$/);
    expect(t).not.toContain("NET À PAYER");
    expect(t).not.toContain("versé au net");
  }, 60_000);

  it("sans transport : pas de ligne transport, et le total versé égale le salaire net", async () => {
    const t = await texteDu(await rendre(ligne({ transportUSD: 0, salNetUSD: 253.72, salBrutUSD: 303.73 })));
    expect(t).toMatch(/SALAIRE NET\s*253,72 \$/);
    expect(t).not.toContain("Indemnité de transport");
    expect(t).toMatch(/TOTAL VERSÉ\s*253,72 \$/);
  }, 60_000);

  it("en CDF, les trois montants sont au taux du bulletin", async () => {
    const t = await texteDu(await rendre(ligne(), "CDF"));
    expect(t).toMatch(/SALAIRE NET\s*710 416 CDF/); // 253,72 × 2 800 — format réel de formatMontant (« CDF », pas « FC »)
    expect(t).toMatch(/TOTAL VERSÉ\s*1 031 800 CDF/); // 368,50 × 2 800
  }, 60_000);
});

/** Nombre de pages du PDF rendu : le bulletin tient sur UNE page. */
async function pagesDu(buffer: Buffer): Promise<number> {
  const { PDFParse } = await import("pdf-parse");
  return (await new PDFParse({ data: new Uint8Array(buffer) }).getText()).pages.length;
}

/**
 * Polices déclarées dans le PDF (même lecture que `glyphes-manquants.test.ts`). Un texte qui tient
 * entièrement dans Optima n'embarque que des sous-ensembles préfixés « ABCDEF+ » ; un caractère
 * absent de la police (espace fine U+202F, ⚠, flèche…) fait apparaître une police standard non
 * embarquée — le glyphe sort barré ou remplacé à l'impression.
 */
function policesNonEmbarquees(pdf: Buffer): string[] {
  return [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)]
    .map((m) => m[1])
    .filter((nom) => !/^[A-Z]{6}\+/.test(nom));
}

describe("bulletin — référence d'heures du mois (paie sur heures planifiées, 2026-09-23)", () => {
  it("ligne antérieure (source CONTRAT par défaut) : « Heures / mois », comme avant", async () => {
    const t = await texteDu(await rendre(ligne()));
    // Les libellés de la case récapitulative sont rendus en capitales (style `recapLabel`).
    expect(t).toMatch(/HEURES \/ MOIS\s*208 h/);
    expect(t).not.toContain("HEURES PLANIFIÉES");
  }, 60_000);

  it("source PLANNING : « Heures planifiées » et R (216 h), sur une seule page", async () => {
    const buf = await rendre(ligne({ sourceReference: "PLANNING", heuresContractuelles: 216 }));
    const t = await texteDu(buf);
    expect(t).toMatch(/HEURES PLANIFIÉES\s*216 h/);
    expect(await pagesDu(buf)).toBe(1);
    expect(policesNonEmbarquees(buf)).toEqual([]);
  }, 60_000);

  it("repli : « Heures contrat (repli) »", async () => {
    const t = await texteDu(await rendre(ligne({ sourceReference: "CONTRAT_REPLI" })));
    expect(t).toMatch(/HEURES CONTRAT \(REPLI\)\s*208 h/);
  }, 60_000);

  it("jours payés non travaillés en heures : base « 54 h (9 j) », une seule page avec congé", async () => {
    const buf = await rendre(ligne({ sourceReference: "PLANNING", heuresContractuelles: 156, heuresPayeesNonTravaillees: 54, joursPayesNonTravailles: 9, remunerationJoursPayesUSD: 82.05, joursCongePris: 9 }));
    const t = await texteDu(buf);
    expect(t).toMatch(/54 h \(9 j\)/);
    expect(await pagesDu(buf)).toBe(1);
  }, 60_000);

  it("R fractionnaire : virgule décimale française (« 173,33 h »), jamais « 173.33 »", async () => {
    const buf = await rendre(ligne({ sourceReference: "PLANNING", heuresContractuelles: 173.33, heuresTravaillees: 157.5, heuresPayeesNonTravaillees: 7.5, joursPayesNonTravailles: 1, remunerationJoursPayesUSD: 10 }));
    const t = await texteDu(buf);
    expect(t).toMatch(/Salaire de base \(heures travaillées\)\s*156,5 h/); // 157,5 − 1 h sup.
    expect(t).toMatch(/HEURES PLANIFIÉES\s*173,33 h/);
    expect(t).toMatch(/7,5 h \(1 j\)/);
    expect(t).not.toContain("173.33");
    expect(policesNonEmbarquees(buf)).toEqual([]);
  }, 60_000);

  it("repli : le motif est imprimé en une ligne sobre, dans la police du bulletin", async () => {
    const buf = await rendre(ligne({ sourceReference: "CONTRAT_REPLI", motifReference: "Planning incomplet : semaine du 07/09 sans créneau" }));
    const t = await texteDu(buf);
    expect(t).toMatch(/Heures contrat \(repli\) : Planning incomplet : semaine du 07\/09 sans créneau/);
    expect(await pagesDu(buf)).toBe(1);
    expect(policesNonEmbarquees(buf)).toEqual([]);
  }, 60_000);

  it("le motif n'apparaît que pour un repli", async () => {
    const t = await texteDu(await rendre(ligne({ sourceReference: "PLANNING", motifReference: "Motif résiduel" })));
    expect(t).not.toContain("Motif résiduel");
  }, 60_000);

  it("le motif le plus long (5 semaines vides) ne fait jamais passer à deux pages un bulletin qui tient sur une", async () => {
    // Le motif occupe l'espace libre du cadre des rubriques (étiré à la hauteur du calendrier) : il
    // n'allonge pas la page. Configurations qui tiennent sur UNE page aujourd'hui, de la plus nue à la
    // plus chargée. Limite connue (rapport de la tâche 8) : quand les rubriques sont plus hautes que
    // le calendrier ET que la page est déjà pleine (toutes les rubriques optionnelles + payé), les
    // signatures passaient déjà en page 2 avec un congé ; la ligne du motif peut alors en faire autant.
    const semaines = ["31/08", "07/09", "14/09", "21/09", "28/09"].map((d) => `semaine du ${d} sans créneau`).join(", ");
    const motif = `Planning incomplet : ${semaines}`;
    const rubriques = { remunerationJoursPayesUSD: 40, joursPayesNonTravailles: 4, heuresPayeesNonTravaillees: 32, remuneration2_3: 12, acompteUSD: 50, retenuePretUSD: 20, fraisMedicauxUSD: 15, heuresSupp60: 2, heuresSupp100: 3 };
    const conge = [{ dateDebut: new Date("2026-09-07"), dateFin: new Date("2026-09-09") }];
    const cas: [string, Record<string, unknown>, typeof conge][] = [
      ["nu", {}, []],
      ["un congé", {}, conge],
      ["payé avec avantages en nature", { statutPaiement: "PAYE", avantagesNatureUSD: 30 }, []],
      ["toutes les rubriques", rubriques, []],
    ];
    const salarie = { ...employee, banque: "Rawbank", compteBancaire: "05100-01234567890-12" } as unknown as Employee;
    const pdf = (s: Record<string, unknown>, c: typeof conge) => renderPdfBuffer(BulletinDocument({
      employee: salarie, ligne: ligne(s), run, devise: "CDF", congesPeriode: c, feries: [], primes: [{ nom: "Prime de rendement", montantUSD: 0 }], codesParJour: {},
    }));
    for (const [nom, s, c] of cas) {
      const sans = await pdf({ ...s, sourceReference: "CONTRAT" }, c);
      expect(await pagesDu(sans), `${nom} (sans motif)`).toBe(1);
      const avec = await pdf({ ...s, sourceReference: "CONTRAT_REPLI", motifReference: motif }, c);
      expect(await pagesDu(avec), `${nom} (avec motif)`).toBe(1);
      expect(await texteDu(avec), nom).toContain(`Heures contrat (repli) : ${motif}`);
      expect(policesNonEmbarquees(avec), nom).toEqual([]);
    }
  }, 120_000);
});
