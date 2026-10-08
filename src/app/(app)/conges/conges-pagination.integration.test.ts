import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// CONGÉS — PAGINATION (2026-10-08) : rendu de la VRAIE page. 120 demandes (la n° 120 est la plus récente), filtre
// statut / type / recherche sur TOUT l'ensemble, compteurs de synthèse sur tout l'ensemble, 50 cartes par page.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "cg@pef.cd", accesStock: false, employeeId: null } }));
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
vi.mock("./calendrier", () => ({ CalendrierAbsences: () => null }));

let fermer: () => Promise<void>;
let prisma: PrismaClient;
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
async function rendre(sp: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
}
const noms = (html: string) => [...html.matchAll(/hover:underline" href="\/employes\/[^"]+">(Salarié \d+)</g)].map((m) => m[1]);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.employee.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({
      matricule: `M-${String(i + 1).padStart(3, "0")}`, nom: `Salarié ${String(i + 1).padStart(3, "0")}`, sexe: "F", etatCivil: "Célibataire", poste: "Cuisinier", secteur: "Cuisine",
      categorie: "BRIGADE" as const, salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    })),
  });
  const emps = await prisma.employee.findMany({ orderBy: { matricule: "asc" } });
  await prisma.leaveRequest.createMany({
    data: emps.map((e, i) => ({
      employeeId: e.id, type: i % 2 === 0 ? "Congé annuel" : "Congé maladie", dateDebut: new Date("2026-11-02"), dateFin: new Date("2026-11-04"), nbJours: 3,
      statut: i < 40 ? ("EN_ATTENTE" as const) : ("APPROUVE" as const), dateEnreg: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000), // n° 120 = la plus récente
    })),
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Congés — liste paginée", () => {
  it("page 1 : les 50 plus récentes, synthèse sur les 120", async () => {
    const html = await rendre();
    const n = noms(html);
    expect(n).toHaveLength(50);
    expect(n[0]).toBe("Salarié 120");
    expect(texte(html)).toContain("1–50 sur 120");
    expect(texte(html)).toContain("En attente 40");
    expect(texte(html)).toContain("Approuvés (total) 80");
  });
  it("page 3 : les 20 plus anciennes ; Tout : 120", async () => {
    expect(noms(await rendre({ page: "3" }))).toHaveLength(20);
    expect(noms(await rendre({ par: "tout" }))).toHaveLength(120);
  });
  it("le filtre statut porte sur tout : 80 approuvées → 2 pages ; 40 en attente → pas de barre", async () => {
    const p2 = await rendre({ statut: "APPROUVE", page: "2" });
    expect(noms(p2)).toHaveLength(30);
    expect(texte(p2)).toContain("51–80 sur 80");
    const att = await rendre({ statut: "EN_ATTENTE", page: "2" });
    expect(noms(att)).toHaveLength(40);
    expect(att).not.toContain('data-pagination=""');
  });
  it("la recherche trouve une demande de la page 3", async () => {
    expect(noms(await rendre({ q: "Salarié 001" }))).toEqual(["Salarié 001"]);
  });
  it("les liens de la barre gardent le filtre", async () => {
    const html = await rendre({ statut: "APPROUVE", par: "100" });
    expect(html).toContain('href="/conges?statut=APPROUVE"'); // « 50 par page » : la taille par défaut s'efface de l'adresse
  });
});
