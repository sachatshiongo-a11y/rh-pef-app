import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Audit du 10/10/2026, sécurité 5 : réinitialiser le mot de passe ou désactiver un compte ferme
// ses sessions ouvertes (`User.sessionsRevoqueesLe`, lu par verifySession — src/lib/sessions-revoquees.ts).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, invalides: [] as string[], fetchOk: true }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => ({ id: "admin-1", role: "ADMIN", nom: "Direction", employeeId: null }),
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé."); },
  invaliderProfil: (id: string) => { H.invalides.push(id); },
}));
vi.mock("@/lib/audit", () => ({ journaliser: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { basculerActifUtilisateur, reinitialiserMotDePasse } = await import("./user-actions");
const { desactiverCompteEmploye } = await import("../employes/compte-actions");

let fermer: () => Promise<void>;
const mdp = (v: string) => { const f = new FormData(); f.set("password", v); return f; };
const revoque = async (id: string) => (await H.client.user.findUniqueOrThrow({ where: { id } })).sessionsRevoqueesLe;

beforeAll(async () => {
  const b = await creerBaseTest();
  H.client = b.prisma; fermer = b.fermer;
  await b.prisma.employee.create({ data: { id: "emp-1", matricule: "SK01PEF", nom: "Salarié", sexe: "M", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 100, dateEmbauche: new Date("2026-01-01T00:00:00Z"), contrat: "CDI" } });
  await b.prisma.user.createMany({
    data: [
      { id: "u-act", email: "a@x.cd", nom: "A", role: "STOCK" },
      { id: "u-mdp", email: "b@x.cd", nom: "B", role: "VIEWER" },
      { id: "u-ko", email: "c@x.cd", nom: "C", role: "VIEWER" },
    ],
  });
}, 120_000);
afterAll(async () => { await fermer?.(); vi.unstubAllGlobals(); });
beforeEach(() => {
  H.invalides = [];
  vi.stubGlobal("fetch", async () => new Response("{}", { status: H.fetchOk ? 200 : 500 }));
});

describe("révocation des sessions", () => {
  it("désactiver : sessions fermées (instant posé, cache invalidé) ; réactiver n'efface pas la révocation", async () => {
    const t0 = Date.now();
    await basculerActifUtilisateur("u-act");
    const r = await revoque("u-act");
    expect(r).toBeInstanceOf(Date);
    expect(r!.getTime()).toBeGreaterThanOrEqual(t0 - 1000);
    expect(H.invalides).toContain("u-act");
    await basculerActifUtilisateur("u-act"); // réactivation
    expect((await revoque("u-act"))!.getTime()).toBe(r!.getTime());
  });

  it("réinitialisation du mot de passe par la Direction : sessions fermées", async () => {
    H.fetchOk = true;
    await reinitialiserMotDePasse("u-mdp", mdp("nouveau-mdp-1"));
    expect(await revoque("u-mdp")).toBeInstanceOf(Date);
    expect(H.invalides).toContain("u-mdp");
  });

  it("réinitialisation REFUSÉE par Supabase : rien n'est révoqué (le mot de passe n'a pas changé)", async () => {
    H.fetchOk = false;
    const r = await reinitialiserMotDePasse("u-ko", mdp("nouveau-mdp-2"));
    expect(r).toMatchObject({ erreur: expect.any(String) });
    expect(await revoque("u-ko")).toBeNull();
    H.fetchOk = true;
  });

  it("désactivation du compte salarié depuis la fiche : sessions fermées", async () => {
    await H.client.user.create({ data: { id: "u-sal", email: "sk01pef@salarie.local", nom: "S", role: "EMPLOYE", employeeId: "emp-1" } });
    expect(await desactiverCompteEmploye("emp-1")).toBeUndefined();
    expect(await revoque("u-sal")).toBeInstanceOf(Date);
    expect(H.invalides).toContain("u-sal");
  });
});

describe("garde-fou : chaque chemin qui change un mot de passe ou désactive un compte révoque les sessions", () => {
  const RACINE = path.resolve(__dirname, "../../../..");
  const CHEMINS: [fichier: string, ancre: RegExp][] = [
    ["src/app/(app)/parametres/user-actions.ts", /actif: !u\.actif, \.\.\.\(u\.actif \? donneesRevocationSessions\(\)/],
    ["src/app/(app)/parametres/user-actions.ts", /data: donneesRevocationSessions\(\) \}\);\n\s*invaliderProfil\(userId\)/],
    ["src/app/(app)/employes/compte-actions.ts", /actif: false, \.\.\.donneesRevocationSessions\(\)/],
    ["src/app/(app)/employes/[id]/dossier-actions.ts", /actif: false, \.\.\.donneesRevocationSessions\(\)/],
    ["src/lib/comptes-salaries.ts", /actif: true, \.\.\.donneesRevocationSessions\(\)/],
    ["src/app/login/actions.ts", /changerMotDePasseAdmin\(user\.id, password\);[\s\S]{0,200}donneesRevocationSessions\(\)/],
  ];
  it.each(CHEMINS)("%s", (f, ancre) => {
    expect(fs.readFileSync(path.join(RACINE, f), "utf8")).toMatch(ancre);
  });
});
