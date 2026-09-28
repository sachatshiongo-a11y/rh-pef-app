import { describe, it, expect } from "vitest";
import { renderPdfBuffer } from "./fonts";
import { AttestationDocument, dateLongue } from "./attestation";
import type { DonneesAttestation } from "@/lib/attestations-donnees";

// L'ATTESTATION IMPRIMÉE — rendu RÉEL, texte relu dans le PDF produit : numéro, « délivrée le … »,
// montants et période ; et AUCUNE police de repli (un caractère absent d'Optima fait apparaître une
// police standard non embarquée — cf. glyphes-manquants.test.ts).

async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}
const policesDuPdf = (pdf: Buffer) => [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map((m) => m[1]);
const estEmbarquee = (nom: string) => /^[A-Z]{6}\+/.test(nom);

const base: DonneesAttestation = {
  type: "TRAVAIL", nom: "Awa Mbuyi", sexe: "F", matricule: "AM12-PEF", poste: "Cuisinière",
  typeContrat: "CDI — durée indéterminée", dateEmbauche: "2023-05-01", enPoste: true, dateSortie: null,
};
const rendre = (donnees: DonneesAttestation) =>
  renderPdfBuffer(AttestationDocument({ donnees, numero: "ATT-2026-0042", delivreeLe: new Date("2026-09-28T23:30:00Z"), signature: null }));

describe("PDF d'attestation", () => {
  it("travail, en poste : numéro, date d'embauche, toujours en fonction, délivrée le (jour de Kinshasa)", async () => {
    const pdf = await rendre(base);
    const t = await texteDu(pdf);
    expect(t).toContain("N° ATT-2026-0042");
    expect(t).toContain("1er mai 2023");
    expect(t).toContain("toujours en fonction à ce jour");
    expect(t).toContain("Attestation n° ATT-2026-0042, délivrée le 29 septembre 2026");
    expect(policesDuPdf(pdf).filter((p) => !estEmbarquee(p))).toEqual([]);
  });

  it("travail, sorti : jusqu'au …", async () => {
    const t = await texteDu(await rendre({ ...base, enPoste: false, dateSortie: "2026-06-30" }));
    expect(t).toContain("jusqu'au 30 juin 2026");
    expect(t).not.toContain("toujours en fonction");
  });

  it("salaire : net et brut de la paie retenue, au titre du mois, équivalent en CDF, allocations à part — sans police de repli", async () => {
    const pdf = await rendre({
      ...base,
      type: "SALAIRE",
      salaire: { mois: 8, annee: 2026, netUSD: "1290.50", brutUSD: "1450.00", allocationsUSD: "4.50", tauxChange: "2800.00" },
    });
    const t = await texteDu(pdf);
    expect(t).toContain("Au titre du mois de août 2026");
    expect(t).toContain("1 290,50 $");
    expect(t).toContain("1 450,00 $");
    expect(t).toContain("3 613 400 CDF");
    expect(t).toContain("allocations familiales de 4,50 $");
    expect(policesDuPdf(pdf).filter((p) => !estEmbarquee(p))).toEqual([]);
  });

  it("stage : période du stage", async () => {
    const t = await texteDu(await rendre({ ...base, type: "STAGE", stage: { debut: "2026-03-01", fin: "2026-08-31" } }));
    expect(t).toContain("a effectué un stage");
    expect(t).toContain("du 1er mars 2026 au 31 août 2026");
    expect(t).toContain("Attestation de stage");
  });

  it("dateLongue n'emploie jamais Intl (pas d'espace fine possible)", () => {
    expect(dateLongue("2026-01-01")).toBe("1er janvier 2026");
    expect(dateLongue("2026-12-25")).toBe("25 décembre 2026");
  });
});
