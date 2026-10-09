import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { poserContraintesFactures } from "@/lib/test/contraintes-factures";

// Import du « Suivi des factures fournisseurs » (Excel) et devise (2026-10-09) : une colonne
// « Devise » remplie dit la devise de chaque facture — « FC » = facture EN FRANCS, gardée en francs
// (jamais convertie) ; sans devise, comme avant (dollars, gros montants ÷ taux) ; une devise
// illisible écarte la ligne en la nommant (jamais devinée). Re-importer ne crée pas de doublon.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { parserClasseurFactures } = await import("./import-factures-excel");
const { analyserFactures, appliquerFactures } = await import("./import-factures");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

async function classeur(avecDevise: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("octobre");
  ws.getRow(9).values = ["Fournisseur", "N° facture", "Date", "Montant facture", ...(avecDevise ? ["Devise"] : []), "Statut"];
  const lignes: (string | number | Date)[][] = avecDevise
    ? [
        ["MAMAN PAPY", "F1", new Date("2026-10-02"), 2800000, "FC", ""],
        ["ETS SENEVE", "S1", new Date("2026-10-03"), 120, "$", ""],
        ["SANS DEVISE", "X1", new Date("2026-10-04"), 28000, "", ""],
        ["EURO SARL", "E1", new Date("2026-10-05"), 50, "EUR", ""],
      ]
    : [["ETS SENEVE", "S1", new Date("2026-10-03"), 120, ""]];
  lignes.forEach((l, i) => { ws.getRow(10 + i).values = l; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const fichier = async (avecDevise: boolean) => new File([new Uint8Array(await classeur(avecDevise))], "Suivi 2026.xlsx");

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await poserContraintesFactures(prisma);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("import Excel des factures et devise", () => {
  it("colonne Devise : FC gardé en francs, $ en dollars, vide comme avant, illisible écartée et nommée", async () => {
    const erreurs: string[] = [];
    const lignes = await parserClasseurFactures(await classeur(true), 2026, 2800, erreurs);
    expect(lignes.map((l) => [l.fournisseurNom, l.devise, l.montant, l.reste])).toEqual([
      ["MAMAN PAPY", "CDF", 2800000, 2800000],
      ["ETS SENEVE", "USD", 120, 120],
      ["SANS DEVISE", "USD", 10, 10], // sans devise : la règle d'avant (≥ 10 000 = francs, ÷ taux)
    ]);
    expect(erreurs).toEqual([expect.stringMatching(/octobre, ligne 13 \(EURO SARL\) : devise « EUR » illisible/)]);
  });

  it("sans colonne Devise : exactement comme avant (dollars)", async () => {
    expect((await parserClasseurFactures(await classeur(false), 2026, 2800)).map((l) => [l.devise, l.montant])).toEqual([["USD", 120]]);
  });

  it("aperçu par devise, application en francs, re-import sans doublon", async () => {
    const apercu = await analyserFactures([await fichier(true)]);
    expect(apercu.resume).toMatchObject({ aInserer: 3, totalUSD: 130, total: { usd: 130, cdf: 2800000 } });
    await appliquerFactures([await fichier(true)], "Suivi 2026", null);
    const fc = await prisma.factureFournisseur.findFirstOrThrow({ where: { fournisseurNom: "MAMAN PAPY" } });
    expect([fc.devise, fc.montantCDF?.toString(), fc.resteAPayerCDF?.toString(), fc.montantUSD, fc.resteAPayerUSD]).toEqual(["CDF", "2800000", "2800000", null, null]);
    const usd = await prisma.factureFournisseur.findFirstOrThrow({ where: { fournisseurNom: "ETS SENEVE" } });
    expect([usd.devise, usd.montantUSD?.toString(), usd.montantCDF]).toEqual(["USD", "120", null]);
    expect((await analyserFactures([await fichier(true)])).resume).toMatchObject({ aInserer: 0, doublons: 3 });
  });
});
