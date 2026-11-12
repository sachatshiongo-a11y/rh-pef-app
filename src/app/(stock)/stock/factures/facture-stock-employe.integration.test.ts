import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { estStock } from "@/lib/espaces";

// Test d'INTÉGRATION (Postgres éphémère) : l'employé du Stock (rôle STOCK) enregistre une facture ET son
// entrée de stock en UNE saisie (2026-11-12). Les gardes sont les VRAIES règles (estStock / rôle), pas des
// bouchons : ce qui est réservé à la Direction le reste.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "STOCK" as string, nom: "Jean", accesStock: false } }));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: (u: { role: "ADMIN" | "STOCK" | "EMPLOYE"; accesStock?: boolean }) => { if (!estStock(u)) throw new Error("Accès refusé : module non autorisé."); },
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock/factures;307;" }); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { creerFactureAvecLignes, supprimerFacture } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let articleId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "j@pef.cd", nom: "Jean", role: "STOCK" } })).id;
  await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } });
  articleId = (await prisma.articleStock.create({ data: { designation: "Riz", domaine: "NOURRITURE" } })).id;
  await prisma.clotureStock.create({ data: { annee: 2026, mois: 8 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  A.user.role = "STOCK";
  await prisma.mouvementStock.deleteMany();
  await prisma.paiement.deleteMany();
  await prisma.ligneFacture.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.stock.create({ data: { articleId, quantite: 10 } });
});

const fd = (o: { date?: string; numero?: string; regle?: string } = {}) => {
  const f = new FormData();
  f.set("fournisseurNom", "ETS SENEVE"); f.set("date", o.date ?? "2026-09-05"); f.set("entrerEnStock", "on"); f.set("forcerDoublons", "on");
  if (o.numero) f.set("numero", o.numero);
  if (o.regle) f.set("montantRegle", o.regle);
  f.append("ligne_articleId", articleId); f.append("ligne_designation", "Riz"); f.append("ligne_unite", "Kg"); f.append("ligne_quantite", "5"); f.append("ligne_prix", "2");
  return f;
};
const stock = async () => Number((await prisma.stock.findUniqueOrThrow({ where: { articleId } })).quantite);

describe("Employé du Stock : facture + entrée de stock en une saisie", () => {
  it("rôle STOCK : la facture et l'entrée (liée à la facture) sont écrites ensemble, le stock monte", async () => {
    await expect(creerFactureAvecLignes(fd({ numero: "A1" }))).rejects.toThrow("NEXT_REDIRECT");
    const f = await prisma.factureFournisseur.findFirstOrThrow({ include: { lignes: true } });
    expect(f.lignes).toHaveLength(1);
    const m = await prisma.mouvementStock.findMany({ where: { articleId } });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ type: "ENTREE", factureId: f.id, creeParId: A.user.id });
    expect(await stock()).toBe(15);
  }, 60_000);

  it("clôture respectée : mois clôturé → ni facture ni entrée", async () => {
    expect(await creerFactureAvecLignes(fd({ date: "2026-08-20" }))).toMatchObject({ erreur: expect.stringMatching(/clôtur/i) });
    expect(await prisma.factureFournisseur.count()).toBe(0);
    expect(await prisma.mouvementStock.count()).toBe(0);
    expect(await stock()).toBe(10);
  }, 60_000);

  it("doublon de facture (même fournisseur, même n°) : refus, le stock n'entre pas deux fois", async () => {
    await expect(creerFactureAvecLignes(fd({ numero: "B2" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await creerFactureAvecLignes(fd({ numero: "B2" }))).toMatchObject({ erreur: expect.any(String) });
    expect(await prisma.factureFournisseur.count()).toBe(1);
    expect(await stock()).toBe(15);
  }, 60_000);

  it("réservé à la Direction : un montant déjà payé est refusé au Stock (rien d'écrit)", async () => {
    expect(await creerFactureAvecLignes(fd({ numero: "C3", regle: "5" }))).toMatchObject({ erreur: expect.stringMatching(/approuvé par la Direction/) });
    expect(await prisma.factureFournisseur.count()).toBe(0);
    expect(await prisma.paiement.count()).toBe(0);
    expect(await stock()).toBe(10);
  }, 60_000);

  it("réservé à la Direction : la suppression de la facture est refusée au Stock, permise à la Direction", async () => {
    await expect(creerFactureAvecLignes(fd({ numero: "D4" }))).rejects.toThrow("NEXT_REDIRECT");
    const f = await prisma.factureFournisseur.findFirstOrThrow();
    expect(await supprimerFacture(f.id)).toMatchObject({ erreur: expect.stringMatching(/Accès refusé/) });
    expect(await prisma.factureFournisseur.count()).toBe(1);
    expect(await stock()).toBe(15);
    A.user.role = "ADMIN";
    await supprimerFacture(f.id).catch(() => {});
    expect(await prisma.factureFournisseur.count()).toBe(0);
    expect(await stock()).toBe(10);
  }, 60_000);
  it("ligne sans article du catalogue : refus qui le dit (rien d'écrit), puis « quand même » → facture sans entrée pour cette ligne", async () => {
    const f = fd({ numero: "E5" });
    f.append("ligne_articleId", ""); f.append("ligne_designation", "Sacs"); f.append("ligne_unite", ""); f.append("ligne_quantite", "3"); f.append("ligne_prix", "1");
    expect(await creerFactureAvecLignes(f)).toMatchObject({ erreur: expect.stringMatching(/^LIGNES_LIBRES\|.*« Sacs ».*PAS en stock/) });
    expect(await prisma.factureFournisseur.count()).toBe(0);
    expect(await stock()).toBe(10);
    f.set("forcerLibres", "1");
    await expect(creerFactureAvecLignes(f)).rejects.toThrow("NEXT_REDIRECT");
    expect(await prisma.factureFournisseur.count()).toBe(1);
    expect(await prisma.mouvementStock.count()).toBe(1); // seule la ligne Riz entre
    expect(await stock()).toBe(15);
  }, 60_000);
});
