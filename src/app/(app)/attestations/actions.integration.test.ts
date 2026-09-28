import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Côté Direction (spec 2026-09-28, §4.3) : délivrer / refuser à l'unité ou en lot, tout ou rien
// PAR LIGNE, avec un message lisible par ligne ; délivrance directe depuis la fiche ; exemplaire
// téléchargeable par la RH.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction", employeeId: null as string | null } }));
const N = vi.hoisted(() => ({ salarie: [] as string[] }));
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
  estRH: (r: string) => r === "ADMIN" || r === "MANAGER" || r === "VIEWER",
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/storage", () => ({ televerserFichier: async (c: string) => `/fichiers/${c}`, lireFichier: async () => null }));
vi.mock("@/lib/pdf/attestation-buffer", () => ({
  rendreAttestationPdf: async () => Buffer.from("%PDF-ATT"),
  exemplaireAttestation: async (a: { statut: string; numero: string | null }) =>
    a.statut === "DELIVREE" ? { buffer: Buffer.from(`%PDF-${a.numero}`), nomFichier: `${a.numero}.pdf` } : null,
}));
vi.mock("@/lib/notifications", () => ({
  notifierSalarie: async (_u: string, n: { message: string }) => { N.salarie.push(n.message); },
  compteSalarieDe: async (employeeId: string) => (await H.client.user.findUnique({ where: { employeeId } }))?.id ?? null,
  creerNotification: async () => {},
  supprimerNotificationsPour: async () => {},
}));

const { delivrerAttestations, refuserAttestations, delivrerAttestationDirecte } = await import("./actions");
const { GET } = await import("./[id]/route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let seq = 0;

async function employe(o: { contrat?: string; paie?: boolean } = {}) {
  seq++;
  const id = (await prisma.employee.create({
    data: {
      matricule: `DA${seq}-PEF`, nom: `Salarié ${seq}`, sexe: "M", etatCivil: "Célibataire", poste: "Plongeur", secteur: "Cuisine",
      categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2024-01-01"), contrat: o.contrat ?? "CDI",
    },
  })).id;
  await prisma.user.create({ data: { email: `da${seq}@salarie.local`, nom: `Salarié ${seq}`, role: "EMPLOYE", employeeId: id } });
  return id;
}
const demande = (employeeId: string, type: "TRAVAIL" | "SALAIRE" | "STAGE") =>
  prisma.attestation.create({ data: { employeeId, type } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "dir.att.lot@test.pef", nom: "Direction", role: "ADMIN" } })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });
beforeEach(() => { A.user.role = "ADMIN"; N.salarie.length = 0; });

