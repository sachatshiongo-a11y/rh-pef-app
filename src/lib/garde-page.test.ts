import { describe, it, expect, vi } from "vitest";
import type { Role } from "@prisma/client";

/** Matrice rôle × garde de page : même verdict que le layout de l'espace, refus = redirection /entree. */
const A = vi.hoisted(() => ({
  user: { id: "u", email: "u@t", nom: "U", role: "EMPLOYE" as string, accesStock: false, employeeId: null as string | null },
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));

const { exigerPageRH, exigerPageStock, exigerPageExploitation } = await import("./garde-page");
const { estRH, estStock, estExploitation } = await import("./espaces");

const ROLES: Role[] = ["ADMIN", "MANAGER", "VIEWER", "STOCK", "COMPTA", "EMPLOYE"];
const comptes = ROLES.flatMap((role) => [false, true].map((accesStock) => ({ role, accesStock, employeeId: "emp-1" })));

async function verdict(garde: () => Promise<unknown>): Promise<"ok" | string> {
  try {
    await garde();
    return "ok";
  } catch (e) {
    return String((e as { digest?: string }).digest);
  }
}

describe.each(comptes)("compte %o", (c) => {
  it("RH, Stock, Exploitation : passe si le layout passe, sinon redirection vers /entree", async () => {
    A.user = { ...A.user, ...c };
    const attendu = (ok: boolean) => (ok ? "ok" : "NEXT_REDIRECT;replace;/entree;307;");
    expect(await verdict(exigerPageRH)).toBe(attendu(estRH(c.role)));
    expect(await verdict(exigerPageStock)).toBe(attendu(estStock(c)));
    expect(await verdict(exigerPageExploitation)).toBe(attendu(estExploitation(c)));
  });
});
