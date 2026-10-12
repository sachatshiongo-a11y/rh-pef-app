import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Corriger une facture : en-tête (numéro, date, échéance, fournisseur, montant) et « Annuler ce paiement »
// (audit du 10/10/2026, constat 11). Direction seule, journalisé avant → après, clôture et devise respectées.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction", accesStock: false }, refuser: false }));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: () => { if (A.refuser) throw new Error("Réservé à la Direction."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" }); } }));

const { modifierEnteteFacture, annulerPaiementFacture, marquerPayee, enregistrerPaiement } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let f1: string, f2: string;
let articleId: string;

const base = { mois: 9, annee: 2026 };
const journal = (id: string) => prisma.journalAudit.findMany({ where: { entiteId: id }, orderBy: { date: "asc" } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  f1 = (await prisma.fournisseur.create({ data: { nom: "SENEVE" } })).id;
  f2 = (await prisma.fournisseur.create({ data: { nom: "KATHY" } })).id;
  articleId = (await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE" } })).id;
  await prisma.stock.create({ data: { articleId, quantite: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("modifierEnteteFacture", () => {
  it("corrige numéro, date, échéance et fournisseur : seules les différences sont écrites, journalisées avant → après", async () => {
    const f = await prisma.factureFournisseur.create({ data: { ...base, fournisseurId: f1, fournisseurNom: "SENEVE", numero: "FA-1O1", date: new Date("2026-09-10"), dateEcheance: new Date("2026-10-10"), montantUSD: 100, resteAPayerUSD: 100, montantRegleUSD: 0, statut: "A_REGLER" } });
    const r = await modifierEnteteFacture(f.id, { numero: "FA-101", date: "2026-09-12", dateEcheance: "2026-10-20", fournisseurId: f2, montant: "100" });
    expect(r).toMatchObject({ changements: expect.arrayContaining([expect.stringMatching(/numéro : FA-1O1 → FA-101/)]) });
    const apres = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } });
    expect(apres).toMatchObject({ numero: "FA-101", fournisseurId: f2, fournisseurNom: "KATHY" });
    expect(apres.date?.toISOString().slice(0, 10)).toBe("2026-09-12");
    expect(apres.dateEcheance?.toISOString().slice(0, 10)).toBe("2026-10-20");
    const champs = (await journal(f.id)).map((j) => `${j.champ} | ${j.ancienneValeur} -> ${j.nouvelleValeur}`);
    expect(champs).toEqual(expect.arrayContaining(["correction numéro | FA-1O1 -> FA-101", "correction fournisseur | SENEVE -> KATHY", "correction date | 10/09/2026 -> 12/09/2026"]));
  }, 60_000);

  it("une échéance repoussée recalcule le statut (échue -> à régler)", async () => {
    const f = await prisma.factureFournisseur.create({ data: { ...base, fournisseurNom: "X", date: new Date("2026-01-10"), dateEcheance: new Date("2026-02-10"), montantUSD: 50, resteAPayerUSD: 50, montantRegleUSD: 0, statut: "ECHUE_NON_REGLEE" } });
    await modifierEnteteFacture(f.id, { dateEcheance: "2099-01-01" });
    expect((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } })).statut).toBe("A_REGLER");
  }, 60_000);

  it("numéro déjà pris chez le même fournisseur : refus sec", async () => {
    await prisma.factureFournisseur.create({ data: { ...base, fournisseurId: f1, fournisseurNom: "SENEVE", numero: "PRIS", montantUSD: 1, resteAPayerUSD: 1 } });
    const f = await prisma.factureFournisseur.create({ data: { ...base, fournisseurId: f1, fournisseurNom: "SENEVE", numero: "AUTRE", montantUSD: 2, resteAPayerUSD: 2 } });
    expect(await modifierEnteteFacture(f.id, { numero: "pris" })).toMatchObject({ erreur: expect.stringMatching(/déjà une facture n° PRIS/) });
    expect((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } })).numero).toBe("AUTRE");
  }, 60_000);

  it("montant : modifiable sans ligne ni entrée (devise de la facture respectée, reste recalculé) ; refusé en expliquant sinon", async () => {
    const libre = await prisma.factureFournisseur.create({ data: { ...base, fournisseurNom: "L", devise: "CDF", montantCDF: 280000, montantRegleCDF: 100000, resteAPayerCDF: 180000, montantUSD: null, montantRegleUSD: null, resteAPayerUSD: null, statut: "A_REGLER" } });
    await modifierEnteteFacture(libre.id, { montant: "300 000" });
    const apres = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: libre.id } });
    expect(Number(apres.montantCDF)).toBe(300000);
    expect(Number(apres.resteAPayerCDF)).toBe(200000);
    expect(apres.montantUSD).toBeNull();
    // Montant inférieur au déjà réglé : refus.
    expect(await modifierEnteteFacture(libre.id, { montant: "50000" })).toMatchObject({ erreur: expect.stringMatching(/inférieur au déjà réglé/) });

    const detaillee = await prisma.factureFournisseur.create({ data: { ...base, fournisseurNom: "D", montantUSD: 10, resteAPayerUSD: 10, montantRegleUSD: 0, lignes: { create: [{ designation: "Farine", quantite: 1, prixUnitaireUSD: 10, totalLigneUSD: 10 }] } } });
    expect(await modifierEnteteFacture(detaillee.id, { montant: "12" })).toMatchObject({ erreur: expect.stringMatching(/somme de ses lignes[\s\S]*1 ligne\(s\) d'articles[\s\S]*supprimez la facture/) });
    expect(Number((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: detaillee.id } })).montantUSD)).toBe(10);
  }, 60_000);

  it("date : refusée quand la facture a fait entrer du stock (la date d'un mouvement ne se déplace pas), expliquée, rien n'est écrit", async () => {
    const f = await prisma.factureFournisseur.create({ data: { ...base, fournisseurNom: "E", date: new Date("2026-09-10"), montantUSD: 10, resteAPayerUSD: 10, montantRegleUSD: 0 } });
    await prisma.mouvementStock.create({ data: { articleId, type: "ENTREE", quantite: 2, date: new Date("2026-09-10"), factureId: f.id } });
    expect(await modifierEnteteFacture(f.id, { date: "2026-09-15" })).toMatchObject({ erreur: expect.stringMatching(/a fait entrer 1 article\(s\) en stock[\s\S]*supprimez la facture/) });
    expect((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } })).date?.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect((await prisma.mouvementStock.findFirstOrThrow({ where: { factureId: f.id } })).date.toISOString().slice(0, 10)).toBe("2026-09-10");
    // Les autres champs de la même facture restent corrigeables (numéro, échéance, fournisseur).
    await modifierEnteteFacture(f.id, { numero: "E-2" });
    expect((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } })).numero).toBe("E-2");
  }, 60_000);

  it("date : jamais vers ni depuis un mois clôturé, rien n'est écrit", async () => {
    const f = await prisma.factureFournisseur.create({ data: { ...base, fournisseurNom: "C", date: new Date("2026-09-10"), montantUSD: 10, resteAPayerUSD: 10, montantRegleUSD: 0 } });
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 6 } });
    expect(await modifierEnteteFacture(f.id, { date: "2026-06-20" })).toMatchObject({ erreur: expect.stringMatching(/clôturée/) });
    const g = await prisma.factureFournisseur.create({ data: { ...base, mois: 6, fournisseurNom: "C2", date: new Date("2026-06-05"), montantUSD: 10, resteAPayerUSD: 10, montantRegleUSD: 0 } });
    expect(await modifierEnteteFacture(g.id, { date: "2026-09-20" })).toMatchObject({ erreur: expect.stringMatching(/clôturée/) });
    expect((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } })).date?.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: g.id } })).date?.toISOString().slice(0, 10)).toBe("2026-06-05");
    await prisma.clotureStock.deleteMany({});
  }, 60_000);

  it("un compte qui n'est pas la Direction est refusé", async () => {
    const f = await prisma.factureFournisseur.create({ data: { ...base, fournisseurNom: "Z", numero: "Z1", montantUSD: 1, resteAPayerUSD: 1 } });
    A.refuser = true;
    try {
      expect(await modifierEnteteFacture(f.id, { numero: "Z2" })).toMatchObject({ erreur: "Réservé à la Direction." });
      expect(await annulerPaiementFacture("n'importe-quel-id")).toMatchObject({ erreur: "Réservé à la Direction." });
    } finally { A.refuser = false; }
    expect((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } })).numero).toBe("Z1");
  }, 60_000);

  it("aucune différence : message clair, rien n'est écrit", async () => {
    const f = await prisma.factureFournisseur.create({ data: { ...base, fournisseurNom: "N", numero: "N1", montantUSD: 5, resteAPayerUSD: 5 } });
    expect(await modifierEnteteFacture(f.id, { numero: "N1", montant: "5" })).toMatchObject({ erreur: expect.stringMatching(/Aucune modification/) });
  }, 60_000);
});

