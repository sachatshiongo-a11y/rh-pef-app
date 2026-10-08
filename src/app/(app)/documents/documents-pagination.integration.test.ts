import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// DOCUMENTS & ARCHIVES — PAGINATION (décision de la Direction, 2026-10-08) : rendu de la VRAIE page sur une
// base éphémère. 120 bulletins, 130 documents RH. Ce qu'on tient :
//  - 50 lignes par page, 51–100 en page 2, 100 par page, « Tout » ; ?page= et ?par= ;
//  - les filtres (statut…) et les compteurs d'onglets portent sur TOUT l'ensemble, pas sur la page ;
//  - les signatures ne sont lues que pour les bulletins de la PAGE ;
//  - les liens de pagination gardent les filtres et la taille ; changer d'onglet garde la taille.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "doc@pef.cd", accesStock: false, employeeId: null } }));
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
vi.mock("../signature-actions", () => ({ faireSignerDocument: async () => ({}) }));
vi.mock("next/navigation", async () => {
  const vrai = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...vrai, useRouter: () => ({ push: () => {}, refresh: () => {} }) };
});

let prisma: PrismaClient;
let fermer: () => Promise<void>;

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
async function rendre(sp: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
}
/** Matricules des lignes du TABLEAU (ordinateur) de l'onglet Bulletins. */
const matricules = (html: string) => [...html.matchAll(/font-mono text-xs">(EMP-\d+)</g)].map((m) => m[1]);
/** Noms des documents RH du tableau. */
const nomsDocuments = (html: string) => [...html.matchAll(/<td class="px-3 py-2">(Doc \d+)<\/td>/g)].map((m) => m[1]);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "doc@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;
  const N = 120;
  const num = (i: number) => String(i).padStart(3, "0");
  await prisma.employee.createMany({
    data: Array.from({ length: N }, (_, i) => ({
      matricule: `EMP-${num(i + 1)}`, nom: `Salarié ${num(i + 1)}`, sexe: "F", etatCivil: "Célibataire", poste: "Cuisinier", secteur: "Cuisine",
      categorie: "BRIGADE" as const, salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    })),
  });
  const emps = await prisma.employee.findMany({ orderBy: { matricule: "asc" } });
  const run = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
  await prisma.payrollLine.createMany({
    data: emps.map((e, i) => ({
      payrollRunId: run.id, employeeId: e.id, statutPaiement: i < 30 ? ("PAYE" as const) : ("VALIDE" as const),
      transportUSD: 15, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 10, allocFamilialeUSD: 0,
      salNetUSD: 290, salNetCDF: 812000, cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
    })),
  });
  await prisma.documentEmploye.createMany({
    data: Array.from({ length: 130 }, (_, i) => ({
      employeeId: emps[i % N].id, type: "AUTRE" as const, nom: `Doc ${num(i + 1)}`, fichierUrl: `/x/${i}.pdf`,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, 0) - i * 1000), // du plus récent (Doc 001) au plus ancien
    })),
  });
}, 120_000);

afterAll(async () => { await fermer?.(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("Documents — bulletins paginés", () => {
  it("page 1 : 50 bulletins sur 120, compteur « 1–50 sur 120 »", async () => {
    const html = await rendre();
    expect(matricules(html)).toHaveLength(50);
    expect(texte(html)).toContain("1–50 sur 120");
    expect(texte(html)).toContain("Bulletins de paie (120)");
  });

  it("page 2 : 51–100 ; page 3 : 101–120 ; page hors limites : la dernière", async () => {
    const p2 = matricules(await rendre({ page: "2" }));
    expect(p2).toHaveLength(50);
    expect(p2[0]).toBe("EMP-051");
    expect(p2[49]).toBe("EMP-100");
    const h3 = await rendre({ page: "3" });
    expect(matricules(h3)).toHaveLength(20);
    expect(texte(h3)).toContain("101–120 sur 120");
    expect(texte(await rendre({ page: "99" }))).toContain("101–120 sur 120");
  });

  it("100 par page, puis Tout", async () => {
    expect(matricules(await rendre({ par: "100" }))).toHaveLength(100);
    const tout = await rendre({ par: "tout" });
    expect(matricules(tout)).toHaveLength(120);
    expect(texte(tout)).toContain("1–120 sur 120");
  });

  it("le filtre de statut porte sur TOUT l'ensemble, pas sur la page", async () => {
    // 30 payés (EMP-001 à 030) : tous tiennent sur une page → pas de barre ; 90 « validés » → 2 pages.
    const payes = await rendre({ statut: "PAYE", page: "2" });
    expect(matricules(payes)).toHaveLength(30);
    expect(payes).not.toContain('data-pagination=""');
    const valides = await rendre({ statut: "VALIDE", page: "2" });
    expect(matricules(valides)).toHaveLength(40);
    expect(texte(valides)).toContain("51–90 sur 90");
    expect(matricules(valides)[0]).toBe("EMP-081"); // 30 payés écartés puis 50 lignes en page 1
  });

  it("les liens de pagination gardent les filtres et la taille de page", async () => {
    const html = await rendre({ statut: "VALIDE", annee: "2026", par: "100" });
    // 90 résultats à 100 par page : une seule page, la barre reste (taille relevée) avec les tailles
    expect(html).toContain("annee=2026");
    expect(html).toMatch(/href="\/documents\?statut=VALIDE&amp;annee=2026"[^>]*>[^<]*50/); // retour à 50 : plus de par
    const p1 = await rendre({ statut: "VALIDE", annee: "2026" });
    expect(p1).toMatch(/href="\/documents\?statut=VALIDE&amp;annee=2026&amp;page=2"/);
  });

  it("changer d'onglet garde la taille de page, et le formulaire de filtres la reporte", async () => {
    const html = await rendre({ par: "100" });
    expect(html).toContain('href="/documents?onglet=contrats&amp;par=100"');
    expect(html).toContain('name="par"'); // champ caché rempli à l'envoi
  });

  it("les signatures ne sont lues que pour les bulletins de la page (50, pas 120)", async () => {
    const spy = vi.spyOn(prisma.signatureElectronique, "findMany");
    await rendre({ page: "2" });
    expect(spy).toHaveBeenCalledTimes(1);
    const where = spy.mock.calls[0][0]!.where as { cibleId: { in: string[] } };
    expect(where.cibleId.in).toHaveLength(50);
  });
});

describe("Documents — autres onglets", () => {
  it("documents RH : 130 → 3 pages de 50, dans l'ordre d'affichage", async () => {
    const p1 = await rendre({ onglet: "documents" });
    expect(nomsDocuments(p1)).toHaveLength(50);
    expect(nomsDocuments(p1)[0]).toBe("Doc 001");
    expect(texte(p1)).toContain("1–50 sur 130");
    const p3 = await rendre({ onglet: "documents", page: "3" });
    expect(nomsDocuments(p3)).toHaveLength(30);
    expect(texte(p3)).toContain("101–130 sur 130");
    expect(texte(p3)).toContain("Documents RH (130)");
  });

  it("un onglet sous 50 lignes n'a pas de barre (fiches de poste : vide)", async () => {
    const html = await rendre({ onglet: "fiches" });
    expect(html).not.toContain('data-pagination=""');
  });
});
