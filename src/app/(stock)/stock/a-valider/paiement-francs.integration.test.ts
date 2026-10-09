import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : payer une facture fournisseur EN FRANCS
// (demande de la Direction, 2026-10-08) — « Marquer payée » à l'unité et en lot, « + Paiement »,
// demande d'un compte non-Direction validée. Règles vérifiées : conversion par LA fonction existante
// (`convertirFrancs` / `francsEnDollars`), au taux des Paramètres du jour du PAIEMENT (de la
// VALIDATION pour une demande) ; la facture garde son reste en dollars ; le paiement garde les francs
// et le taux ; taux absent = refus lisible, rien d'écrit ; droits inchangés.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", accesStock: false } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { marquerPayee, marquerPayeesEnLot, enregistrerPaiement } = await import("../factures/actions");
const { validerDemandes } = await import("./actions");
const { messageReglements } = await import("@/lib/validations-stock/reglement");

const v = async (ids: string[]) => Object.fromEntries((await prisma.demandeValidationStock.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true } })).map((x) => [x.id, x.updatedAt.toISOString()]));

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const taux = (t: number) => prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: t } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const [k, role] of [["dir", "ADMIN"], ["resp", "STOCK"]] as const) {
    U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role } })).id;
  }
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.paiement.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await taux(2800);
  en("dir");
});

const facture = (montant: number, numero = "12") =>
  prisma.factureFournisseur.create({
    data: { fournisseurNom: "ETS SENEVE", numero, date: new Date("2026-09-01T00:00:00.000Z"), montantUSD: montant, montantRegleUSD: 0, resteAPayerUSD: montant, statut: "A_REGLER", mois: 9, annee: 2026 },
  });
const etat = async (id: string) => {
  const f = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id } });
  const p = await prisma.paiement.findMany({ where: { factureId: id }, orderBy: { createdAt: "asc" } });
  return {
    statut: f.statut, regle: f.montantRegleUSD!.toString(), reste: f.resteAPayerUSD!.toString(),
    paiements: p.map((x) => ({ montantUSD: x.montantUSD!.toString(), montantCDF: x.montantCDF?.toString() ?? null, taux: x.tauxChangeUtilise?.toString() ?? null, note: x.note })),
  };
};
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(o)) f.set(k, x); return f; };

