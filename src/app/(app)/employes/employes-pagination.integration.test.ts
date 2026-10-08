import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// EMPLOYÉS — PAGINATION (2026-10-08) : rendu de la VRAIE page. 100 en brigade puis 30 en back-office, triés
// par nom : la fiche RH est une seule suite « Brigade puis Back-office » découpée en pages de 50 / 100 / Tout.
// Les titres gardent les totaux de TOUT le filtre ; le filtre (recherche, statut) porte sur tout l'ensemble.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "emp@pef.cd", accesStock: false, employeeId: null } }));
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
vi.mock("./doublons-probables", () => ({ DoublonsProbables: () => null }));

let fermer: () => Promise<void>;
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
async function rendre(sp: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
}
/** Matricules du TABLEAU (ordinateur). */
const matricules = (html: string) => [...html.matchAll(/font-mono text-xs">(M-\d+)</g)].map((m) => m[1]);

beforeAll(async () => {
  const db = await creerBaseTest();
  fermer = db.fermer; H.client = db.prisma;
  await db.prisma.employee.createMany({
    data: Array.from({ length: 130 }, (_, i) => {
      const n = String(i + 1).padStart(3, "0");
      return {
        matricule: `M-${n}`, nom: `Salarié ${n}`, sexe: "F", etatCivil: "Célibataire", poste: i < 100 ? "Cuisinier" : "Comptable", secteur: i < 100 ? "Cuisine" : "Bureau",
        categorie: i < 100 ? ("BRIGADE" as const) : ("BACKOFFICE" as const), salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
        actif: i < 120, // 10 ex-employés (back-office)
      };
    }),
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Employés — fiche RH paginée", () => {
  it("page 1 : 50 de la brigade, titre « Brigade (100) », pas de section Back-office", async () => {
    const html = await rendre();
    const m = matricules(html);
    expect(m).toHaveLength(50);
    expect(m[0]).toBe("M-001");
    expect(texte(html)).toContain("Brigade (100)");
    expect(texte(html)).not.toContain("Back-office (");
    expect(texte(html)).toContain("1–50 sur 120"); // 120 actifs
  });

  it("page 3 : 20 du back-office, sans section Brigade ; titres = totaux de tout le filtre", async () => {
    const html = await rendre({ page: "3" });
    expect(matricules(html)).toHaveLength(20);
    expect(texte(html)).toContain("Back-office (20)");
    expect(texte(html)).not.toContain("Brigade (");
    expect(texte(html)).toContain("101–120 sur 120");
  });

  it("100 par page : la page 1 contient brigade ET back-office, la taille suit les filtres de statut", async () => {
    const html = await rendre({ par: "100" });
    expect(matricules(html)).toHaveLength(100);
    expect(texte(html)).not.toContain("Back-office (");
    const tout = await rendre({ par: "tout" });
    expect(matricules(tout)).toHaveLength(120);
    expect(texte(tout)).toContain("Brigade (100)");
    expect(texte(tout)).toContain("Back-office (20)");
    expect(tout).toContain('href="/employes?statut=inactifs&amp;par=tout"');
  });

  it("la recherche porte sur TOUT l'ensemble (un employé de la page 3 est trouvé), et la pagination disparaît", async () => {
    const html = await rendre({ q: "Salarié 115" });
    expect(matricules(html)).toEqual(["M-115"]);
    expect(html).not.toContain('data-pagination=""');
  });

  it("statut « tous » : 130 lignes sur 3 pages ; les liens de la barre gardent le statut et la recherche", async () => {
    const html = await rendre({ statut: "tous", q: "Salarié" });
    expect(texte(html)).toContain("1–50 sur 130");
    expect(html).toContain('href="/employes?statut=tous&amp;q=Salari%C3%A9&amp;page=2"');
  });
});

describe("Employés — l'export exporte TOUT l'ensemble filtré, jamais la page", () => {
  async function lireExcel(url: string): Promise<string[]> {
    const { GET } = await import("./export/route");
    const ExcelJS = (await import("exceljs")).default;
    const res = await GET(new Request(url));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const cellules: string[] = [];
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => cellules.push(String(c.value ?? ""))));
    return cellules;
  }
  it("même avec ?page=2&par=50 dans l'adresse : les 120 actifs", async () => {
    const c = await lireExcel("http://x/employes/export?page=2&par=50");
    expect(c.filter((v) => /^M-\d{3}$/.test(v))).toHaveLength(120);
    expect(c.some((v) => v.includes("120 employé(s) actif(s)"))).toBe(true);
  });
  it("le filtre s'applique à tout l'ensemble, pas à la page (recherche d'un employé de la page 3)", async () => {
    const c = await lireExcel("http://x/employes/export?q=Salari%C3%A9%20115&page=1&par=50");
    expect(c.filter((v) => /^M-\d{3}$/.test(v))).toEqual(["M-115"]);
  });
});
