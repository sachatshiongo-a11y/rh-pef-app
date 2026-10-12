import { describe, it, expect } from "vitest";
import type { Employee, PayrollLine, PayrollRun } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { AttestationPaieDocument } from "./attestation-paie";
import { pagesDuPdf, policesDeRepli } from "@/lib/test/pdf-lecture";

// ATTESTATION DE PAIE — pied « Page x sur y » (le `lineHeight` de la <Page> le faisait disparaître,
// cf. contrat.render.test.ts) et montants relus dans le PDF produit.

const employee = { id: "e1", matricule: "AM12-PEF", nom: "Awa Mbuyi", sexe: "F", poste: "Cuisinière" } as unknown as Employee;
const ligne = { salNetUSD: "300.00", transportUSD: "20.00", salNetCDF: "840000", acompteUSD: "0", retenuePretUSD: "0", fraisMedicauxUSD: "0" } as unknown as PayrollLine;
const run = { mois: 8, annee: 2026, tauxChangeUtilise: "2800" } as unknown as PayrollRun;

describe("PDF de l'attestation de paie", () => {
  it("« Page 1 sur 1 » et libellé du document au pied ; montants présents ; aucune police de repli", async () => {
    const pdf = await renderPdfBuffer(AttestationPaieDocument({ employee, ligne, run, signature: null }));
    const pages = await pagesDuPdf(pdf);
    expect(pages.length).toBe(1);
    expect(pages[0].plat).toContain("Page 1 sur 1");
    expect(pages[0].plat).toContain("Attestation de paie");
    expect(pages[0].plat).toContain("280,00 $"); // net habituel = 300 − 20 de transport
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);

  // Décision Direction 2026-10-12 : NET HABITUEL (avant acompte et prêt), francs au taux FIGÉ.
  it("net habituel : l'acompte et l'échéance de prêt ne réduisent pas le salaire attesté ; taux figé à la validation", async () => {
    const avecAvances = { salNetUSD: "180.00", transportUSD: "20.00", salNetCDF: "504000", acompteUSD: "50", retenuePretUSD: "50", fraisMedicauxUSD: "0", tauxChangeFige: "2800" } as unknown as PayrollLine;
    const runTauxDuJour = { ...run, tauxChangeUtilise: "2900" } as unknown as PayrollRun;
    const pdf = await renderPdfBuffer(AttestationPaieDocument({ employee, ligne: avecAvances, run: runTauxDuJour, signature: null }));
    const t = (await pagesDuPdf(pdf))[0].plat;
    expect(t).toContain("260,00 $"); // 180 − 20 + 50 + 50
    expect(t).toContain("728 000 CDF"); // 260 × 2 800 (taux figé), jamais × 2 900
    expect(t).not.toContain("754 000");
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);
});
