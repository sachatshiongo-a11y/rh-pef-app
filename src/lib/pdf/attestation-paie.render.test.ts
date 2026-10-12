import { describe, it, expect } from "vitest";
import type { Employee, PayrollLine, PayrollRun } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { AttestationPaieDocument } from "./attestation-paie";
import { pagesDuPdf, policesDeRepli } from "@/lib/test/pdf-lecture";

// ATTESTATION DE PAIE — pied « Page x sur y » (le `lineHeight` de la <Page> le faisait disparaître,
// cf. contrat.render.test.ts) et montants relus dans le PDF produit.

const employee = { id: "e1", matricule: "AM12-PEF", nom: "Awa Mbuyi", sexe: "F", poste: "Cuisinière" } as unknown as Employee;
const ligne = { salNetUSD: "300.00", transportUSD: "20.00", salNetCDF: "840000" } as unknown as PayrollLine;
const run = { mois: 8, annee: 2026, tauxChangeUtilise: "2800" } as unknown as PayrollRun;

describe("PDF de l'attestation de paie", () => {
  it("« Page 1 sur 1 » et libellé du document au pied ; montants présents ; aucune police de repli", async () => {
    const pdf = await renderPdfBuffer(AttestationPaieDocument({ employee, ligne, run, signature: null }));
    const pages = await pagesDuPdf(pdf);
    expect(pages.length).toBe(1);
    expect(pages[0].plat).toContain("Page 1 sur 1");
    expect(pages[0].plat).toContain("Attestation de paie");
    expect(pages[0].plat).toContain("300,00 $");
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);
});
