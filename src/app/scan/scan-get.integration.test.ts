import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// ─────────────────────────────────────────────────────────────────────────────
// UN GET DE `/scan?c=…` N'ÉCRIT AUCUN SCAN — garde-fou du pointage automatique (décision de la
// Direction du 2026-09-29). Un aperçu de lien (WhatsApp, iMessage), un préchargement du
// navigateur ou un robot qui suit l'adresse de l'affiche font une requête GET : le serveur rend la
// page, SANS exécuter son script. Le pointage ne part que de ce script (après chargement, dans le
// navigateur) : ici, le rendu serveur complet de la page, avec une session liée à une fiche et le
// BON code d'affiche, contre une VRAIE base — puis on relit la base : rien.
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, user: null as unknown }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifySession: async () => H.user,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/image", () => ({ default: (p: { alt: string }) => createElement("img", { alt: p.alt }) }));
vi.mock("next/link", () => ({
  default: (p: { href: string; children: ReactNode }) => createElement("a", { href: p.href }, p.children),
}));

const { default: ScanPage } = await import("./page");

const CODE = "code-affiche-en-vigueur";
let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({
    data: {
      id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9, espaceEmployeActif: true,
      pointageLatitude: -4.3217, pointageLongitude: 15.3125, pointageRayonM: 150, pointageCode: CODE,
    },
  });
  const emp = await prisma.employee.create({
    data: {
      matricule: "GET01-PEF", nom: "Salarié GET", sexe: "F", etatCivil: "Célibataire", poste: "Test", secteur: "Salle",
      categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  const u = await prisma.user.create({
    data: { email: "get01pef@salarie.local", nom: emp.nom, role: "EMPLOYE", employeeId: emp.id, motDePasseTemporaire: false },
  });
  H.user = { id: u.id, email: u.email, nom: u.nom, role: "EMPLOYE", accesStock: false, employeeId: emp.id };
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("GET /scan?c=… (aperçu de lien, préchargement) : rien n'est pointé", () => {
  it("le rendu serveur complet, avec session et bon code, n'écrit ni pointage ni scan", async () => {
    const html = renderToStaticMarkup((await ScanPage({ searchParams: Promise.resolve({ c: CODE }) })) as ReactElement);

    // La page s'est bien rendue jusqu'au scanner (état « pointage en cours », que seul le script
    // du navigateur fera aboutir)…
    expect(html).toContain("Pointage en cours");
    // … et la base n'a rien reçu.
    expect(await prisma.pointage.count()).toBe(0);
    expect(await prisma.scanPointage.count()).toBe(0);
  });

  it("deux GET de suite (aperçu puis préchargement) : toujours rien", async () => {
    for (let i = 0; i < 2; i++) renderToStaticMarkup((await ScanPage({ searchParams: Promise.resolve({ c: CODE }) })) as ReactElement);
    expect(await prisma.scanPointage.count()).toBe(0);
    expect(await prisma.pointage.count()).toBe(0);
  });
});
