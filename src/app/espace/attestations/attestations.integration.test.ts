import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// « Mes attestations » (spec 2026-09-28, §4.3-4.4) : le salarié DEMANDE (travail, stage), obtient
// TOUT DE SUITE son attestation de salaire (libre-service, décision du 2026-09-28 — une action, plus
// l'ancienne route), et ne télécharge que SES attestations délivrées.
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

const { demanderMonAttestation, obtenirMonAttestationSalaire } = await import("./actions");
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

describe("attestation de salaire en libre-service", () => {
  async function paieValidee(employeeId: string, mois: number) {
    const run =
      (await prisma.payrollRun.findUnique({ where: { mois_annee: { mois, annee: 2026 } } })) ??
      (await prisma.payrollRun.create({ data: { mois, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } }));
    await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id, employeeId, statutPaiement: "VALIDE", transportUSD: 15, salBrutUSD: 330, cnssSalarieUSD: 15,
        netImposableUSD: 285, iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 305, salNetCDF: 854000,
        cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
      },
    });
  }

  it("la demande d'une attestation de SALAIRE est redirigée vers le libre-service", async () => {
    expect(await demanderMonAttestation("SALAIRE", null)).toEqual({
      erreur: "L'attestation de salaire s'obtient directement : bouton « Obtenir mon attestation de salaire ».",
    });
  });

  it("sans paie validée : refus lisible", async () => {
    const r = await obtenirMonAttestationSalaire();
    expect(r).toEqual({ erreur: "Aucune paie validée : l'attestation de salaire reprend la dernière paie validée ou payée." });
  });

  it("obtenue tout de suite pour SON dossier seulement, la même au second clic, téléchargeable par lui", async () => {
    await paieValidee(moi, 7);
    await paieValidee(collegue, 7);
    const r1 = await obtenirMonAttestationSalaire();
    if ("erreur" in r1) throw new Error(r1.erreur);
    const att = await prisma.attestation.findUniqueOrThrow({ where: { id: r1.id } });
    expect(att.employeeId).toBe(moi);
    expect(await prisma.attestation.count({ where: { employeeId: collegue, type: "SALAIRE" } }), "rien pour le collègue").toBe(0);
    expect(await obtenirMonAttestationSalaire()).toEqual({ ...r1, existante: true });
    expect((await telecharger(r1.id)).status).toBe(200);
  });

  it("espace fermé : refusé", async () => {
    F.espaceActif = false;
    expect(await obtenirMonAttestationSalaire()).toEqual({ erreur: "Accès refusé." });
  });
});
