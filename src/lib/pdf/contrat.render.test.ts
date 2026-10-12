import { describe, it, expect } from "vitest";
import type { Employee, Contrat } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { ContratDocument } from "./contrat";
import { pagesDuPdf, policesDeRepli } from "@/lib/test/pdf-lecture";

/**
 * CONTRAT — pied de page « Page x sur y » sur CHAQUE page. Un `lineHeight` posé sur la <Page> est
 * hérité par la ligne de pied du composant commun et la fait disparaître (défaut constaté le
 * 12/10 sur le contrat, les attestations et les fiches de poste) : l'interligne vit sur le bloc
 * `corps`, jamais sur la page.
 */

const employee = {
  id: "e1", matricule: "AM12-PEF", nom: "Awa Mbuyi", sexe: "F", poste: "Cuisinière", type: "NATIONAL",
  telephone: "+243 81 000 0000", adresse: "12 avenue de la Paix, Gombe", enfants: 2,
} as unknown as Employee;
const contrat = {
  id: "c1", type: "CDI", dateDebut: new Date("2026-05-01"), dateFin: null, finPeriodeEssai: new Date("2026-08-01"),
  heuresHebdo: "48", salaireMensuel: "450", devise: "USD", poste: "Cuisinière", renouvellements: 0,
} as unknown as Contrat;
const params = { preavisDemission: 30, preavisLicenciement: 30, droitsCongesAnnuel: 18 };

const rendre = (fonctions: string | null = null) =>
  renderPdfBuffer(ContratDocument({ employee, contrat, params, salaireEstNet: true, salaireBrut: "520,00 USD", fonctions, signature: null }));

describe("PDF du contrat — pied de page", () => {
  it("« Page x sur N » sur chaque page, avec le libellé du document ; les 11 articles tiennent sur 3 pages ; aucune police de repli", async () => {
    const pdf = await rendre();
    const pages = await pagesDuPdf(pdf);
    expect(pages.length).toBe(3);
    pages.forEach((p, i) => {
      expect(p.plat, `page ${i + 1}`).toContain(`Page ${i + 1} sur ${pages.length}`);
      expect(p.plat, `page ${i + 1}`).toContain("Contrat de travail — AM12-PEF");
    });
    const tout = pages.map((p) => p.plat).join(" ");
    expect(tout).toContain("Article 11 — Litiges et dispositions diverses");
    expect(tout).not.toContain("Article 12");
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);

  it("contrat long (missions nombreuses dans l'article 1) : le pied suit le nombre de pages", async () => {
    const fonctions = Array.from({ length: 25 }, (_, i) => `mission longue numéro ${i + 1} du poste de cuisinière`).join("\n");
    const pages = await pagesDuPdf(await rendre(fonctions));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    pages.forEach((p, i) => expect(p.plat, `page ${i + 1}`).toContain(`Page ${i + 1} sur ${pages.length}`));
  }, 60_000);
});
