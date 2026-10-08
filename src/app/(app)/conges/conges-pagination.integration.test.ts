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
  // 370 demandes (plus que l'ancien plafond de 300), la n° 370 est la plus récente ; 40 en attente, 330 approuvées.
  await prisma.leaveRequest.createMany({
    data: Array.from({ length: 370 }, (_, i) => ({
      employeeId: emps[i % 120].id, type: i % 2 === 0 ? "Congé annuel" : "Congé maladie", dateDebut: new Date("2026-11-02"), dateFin: new Date("2026-11-04"), nbJours: 3,
      statut: i < 40 ? ("EN_ATTENTE" as const) : ("APPROUVE" as const), dateEnreg: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000),
    })),
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Congés — liste paginée", () => {
  it("page 1 : les 50 plus récentes, synthèse sur les 370 (plus de plafond à 300)", async () => {
    const html = await rendre();
    const n = noms(html);
    expect(n).toHaveLength(50);
    expect(n[0]).toBe("Salarié 010"); // la demande n° 370 (index 369 % 120 = 9)
    expect(texte(html)).toContain("1–50 sur 370");
    expect(texte(html)).toContain("En attente 40");
    expect(texte(html)).toContain("Approuvés (total) 330");
  });
  it("la dernière page atteint la plus ancienne demande (n° 1) ; Tout : 370", async () => {
    const p8 = await rendre({ page: "8" });
    expect(noms(p8)).toHaveLength(20);
    expect(noms(p8)[19]).toBe("Salarié 001");
    expect(noms(await rendre({ par: "tout" }))).toHaveLength(370);
  });
  it("le filtre statut porte sur tout : 330 approuvées → 7 pages ; 40 en attente → pas de barre", async () => {
    const p7 = await rendre({ statut: "APPROUVE", page: "7" });
    expect(noms(p7)).toHaveLength(30);
    expect(texte(p7)).toContain("301–330 sur 330");
    const att = await rendre({ statut: "EN_ATTENTE", page: "2" });
    expect(noms(att)).toHaveLength(40);
    expect(att).not.toContain('data-pagination=""');
    expect(noms(await rendre({ statut: "N_IMPORTE_QUOI" }))).toHaveLength(0); // statut inconnu : aucune demande
  });
  it("le filtre de type et la recherche portent sur tout l'ensemble", async () => {
    expect(texte(await rendre({ type: "Congé maladie" }))).toContain("1–50 sur 185");
    // « Salarié 001 » a 4 demandes (index 0, 120, 240, 360 → 3 : 0,120,240,360 < 370 → 4)
    expect(noms(await rendre({ q: "salarié 001" }))).toHaveLength(4);
  });
  it("les liens de la barre gardent le filtre mais pas les messages d'erreur", async () => {
    const html = await rendre({ statut: "APPROUVE", erreurDecision: "Boum", erreur: "Zut" });
    expect(html).toContain('href="/conges?statut=APPROUVE&amp;page=2"');
    expect(html).not.toContain("erreurDecision=Boum&amp;page");
  });
});
