import { describe, it, expect, vi } from "vitest";
import type { Role } from "@prisma/client";

/**
 * Matrice complète rôle × garde : chaque garde de Route Handler donne EXACTEMENT la réponse du
 * layout de son espace (mêmes prédicats), et un refus est un 403 texte — jamais une redirection.
 */
const A = vi.hoisted(() => ({
  user: { id: "u", email: "u@t", nom: "U", role: "EMPLOYE" as string, accesStock: false, employeeId: null as string | null },
  espaceOuvert: true,
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user }));
vi.mock("@/lib/espace-employe", () => ({ espaceEmployeActif: async () => A.espaceOuvert }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { exigerEspaceRH, exigerEspaceStock, exigerEspaceExploitation, exigerEspaceSalarie } = await import("./garde-route");
const { estRH, estStock, estExploitation, estSalarie } = await import("./espaces");

const ROLES: Role[] = ["ADMIN", "MANAGER", "VIEWER", "STOCK", "COMPTA", "EMPLOYE"];
const comptes = ROLES.flatMap((role) =>
  [false, true].flatMap((accesStock) => [null, "emp-1"].map((employeeId) => ({ role, accesStock, employeeId }))),
);

describe.each(comptes)("compte %o", (c) => {
  it("RH, Stock, Exploitation, Salarié : même verdict que le layout", async () => {
    A.user = { ...A.user, ...c };
    A.espaceOuvert = true;
    expect((await exigerEspaceRH()).ok).toBe(estRH(c.role));
    expect((await exigerEspaceStock()).ok).toBe(estStock(c));
    expect((await exigerEspaceExploitation()).ok).toBe(estExploitation(c));
    expect((await exigerEspaceSalarie()).ok).toBe(estSalarie(c));
  });

  it("espace salarié FERMÉ : refus pour tous", async () => {
    A.user = { ...A.user, ...c };
    A.espaceOuvert = false;
    expect((await exigerEspaceSalarie()).ok).toBe(false);
  });
});

describe("forme du refus et restriction de rôles", () => {
  it("un refus est un 403 texte, non mis en cache", async () => {
    A.user = { ...A.user, role: "EMPLOYE", employeeId: "emp-1" };
    const g = await exigerEspaceRH();
    expect(g.ok).toBe(false);
    if (g.ok) return;
    expect(g.reponse.status).toBe(403);
    expect(g.reponse.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(g.reponse.headers.get("Cache-Control")).toBe("no-store");
    expect(g.reponse.headers.get("Location")).toBeNull();
  });

  it("roles: [ADMIN, MANAGER] refuse VIEWER, accepte MANAGER", async () => {
    A.user = { ...A.user, role: "VIEWER" };
    expect((await exigerEspaceRH({ roles: ["ADMIN", "MANAGER"] })).ok).toBe(false);
    A.user = { ...A.user, role: "MANAGER" };
    expect((await exigerEspaceRH({ roles: ["ADMIN", "MANAGER"] })).ok).toBe(true);
  });

  it("le message personnalisé est rendu", async () => {
    A.user = { ...A.user, role: "MANAGER" };
    const g = await exigerEspaceRH({ roles: ["ADMIN"], message: "Direction uniquement." });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(await g.reponse.text()).toBe("Direction uniquement.");
  });

  it("la garde salarié garantit l'employeeId de la SESSION", async () => {
    A.user = { ...A.user, role: "STOCK", employeeId: "emp-42" };
    A.espaceOuvert = true;
    const g = await exigerEspaceSalarie();
    expect(g.ok && g.user.employeeId).toBe("emp-42");
  });
});
