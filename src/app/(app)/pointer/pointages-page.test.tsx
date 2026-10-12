import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// L'écran « Pointages » (menu RH, lot 4) : la Direction et la RH y lisent le SUIVI ; leur pointage personnel est
// un bouton (?moi=1) ; un compte en consultation n'a pas le suivi et garde son pointage personnel.
const A = vi.hoisted(() => ({ user: { id: "u1", email: "a@b.cd", nom: "Test", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), verifySession: async () => A.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: async () => ({ employeeId: "e1" }) } } }));
vi.mock("@/lib/espace-employe", () => ({ espaceEmployeActif: async () => true }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("./ecran-suivi", () => ({ EcranSuivi: ({ date }: { date?: string }) => createElement("div", null, `SUIVI-DE-LA-BRIGADE${date ? ` ${date}` : ""}`) }));
vi.mock("./pointage-du-jour", () => ({
  chargerPointageDuJour: async () => ({ nom: "Awa", photoUrl: null, dateLabel: "lundi 12 octobre", pointage: null, departScanne: null }),
}));
vi.mock("./pointer-client", () => ({ PointerClient: () => createElement("div", null, "MON-POINTAGE") }));

const { default: PointagesPage } = await import("./page");

const rendre = async (role: string, sp: { moi?: string; date?: string } = {}) => {
  A.user.role = role;
  return renderToStaticMarkup(await PointagesPage({ searchParams: Promise.resolve(sp) }));
};

beforeEach(() => { A.user.role = "ADMIN"; });

describe("Pointages — qui voit quoi", () => {
  for (const role of ["ADMIN", "MANAGER"]) {
    it(`${role} : le suivi de la brigade, à la date demandée`, async () => {
      expect(await rendre(role)).toContain("SUIVI-DE-LA-BRIGADE");
      expect(await rendre(role, { date: "2026-10-09" })).toContain("SUIVI-DE-LA-BRIGADE 2026-10-09");
      expect(await rendre(role)).not.toContain("MON-POINTAGE");
    });

    it(`${role} : « Pointer moi-même » (?moi=1) ouvre son pointage, avec le retour vers le suivi`, async () => {
      const html = await rendre(role, { moi: "1" });
      expect(html).toContain("MON-POINTAGE");
      expect(html).toContain("<h1");
      expect(html).toContain("Pointages");
      expect(html).toContain('href="/pointer"');
      expect(html).not.toContain("SUIVI-DE-LA-BRIGADE");
    });
  }

  it("VIEWER (consultation) : son pointage personnel, jamais le suivi — même avec ?moi=0 ou ?date", async () => {
    for (const sp of [{}, { moi: "0" }, { date: "2026-10-09" }]) {
      const html = await rendre("VIEWER", sp);
      expect(html).toContain("MON-POINTAGE");
      expect(html).not.toContain("SUIVI-DE-LA-BRIGADE");
      expect(html).not.toContain("Suivi de la brigade"); // pas de lien vers un écran qu'il n'a pas
    }
  });

  it("un compte qui n'est pas de l'espace RH est renvoyé (garde de page)", async () => {
    await expect(rendre("EMPLOYE")).rejects.toThrow("REDIRECT /entree");
  });
});
