import { describe, it, expect } from "vitest";
import type { Employee, LeaveRequest } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { DemandeCongeDocument } from "./demande-conge";

/**
 * Audit paie du 2026-10-10 : la « date de reprise » était la fin + 1 jour, soit un DIMANCHE pour un
 * congé qui finit un samedi, et la date de fin n'était pas imprimée. La reprise est le prochain jour
 * ouvrable (ni dimanche ni férié) et la date de fin figure sur la demande.
 */
async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

const employee = { id: "e1", matricule: "PEF-007", nom: "Aimée Mutita", poste: "Cuisinière", secteur: "Cuisine" } as unknown as Employee;
const demande = (dateFin: string) => ({
  id: "d1", employeeId: "e1", type: "Congé annuel", dateDebut: new Date("2026-09-14T00:00:00Z"), dateFin: new Date(`${dateFin}T00:00:00Z`),
  nbJours: 6, motif: null, statut: "EN_ATTENTE", motifRefus: null,
}) as unknown as LeaveRequest;
const rendre = (dateFin: string, feries: string[] = []) =>
  renderPdfBuffer(DemandeCongeDocument({ employee, demande: demande(dateFin), remplacant: null, solde: { jours: 10, au: new Date("2026-09-10T00:00:00Z"), origine: "EDITION" }, feries }));

describe("demande de congé PDF — date de fin et reprise", () => {
  it("fin un samedi (19/09/2026) : fin imprimée, reprise le lundi 21/09 (et non le dimanche 20/09)", async () => {
    const t = await texteDu(await rendre("2026-09-19"));
    expect(t).toMatch(/Date de fin\s*19\/09\/2026/);
    expect(t).toMatch(/Date de reprise\s*21\/09\/2026/);
    expect(t).not.toMatch(/Date de reprise\s*20\/09\/2026/);
  }, 60_000);

  it("fin un vendredi (18/09) : reprise le samedi 19/09, jour ouvrable en RDC", async () => {
    expect(await texteDu(await rendre("2026-09-18"))).toMatch(/Date de reprise\s*19\/09\/2026/);
  }, 60_000);

  it("lundi 21/09 férié : reprise le mardi 22/09", async () => {
    expect(await texteDu(await rendre("2026-09-19", ["2026-09-21"]))).toMatch(/Date de reprise\s*22\/09\/2026/);
  }, 60_000);
});
