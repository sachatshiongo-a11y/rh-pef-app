import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Création d'une facture (audit du 10/10/2026) : doublon (constat 6), fournisseur proche (7),
// « déjà réglé » = un Paiement daté (18).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction", accesStock: false } }));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock/factures;307;" }); } }));

const { creerFactureAvecLignes } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let seneveId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  seneveId = (await prisma.fournisseur.create({ data: { nom: "ETS SENEVE" } })).id;
  await prisma.fournisseur.create({ data: { nom: "Maison Kathy" } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

type Champs = { fournisseurNom?: string; fournisseurId?: string; numero?: string; date?: string; prix?: string; devise?: "USD" | "CDF"; regle?: string; datePaiement?: string; forcerFacture?: boolean; fournisseurNouveau?: boolean };
const fd = (c: Champs) => {
  const f = new FormData();
  f.set("fournisseurNom", c.fournisseurNom ?? "ETS SENEVE");
  if (c.fournisseurId) f.set("fournisseurId", c.fournisseurId);
  if (c.numero) f.set("numero", c.numero);
  f.set("date", c.date ?? "2026-09-10");
  f.set("devise", c.devise ?? "USD");
  if (c.regle) f.set("montantRegle", c.regle);
  if (c.datePaiement) f.set("datePaiement", c.datePaiement);
  if (c.forcerFacture) f.set("forcerFacture", "1");
  if (c.fournisseurNouveau) f.set("fournisseurNouveau", "1");
  f.append("ligne_articleId", ""); f.append("ligne_designation", "Farine"); f.append("ligne_unite", "Kg"); f.append("ligne_quantite", "1"); f.append("ligne_prix", c.prix ?? "100");
  return f;
};
const cree = (c: Champs) => expect(creerFactureAvecLignes(fd(c))).rejects.toThrow("NEXT_REDIRECT");
const nb = () => prisma.factureFournisseur.count();

describe("facture saisie deux fois", () => {
  it("la première facture se crée", async () => {
    await cree({ numero: "FA-001", prix: "100" });
    expect(await nb()).toBe(1);
  }, 60_000);

  it("même fournisseur + même numéro : refus sec, même avec « Créer quand même »", async () => {
    expect(await creerFactureAvecLignes(fd({ numero: "fa 001", prix: "55" }))).toMatchObject({ erreur: expect.stringMatching(/déjà une facture n° FA-001/) });
    expect(await creerFactureAvecLignes(fd({ numero: "FA-001", prix: "55", forcerFacture: true }))).toMatchObject({ erreur: expect.stringMatching(/déjà une facture n° FA-001/) });
    expect(await nb()).toBe(1);
  }, 60_000);

  it("même fournisseur + même montant à 10 jours : avertissement ; « Créer quand même » la crée", async () => {
    const r = await creerFactureAvecLignes(fd({ numero: "FA-002", date: "2026-09-20", prix: "100" }));
    expect(r).toMatchObject({ erreur: expect.stringMatching(/^DOUBLON_FACTURE\|/) });
    expect(await nb()).toBe(1);
    await cree({ numero: "FA-002", date: "2026-09-20", prix: "100", forcerFacture: true });
    expect(await nb()).toBe(2);
    const j = await prisma.journalAudit.findMany({ where: { champ: "creation", entite: "FactureFournisseur" } });
    expect(j.some((x) => /malgré une facture ressemblante/.test(x.nouvelleValeur ?? ""))).toBe(true);
  }, 60_000);

  it("même montant mais 20 jours plus tard, ou autre montant : pas d'avertissement", async () => {
    await cree({ numero: "FA-003", date: "2026-10-05", prix: "100" });
    await cree({ numero: "FA-004", date: "2026-09-12", prix: "100,5" });
    expect(await nb()).toBe(4);
  }, 60_000);

  it("même numéro chez un autre fournisseur : permis", async () => {
    await cree({ fournisseurNom: "AUTRE SARL", numero: "FA-001", prix: "100" });
    expect(await nb()).toBe(5);
  }, 60_000);
});

describe("fournisseur : l'identique s'applique, le proche se propose", () => {
  it("nom identique à la casse et aux accents près : rattaché au fournisseur existant, rien de créé", async () => {
    const avant = await prisma.fournisseur.count();
    await cree({ fournisseurNom: "ets  séneve", numero: "FA-010", date: "2026-08-01", prix: "7" });
    expect(await prisma.fournisseur.count()).toBe(avant);
    expect((await prisma.factureFournisseur.findFirstOrThrow({ where: { numero: "FA-010" } })).fournisseurId).toBe(seneveId);
  }, 60_000);

  it("nom qui ressemble (« Kathy ») : refus qui PROPOSE, ni facture ni fournisseur créés", async () => {
    const avant = await prisma.fournisseur.count();
    const r = await creerFactureAvecLignes(fd({ fournisseurNom: "Kathy", numero: "K-1", prix: "9" }));
    expect(r).toMatchObject({ erreur: expect.stringMatching(/^FOURNISSEUR_PROCHE\|.*Maison Kathy/) });
    expect(await prisma.fournisseur.count()).toBe(avant);
    expect(await prisma.factureFournisseur.count({ where: { numero: "K-1" } })).toBe(0);
  }, 60_000);

  it("« Créer » (fournisseurNouveau) crée le fournisseur ; « Utiliser » (identifiant) rattache à l'existant", async () => {
    await cree({ fournisseurNom: "Kathy", numero: "K-1", prix: "9", fournisseurNouveau: true });
    expect(await prisma.fournisseur.count({ where: { nom: "Kathy" } })).toBe(1);
    const kathy = await prisma.fournisseur.findFirstOrThrow({ where: { nom: "Maison Kathy" } });
    await cree({ fournisseurNom: "Kathy", fournisseurId: kathy.id, numero: "K-2", prix: "11" });
    expect((await prisma.factureFournisseur.findFirstOrThrow({ where: { numero: "K-2" } })).fournisseurId).toBe(kathy.id);
  }, 60_000);
});

describe("facture « déjà réglée » à la création", () => {
  it("crée un PAIEMENT daté (date de la facture par défaut) dans la devise de la facture ; solde et date de paiement posés", async () => {
    await cree({ fournisseurNom: "ETS SENEVE", numero: "R-1", date: "2026-07-03", prix: "40", regle: "40" });
    const f = await prisma.factureFournisseur.findFirstOrThrow({ where: { numero: "R-1" }, include: { paiements: true } });
    expect(f.statut).toBe("REGLEE");
    expect(Number(f.resteAPayerUSD)).toBe(0);
    expect(f.datePaiement?.toISOString().slice(0, 10)).toBe("2026-07-03");
    expect(f.paiements).toHaveLength(1);
    expect(f.paiements[0]).toMatchObject({ type: "PAIEMENT", devise: "USD" });
    expect(Number(f.paiements[0].montantUSD)).toBe(40);
    expect(f.paiements[0].date.toISOString().slice(0, 10)).toBe("2026-07-03");
  }, 60_000);

  it("réglé partiel avec date de paiement saisie, facture en francs : Paiement en francs, reste en francs", async () => {
    await cree({ numero: "R-2", date: "2026-07-03", devise: "CDF", prix: "280000", regle: "100000", datePaiement: "2026-07-10" });
    const f = await prisma.factureFournisseur.findFirstOrThrow({ where: { numero: "R-2" }, include: { paiements: true } });
    expect(f.devise).toBe("CDF");
    expect(Number(f.resteAPayerCDF)).toBe(180000);
    expect(f.statut).not.toBe("REGLEE");
    expect(f.datePaiement).toBeNull();
    expect(f.paiements[0].devise).toBe("CDF");
    expect(Number(f.paiements[0].montantCDF)).toBe(100000);
    expect(f.paiements[0].montantUSD).toBeNull();
    expect(f.paiements[0].date.toISOString().slice(0, 10)).toBe("2026-07-10");
  }, 60_000);

  it("un réglé supérieur au montant est refusé, rien n'est écrit", async () => {
    const avant = await nb();
    expect(await creerFactureAvecLignes(fd({ numero: "R-3", prix: "40", regle: "50" }))).toMatchObject({ erreur: expect.stringMatching(/dépasse le montant de la facture/) });
    expect(await nb()).toBe(avant);
  }, 60_000);
});
