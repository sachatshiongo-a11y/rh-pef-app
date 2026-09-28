import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Clôture du stock — BORNE BASSE (relecture 2026-09-28) : un mois clôturé fige aussi tout ce qui
// le précède. Avant, seul le mois de la date était contrôlé : avec 02 à 06 clôturés, un achat
// daté de janvier ou de 2025 passait, et changeait des stocks déjà figés.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { exigerPeriodeOuverte, exigerPeriodesOuvertes } = await import("./cloture-stock");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
}, 300_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => { await prisma.clotureStock.deleteMany(); });

const j = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const clore = (...mois: [number, number][]) => prisma.clotureStock.createMany({ data: mois.map(([annee, m]) => ({ annee, mois: m })) });

describe("exigerPeriodeOuverte — tout mois antérieur ou égal au dernier mois clôturé est figé", () => {
  it("aucune clôture : tout passe", async () => {
    await expect(exigerPeriodeOuverte(j("2025-01-15"))).resolves.toBeUndefined();
  });

  it("mois clôturé lui-même : refusé (message inchangé)", async () => {
    await clore([2026, 2], [2026, 6]);
    await expect(exigerPeriodeOuverte(j("2026-06-30"))).rejects.toThrow(/La période 06\/2026 est clôturée/);
  });

  it("mois NON clôturé mais antérieur au dernier mois clôturé : refusé, avec la date et le mois qui bloque", async () => {
    await clore([2026, 2], [2026, 3], [2026, 4], [2026, 5], [2026, 6]);
    await expect(exigerPeriodeOuverte(j("2026-01-20"))).rejects.toThrow("La période 06/2026 est clôturée : le stock est figé jusqu'à ce mois inclus, aucun mouvement daté du 20/01/2026 ne peut être ajouté ou supprimé.");
    await expect(exigerPeriodeOuverte(j("2025-12-31"))).rejects.toThrow(/06\/2026 est clôturée/);
  });

  it("un mois rouvert au milieu reste figé tant qu'un mois postérieur est clôturé", async () => {
    await clore([2026, 2], [2026, 4]);
    await expect(exigerPeriodeOuverte(j("2026-03-10"))).rejects.toThrow(/04\/2026 est clôturée/);
  });

  it("le mois qui suit le dernier mois clôturé reste ouvert (limite exacte)", async () => {
    await clore([2026, 6]);
    await expect(exigerPeriodeOuverte(j("2026-07-01"))).resolves.toBeUndefined();
    await expect(exigerPeriodeOuverte(j("2027-01-01"))).resolves.toBeUndefined();
  });

  it("changement d'année : décembre clôturé fige 2025, janvier suivant ouvert", async () => {
    await clore([2025, 12]);
    await expect(exigerPeriodeOuverte(j("2025-11-30"))).rejects.toThrow(/12\/2025 est clôturée/);
    await expect(exigerPeriodeOuverte(j("2026-01-02"))).resolves.toBeUndefined();
  });

  it("plusieurs dates (suppression en lot, import) : une seule date figée suffit à refuser", async () => {
    await clore([2026, 6]);
    await expect(exigerPeriodesOuvertes([j("2026-08-01"), j("2026-05-31")])).rejects.toThrow(/31\/05\/2026/);
    await expect(exigerPeriodesOuvertes([j("2026-08-01"), j("2026-07-15")])).resolves.toBeUndefined();
    await expect(exigerPeriodesOuvertes([])).resolves.toBeUndefined();
  });
});
