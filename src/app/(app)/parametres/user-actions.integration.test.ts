import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
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
  invaliderProfil: () => {},
}));
vi.mock("@/lib/audit", () => ({ journaliser: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { definirRoleUtilisateur } from "./user-actions";

let fermer: () => Promise<void>;
const role = (fd: string) => { const f = new FormData(); f.set("role", fd); return f; };

beforeAll(async () => {
  const b = await creerBaseTest();
  H.client = b.prisma;
  fermer = b.fermer;
  await b.prisma.user.createMany({
    data: [
      { id: "sal-1", email: "sk19pef@salarie.local", nom: "Salariée", role: "EMPLOYE" },
      { id: "stock-1", email: "stock@x.cd", nom: "Stock", role: "STOCK" },
    ],
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("definirRoleUtilisateur", () => {
  it("REFUSE de changer le rôle d'un compte salarié, et n'écrit rien", async () => {
    for (const r of ["ADMIN", "MANAGER", "VIEWER", "STOCK"]) {
      const res = await definirRoleUtilisateur("sal-1", role(r));
      expect(res, `un salarié a pu devenir ${r}`).toMatchObject({ erreur: expect.stringContaining("compte salarié") });
    }
    const u = await H.client.user.findUniqueOrThrow({ where: { id: "sal-1" } });
    expect(u.role).toBe("EMPLOYE");
  });
  it("change normalement le rôle d'un compte de gestion", async () => {
    await definirRoleUtilisateur("stock-1", role("VIEWER"));
    const u = await H.client.user.findUniqueOrThrow({ where: { id: "stock-1" } });
    expect(u.role).toBe("VIEWER");
  });
});
