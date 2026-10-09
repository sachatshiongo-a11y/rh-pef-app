import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import JSZip from "jszip";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// CONGÉS — PDF EN LOT : un ZIP, un PDF par demande, chacun EXACTEMENT celui de la route unitaire ; mêmes droits
// que l'unitaire (toute l'équipe RH, pas un salarié) ; refus explicite au-delà de 50 plutôt qu'un ZIP tronqué.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "MANAGER", nom: "Responsable", email: "lot@pef.cd", accesStock: false, employeeId: null as string | null } }));
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
  return { ...vrai, verifySession: async () => A.user };
});
vi.mock("@/lib/storage", () => ({ televerserFichier: async () => "/fichiers/x.png", lireFichier: async () => null }));

const { GET } = await import("./route");
const { GET: GET_UNITAIRE } = await import("../demande/[id]/route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids: string[] = [];
const appeler = (liste: string) => GET(new Request(`http://x/conges/pdf-lot?ids=${liste}`));

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma);
  const e = await prisma.employee.create({
    data: { matricule: "LOT-1", nom: "Salarié Lot", sexe: "F", etatCivil: "Célibataire", poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI" },
  });
  for (const jour of ["2026-11-03", "2026-12-01"]) {
    ids.push((await prisma.leaveRequest.create({ data: { employeeId: e.id, type: "Congé annuel", dateDebut: new Date(jour), dateFin: new Date(jour), nbJours: 1 } })).id);
  }
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("PDF en lot des demandes de congé", () => {
  it("un ZIP avec un PDF par demande (deux demandes du même salarié : aucun écrasement), PDF comme l'unitaire", async () => {
    const res = await appeler(ids.join(","));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("Demandes_de_conge.zip");
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(["Demande_LOT-1.pdf", "Demande_LOT-1_2.pdf"]);
    for (const f of Object.values(zip.files)) expect((await f.async("string")).startsWith("%PDF")).toBe(true);
    // Même générateur que la route unitaire : un PDF du lot a la taille du PDF unitaire (à l'octet près des dates d'édition).
    const unitaire = await GET_UNITAIRE(new Request("http://x"), { params: Promise.resolve({ id: ids[0] }) });
    expect(unitaire.status).toBe(200);
    const taille = (await unitaire.arrayBuffer()).byteLength;
    expect(Math.abs((await zip.files["Demande_LOT-1.pdf"].async("uint8array")).byteLength - taille)).toBeLessThan(200);
  });

  it("aucune sélection, trop de demandes, demandes inconnues : refus explicites", async () => {
    expect((await appeler("")).status).toBe(400);
    const trop = Array.from({ length: 51 }, (_, i) => `id-${i}`).join(",");
    const r = await appeler(trop);
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("50 demandes au plus");
    expect((await appeler("00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("un doublon dans la liste ne donne pas deux fichiers", async () => {
    const zip = await JSZip.loadAsync(Buffer.from(await (await appeler(`${ids[0]},${ids[0]}`)).arrayBuffer()));
    expect(Object.keys(zip.files)).toEqual(["Demande_LOT-1.pdf"]);
  });

  it("un compte qui n'est pas de l'espace RH est refusé (403)", async () => {
    const avant = A.user.role;
    A.user.role = "EMPLOYE";
    try { expect((await appeler(ids[0])).status).toBe(403); } finally { A.user.role = avant; }
  });
});
