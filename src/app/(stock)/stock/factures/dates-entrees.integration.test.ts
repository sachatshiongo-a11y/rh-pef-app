import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";

// Audit du 10/10/2026, stock 13 : les entrées en stock issues d'une facture ne se datent ni du futur, ni de
// l'ÉCHÉANCE quand la facture n'a pas de date (l'échéance est une date à venir).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => ({ id: "u1", role: "ADMIN", nom: "Sacha" }), requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock;307;" }); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { creerFactureAvecLignes } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let farine: string;
const plusJours = (n: number) => { const d = new Date(`${jourCourantKinshasaISO()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const facture = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ fournisseurNom: "ETS SENEVE", devise: "USD", numero: "F-1", ...o })) f.append(k, v);
  for (const [k, v] of [["ligne_articleId", farine], ["ligne_designation", "Farine"], ["ligne_unite", "kg"], ["ligne_quantite", "5"], ["ligne_prix", "2"]]) f.append(k, v);
  return f;
};
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.user.create({ data: { id: "u1", email: "u1@pef.cd", nom: "Sacha", role: "ADMIN" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  farine = (await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg", stock: { create: { quantite: 0 } } } })).id;
  await prisma.fournisseur.create({ data: { nom: "ETS SENEVE" } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => { await prisma.mouvementStock.deleteMany(); await prisma.ligneFacture.deleteMany(); await prisma.factureFournisseur.deleteMany(); });

describe("date des entrées en stock d'une facture", () => {
  it("sans date mais avec une échéance à venir : les entrées sont datées d'AUJOURD'HUI (Kinshasa), pas de l'échéance", async () => {
    await expect(creerFactureAvecLignes(facture({ entrerEnStock: "on", dateEcheance: plusJours(30) }))).rejects.toThrow("NEXT_REDIRECT");
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: farine } });
    expect(m.date.toISOString().slice(0, 10)).toBe(jourCourantKinshasaISO());
  }, 60_000);

  it("date de facture dans le futur avec entrée en stock : refusée, rien n'est écrit", async () => {
    const r = await creerFactureAvecLignes(facture({ entrerEnStock: "on", date: plusJours(3) }));
    expect(erreurDe(r)).toMatch(/La date de la facture ne peut pas être dans le futur/);
    expect(await prisma.factureFournisseur.count()).toBe(0);
    expect(await prisma.mouvementStock.count()).toBe(0);
  }, 60_000);

  it("une date passée reste acceptée", async () => {
    await expect(creerFactureAvecLignes(facture({ entrerEnStock: "on", date: "2026-09-12" }))).rejects.toThrow("NEXT_REDIRECT");
    expect((await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: farine } })).date.toISOString().slice(0, 10)).toBe("2026-09-12");
  }, 60_000);

  it("sans entrée en stock (facture purement financière), la date de facture n'est pas contrôlée comme une entrée", async () => {
    await expect(creerFactureAvecLignes(facture({ date: plusJours(3) }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await prisma.mouvementStock.count()).toBe(0);
  }, 60_000);
});
