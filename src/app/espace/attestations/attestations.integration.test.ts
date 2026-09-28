import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// « Mes attestations » (spec 2026-09-28, §4.3-4.4) : le salarié DEMANDE, ne télécharge que SES
// attestations délivrées ; l'ancien libre-service n'existe plus.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "EMPLOYE", nom: "Salariée", employeeId: "seed" as string | null } }));
const F = vi.hoisted(() => ({ espaceActif: true }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  estSalarie: (u: { employeeId?: string | null }) => !!u.employeeId,
  estRH: (r: string) => r === "ADMIN" || r === "MANAGER" || r === "VIEWER",
}));
vi.mock("@/lib/espace-employe", () => ({ espaceEmployeActif: async () => F.espaceActif }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/storage", () => ({ televerserFichier: async (c: string) => `/fichiers/${c}`, lireFichier: async () => null }));
vi.mock("@/lib/pdf/attestation-buffer", () => ({
  rendreAttestationPdf: async () => Buffer.from("%PDF-ATT"),
  exemplaireAttestation: async (a: { statut: string; numero: string | null }) =>
    a.statut === "DELIVREE" ? { buffer: Buffer.from(`%PDF-${a.numero}`), nomFichier: `${a.numero}.pdf` } : null,
}));
vi.mock("@/lib/notifications", () => ({
  notifierSalarie: async () => {},
  compteSalarieDe: async () => null,
  creerNotification: async () => {},
  supprimerNotificationsPour: async () => {},
}));

const { demanderMonAttestation } = await import("./actions");
const { GET } = await import("./[id]/route");
const { delivrerAttestation } = await import("@/lib/attestations");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let moi: string;
let collegue: string;
let directionId: string;

async function employe(matricule: string) {
  return (await prisma.employee.create({
    data: {
      matricule, nom: `Salarié ${matricule}`, sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine",
      categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2024-01-01"), contrat: "CDI",
    },
  })).id;
}
const telecharger = (id: string) => GET(new Request(`http://local/espace/attestations/${id}?dl=1`), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  moi = await employe("MA01-PEF");
  collegue = await employe("CO01-PEF");
  A.user.employeeId = moi;
  A.user.id = (await prisma.user.create({ data: { email: "ma01@salarie.local", nom: "Moi", role: "EMPLOYE", employeeId: moi } })).id;
  directionId = (await prisma.user.create({ data: { email: "dir.espace.att@test.pef", nom: "Direction", role: "ADMIN" } })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });
beforeEach(() => { F.espaceActif = true; A.user.employeeId = moi; });

describe("demander une attestation", () => {
  it("crée une demande DEMANDÉE pour SON dossier ; une deuxième du même type est refusée par un message", async () => {
    expect(await demanderMonAttestation("TRAVAIL", "banque")).toBeUndefined();
    const a = await prisma.attestation.findFirstOrThrow({ where: { employeeId: moi, type: "TRAVAIL" } });
    expect(a).toEqual(expect.objectContaining({ statut: "DEMANDEE", motif: "banque", demandeParId: A.user.id }));
    expect(await demanderMonAttestation("TRAVAIL", null)).toEqual({ erreur: "Une demande d'attestation de travail est déjà en cours." });
  });

  it("un type inconnu est refusé ; l'espace fermé refuse tout", async () => {
    expect(await demanderMonAttestation("PAIE" as never, null)).toEqual({ erreur: "Type d'attestation inconnu." });
    F.espaceActif = false;
    expect(await demanderMonAttestation("STAGE", null)).toEqual({ erreur: "Accès refusé." });
  });
});

describe("télécharger une attestation", () => {
  it("SA propre attestation délivrée : le PDF", async () => {
    const r = await delivrerAttestation(prisma, { employeeId: moi, type: "TRAVAIL", parId: directionId });
    if (!r.ok) throw new Error(r.motif);
    const res = await telecharger(r.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(`attachment; filename="${r.numero}.pdf"`);
  });

  it("l'attestation d'un COLLÈGUE : 403, rien n'est servi", async () => {
    const r = await delivrerAttestation(prisma, { employeeId: collegue, type: "TRAVAIL", parId: directionId });
    if (!r.ok) throw new Error(r.motif);
    const res = await telecharger(r.id);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("%PDF");
  });

  it("une demande pas encore délivrée : 404 ; un identifiant inconnu : 403", async () => {
    const d = await prisma.attestation.create({ data: { employeeId: moi, type: "SALAIRE", demandeParId: A.user.id } });
    expect((await telecharger(d.id)).status).toBe(404);
    expect((await telecharger("inconnu")).status).toBe(403);
  });

  it("espace fermé : 403", async () => {
    const r = await delivrerAttestation(prisma, { employeeId: moi, type: "TRAVAIL", parId: directionId });
    if (!r.ok) throw new Error(r.motif);
    F.espaceActif = false;
    expect((await telecharger(r.id)).status).toBe(403);
  });
});

describe("l'ancien libre-service a disparu", () => {
  it("plus de route espace/attestation/[type], et plus aucun lien vers elle", () => {
    const racine = path.resolve(__dirname, "..");
    expect(fs.existsSync(path.join(racine, "attestation"))).toBe(false);
    const fichiers: string[] = [];
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test.")) fichiers.push(p);
      }
    };
    parcourir(path.resolve(__dirname, "../.."));
    const liens = fichiers.filter((f) => /\/espace\/attestation\//.test(fs.readFileSync(f, "utf8")));
    expect(liens).toEqual([]);
  });
});
