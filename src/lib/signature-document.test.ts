import { describe, it, expect } from "vitest";
import { canonique, empreinteDe, instantaneBulletin, instantaneContrat, instantaneDemandeConge } from "./signature-document";

const bulletin = {
  id: "l1",
  payrollRun: { mois: 9, annee: 2026, tauxChangeUtilise: 2800 },
  employee: { matricule: "PEF-007" },
  salBrutUSD: 418.51, cnssSalarieUSD: 15.19, iprCalculeUSD: 34.83, transportUSD: 114.78,
  primesUSD: 0, acompteUSD: 0, retenuePretUSD: 0, allocFamilialeUSD: 0, fraisMedicauxUSD: 0,
  salNetUSD: 368.5, statutPaiement: "VALIDE",
};

describe("canonique — l'ordre des clés ne change pas l'empreinte", () => {
  it("deux objets aux mêmes données, clés dans un autre ordre, donnent la même chaîne", () => {
    expect(canonique({ b: "2", a: "1" })).toBe(canonique({ a: "1", b: "2" }));
  });
  it("empreinteDe est un SHA-256 hexadécimal de 64 caractères", () => {
    expect(empreinteDe({ a: "1" })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("instantaneBulletin", () => {
  it("porte la période, le matricule, les montants et le statut", () => {
    const i = instantaneBulletin(bulletin as never);
    expect(i).toMatchObject({
      periode: "2026-09", matricule: "PEF-007", brut: "418.51", cnss: "15.19", ipr: "34.83",
      transport: "114.78", salaireNet: "253.72", totalVerse: "368.50", statutPaiement: "VALIDE",
    });
  });
  it("un montant qui change change l'empreinte", () => {
    const a = empreinteDe(instantaneBulletin(bulletin as never));
    const b = empreinteDe(instantaneBulletin({ ...bulletin, salNetUSD: 368.51 } as never));
    expect(a).not.toBe(b);
  });
  it("le statut de paiement fait partie de ce qui est signé (VALIDÉ ≠ PAYÉ)", () => {
    const a = empreinteDe(instantaneBulletin(bulletin as never));
    const b = empreinteDe(instantaneBulletin({ ...bulletin, statutPaiement: "PAYE" } as never));
    expect(a).not.toBe(b);
  });
  it("les montants sont des chaînes à 2 décimales : 368,5 et 368,50 donnent la même empreinte", () => {
    const a = empreinteDe(instantaneBulletin(bulletin as never));
    const b = empreinteDe(instantaneBulletin({ ...bulletin, salNetUSD: 368.5000001 } as never));
    expect(a).toBe(b);
  });
});

describe("instantaneContrat", () => {
  const contrat = {
    id: "c1", type: "CDD", poste: "Cuisinière", dateDebut: new Date("2026-01-06T00:00:00Z"),
    dateFin: new Date("2026-12-31T00:00:00Z"), finPeriodeEssai: null, salaireMensuel: 250,
    devise: "USD", heuresHebdo: 48, employee: { matricule: "PEF-007" },
  };
  it("porte les conditions économiques", () => {
    expect(instantaneContrat(contrat as never)).toMatchObject({
      type: "CDD", poste: "Cuisinière", dateDebut: "2026-01-06", dateFin: "2026-12-31",
      salaire: "250.00", devise: "USD", heuresHebdo: "48.00", matricule: "PEF-007",
    });
  });
  it("un salaire qui change change l'empreinte", () => {
    const a = empreinteDe(instantaneContrat(contrat as never));
    const b = empreinteDe(instantaneContrat({ ...contrat, salaireMensuel: 260 } as never));
    expect(a).not.toBe(b);
  });
});

describe("instantaneDemandeConge", () => {
  const demande = {
    id: "d1", type: "Congé annuel", dateDebut: new Date("2026-08-03T00:00:00Z"),
    dateFin: new Date("2026-08-08T00:00:00Z"), nbJours: 6, statut: "APPROUVE",
    approuveParId: "u1", employee: { matricule: "PEF-007" },
  };
  it("porte le type, les dates, les jours et le statut", () => {
    expect(instantaneDemandeConge(demande as never)).toMatchObject({
      type: "Congé annuel", dateDebut: "2026-08-03", dateFin: "2026-08-08", nbJours: "6",
      statut: "APPROUVE", matricule: "PEF-007",
    });
  });
  it("un nombre de jours qui change change l'empreinte", () => {
    const a = empreinteDe(instantaneDemandeConge(demande as never));
    const b = empreinteDe(instantaneDemandeConge({ ...demande, nbJours: 5 } as never));
    expect(a).not.toBe(b);
  });
});
