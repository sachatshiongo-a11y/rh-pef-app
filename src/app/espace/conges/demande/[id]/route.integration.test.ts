import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { LeaveStatus, PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

/**
 * LE DOCUMENT QU'ON DEMANDE AU SALARIÉ DE SIGNER — il doit pouvoir le LIRE, et seulement le sien.
 *
 * Deux choses sont prouvées ici, base relue à chaque fois :
 *  1. LA GARDE. Un salarié ne peut pas obtenir la demande d'un collègue, ni une demande qui n'est
 *     pas approuvée, et l'interrupteur du self-service ferme la route. Un refus est un REFUS
 *     (403), jamais une redirection : un `fetch` suit les redirections et enregistrerait la page
 *     de connexion sous le nom du document, sans que rien ne signale l'erreur.
 *  2. LE PARTAGE. Le PDF servi au salarié et celui servi à la Direction sortent du MÊME
 *     assembleur (`genererDemandeCongePdf`) : même texte, donc même mention de signature. Si
 *     quelqu'un recopiait le document côté espace salarié, les deux se mettraient à diverger
 *     silencieusement — c'est ce test qui l'attrape.
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "EMPLOYE", nom: "Testeur", employeeId: "seed-emp" } }));
const F = vi.hoisted(() => ({ espaceEmployeActif: true }));
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
  requireRole: () => {},
}));
vi.mock("@/lib/espace-employe", () => ({ espaceEmployeActif: async () => F.espaceEmployeActif }));
// Le tracé n'est pas relu depuis le stockage en test : c'est la MENTION qui est comparée, et elle
// est composée par `mentionSignature` à partir de la ligne en base, pas du fichier PNG.
vi.mock("@/lib/storage", () => ({ televerserFichier: async () => "/fichiers/x.png", lireFichier: async () => null }));

const { GET: getSalarie } = await import("./route");
const { GET: getDirection } = await import("@/app/(app)/conges/demande/[id]/route");
const { enregistrerSignature } = await import("@/lib/signature");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;
let collegueId: string;
let approuveeId: string; // demande APPROUVÉE du salarié connecté
let enAttenteId: string; // demande EN_ATTENTE du salarié connecté
let refuseeId: string; // demande REFUSÉE du salarié connecté
let collegueApprouveeId: string; // demande APPROUVÉE du collègue

const appeler = (id: string, query = "") =>
  getSalarie(new Request(`http://localhost/espace/conges/demande/${id}${query}`), { params: Promise.resolve({ id }) });

/** Texte réellement imprimé dans le PDF (mêmes outils que `lib/pdf/signature.render.test.ts`). */
async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}
const corpsDe = async (r: Response) => Buffer.from(await r.arrayBuffer());

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;

  await prisma.config.create({
    data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 8, espaceEmployeActif: true },
  });
  await seedParametresLegaux(prisma);

  const emp = await prisma.employee.create({
    data: {
      matricule: "SA01-PEF", nom: "Salarié A", sexe: "F", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  empId = emp.id;
  A.user.employeeId = empId;
  const compte = await prisma.user.create({
    data: { email: "salarie.a.conges.pdf@test.pef", nom: "Salarié A", role: "EMPLOYE", employeeId: empId },
  });
  A.user.id = compte.id;

  const collegue = await prisma.employee.create({
    data: {
      matricule: "SB01-PEF", nom: "Salarié B", sexe: "M", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  collegueId = collegue.id;

  const demande = (employeeId: string, statut: LeaveStatus, jour: number) =>
    prisma.leaveRequest.create({
      data: {
        employeeId, type: "Congé annuel",
        dateDebut: new Date(`2026-08-${String(jour).padStart(2, "0")}`),
        dateFin: new Date(`2026-08-${String(jour + 4).padStart(2, "0")}`),
        nbJours: 5, statut,
      },
    }).then((d) => d.id);

  approuveeId = await demande(empId, "APPROUVE", 3);
  enAttenteId = await demande(empId, "EN_ATTENTE", 10);
  refuseeId = await demande(empId, "REFUSE", 17);
  collegueApprouveeId = await demande(collegueId, "APPROUVE", 3);
}, 180_000);

afterAll(async () => { await fermer?.(); });

describe("garde de /espace/conges/demande/[id]", () => {
  it("sa propre demande approuvée : 200, un vrai PDF, servi en ligne", async () => {
    const r = await appeler(approuveeId);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("Content-Disposition")).toContain("inline");
    expect((await corpsDe(r)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 120_000);

  it("?dl=1 : le même document, en téléchargement", async () => {
    const r = await appeler(approuveeId, "?dl=1");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Disposition")).toContain("attachment");
  }, 120_000);

  it("la demande d'un COLLÈGUE est refusée — et elle existe bien, approuvée, en base", async () => {
    // Relecture : sans elle, ce test resterait vert si la demande du collègue n'existait pas du
    // tout (le 403 viendrait alors du `findUnique` vide, pas du contrôle de propriété).
    const enBase = await prisma.leaveRequest.findUnique({ where: { id: collegueApprouveeId } });
    expect(enBase?.employeeId).toBe(collegueId);
    expect(enBase?.statut).toBe("APPROUVE");
    expect(enBase?.employeeId).not.toBe(A.user.employeeId);

    const r = await appeler(collegueApprouveeId);
    expect(r.status).toBe(403);
    expect((await r.text())).not.toContain("%PDF-");
  });

  it("une demande EN ATTENTE est refusée — elle est bien à lui, seul le statut la bloque", async () => {
    const enBase = await prisma.leaveRequest.findUnique({ where: { id: enAttenteId } });
    expect(enBase?.employeeId).toBe(A.user.employeeId);
    expect(enBase?.statut).toBe("EN_ATTENTE");

    const r = await appeler(enAttenteId);
    expect(r.status).toBe(403);
  });

  it("une demande REFUSÉE est refusée — elle est bien à lui, seul le statut la bloque", async () => {
    const enBase = await prisma.leaveRequest.findUnique({ where: { id: refuseeId } });
    expect(enBase?.employeeId).toBe(A.user.employeeId);
    expect(enBase?.statut).toBe("REFUSE");

    const r = await appeler(refuseeId);
    expect(r.status).toBe(403);
  });

  it("espace salarié fermé : refusé — et la réponse n'est PAS une redirection vers /login", async () => {
    F.espaceEmployeActif = false;
    try {
      const r = await appeler(approuveeId);
      expect(r.status).toBe(403);
      // Le cœur du piège : un `fetch` suit les 3xx et enregistrerait la page de connexion sous le
      // nom du document. Aucun code de redirection, aucun en-tête Location, jamais.
      expect(r.status >= 300 && r.status < 400).toBe(false);
      expect(r.redirected).toBe(false);
      expect(r.headers.get("Location")).toBeNull();
    } finally {
      F.espaceEmployeActif = true;
    }
  });

  it("une demande inexistante est refusée sans rien révéler", async () => {
    const r = await appeler("00000000-0000-0000-0000-000000000000");
    expect(r.status).toBe(403);
  });
});

describe("le salarié et la Direction lisent EXACTEMENT le même document", () => {
  it("demande signée : même mention de signature des deux côtés, et même texte complet", async () => {
    await enregistrerSignature(prisma, {
      cible: "DEMANDE_CONGE", cibleId: approuveeId, employeeId: empId,
      traceUrl: "/fichiers/signatures/demande_conge/test.png", mode: "ESPACE_SALARIE", presenteParId: null,
    });

    const [cote, direction] = await Promise.all([
      appeler(approuveeId).then(corpsDe),
      getDirection(new Request(`http://localhost/conges/demande/${approuveeId}`), {
        params: Promise.resolve({ id: approuveeId }),
      }).then(corpsDe),
    ]);
    const [texteSalarie, texteDirection] = await Promise.all([texteDu(cote), texteDu(direction)]);

    // La mention existe vraiment : sans cette assertion, l'égalité ci-dessous serait verte même
    // si AUCUN des deux documents ne portait de mention du tout.
    const mention = "Signé électroniquement par Salarié A (matricule SA01-PEF)";
    expect(texteSalarie).toContain(mention);
    expect(texteSalarie).toContain("depuis son espace salarié");
    expect(texteDirection).toContain(mention);

    // Et c'est la MÊME feuille, pas seulement la même phrase.
    expect(texteSalarie).toBe(texteDirection);
  }, 180_000);
});
