import { describe, it, expect } from "vitest";
import type { Employee, PayrollLine, PayrollRun } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { BulletinDocument } from "./bulletin";
import { LivrePaieDocument } from "./livre-paie";

/**
 * Audit paie du 2026-10-10 : un bulletin dont la ligne n'est ni VALIDÉE ni PAYÉE sortait propre, sans
 * rien qui dise qu'il pouvait encore changer. Désormais bandeau + filigrane « PROVISOIRE — non
 * validé » — sans jamais ajouter une page au bulletin.
 */
async function pages(buffer: Buffer): Promise<string[]> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text.replace(/\s+/g, " "));
}

const employee = {
  id: "e1", matricule: "PEF-007", nom: "Aimée Mutita", sexe: "F", poste: "Cuisinière", secteur: "Cuisine", categorie: "BRIGADE",
  enfants: 0, salaireMensuel: 250, dateEmbauche: new Date("2025-01-06"), heuresHebdomadaires: 48,
} as unknown as Employee;
const run = { id: "r1", mois: 9, annee: 2026, tauxChangeUtilise: 2800, statut: "BROUILLON" } as unknown as PayrollRun;
const ligne = (statutPaiement: string) => ({
  id: "l1", employeeId: "e1", payrollRunId: "r1", statutPaiement,
  remuneration100: 264.94, remuneration2_3: 0, remunerationJoursPayesUSD: 0, hsValorisee: 0,
  heuresTravaillees: 208, heuresContractuelles: 208, heuresSupp30: 0, heuresSupp60: 0, heuresSupp100: 0,
  joursPayesNonTravailles: 0, fraisMedicauxUSD: 0, transportUSD: 0, primesUSD: 0, avantagesNatureUSD: 0, acompteUSD: 0, retenuePretUSD: 0,
  salBrutUSD: 264.94, cnssSalarieUSD: 13.25, netImposableUSD: 251.69, iprCalculeUSD: 20, allocFamilialeUSD: 0, salNetUSD: 231.69,
  cnssPatronalUSD: 34.44, inppUSD: 7.95, onemUSD: 0.53, coutEmployeurUSD: 307.86, sourceReference: "CONTRAT", heuresPayeesNonTravaillees: 0,
}) as unknown as PayrollLine;
const rendre = (statut: string, extra: Partial<Parameters<typeof BulletinDocument>[0]> = {}) =>
  renderPdfBuffer(BulletinDocument({ employee, ligne: ligne(statut), run, devise: "USD", congesPeriode: [], feries: [], primes: [], codesParJour: {}, ...extra }));

describe("bulletin — mention PROVISOIRE selon l'état de la ligne", () => {
  it("PAS_VALIDE : bandeau et filigrane, toujours UNE page", async () => {
    const p = await pages(await rendre("PAS_VALIDE"));
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("PROVISOIRE — non validé");
    expect(p[0]).toContain("PROVISOIRE — NON VALIDÉ");
  }, 60_000);

  it.each(["VALIDE", "PAYE"])("%s : aucune mention", async (statut) => {
    expect((await pages(await rendre(statut))).join(" ")).not.toContain("PROVISOIRE");
  }, 60_000);

  it("une archive (bulletin remis) n'est jamais provisoire, même si l'instantané a gardé l'état d'avant validation", async () => {
    const p = await pages(await rendre("PAS_VALIDE", { archive: { version: 1, remisLe: new Date("2026-09-30T10:00:00Z") } }));
    expect(p.join(" ")).not.toContain("PROVISOIRE");
  }, 60_000);
});

describe("livre de paie — mention PROVISOIRE quand il contient du non validé", () => {
  const l = (statutPaiement: "PAS_VALIDE" | "VALIDE", i: number) => ({
    salBrutUSD: 300, cnssSalarieUSD: 15, iprCalculeUSD: 20, transportUSD: 10, salNetUSD: 275, hsValorisee: 0,
    heuresSupp30: 0, heuresSupp60: 0, heuresSupp100: 0, statutPaiement,
    employee: { matricule: `PEF-00${i}`, nom: `Salarié ${i}`, categorie: "BRIGADE" },
  });
  it("avec un brouillon : en-tête de chaque page et pied le disent", async () => {
    const p = await pages(await renderPdfBuffer(LivrePaieDocument({ lignes: [l("VALIDE", 1), l("PAS_VALIDE", 2)] as never, taux: 2800, periode: "septembre 2026" })));
    expect(p.every((x) => x.includes("PROVISOIRE — non validé"))).toBe(true);
    expect(p.join(" ")).toContain("1 bulletin(s) sur 2 pas encore validé(s)");
  }, 60_000);
  it("tout validé : rien", async () => {
    const p = await pages(await renderPdfBuffer(LivrePaieDocument({ lignes: [l("VALIDE", 1)] as never, taux: 2800, periode: "septembre 2026" })));
    expect(p.join(" ")).not.toContain("PROVISOIRE");
  }, 60_000);
});
