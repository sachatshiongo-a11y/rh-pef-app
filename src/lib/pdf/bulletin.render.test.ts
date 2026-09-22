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