describe("« Marquer payée » en francs (Direction)", () => {
  it("280 000 FC au taux de 2 800 soldent 100,00 $ ; le paiement garde francs et taux, la facture reste en dollars", async () => {
    const f = await facture(100);
    expect(await marquerPayee(f.id, "2026-10-01", "280 000")).toBeUndefined();
    expect(await etat(f.id)).toEqual({ statut: "REGLEE", regle: "100", reste: "0", paiements: [{ montantUSD: "100", montantCDF: "280000", taux: "2800", note: "Marquée payée (en francs)" }] });
  }, 60_000);

  it("moins de francs que le reste : paiement partiel, reste en dollars", async () => {
    const f = await facture(100);
    await marquerPayee(f.id, "2026-10-01", "140 000");
    expect(await etat(f.id)).toMatchObject({ statut: "A_REGLER", regle: "50", reste: "50", paiements: [{ montantUSD: "50", montantCDF: "140000", taux: "2800" }] });
  }, 60_000);

  it("plus de francs que le reste : refusé, rien n'est écrit", async () => {
    const f = await facture(100);
    expect(await marquerPayee(f.id, "2026-10-01", "300 000")).toMatchObject({ erreur: expect.stringMatching(/dépasse le reste à payer/) });
    expect(await etat(f.id)).toMatchObject({ statut: "A_REGLER", reste: "100", paiements: [] });
  }, 60_000);

  it("taux du jour au moment du PAIEMENT : le taux changé avant le geste s'applique", async () => {
    const f = await facture(100);
    await taux(3500);
    await marquerPayee(f.id, "2026-10-01", "280 000");
    expect(await etat(f.id)).toMatchObject({ regle: "80", reste: "20", paiements: [{ montantUSD: "80", montantCDF: "280000", taux: "3500" }] });
  }, 60_000);

  it("FC choisi mais montant vide : refusé — jamais un paiement en dollars à la place (relecture)", async () => {
    const f = await facture(100);
    expect(await marquerPayee(f.id, "2026-10-01", "")).toMatchObject({ erreur: "Saisissez le montant versé en francs." });
    expect(await marquerPayee(f.id, "2026-10-01", "  ")).toMatchObject({ erreur: "Saisissez le montant versé en francs." });
    expect(await etat(f.id)).toMatchObject({ statut: "A_REGLER", reste: "100", paiements: [] });
    en("resp");
    expect(await marquerPayee(f.id, "2026-10-01", "")).toMatchObject({ erreur: "Saisissez le montant versé en francs." });
    expect(await prisma.demandeValidationStock.count()).toBe(0);
  }, 60_000);

  it("taux absent : refus lisible, rien n'est écrit", async () => {
    const f = await facture(100);
    await taux(0);
    expect(await marquerPayee(f.id, "2026-10-01", "280 000")).toMatchObject({ erreur: expect.stringMatching(/Taux de change non configuré/) });
    expect(await etat(f.id)).toMatchObject({ reste: "100", paiements: [] });
  }, 60_000);

  it("en dollars (sans francs) : inchangé — un paiement du reste, sans francs ni taux", async () => {
    const f = await facture(100);
    await marquerPayee(f.id, "2026-10-01");
    expect(await etat(f.id)).toEqual({ statut: "REGLEE", regle: "100", reste: "0", paiements: [{ montantUSD: "100", montantCDF: null, taux: null, note: "Marquée payée" }] });
  }, 60_000);
});

describe("« Marquer payées » (lot) en francs (Direction)", () => {
  it("chaque facture soldée par reste × taux francs ; trace francs + taux ; reste 0 en dollars", async () => {
    const [a, b] = [await facture(100, "1"), await facture(33.33, "2")];
    expect(await marquerPayeesEnLot([a.id, b.id], "2026-10-01", "CDF")).toEqual({ reglees: 2, demandees: 2 });
    expect(await etat(a.id)).toMatchObject({ statut: "REGLEE", reste: "0", paiements: [{ montantUSD: "100", montantCDF: "280000", taux: "2800" }] });
    // 33,33 × 2 800 = 93 324 FC, qui redonnent 33,33 $ par la conversion des règlements.
    expect(await etat(b.id)).toMatchObject({ statut: "REGLEE", reste: "0", paiements: [{ montantUSD: "33.33", montantCDF: "93324", taux: "2800" }] });
  }, 60_000);

  it("taux absent : le lot ENTIER est refusé, rien n'est écrit", async () => {
    const [a, b] = [await facture(100, "1"), await facture(50, "2")];
    await taux(0);
    expect(await marquerPayeesEnLot([a.id, b.id], "2026-10-01", "CDF")).toMatchObject({ erreur: expect.stringMatching(/Taux de change non configuré/) });
    expect(await prisma.paiement.count()).toBe(0);
  }, 60_000);

  it("en dollars : inchangé (aucun franc écrit)", async () => {
    const a = await facture(100, "1");
    await marquerPayeesEnLot([a.id], "2026-10-01");
    expect(await etat(a.id)).toMatchObject({ statut: "REGLEE", paiements: [{ montantUSD: "100", montantCDF: null, taux: null }] });
  }, 60_000);
});

