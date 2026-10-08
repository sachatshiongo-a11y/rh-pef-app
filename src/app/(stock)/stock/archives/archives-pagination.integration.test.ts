import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToReadableStream } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// ARCHIVES — PAGINATION CÔTÉ SERVEUR (2026-10-08) : chaque onglet s'arrêtait en silence aux 300 plus récents
// (`take: 300`), le journal d'activité grossit sans fin. Rendu de la VRAIE page : skip/take + count, filtres du
// journal sur TOUT l'ensemble, mois coupés par une frontière de page signalés « sur cette page ».
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "arch@pef.cd", accesStock: false, employeeId: null } }));
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

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let idSession = "";
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
async function rendre(sp: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  // La page contient des sous-composants serveur ASYNCHRONES (un par onglet) : rendu en flux, attendu en entier.
  const flux = await renderToReadableStream(await Page({ searchParams: Promise.resolve(sp) }));
  await flux.allReady;
  return await new Response(flux).text();
}
const lignesJournal = (html: string) => [...html.matchAll(/entrée n° (\d+)/g)].map((m) => Number(m[1]));

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "arch@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;
  const jour = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
  // 120 entrées de journal « Article » (la n° 120 est la plus récente) + 20 « Facture » d'un autre type.
  await prisma.journalAudit.createMany({
    data: [
      ...Array.from({ length: 120 }, (_, i) => ({ entite: "ArticleStock", entiteId: `a${i}`, champ: `entrée n° ${i + 1}`, userId: u.id, date: jour(i) })),
      ...Array.from({ length: 20 }, (_, i) => ({ entite: "FactureFournisseur", entiteId: `f${i}`, champ: `facture ${i + 1}`, userId: u.id, date: jour(i) })),
    ],
  });
  await prisma.sessionComptage.createMany({ data: Array.from({ length: 120 }, (_, i) => ({ date: jour(i), nbArticles: i })) });
  // Un comptage de 120 lignes pour la page de détail.
  const session = await prisma.sessionComptage.create({ data: { date: jour(0), nbArticles: 120, nbEcarts: 3, nbHorsTol: 1 } });
  idSession = session.id;
  await prisma.ligneComptage.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({ sessionId: session.id, designation: `Article ${String(i + 1).padStart(3, "0")}`, theorique: 10, physique: 9, ecart: -1 })),
  });
  await prisma.rapport.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ titre: `R${i}`, type: "FACTURES", createdAt: jour(i) })) });
  await prisma.bonDeCommande.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({ numero: `${i + 1}/PEF/X/26`, sequence: i + 1, annee: 2026, mois: 1 + (i % 12), date: jour(i), statut: "VALIDE" as const, totalUSD: 10 })),
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Archives — journal d'activité", () => {
  it("page 1 : les 50 plus récents (n° 120 → 71), compteur sur tout le journal filtré (140)", async () => {
    const html = await rendre({ vue: "journal" });
    const l = lignesJournal(html);
    expect(l).toHaveLength(50);
    expect(l[0]).toBe(120);
    expect(texte(html)).toContain("140 entrée(s)");
    expect(texte(html)).toContain("1–50 sur 140");
  });

  it("le filtre de type porte sur TOUT l'ensemble : 120 articles → 3 pages, la page 3 finit à la plus ancienne", async () => {
    const p3 = await rendre({ vue: "journal", entite: "ArticleStock", page: "3" });
    const l = lignesJournal(p3);
    expect(l).toHaveLength(20);
    expect(l[l.length - 1]).toBe(1);
    expect(texte(p3)).toContain("101–120 sur 120");
  });

  it("tout le journal est atteignable (plus de plafond à 300) : 140 lignes sur « Tout »", async () => {
    const html = await rendre({ vue: "journal", par: "tout" });
    expect(lignesJournal(html)).toHaveLength(120);
    expect((html.match(/facture \d+/g) ?? [])).toHaveLength(20);
  });

  it("un mois coupé par la page est signalé « sur cette page » ; les mois entiers ne le sont pas", async () => {
    const p1 = texte(await rendre({ vue: "journal", entite: "ArticleStock" }));
    // 120 jours depuis le 1er janvier : avril = jours 90 à 119 (30 entrées, entier, en tête de la page 1) ;
    // la page 1 s'arrête au jour 70 : mars (jours 59 à 89) n'y figure que par 20 entrées, il continue en page 2.
    expect(p1).toMatch(/Avril 2026 · 30 entrée\(s\)(?! sur cette page)/);
    expect(p1).toMatch(/Mars 2026 · 20 entrée\(s\) sur cette page/);
    // En page 2 (n° 70 → 21), le premier mois (mars, 11 entrées restantes) est coupé en tête : annoncé aussi.
    expect(texte(await rendre({ vue: "journal", entite: "ArticleStock", page: "2" }))).toMatch(/Mars 2026 · 11 entrée\(s\) sur cette page/);
  });

  it("les liens de page gardent le type filtré et la taille ; changer d'onglet garde la taille", async () => {
    const html = await rendre({ vue: "journal", entite: "ArticleStock", par: "100" });
    expect(html).toContain('href="/stock/archives?vue=journal&amp;entite=ArticleStock&amp;page=2&amp;par=100"');
    expect(html).toContain('href="/stock/archives?vue=bons&amp;par=100"');
  });
});