describe("délivrer en lot", () => {
  it("trois demandes dont une inéligible : deux délivrées numérotées, une REFUSÉE avec son message", async () => {
    const a = await employe();
    const b = await employe();
    const stagiaire = await employe({ contrat: "STAGE" });
    const d1 = await demande(a, "TRAVAIL");
    const d2 = await demande(b, "TRAVAIL");
    const d3 = await demande(stagiaire, "SALAIRE");
    const r = await delivrerAttestations([d1.id, d2.id, d3.id]);
    expect(r).toEqual({
      traites: 2,
      refus: [{ id: d3.id, nom: expect.stringMatching(/Salarié/), message: "Pas d'attestation de salaire pour un stagiaire ou un intérimaire." }],
    });
    const apres = await prisma.attestation.findMany({ where: { id: { in: [d1.id, d2.id, d3.id] } }, orderBy: { createdAt: "asc" } });
    expect(apres.map((x) => x.statut)).toEqual(["DELIVREE", "DELIVREE", "REFUSEE"]);
    expect(new Set(apres.filter((x) => x.numero).map((x) => x.numero)).size).toBe(2);
    expect(N.salarie.filter((m) => /est disponible$/.test(m))).toHaveLength(2);
  });

  it("MANAGER et VIEWER ne délivrent ni ne refusent", async () => {
    const d = await demande(await employe(), "TRAVAIL");
    for (const role of ["MANAGER", "VIEWER"]) {
      A.user.role = role;
      expect(await delivrerAttestations([d.id])).toEqual({ erreur: "Accès refusé." });
      expect(await refuserAttestations([d.id], "non")).toEqual({ erreur: "Accès refusé." });
    }
    expect((await prisma.attestation.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("DEMANDEE");
  });
});

describe("refuser en lot", () => {
  it("sans motif : message, rien ne bouge ; avec motif : refusées, salarié prévenu", async () => {
    const d = await demande(await employe(), "TRAVAIL");
    expect(await refuserAttestations([d.id], " ")).toEqual({ erreur: "Indiquez le motif du refus." });
    expect((await prisma.attestation.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("DEMANDEE");
    expect(await refuserAttestations([d.id], "Dossier incomplet")).toEqual({ traites: 1, refus: [] });
    expect(N.salarie).toEqual(["Votre demande d'attestation de travail a été refusée : Dossier incomplet"]);
  });
});

describe("délivrance directe depuis la fiche, téléchargement RH", () => {
  it("crée une attestation déjà délivrée et numérotée, téléchargeable par la RH", async () => {
    const e = await employe();
    const r = await delivrerAttestationDirecte(e, "TRAVAIL");
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.numero).toMatch(/^ATT-\d{4}-\d{4}$/);
    A.user.role = "VIEWER";
    const res = await GET(new Request(`http://local/attestations/${r.id}`), { params: Promise.resolve({ id: r.id }) });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(`%PDF-${r.numero}`);
  });

  it("un compte hors RH (salarié) ne télécharge rien par la route Direction", async () => {
    const e = await employe();
    const r = await delivrerAttestationDirecte(e, "TRAVAIL");
    if ("erreur" in r) throw new Error(r.erreur);
    A.user.role = "EMPLOYE";
    const res = await GET(new Request(`http://local/attestations/${r.id}`), { params: Promise.resolve({ id: r.id }) });
    expect(res.status).toBe(403);
  });

  it("inéligible : message lisible, rien n'est créé", async () => {
    const e = await employe({ contrat: "INTERIM" });
    expect(await delivrerAttestationDirecte(e, "SALAIRE")).toEqual({ erreur: "Pas d'attestation de salaire pour un stagiaire ou un intérimaire." });
    expect(await prisma.attestation.count({ where: { employeeId: e } })).toBe(0);
  });
});

describe("registre : export Excel", () => {
  it("une ligne par attestation, mêmes filtres que l'onglet ; RH seulement", async () => {
    const { GET: exporter } = await import("./export/route");
    const ExcelJS = (await import("exceljs")).default;
    A.user.role = "VIEWER";
    const res = await exporter(new Request("http://local/attestations/export?statut=DELIVREE&type=TRAVAIL"));
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const valeurs: string[][] = [];
    wb.worksheets[0].eachRow((r) => valeurs.push((r.values as unknown[]).slice(1).map((v) => String(v ?? ""))));
    const entete = valeurs.findIndex((v) => v[0] === "Numéro");
    expect(valeurs[entete]).toEqual(["Numéro", "Type", "Statut", "Matricule", "Employé", "Demandée le", "Délivrée ou refusée le", "Par", "Motif du refus"]);
    const donnees = valeurs.slice(entete + 1).filter((v) => /^ATT-/.test(v[0]));
    const attendues = await prisma.attestation.count({ where: { statut: "DELIVREE", type: "TRAVAIL" } });
    expect(donnees).toHaveLength(attendues);
    expect(donnees.every((v) => v[1] === "Attestation de travail" && v[2] === "Délivrée")).toBe(true);
    A.user.role = "EMPLOYE";
    expect((await exporter(new Request("http://local/attestations/export"))).status).toBe(403);
  });
});