describe("demandes d'un compte non-Direction en francs : converties au taux du jour de la VALIDATION", () => {
  it("« Marquer payée » en francs : une demande, rien de payé ; validée à un autre taux, ce taux s'applique", async () => {
    const f = await facture(100);
    en("resp");
    expect(await marquerPayee(f.id, "2026-10-01", "140 000")).toMatchObject({ demande: true });
    expect(await etat(f.id)).toMatchObject({ reste: "100", paiements: [] });
    const [d] = await prisma.demandeValidationStock.findMany();
    expect(d.resume).toBe("Paiement de 140 000 FC sur la facture n° 12 de ETS SENEVE le 01/10/2026");
    en("dir");
    await taux(3500);
    expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ traitees: [d.id], echecs: [] });
    expect(await etat(f.id)).toMatchObject({ regle: "40", reste: "60", paiements: [{ montantUSD: "40", montantCDF: "140000", taux: "3500" }] });
  }, 60_000);

  it("validée alors que le taux a baissé : les francs dépassent le reste → conflit lisible, rien n'est écrit", async () => {
    const f = await facture(100);
    en("resp");
    await marquerPayee(f.id, "2026-10-01", "280 000");
    const [d] = await prisma.demandeValidationStock.findMany();
    en("dir");
    await taux(2000);
    const r = await validerDemandes([d.id], {}, await v([d.id]));
    expect(JSON.stringify(r)).toMatch(/Au taux de ce jour \(2 000 FC\/\$\), 280 000 FC font 140,00 \$ : plus que le reste à payer \(100,00 \$\)/);
    expect(await etat(f.id)).toMatchObject({ reste: "100", paiements: [] });
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
  }, 60_000);

  it("lot en francs : une demande tout-ou-rien ; validée, chaque facture soldée au taux de la validation", async () => {
    const [a, b] = [await facture(100, "1"), await facture(50, "2")];
    en("resp");
    expect(await marquerPayeesEnLot([a.id, b.id], "2026-10-01", "CDF")).toMatchObject({ reglees: 0, demandePaiement: 2 });
    const [d] = await prisma.demandeValidationStock.findMany();
    expect((d.charge as { enFrancs?: boolean }).enFrancs).toBe(true);
    expect(d.resume).toMatch(/^Payer 2 factures en francs le 01\/10\/2026 — 150,00 \$ en FC au taux du jour de la validation/);
    en("dir");
    await taux(3000);
    await validerDemandes([d.id], {}, await v([d.id]));
    expect(await etat(a.id)).toMatchObject({ statut: "REGLEE", paiements: [{ montantUSD: "100", montantCDF: "300000", taux: "3000" }] });
    expect(await etat(b.id)).toMatchObject({ statut: "REGLEE", paiements: [{ montantUSD: "50", montantCDF: "150000", taux: "3000" }] });
  }, 60_000);

  it("lot en francs demandé sans taux : refus lisible dès la demande", async () => {
    const a = await facture(100, "1");
    await taux(0);
    en("resp");
    expect(await marquerPayeesEnLot([a.id], "2026-10-01", "CDF")).toMatchObject({ erreur: expect.stringMatching(/Taux de change non configuré/) });
    expect(await prisma.demandeValidationStock.count()).toBe(0);
  }, 60_000);

  it("« + Paiement » en francs (chemin existant) : inchangé, même conversion", async () => {
    const f = await facture(100);
    await enregistrerPaiement(f.id, fd({ type: "PAIEMENT", devise: "CDF", montant: "56 000", date: "2026-10-01" }));
    expect(await etat(f.id)).toMatchObject({ regle: "20", reste: "80", paiements: [{ montantUSD: "20", montantCDF: "56000", taux: "2800" }] });
  }, 60_000);
});

describe("notification : les francs à côté des dollars", () => {
  it("dit les francs et le taux", () => {
    const r = { factureId: "f", fournisseurNom: "SENEVE", numero: "12", montant: 100, type: "PAIEMENT" as const, date: "2026-10-08", solde: true, reste: 0, montantCDF: 280000, taux: 2800 };
    expect(messageReglements([r])).toBe("Facture n° 12 de SENEVE payée le 08/10/2026 — 100,00 $ (280 000 FC au taux de 2 800)");
    expect(messageReglements([r, { ...r, numero: "13", montant: 50, montantCDF: 140000 }])).toBe("2 factures payées le 08/10/2026 — 150,00 $ (420 000 FC au taux de 2 800) (SENEVE n° 12, SENEVE n° 13)");
  });
});
