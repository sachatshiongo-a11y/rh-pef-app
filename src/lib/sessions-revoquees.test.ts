import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { instantAuthentification, sessionRevoquee, MOTIF_SESSION_FERMEE } from "./sessions-revoquees";

// Audit du 10/10/2026, sécurité 5 : sessions jamais révoquées (réinitialisation du mot de passe,
// désactivation) + boucle de redirection d'un compte désactivé.

const H = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  profils: new Map<string, Record<string, unknown>>(),
}));
vi.mock("@/lib/supabase/jwks", () => ({ getJwksKeys: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: async () => ({ data: H.claims ? { claims: H.claims } : null }) } }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims: async () => ({ data: H.claims ? { claims: H.claims } : null }) } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: async ({ where }: { where: { id: string } }) => H.profils.get(where.id) ?? null } } }));

const { verifySession, invaliderProfil } = await import("./auth");
const { updateSession } = await import("./supabase/middleware");

const S = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const jeton = (sub: string, connexion: string, emis = connexion) => ({ sub, iat: S(emis), amr: [{ method: "password", timestamp: S(connexion) }] });
const profil = (id: string, p: Partial<{ actif: boolean; sessionsRevoqueesLe: Date | null }> = {}) =>
  H.profils.set(id, { id, email: `${id}@pef.cd`, nom: id, role: "ADMIN", accesStock: false, employeeId: null, actif: true, sessionsRevoqueesLe: null, ...p });

/** Adresse de la redirection levée par `redirect()` (next/navigation), ou null si pas de redirection. */
async function redirection(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) {
    const d = String((e as { digest?: string }).digest ?? "");
    if (!d.startsWith("NEXT_REDIRECT")) throw e;
    return d.split(";")[2] ?? null;
  }
}

describe("règle de révocation (pure)", () => {
  it("l'instant de connexion se lit dans amr, PAS dans iat (un rafraîchissement ne blanchit pas la session)", () => {
    const rafraichi = jeton("u", "2026-10-01T08:00:00Z", "2026-10-12T09:00:00Z");
    expect(instantAuthentification(rafraichi)).toBe(S("2026-10-01T08:00:00Z"));
    expect(sessionRevoquee(rafraichi, new Date("2026-10-12T08:30:00Z"))).toBe(true);
  });
  it("une connexion APRÈS la révocation passe ; aucune révocation = tout passe", () => {
    expect(sessionRevoquee(jeton("u", "2026-10-12T08:31:00Z"), new Date("2026-10-12T08:30:00Z"))).toBe(false);
    expect(sessionRevoquee(jeton("u", "2020-01-01T00:00:00Z"), null)).toBe(false);
  });
  it("connexion dans la même seconde que la révocation : acceptée (jeton à la seconde près)", () => {
    expect(sessionRevoquee(jeton("u", "2026-10-12T08:30:00Z"), new Date("2026-10-12T08:30:00.700Z"))).toBe(false);
  });
  it("sans amr : repli sur iat ; jeton illisible et révocation posée : refusé", () => {
    expect(sessionRevoquee({ iat: S("2026-10-12T08:00:00Z") }, new Date("2026-10-12T08:30:00Z"))).toBe(true);
    expect(sessionRevoquee({}, new Date("2026-10-12T08:30:00Z"))).toBe(true);
  });
});

describe("verifySession", () => {
  beforeEach(() => { H.profils.clear(); });

  it("session ouverte AVANT la réinitialisation : renvoyée vers /login avec le motif qui efface les cookies", async () => {
    profil("a1", { sessionsRevoqueesLe: new Date("2026-10-12T08:30:00Z") });
    invaliderProfil("a1");
    H.claims = jeton("a1", "2026-10-12T07:00:00Z", "2026-10-12T08:45:00Z");
    expect(await redirection(verifySession())).toBe(`/login?motif=${MOTIF_SESSION_FERMEE}`);
  });

  it("nouvelle connexion après la réinitialisation : acceptée", async () => {
    profil("a2", { sessionsRevoqueesLe: new Date("2026-10-12T08:30:00Z") });
    invaliderProfil("a2");
    H.claims = jeton("a2", "2026-10-12T08:40:00Z");
    expect((await verifySession()).id).toBe("a2");
  });

  it("révocation posée alors que le profil est EN CACHE : refusée dès que le cache est invalidé", async () => {
    profil("a3");
    invaliderProfil("a3");
    H.claims = jeton("a3", "2026-10-12T07:00:00Z");
    expect((await verifySession()).id).toBe("a3"); // profil mis en cache
    profil("a3", { sessionsRevoqueesLe: new Date("2026-10-12T08:30:00Z") });
    invaliderProfil("a3"); // ce que font les actions de réinitialisation / désactivation
    expect(await redirection(verifySession())).toBe(`/login?motif=${MOTIF_SESSION_FERMEE}`);
  });

  it("compte désactivé : même sortie (motif), plus jamais /login nu", async () => {
    profil("a4", { actif: false });
    invaliderProfil("a4");
    H.claims = jeton("a4", "2026-10-12T07:00:00Z");
    expect(await redirection(verifySession())).toBe(`/login?motif=${MOTIF_SESSION_FERMEE}`);
  });
});

describe("proxy : fin de la boucle /login ↔ /entree", () => {
  const req = (url: string) => new NextRequest(url, { headers: { cookie: "sb-proj-auth-token.0=aaa; sb-proj-auth-token.1=bbb; dernier-espace=rh" } });

  it("jeton valide + /login?motif=session-fermee : la page de connexion est servie et les cookies de session effacés", async () => {
    H.claims = jeton("a5", "2026-10-12T07:00:00Z");
    const r = await updateSession(req(`http://x/login?motif=${MOTIF_SESSION_FERMEE}`));
    expect(r.headers.get("location")).toBeNull();
    const effaces = r.cookies.getAll().filter((c) => c.value === "" && c.maxAge === 0).map((c) => c.name).sort();
    expect(effaces).toEqual(["sb-proj-auth-token.0", "sb-proj-auth-token.1"]);
  });

  it("jeton valide + /login sans motif : redirection vers /entree (inchangé)", async () => {
    H.claims = jeton("a6", "2026-10-12T07:00:00Z");
    const r = await updateSession(req("http://x/login"));
    expect(new URL(r.headers.get("location")!).pathname).toBe("/entree");
  });
});
