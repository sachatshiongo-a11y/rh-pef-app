import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Dates des contrats dans le futur : les tests ne dépendent pas du jour où ils tournent.
// Contrats côté Direction (spec 2026-09-28, §3.3-3.4) :
//  - le salarié est prévenu qu'un contrat attend sa signature (création, passage « à resigner ») ;
//  - la création d'un contrat PROPOSE de clôturer le contrat en cours, dans la même transaction ;
//  - « Marquer expiré » est un geste de la Direction, journalisé, jamais automatique.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction", employeeId: null as string | null } }));
const N = vi.hoisted(() => ({ salarie: [] as { userId: string; message: string; lien?: string }[] }));
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
  requireRole: (u: { role: string }, roles: string[]) => {
    if (!roles.includes(u.role)) throw new Error("Accès refusé.");
  },
  invaliderProfil: () => {},
  estRH: (r: string) => r === "ADMIN" || r === "MANAGER" || r === "VIEWER",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// `formulaireLisible` redirige vers la page avec `?erreur=` : on remonte ce message au test.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${decodeURIComponent(url)}`);
  },
}));
vi.mock("@/lib/storage", () => ({ televerserFichier: async (c: string) => `/fichiers/${c}`, lireFichier: async () => null }));
vi.mock("@/lib/pdf/contrat-buffer", () => ({ genererContratPdf: async () => null }));
vi.mock("@/lib/notifications", () => ({
  notifierSalarie: async (userId: string, n: { message: string; lien?: string }) => { N.salarie.push({ userId, ...n }); },
  compteSalarieDe: async (employeeId: string) => {
    const u = await H.client.user.findUnique({ where: { employeeId } });
    return u && u.actif ? u.id : null;
  },
  creerNotification: async () => {},
}));

const { ajouterContrat } = await import("../employes/[id]/dossier-actions");
const { modifierContrat, prolongerContrat, marquerContratsExpires } = await import("./contrat-actions");
const { enregistrerSignature } = await import("@/lib/signature");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let seq = 0;

async function salarie(avecCompte: boolean) {
  seq++;
  const emp = await prisma.employee.create({
    data: {
      matricule: `CT${seq}-PEF`, nom: `Salarié ${seq}`, sexe: "F", etatCivil: "Célibataire",
      poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDD",
    },
  });
  let userId: string | null = null;
  if (avecCompte) {
    userId = (await prisma.user.create({ data: { email: `ct${seq}@salarie.local`, nom: emp.nom, role: "EMPLOYE", employeeId: emp.id } })).id;
  }
  return { employeeId: emp.id, userId };
}

async function contrat(employeeId: string, p: { type?: "CDD" | "CDI"; dateDebut?: string; dateFin?: string | null; statut?: "ACTIF" | "RESILIE" } = {}) {
  return prisma.contrat.create({
    data: {
      employeeId, type: p.type ?? "CDD", dateDebut: new Date(p.dateDebut ?? "2029-06-01"),
      dateFin: p.dateFin === undefined ? new Date("2030-06-30") : p.dateFin === null ? null : new Date(p.dateFin),
      heuresHebdo: 48, salaireMensuel: 300, devise: "USD", poste: "Commis", statut: p.statut ?? "ACTIF",
    },
  });
}

async function signer(employeeId: string, contratId: string) {
  await enregistrerSignature(prisma, {
    cible: "CONTRAT", cibleId: contratId, employeeId, traceUrl: "/fichiers/signatures/t.png", mode: "ESPACE_SALARIE", presenteParId: null,
  });
}

function formulaire(champs: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(champs)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "direction.contrats@test.pef", nom: "Direction", role: "ADMIN" } })).id;
}, 600_000);
afterAll(async () => { await fermer?.(); });
beforeEach(() => { N.salarie.length = 0; A.user.role = "ADMIN"; });

