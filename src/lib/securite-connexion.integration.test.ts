import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Anti-force-brute (délai qui s'allonge) et jetons de réinitialisation (usage unique, expiration,
// invalidation des anciens) — sur Postgres éphémère.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { secondesAttente, formaterAttente, delaiApresEchecs, ATTENTE_MAX_S, FENETRE_MIN, enregistrerEchec, effacerEchecs, genererJetonReinitialisation, verifierJeton, consommerJeton } =
  await import("@/lib/securite-connexion");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("anti-force-brute : un délai qui s'allonge, par identifiant", () => {
  it("progression 0, 0, 2, 4, 8, 16… et plafond 15 min (fonction pure)", () => {
    expect([1, 2, 3, 4, 5, 6].map(delaiApresEchecs)).toEqual([0, 2, 4, 8, 16, 32]);
    expect(delaiApresEchecs(0)).toBe(0);
    expect(delaiApresEchecs(11)).toBe(900); // 1024 s plafonnés
    expect(delaiApresEchecs(500)).toBe(ATTENTE_MAX_S);
  });

  it("le message dit combien attendre", () => {
    expect([1, 2, 59, 60, 61, 900].map(formaterAttente)).toEqual(["1 seconde", "2 secondes", "59 secondes", "1 minute", "2 minutes", "15 minutes"]);
  });

  it("1er échec : aucune attente ; 2e : 2 s ; 3e : 4 s ; l'attente se compte depuis le dernier échec ; insensible à la casse", async () => {
    const t0 = new Date("2026-10-13T08:00:00Z");
    const echec = (quand: Date, email = "Dir@Pef.cd") => prisma.tentativeConnexion.create({ data: { email: email.trim().toLowerCase(), ip: "10.0.0.1", createdAt: quand } });
    await echec(t0);
    expect(await secondesAttente("dir@pef.cd", new Date(t0.getTime() + 1))).toBe(0);
    await echec(new Date(t0.getTime() + 1000));
    expect(await secondesAttente("DIR@pef.cd", new Date(t0.getTime() + 1000))).toBe(2);
    expect(await secondesAttente("dir@pef.cd", new Date(t0.getTime() + 2000))).toBe(1);
    expect(await secondesAttente("dir@pef.cd", new Date(t0.getTime() + 3000))).toBe(0);
    await echec(new Date(t0.getTime() + 3000));
    expect(await secondesAttente("dir@pef.cd", new Date(t0.getTime() + 3000))).toBe(4);
    // Un autre identifiant, même adresse IP (le VPN), n'est pas affecté.
    await echec(t0, "autre@pef.cd");
    expect(await secondesAttente("collegue@pef.cd", new Date(t0.getTime() + 3000))).toBe(0);
    expect(await secondesAttente("autre@pef.cd", new Date(t0.getTime() + 500))).toBe(0);
  }, 60_000);

  it("plafond de 15 min, jamais de blocage définitif : les échecs anciens sont oubliés ; un succès remet à zéro", async () => {
    const t0 = new Date("2026-10-13T09:00:00Z");
    for (let i = 0; i < 15; i++) await prisma.tentativeConnexion.create({ data: { email: "brute@pef.cd", createdAt: new Date(t0.getTime() + i * 1000) } });
    const dernier = t0.getTime() + 14 * 1000;
    expect(await secondesAttente("brute@pef.cd", new Date(dernier))).toBe(ATTENTE_MAX_S);
    expect(await secondesAttente("brute@pef.cd", new Date(dernier + ATTENTE_MAX_S * 1000))).toBe(0); // après 15 min on peut réessayer
    expect(await secondesAttente("brute@pef.cd", new Date(dernier + (FENETRE_MIN + 1) * 60_000))).toBe(0); // et tout est oublié après la fenêtre
    await effacerEchecs("BRUTE@pef.cd");
    expect(await secondesAttente("brute@pef.cd", new Date(dernier))).toBe(0);
  }, 60_000);

  it("enregistrerEchec journalise l'identifiant et l'adresse IP", async () => {
    await enregistrerEchec("Journal@Pef.cd", "9.9.9.9");
    const t = await prisma.tentativeConnexion.findFirstOrThrow({ where: { email: "journal@pef.cd" } });
    expect(t.ip).toBe("9.9.9.9");
  });
});

describe("jetons de réinitialisation", () => {
  it("valide → email ; usage unique ; nouveau jeton invalide l'ancien ; expiré → null", async () => {
    const t1 = await genererJetonReinitialisation("reset@pef.cd");
    expect(await verifierJeton(t1)).toBe("reset@pef.cd");

    // Un nouveau jeton invalide le précédent.
    const t2 = await genererJetonReinitialisation("reset@pef.cd");
    expect(await verifierJeton(t1)).toBeNull();
    expect(await verifierJeton(t2)).toBe("reset@pef.cd");

    // Usage unique.
    await consommerJeton(t2);
    expect(await verifierJeton(t2)).toBeNull();

    // Expiré → null.
    const t3 = await genererJetonReinitialisation("reset@pef.cd");
    await prisma.jetonReinitialisation.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifierJeton(t3)).toBeNull();

    // Jeton fantaisiste → null.
    expect(await verifierJeton("nimportequoi")).toBeNull();
  }, 60_000);
});
