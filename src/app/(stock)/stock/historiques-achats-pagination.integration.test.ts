import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// HISTORIQUES D'ACHATS (Liste d'achat, Légumes) — PAGINATION CÔTÉ SERVEUR (2026-10-08) : ils s'arrêtaient en
// silence aux 400 / 500 achats les plus récents. Rendu des VRAIES pages : count + skip/take, tailles 50 / 100 /
// Tout, et un groupe (jour / semaine / mois) COUPÉ par une page se relit sur sa tranche de dates entière :
// compteur et totaux exacts, « N affichée(s) » pour ce que la page en montre.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "ach@pef.cd", accesStock: false, employeeId: null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...vrai, verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
async function rendre(chemin: "entree" | "legumes", sp: Record<string, string> = {}) {
  const { default: Page } = await import(chemin === "entree" ? "./entree/page" : "./legumes/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
}
// 130 achats, un par jour du 1er janvier (n° 1) au 10 mai 2026 (n° 130).
const jour = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "ach@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 5 } });
  const art = await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "Kg" } });
  await prisma.mouvementStock.createMany({
    data: Array.from({ length: 130 }, (_, i) => ({ articleId: art.id, type: "ENTREE" as const, quantite: 1, date: jour(i), origine: `Achat n° ${i + 1}`, montantUSD: 2 })),
  });
  await prisma.achatLegume.createMany({
    data: Array.from({ length: 130 }, (_, i) => ({ date: jour(i), legume: `Légume n° ${i + 1}`, quantite: 1, montantCDF: 1000, montantUSD: 1 })),
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Liste d'achat — historique paginé", () => {
  it("page 1 : 50 achats (n° 130 → 81), compteur sur les 130 — plus de plafond à 400", async () => {
    const html = await rendre("entree", { periode: "jour" });
    expect((html.match(/Achat n° \d+/g) ?? [])).toHaveLength(50);
    expect(html).toContain("Achat n° 130");
    expect(texte(html)).toContain("1–50 sur 130");
    expect((await rendre("entree", { periode: "jour", par: "tout" }).then((h) => h.match(/Achat n° \d+/g) ?? []))).toHaveLength(130);
  });

  it("par mois : le mois coupé par la page se relit en entier (31 achats, 62 $), 10 affichés", async () => {
    const html = texte(await rendre("entree", { periode: "mois" }));
    // Page 1 = jours 129 → 80 : mai (10 jours, entier), avril (30, entier), mars (jours 80 à 89 = 10 sur 31, coupé)
    expect(html).toContain("Mai 2026 · 10 ligne(s)");
    expect(html).not.toMatch(/Avril 2026 · 30 ligne\(s\) · /);
    expect(html).toContain("Mars 2026 · 31 ligne(s) · 10 affichée(s)");
    expect(html).toMatch(/Mars 2026[^$]*62,00 \$/); // 31 × 2 $ : le total du mois ENTIER, pas des 10 lignes affichées
  });

  it("page 2 : le mois de mars continue, ses chiffres restent ceux du mois entier", async () => {
    const html = texte(await rendre("entree", { periode: "mois", page: "2" }));
    expect(html).toContain("Mars 2026 · 31 ligne(s) · 21 affichée(s)"); // jours 59 à 79
    expect(html).toContain("51–100 sur 130");
  });

  it("par semaine : les liens d'onglets gardent la taille de page", async () => {
    const html = await rendre("entree", { periode: "semaine", par: "100" });
    expect(html).toContain('href="/stock/entree?periode=jour&amp;par=100"');
  });
});

describe("Légumes — historique paginé", () => {
  it("page 1 : 50 achats sur 130 — plus de plafond à 500", async () => {
    const html = await rendre("legumes", { periode: "jour" });
    expect((html.match(/font-medium">Légume n° \d+</g) ?? [])).toHaveLength(50);
    expect(texte(html)).toContain("1–50 sur 130");
  });

  it("par mois : mois coupé = compteur et totaux CDF / USD du mois entier", async () => {
    const html = texte(await rendre("legumes", { periode: "mois" }));
    expect(html).toContain("Mars 2026 · 31 achat(s) · 10 affiché(s)");
    expect(html).toMatch(/Mars 2026[^]*?31[\s  ]000 CDF · 31,00 \$/);
  });

  it("page 3 : les 30 plus anciens ; hors limites : la dernière", async () => {
    const p3 = await rendre("legumes", { periode: "jour", page: "3" });
    expect((p3.match(/font-medium">Légume n° \d+</g) ?? [])).toHaveLength(30);
    expect(texte(await rendre("legumes", { periode: "jour", page: "99" }))).toContain("101–130 sur 130");
  });
});