describe("notification « Un contrat vous attend pour signature »", () => {
  it("à la création d'un contrat, le salarié qui a un compte est prévenu, lien vers « Mes contrats »", async () => {
    const s = await salarie(true);
    await ajouterContrat(s.employeeId, formulaire({ type: "CDI", poste: "Commis", dateDebut: "2026-09-01", salaireMensuel: "300" }));
    expect(N.salarie).toEqual([expect.objectContaining({ userId: s.userId, message: "Un contrat vous attend pour signature", lien: "/espace/contrats" })]);
  });

  it("un salarié sans compte n'est pas notifié", async () => {
    const s = await salarie(false);
    await ajouterContrat(s.employeeId, formulaire({ type: "CDI", poste: "Commis", dateDebut: "2026-09-01", salaireMensuel: "300" }));
    expect(N.salarie).toEqual([]);
  });

  it("corriger un contrat SIGNÉ au point qu'il faille le resigner prévient le salarié", async () => {
    const s = await salarie(true);
    const c = await contrat(s.employeeId);
    await signer(s.employeeId, c.id);
    await modifierContrat(c.id, formulaire({ type: "CDD", poste: "Commis", dateDebut: "2029-06-01", dateFin: "2030-06-30", salaireMensuel: "350", heuresHebdo: "48", devise: "USD" }));
    expect(N.salarie.map((n) => n.message)).toEqual(["Un contrat vous attend pour signature"]);
  });

  it("prolonger un CDD signé le fait repasser « à resigner » : notification", async () => {
    const s = await salarie(true);
    const c = await contrat(s.employeeId);
    await signer(s.employeeId, c.id);
    await prolongerContrat(c.id, formulaire({ dateFin: "2030-12-31" }));
    expect(N.salarie).toHaveLength(1);
  });

  it("corriger un contrat JAMAIS signé n'est pas un nouvel événement", async () => {
    const s = await salarie(true);
    const c = await contrat(s.employeeId);
    await modifierContrat(c.id, formulaire({ type: "CDD", poste: "Commis", dateDebut: "2029-06-01", dateFin: "2030-06-30", salaireMensuel: "350", heuresHebdo: "48", devise: "USD" }));
    expect(N.salarie).toEqual([]);
  });

  it("une correction qui ne change pas les conditions signées ne notifie pas", async () => {
    const s = await salarie(true);
    const c = await contrat(s.employeeId);
    await signer(s.employeeId, c.id);
    await modifierContrat(c.id, formulaire({ type: "CDD", poste: "Commis", dateDebut: "2029-06-01", dateFin: "2030-06-30", salaireMensuel: "300", heuresHebdo: "48", devise: "USD" }));
    expect(N.salarie).toEqual([]);
  });
});

