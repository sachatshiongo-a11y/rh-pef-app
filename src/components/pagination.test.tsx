// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown; className?: string; "aria-label"?: string; "aria-current"?: string }) => createElement("a", { href: p.href, className: p.className, "aria-label": p["aria-label"], "aria-current": p["aria-current"] }, p.children as never) }));

import { ChampTaillePage, LienGardantTaille, Pagination, usePagination } from "./pagination";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Pagination — mode liens (page serveur)", () => {
  const rendre = (props: Partial<Parameters<typeof Pagination>[0]> = {}) =>
    renderToStaticMarkup(createElement(Pagination, { total: 342, page: 2, par: 50, chemin: "/stock/factures", params: { statut: "A_PAYER", q: "x" }, libelle: "factures", ...props }));

  it("compteur « 51–100 sur 342 », liens qui gardent filtres et recherche", () => {
    const h = rendre();
    expect(h).toContain("51–100 sur 342");
    expect(h).toContain('href="/stock/factures?statut=A_PAYER&amp;q=x"'); // page 1 : paramètres par défaut effacés
    expect(h).toContain('href="/stock/factures?statut=A_PAYER&amp;q=x&amp;page=3"');
    expect(h).toContain('aria-label="Page suivante"');
  });
  it("tailles 50 / 100 / Tout : liens vers la page qui garde la première ligne", () => {
    const h = rendre({ page: 3 }); // première ligne = 101
    expect(h).toContain('href="/stock/factures?statut=A_PAYER&amp;q=x&amp;page=2&amp;par=100"'); // la 101e ligne est en page 2 de 100
    expect(h).toContain("par=tout");
  });
  it("cibles tactiles de 44 px et pas de backdrop-filter", () => {
    const h = rendre();
    expect(h).toContain("min-h-11");
    expect(h).not.toMatch(/backdrop/);
  });
  it("première page : « Précédent » inactif ; dernière : « Suivant » inactif", () => {
    expect(rendre({ page: 1 })).toMatch(/<span aria-disabled="true" aria-label="Page précédente"/);
    expect(rendre({ page: 7 })).toMatch(/<span aria-disabled="true" aria-label="Page suivante"/);
  });
  it("moins d'une page à 50 par page : aucune barre", () => {
    expect(rendre({ total: 30, page: 1 })).toBe("");
  });
  it("« Tout » : plus de numéros, mais le retour à 50 reste possible", () => {
    const h = rendre({ par: "tout", page: 1 });
    expect(h).toContain("1–342 sur 342");
    expect(h).not.toContain("Suivant");
    expect(h).toContain("Par page");
  });
});

describe("usePagination — mode état + URL", () => {
  let racine: ReturnType<typeof createRoot> | null = null;
  afterEach(() => { if (racine) act(() => racine!.unmount()); racine = null; window.history.replaceState(null, "", "/"); });

  function Essai({ total, cle, pageInit = 1, parInit = 50 as const }: { total: number; cle: string; pageInit?: number; parInit?: 50 | 100 | "tout" }) {
    const p = usePagination({ total, pageInit, parInit, cleFiltre: cle });
    return createElement("div", null,
      createElement("span", { id: "etat" }, `${p.page}|${p.de}-${p.a}|${p.nbPages}`),
      createElement("button", { id: "suiv", onClick: () => p.aller(p.page + 1, p.par) }),
      createElement("button", { id: "cent", onClick: () => p.aller(1, 100) }));
  }
  const monter = (el: ReturnType<typeof createElement>) => {
    const c = document.createElement("div"); document.body.appendChild(c);
    racine = createRoot(c); act(() => racine!.render(el)); return c;
  };

  it("page et taille écrites dans l'URL, autres paramètres conservés ; défauts effacés", () => {
    window.history.replaceState(null, "", "/stock/catalogue?q=farine");
    const c = monter(createElement(Essai, { total: 342, cle: "a" }));
    expect(window.location.search).toBe("?q=farine");
    act(() => c.querySelector<HTMLButtonElement>("#suiv")!.click());
    expect(c.querySelector("#etat")!.textContent).toBe("2|51-100|7");
    expect(window.location.search).toBe("?q=farine&page=2");
    act(() => c.querySelector<HTMLButtonElement>("#cent")!.click());
    expect(window.location.search).toBe("?q=farine&par=100");
  });
  it("départ depuis l'URL (page 3) ; un changement de filtre ramène à la page 1", () => {
    window.history.replaceState(null, "", "/x?page=3");
    const c = document.createElement("div"); document.body.appendChild(c);
    racine = createRoot(c);
    act(() => racine!.render(createElement(Essai, { total: 342, cle: "a", pageInit: 3 })));
    expect(c.querySelector("#etat")!.textContent).toBe("3|101-150|7");
    act(() => racine!.render(createElement(Essai, { total: 120, cle: "b", pageInit: 3 })));
    expect(c.querySelector("#etat")!.textContent).toBe("1|1-50|3");
    expect(window.location.search).toBe("");
  });
  it("page hors limites dans l'URL : ramenée à la dernière", () => {
    const c = monter(createElement(Essai, { total: 120, cle: "a", pageInit: 99 }));
    expect(c.querySelector("#etat")!.textContent).toBe("3|101-120|3");
  });
});

describe("la taille de page survit à un changement de filtre", () => {
  afterEach(() => { window.history.replaceState(null, "", "/"); document.body.innerHTML = ""; });
  const monter = (el: ReturnType<typeof createElement>) => {
    const c = document.createElement("div"); document.body.appendChild(c);
    const r = createRoot(c); act(() => r.render(el)); return { c, r };
  };

  it("LienGardantTaille : reprend la taille de l'adresse affichée et supprime la page du lien", () => {
    window.history.replaceState(null, "", "/stock/catalogue?par=100&page=3");
    const { c, r } = monter(createElement(LienGardantTaille, { href: "/stock/catalogue?domaine=BOISSON" }, "Boissons"));
    expect(c.querySelector("a")!.getAttribute("href")).toBe("/stock/catalogue?domaine=BOISSON&par=100");
    act(() => r.unmount());
  });

  it("LienGardantTaille : taille par défaut dans l'adresse = rien à reporter", () => {
    window.history.replaceState(null, "", "/stock/catalogue");
    const { c, r } = monter(createElement(LienGardantTaille, { href: "/stock/catalogue?domaine=AUTRE&par=100" }, "Autre"));
    expect(c.querySelector("a")!.getAttribute("href")).toBe("/stock/catalogue?domaine=AUTRE");
    act(() => r.unmount());
  });

  it("ChampTaillePage : copie la taille affichée dans le formulaire GET ; désactivé (donc absent) à 50", () => {
    window.history.replaceState(null, "", "/stock/reconciliation?par=tout");
    const form = (): HTMLFormElement => document.querySelector("form")!;
    const { r } = monter(createElement("form", { method: "GET" }, createElement("input", { name: "domaine", defaultValue: "AUTRE" }), createElement(ChampTaillePage)));
    expect(new URLSearchParams(new FormData(form()) as unknown as Record<string, string>).toString()).toBe("domaine=AUTRE&par=tout");
    act(() => r.unmount());
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/stock/reconciliation");
    const m2 = monter(createElement("form", { method: "GET" }, createElement("input", { name: "domaine", defaultValue: "AUTRE" }), createElement(ChampTaillePage)));
    expect(new URLSearchParams(new FormData(form()) as unknown as Record<string, string>).toString()).toBe("domaine=AUTRE");
    act(() => m2.r.unmount());
  });
});