describe("annulerPaiementFacture", () => {
  it("annule un paiement partiel : reste et statut recalculés, dans la devise de la facture (francs)", async () => {
    const f = await prisma.factureFournisseur.create({ data: { ...base, fournisseurNom: "P", date: new Date("2026-09-01"), devise: "CDF", montantCDF: 280000, montantRegleCDF: 0, resteAPayerCDF: 280000, montantUSD: null, montantRegleUSD: null, resteAPayerUSD: null, dateEcheance: new Date("2026-09-30"), statut: "ECHUE_NON_REGLEE" } });
    const fd = new FormData();
    fd.set("type", "PAIEMENT"); fd.set("devise", "CDF"); fd.set("montant", "100000"); fd.set("date", "2026-09-05");
    await enregistrerPaiement(f.id, fd);
    const p = await prisma.paiement.findFirstOrThrow({ where: { factureId: f.id } });
    expect(Number((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } })).resteAPayerCDF)).toBe(180000);

    const r = await annulerPaiementFacture(p.id);
    expect(r).toMatchObject({ resume: expect.stringMatching(/paiement de .*100 000.* du 05\/09\/2026 annulé — reste .*180 000.* → .*280 000/) });
    const apres = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } });
    expect(Number(apres.resteAPayerCDF)).toBe(280000);
    expect(Number(apres.montantRegleCDF)).toBe(0);
    expect(apres.statut).toBe("ECHUE_NON_REGLEE");
    expect(await prisma.paiement.count({ where: { factureId: f.id } })).toBe(0);
    expect((await journal(f.id)).some((j) => j.champ === "annulation de paiement" && /reste/.test(j.nouvelleValeur ?? ""))).toBe(true);
  }, 60_000);

  it("annuler le paiement qui soldait : la facture n'est plus réglée, sans date de paiement ; un autre paiement reste", async () => {
    const f = await prisma.factureFournisseur.create({ data: { ...base, fournisseurNom: "Q", date: new Date("2026-09-01"), montantUSD: 100, montantRegleUSD: 0, resteAPayerUSD: 100, dateEcheance: new Date("2099-01-01"), statut: "A_REGLER" } });
    const fd = new FormData();
    fd.set("type", "PAIEMENT"); fd.set("devise", "USD"); fd.set("montant", "40"); fd.set("date", "2026-09-05");
    await enregistrerPaiement(f.id, fd);
    await marquerPayee(f.id, "2026-09-08"); // solde le reste (60)
    expect((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } })).statut).toBe("REGLEE");
    const solde = await prisma.paiement.findFirstOrThrow({ where: { factureId: f.id }, orderBy: { date: "desc" } });
    await annulerPaiementFacture(solde.id);
    const apres = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } });
    expect(apres.statut).toBe("A_REGLER");
    expect(Number(apres.resteAPayerUSD)).toBe(60);
    expect(Number(apres.montantRegleUSD)).toBe(40);
    expect(apres.datePaiement).toBeNull();
    expect(await prisma.paiement.count({ where: { factureId: f.id } })).toBe(1);
  }, 60_000);

  it("un paiement déjà annulé : message lisible, rien n'est touché", async () => {
    expect(await annulerPaiementFacture("00000000-0000-0000-0000-000000000000")).toMatchObject({ erreur: expect.stringMatching(/n'existe plus/) });
  }, 60_000);
});