describe("nouveau contrat — clôture proposée du contrat en cours (§3.4)", () => {
  const nouveauCdi = (extra: Record<string, string> = {}) =>
    formulaire({ type: "CDI", poste: "Commis", dateDebut: "2030-07-01", salaireMensuel: "400", ...extra });

  it("case cochée : l'ancien passe dans le statut choisi, le nouveau est ACTIF, le tout journalisé", async () => {
    const s = await salarie(false);
    const ancien = await contrat(s.employeeId);
    await ajouterContrat(s.employeeId, nouveauCdi({ cloturerContratId: ancien.id, cloturer: "on", statutCloture: "TRANSFORME" }));
    expect((await prisma.contrat.findUniqueOrThrow({ where: { id: ancien.id } })).statut).toBe("TRANSFORME");
    const tous = await prisma.contrat.findMany({ where: { employeeId: s.employeeId } });
    expect(tous.filter((c) => c.statut === "ACTIF").map((c) => c.type)).toEqual(["CDI"]);
    const journal = await prisma.journalAudit.findMany({ where: { entite: "Contrat", entiteId: ancien.id, champ: "cloture" } });
    expect(journal).toEqual([expect.objectContaining({ ancienneValeur: "ACTIF", nouvelleValeur: "TRANSFORME", userId: A.user.id })]);
  });

  it("« Résilié » au choix", async () => {
    const s = await salarie(false);
    const ancien = await contrat(s.employeeId);
    await ajouterContrat(s.employeeId, nouveauCdi({ cloturerContratId: ancien.id, cloturer: "on", statutCloture: "RESILIE" }));
    expect((await prisma.contrat.findUniqueOrThrow({ where: { id: ancien.id } })).statut).toBe("RESILIE");
  });

  it("case décochée : l'ancien contrat ne bouge pas", async () => {
    const s = await salarie(false);
    const ancien = await contrat(s.employeeId);
    await ajouterContrat(s.employeeId, nouveauCdi({ cloturerContratId: ancien.id, statutCloture: "TRANSFORME" }));
    expect((await prisma.contrat.findUniqueOrThrow({ where: { id: ancien.id } })).statut).toBe("ACTIF");
    expect(await prisma.journalAudit.count({ where: { entiteId: ancien.id, champ: "cloture" } })).toBe(0);
  });

  it("même transaction : si la création échoue, l'ancien contrat reste ACTIF", async () => {
    const s = await salarie(false);
    const ancien = await contrat(s.employeeId);
    // Date de début illisible → la création du nouveau contrat échoue en base.
    await expect(
      ajouterContrat(s.employeeId, nouveauCdi({ dateDebut: "pas-une-date", cloturerContratId: ancien.id, cloturer: "on", statutCloture: "TRANSFORME" })),
    ).rejects.toThrow(/REDIRECT/);
    expect((await prisma.contrat.findUniqueOrThrow({ where: { id: ancien.id } })).statut).toBe("ACTIF");
    expect(await prisma.contrat.count({ where: { employeeId: s.employeeId } })).toBe(1);
  });

  it("le contrat d'un AUTRE salarié ne se clôture pas par ce formulaire", async () => {
    const s = await salarie(false);
    const autre = await salarie(false);
    const sien = await contrat(autre.employeeId);
    await expect(
      ajouterContrat(s.employeeId, nouveauCdi({ cloturerContratId: sien.id, cloturer: "on", statutCloture: "RESILIE" })),
    ).rejects.toThrow(/Ce contrat n'appartient pas à ce salarié/);
    expect((await prisma.contrat.findUniqueOrThrow({ where: { id: sien.id } })).statut).toBe("ACTIF");
    expect(await prisma.contrat.count({ where: { employeeId: s.employeeId } })).toBe(0);
  });

  it("un statut de clôture autre que Transformé / Résilié est refusé", async () => {
    const s = await salarie(false);
    const ancien = await contrat(s.employeeId);
    await expect(
      ajouterContrat(s.employeeId, nouveauCdi({ cloturerContratId: ancien.id, cloturer: "on", statutCloture: "EXPIRE" })),
    ).rejects.toThrow(/Transformé ou Résilié/);
  });
});

describe("« Marquer expiré » — un geste de la Direction, journalisé (§3.4)", () => {
  it("lot mixte : seuls les ACTIF dont la fin est passée passent en EXPIRE ; un message par ligne refusée", async () => {
    const s = await salarie(false);
    const t = await salarie(false);
    const expire = await contrat(s.employeeId, { dateDebut: "2024-01-01", dateFin: "2024-12-31" });
    const enCours = await contrat(t.employeeId);
    const resilie = await contrat(t.employeeId, { dateDebut: "2023-01-01", dateFin: "2023-06-30", statut: "RESILIE" });

    const r = await marquerContratsExpires([expire.id, enCours.id, resilie.id, "inconnu"]);
    expect(r).toEqual({
      traites: 1,
      refus: [
        { id: enCours.id, message: expect.stringMatching(/pas encore échu/) },
        { id: resilie.id, message: expect.stringMatching(/n'est plus actif/) },
        { id: "inconnu", message: "Contrat introuvable." },
      ],
    });
    expect((await prisma.contrat.findUniqueOrThrow({ where: { id: expire.id } })).statut).toBe("EXPIRE");
    expect((await prisma.contrat.findUniqueOrThrow({ where: { id: enCours.id } })).statut).toBe("ACTIF");
    expect(await prisma.journalAudit.findMany({ where: { entiteId: expire.id, champ: "statut" } })).toEqual([
      expect.objectContaining({ ancienneValeur: "ACTIF", nouvelleValeur: "EXPIRE", userId: A.user.id }),
    ]);
  });

  it("un compte en lecture seule ne marque rien", async () => {
    const s = await salarie(false);
    const expire = await contrat(s.employeeId, { dateDebut: "2024-01-01", dateFin: "2024-12-31" });
    A.user.role = "VIEWER";
    expect(await marquerContratsExpires([expire.id])).toEqual({ erreur: "Accès refusé." });
    expect((await prisma.contrat.findUniqueOrThrow({ where: { id: expire.id } })).statut).toBe("ACTIF");
  });

  it("rien n'est marqué sans le geste : un CDD échu reste ACTIF en base, seul l'affichage le dit expiré", async () => {
    const s = await salarie(false);
    const expire = await contrat(s.employeeId, { dateDebut: "2024-01-01", dateFin: "2024-12-31" });
    await ajouterContrat(s.employeeId, formulaire({ type: "CDI", poste: "Commis", dateDebut: "2030-07-01", salaireMensuel: "400" }));
    expect((await prisma.contrat.findUniqueOrThrow({ where: { id: expire.id } })).statut).toBe("ACTIF");
  });
});
