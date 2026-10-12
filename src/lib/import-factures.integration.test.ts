import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { poserContraintesFactures } from "@/lib/test/contraintes-factures";

// Import du « Suivi des factures fournisseurs » (Excel). Audit du 10/10/2026 :
//  - constat 9 : la devise est EXPLICITE (colonne Devise) ou la ligne est refusée — plus de « ≥ 10 000 = francs ÷ taux » ;
//  - constat 6 : même fournisseur + même numéro = refus sec ; même montant à ±14 jours = à confirmer ; une livraison
//    sans numéro n'est plus fusionnée en silence ;
//  - constat 7 : un fournisseur qui ressemble à un existant se décide à l'écran (jamais rattaché d'office).
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
const { annulerImport } = await import("./import-inventaire");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

type Ligne = (string | number | Date)[];
async function classeur(lignes: Ligne[], avecDevise = true): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("octobre");
  ws.getRow(9).values = ["Fournisseur", "N° facture", "Date", "Montant facture", ...(avecDevise ? ["Devise"] : []), "Statut"];
  lignes.forEach((l, i) => { ws.getRow(10 + i).values = l; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const fichier = async (lignes: Ligne[], avecDevise = true, nom = "Suivi 2026.xlsx") => new File([new Uint8Array(await classeur(lignes, avecDevise))], nom);
const D = (j: string) => new Date(`2026-10-${j}`);

const STANDARD: Ligne[] = [
  ["MAMAN PAPY", "F1", D("02"), 2800000, "FC", ""],
  ["ETS SENEVE", "S1", D("03"), 120, "$", ""],
  ["SANS DEVISE", "X1", D("04"), 28000, "", ""],
  ["EURO SARL", "E1", D("05"), 50, "EUR", ""],
];

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await poserContraintesFactures(prisma);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("devise explicite ou ligne refusée", () => {
  it("FC gardé en francs, $ en dollars ; devise absente ou illisible : ligne REFUSÉE et nommée (jamais devinée)", async () => {
    const erreurs: string[] = [];
    const lignes = await parserClasseurFactures(await classeur(STANDARD), 2026, erreurs);
    expect(lignes.map((l) => [l.fournisseurNom, l.devise, l.montant, l.reste])).toEqual([
      ["MAMAN PAPY", "CDF", 2800000, 2800000],
      ["ETS SENEVE", "USD", 120, 120],
    ]);
    expect(erreurs).toEqual([
      expect.stringMatching(/octobre, ligne 12 \(SANS DEVISE\) : devise absente/),
      expect.stringMatching(/octobre, ligne 13 \(EURO SARL\) : devise « EUR » illisible/),
    ]);
  });

  it("un gros montant sans devise n'est PAS pris pour des francs puis divisé par le taux", async () => {
    const erreurs: string[] = [];
    const lignes = await parserClasseurFactures(await classeur([["GROS", "G1", D("02"), 12000, "$", ""], ["FLOU", "G2", D("02"), 12000, "", ""]]), 2026, erreurs);
    expect(lignes.map((l) => [l.devise, l.montant])).toEqual([["USD", 12000]]); // 12 000 $ restent 12 000 $ (avant : 4,29 $)
    expect(erreurs).toHaveLength(1);
  });

  it("sans colonne Devise : toutes les lignes refusées, une seule phrase par feuille", async () => {
    const erreurs: string[] = [];
    const lignes = await parserClasseurFactures(await classeur([["ETS SENEVE", "S1", D("03"), 120, ""], ["AUTRE", "A1", D("03"), 5, ""]], false), 2026, erreurs);
    expect(lignes).toEqual([]);
    expect(erreurs).toEqual([expect.stringMatching(/octobre : pas de colonne « Devise » — 2 facture\(s\) refusée\(s\)/)]);
  });
});

describe("aperçu, application, doublons et lot annulable", () => {
  it("aperçu par devise, application en francs, re-import : refus du même numéro", async () => {
    const f = await fichier(STANDARD);
    const apercu = await analyserFactures([f]);
    expect(apercu.resume).toMatchObject({ aInserer: 2, doublons: 0, aConfirmer: 0, totalUSD: 120, total: { usd: 120, cdf: 2800000 } });
    expect(apercu.erreurs).toHaveLength(2);
    const { batchId } = await appliquerFactures([f], "Suivi 2026", null);
    const fc = await prisma.factureFournisseur.findFirstOrThrow({ where: { fournisseurNom: "MAMAN PAPY" } });
    expect([fc.devise, fc.montantCDF?.toString(), fc.resteAPayerCDF?.toString(), fc.montantUSD, fc.resteAPayerUSD]).toEqual(["CDF", "2800000", "2800000", null, null]);
    const usd = await prisma.factureFournisseur.findFirstOrThrow({ where: { fournisseurNom: "ETS SENEVE" } });
    expect([usd.devise, usd.montantUSD?.toString(), usd.montantCDF]).toEqual(["USD", "120", null]);
    const re = await analyserFactures([await fichier(STANDARD)]);
    expect(re.resume).toMatchObject({ aInserer: 0, doublons: 2 });
    expect(re.factures.map((x) => x.etat)).toEqual(["DOUBLON_NUMERO", "DOUBLON_NUMERO"]);
    // Le lot est annulable depuis l'écran Imports.
    await annulerImport(batchId);
    expect(await prisma.factureFournisseur.count()).toBe(0);
  });

  it("même fournisseur + même numéro mais autre montant : refus sec (avant : importée comme nouvelle)", async () => {
    await appliquerFactures([await fichier([["ETS SENEVE", "S9", D("03"), 100, "$", ""]])], "Premier", null);
    const a = await analyserFactures([await fichier([["ets séneve", "s9", D("10"), 175, "$", ""]], true, "Suivi 2026 bis.xlsx")]);
    expect(a.factures[0]).toMatchObject({ etat: "DOUBLON_NUMERO" });
    expect(a.factures[0].message).toMatch(/déjà une facture n° S9/);
    expect(a.resume.aInserer).toBe(0);
  });

  it("livraisons SANS numéro, même fournisseur, même montant, même jour : signalées, jamais fusionnées en silence ; importées seulement si cochées", async () => {
    const lignes: Ligne[] = [["BOULANGER", "", D("06"), 80, "$", ""], ["BOULANGER", "", D("06"), 80, "$", ""]];
    const a = await analyserFactures([await fichier(lignes)]);
    expect(a.factures.map((x) => x.etat)).toEqual(["NOUVELLE", "A_CONFIRMER"]);
    expect(a.resume).toMatchObject({ aInserer: 1, aConfirmer: 1 });
    const r1 = await appliquerFactures([await fichier(lignes)], "Sans numéro", null);
    expect(r1.resume).toMatchObject({ aInserer: 1, aConfirmer: 1 });
    expect(await prisma.factureFournisseur.count({ where: { fournisseurNom: "BOULANGER" } })).toBe(1);
    // Réimporter le même fichier : les deux lignes ressemblent à celle déjà en base ; la Direction ne coche que la seconde
    // (une vraie 2e livraison) : seule elle s'importe, l'autre reste signalée comme non importée.
    const r2 = await appliquerFactures([await fichier(lignes)], "Sans numéro bis", null, { forcer: ["1"] });
    expect(r2.resume).toMatchObject({ aInserer: 1, aConfirmer: 1 });
    expect(await prisma.factureFournisseur.count({ where: { fournisseurNom: "BOULANGER" } })).toBe(2);
  });
});

describe("fournisseur qui ressemble à un existant", () => {
  it("jamais rattaché d'office : proposé dans l'aperçu, décision exigée à l'application", async () => {
    await prisma.fournisseur.create({ data: { nom: "Maison Kathy" } });
    const lignes: Ligne[] = [["Kathy", "K1", D("07"), 30, "$", ""]];
    const a = await analyserFactures([await fichier(lignes)]);
    expect(a.fournisseursCrees).toEqual(["Kathy"]);
    expect(a.fournisseursProches["Kathy"]?.map((f) => f.nom)).toEqual(["Maison Kathy"]);
    await expect(appliquerFactures([await fichier(lignes)], "Kathy", null)).rejects.toThrow(/rien n'a été importé[\s\S]*Kathy[\s\S]*Maison Kathy/);
    expect(await prisma.factureFournisseur.count({ where: { numero: "K1" } })).toBe(0);

    const kathy = await prisma.fournisseur.findFirstOrThrow({ where: { nom: "Maison Kathy" } });
    await appliquerFactures([await fichier(lignes)], "Kathy", null, { choixFournisseurs: { Kathy: kathy.id } });
    expect((await prisma.factureFournisseur.findFirstOrThrow({ where: { numero: "K1" } })).fournisseurId).toBe(kathy.id);
    expect(await prisma.fournisseur.count({ where: { nom: "Kathy" } })).toBe(0);

    await appliquerFactures([await fichier([["Kathy", "K2", D("08"), 31, "$", ""]])], "Kathy 2", null, { choixFournisseurs: { Kathy: "CREER" } });
    expect(await prisma.fournisseur.count({ where: { nom: "Kathy" } })).toBe(1);
  });
});
