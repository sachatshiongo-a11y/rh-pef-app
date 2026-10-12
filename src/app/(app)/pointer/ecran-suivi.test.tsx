import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Le suivi des pointages, tel que « Pointages » l'affiche : titre, bouton « Pointer moi-même », navigation entre
// les jours sur /pointer (plus sur /pointer/suivi). Les lectures sont simulées : on regarde le dessin.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    employee: { findMany: async () => [] },
    pointage: { findMany: async () => [] },
    attendance: { findMany: async () => [] },
  },
}));
vi.mock("@/lib/pointage-suivi", () => ({ resumeSemaineCourante: async () => ({ total: 0, horsRestaurant: 0, pourcent: 0 }) }));
vi.mock("@/lib/conges-couverture", () => ({ joursEnConge: async () => new Set(), joursDeReposSelonModele: async () => new Set() }));
vi.mock("./suivi/suivi-bulk", () => ({ SuiviBulk: () => createElement("div", null, "LISTE") }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => createElement("a", { href, ...rest }, children),
}));

const { EcranSuivi } = await import("./ecran-suivi");

describe("EcranSuivi — le contenu de « Pointages »", () => {
  it("titre « Pointages » (le libellé du menu) et bouton « Pointer moi-même » vers ?moi=1", async () => {
    const html = renderToStaticMarkup(await EcranSuivi({ date: "2026-10-09" }));
    expect(html).toMatch(/<h1[^>]*>Pointages<\/h1>/);
    expect(html).toMatch(/<a href="\/pointer\?moi=1"[^>]*>Pointer moi-même<\/a>/);
  });

  it("la navigation entre les jours reste sur /pointer", async () => {
    const html = renderToStaticMarkup(await EcranSuivi({ date: "2026-10-09" }));
    expect(html).toContain('href="/pointer?date=2026-10-08"');
    expect(html).toContain('href="/pointer?date=2026-10-10"');
    expect(html).not.toContain("/pointer/suivi");
  });
});