describe("Archives — comptages, bons, rapports", () => {
  it("comptages : 50 par page sur 121 (120 + celui du détail), compteur et page 3", async () => {
    const html = await rendre({ vue: "comptages" });
    expect((html.match(/hors tol\./g) ?? [])).toHaveLength(50);
    expect(texte(html)).toContain("1–50 sur 121");
    expect((await rendre({ vue: "comptages", page: "3" }).then((h) => h.match(/hors tol\./g) ?? []))).toHaveLength(21);
  });
  it("bons validés : 50 par page, total du mois coupé annoncé « (cette page) »", async () => {
    const html = await rendre({ vue: "bons" });
    expect((html.match(/\/PEF\/X\/26/g) ?? [])).toHaveLength(50);
    expect(texte(html)).toContain("1–50 sur 120");
    expect(texte(html)).toContain("(cette page)");
  });
  it("rapports : 30 → une seule page, pas de barre", async () => {
    const html = await rendre({ vue: "rapports" });
    expect((html.match(/Télécharger/g) ?? [])).toHaveLength(30);
    expect(html).not.toContain('data-pagination=""');
  });
});

describe("Archives — détail d'un comptage (lignes paginées côté serveur)", () => {
  async function rendreDetail(sp: Record<string, string> = {}) {
    const { default: Page } = await import("./[id]/page");
    const flux = await renderToReadableStream(await Page({ params: Promise.resolve({ id: idSession }), searchParams: Promise.resolve(sp) }));
    await flux.allReady;
    return await new Response(flux).text();
  }
  const articles = (html: string) => [...html.matchAll(/>(Article \d{3})</g)].map((m) => m[1]);

  it("50 articles par page, l'en-tête garde les chiffres de TOUT le comptage", async () => {
    const html = await rendreDetail();
    const a = articles(html);
    expect(a).toHaveLength(50);
    expect(a[0]).toBe("Article 001");
    expect(texte(html)).toContain("Articles : 120");
    expect(texte(html)).toContain("1–50 sur 120");
  });
  it("page 3 = 101–120 ; 100 par page ; Tout", async () => {
    const p3 = articles(await rendreDetail({ page: "3" }));
    expect(p3).toHaveLength(20);
    expect(p3[19]).toBe("Article 120");
    expect(articles(await rendreDetail({ par: "100" }))).toHaveLength(100);
    expect(articles(await rendreDetail({ par: "tout" }))).toHaveLength(120);
  });
});
