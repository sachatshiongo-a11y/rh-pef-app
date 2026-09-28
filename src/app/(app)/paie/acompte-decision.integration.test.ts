import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Décision de la Direction du 2026-09-28 : le salarié est PRÉVENU quand sa demande d'acompte est
// acceptée ou refusée — à l'unité comme en lot —, par sa cloche et un push. La notification doit
// SURVIVRE au ménage `supprimerNotificationsPour(id)` que fait la décision elle-même (elle efface
// la notification « à valider » de la Direction) : d'où un refId distinct, `<id>:decision`.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const P = vi.hoisted(() => ({ push: [] as { ids: string[]; body: string }[] }));
const A = vi.hoisted(() => ({ user: { id: "admin", role: "ADMIN", nom: "Direction", employeeId: null } }));
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
  requireRole: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async (ids: string[], p: { body: string }) => { P.push.push({ ids, body: p.body }); } }));
vi.mock("@/lib/email", () => ({ envoyerEmail: async () => {} }));
vi.mock("./actions", () => ({ recalculerPaieSiCalculee: async () => {} }));

const { approuverAcompte, refuserAcompte, approuverAcomptesEnLot } = await import("./remuneration-actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;
let userId: string;

const acompte = (montantUSD: number) =>
  prisma.acompteSalaire.create({ data: { employeeId: empId, montantUSD, mois: 9, annee: 2026, statut: "EN_ATTENTE" } });

/** Ce que le salarié trouve dans SA cloche pour cet acompte. */
const cloche = (acompteId: string) =>
  prisma.notification.findMany({ where: { domaine: "SALARIE", destinataireUserId: userId, refId: `${acompteId}:decision` } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const emp = await prisma.employee.create({
    data: {
      matricule: "ACD1-PEF", nom: "Aimée Mutita", sexe: "F", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 400,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  empId = emp.id;
  A.user.id = (await prisma.user.create({ data: { email: "direction.acd@test.pef", nom: "Direction", role: "ADMIN" } })).id;
  userId = (await prisma.user.create({ data: { email: "acd1@test.pef", nom: "Aimée Mutita", role: "EMPLOYE", employeeId: empId } })).id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("décision sur un acompte → le salarié est prévenu", () => {
  it("acceptée à l'unité : cloche + push, lien vers « Ma paie », qui survit au ménage de la décision", async () => {
    const a = await acompte(50);
    // La notification « à valider » de la Direction, effacée par la décision.
    await prisma.notification.create({ data: { domaine: "RH", type: "ACOMPTE", message: "Demande d'acompte", refId: a.id } });
    P.push.length = 0;

    expect(await approuverAcompte(a.id)).toEqual({ ok: true });

    const n = await cloche(a.id);
    expect(n).toHaveLength(1);
    expect(n[0].message).toBe("Votre demande d'acompte de 50,00 $ (septembre 2026) a été acceptée ✅. Le montant sera déduit de votre salaire.");
    expect(n[0].lien).toBe("/espace/paie");
    expect(P.push).toEqual([{ ids: [userId], body: n[0].message }]);
    expect(await prisma.notification.count({ where: { refId: a.id } }), "la notification Direction est bien effacée").toBe(0);
  });

  it("refusée à l'unité : le salarié le sait aussi", async () => {
    const a = await acompte(30);
    await refuserAcompte(a.id);
    const n = await cloche(a.id);
    expect(n.map((x) => x.message)).toEqual(["Votre demande d'acompte de 30,00 $ (septembre 2026) a été refusée."]);
  });

  it("en lot : chaque salarié concerné est prévenu, une fois par acompte", async () => {
    const [a1, a2] = [await acompte(10), await acompte(20)];
    const r = await approuverAcomptesEnLot([a1.id, a2.id]);
    expect(r.traites).toBe(2);
    expect(await cloche(a1.id)).toHaveLength(1);
    expect(await cloche(a2.id)).toHaveLength(1);
  });

  it("déjà décidé : rien de nouveau (pas de seconde notification)", async () => {
    const a = await acompte(5);
    await approuverAcompte(a.id);
    await approuverAcompte(a.id);
    expect(await cloche(a.id)).toHaveLength(1);
  });
});
