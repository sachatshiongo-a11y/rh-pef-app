// @vitest-environment happy-dom
//
// Fournisseurs : cases à cocher par ligne, barre d'actions groupées (export, fusion des 2 cochés, suppression
// Direction) et pagination 50 / 100 / Tout (audit du 10/10/2026, ergonomie 7).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { champChoix } from "@/lib/test/choix-recherche";

const m = vi.hoisted(() => ({
  supprimerLot: vi.fn<(ids: string[]) => Promise<unknown>>(async (ids) => ({ traitees: ids.length, echecs: [] })),
}));
vi.mock("./actions", () => ({ creerFournisseur: vi.fn(), fusionnerFournisseurs: vi.fn(), supprimerFournisseursEnLot: m.supprimerLot }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: unknown }) => createElement("a", { href, ...p }, children as never) }));

const { FournisseursClient } = await import("./fournisseurs-client");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const F = (id: string, nom: string) => ({ id, nom, contactNom: "", telephone: "", ville: "", rccm: "", idNational: "", delaiPaiement: "", delaiLivraison: "", nbArticles: 0 });
let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; vi.clearAllMocks(); vi.unstubAllGlobals(); });
function monter(fournisseurs: ReturnType<typeof F>[], estDirection = true) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(FournisseursClient, { fournisseurs, estDirection })));
}
const cases = () => [...conteneur.querySelectorAll<HTMLInputElement>('.divide-y input[type="checkbox"]')];
const barre = () => conteneur.querySelector<HTMLElement>(".sticky")!;
const bouton = (re: RegExp) => [...barre().querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""))!;
const PETITE = [F("f1", "Marché central"), F("f2", "Grossiste Nord"), F("f3", "Marché de la Liberté")];

describe("Fournisseurs — actions groupées", () => {
  it("une case par fournisseur ; le nom reste un lien vers la fiche", () => {
    monter(PETITE);
    expect(cases().map((c) => c.getAttribute("aria-label"))).toEqual(["Sélectionner Grossiste Nord", "Sélectionner Marché central", "Sélectionner Marché de la Liberté"]);
    expect([...conteneur.querySelectorAll(".divide-y a")].map((a) => a.getAttribute("href"))).toEqual(["/stock/fournisseurs/f2", "/stock/fournisseurs/f1", "/stock/fournisseurs/f3"]);
  });

  it("export de la sélection : lien ?ids= des cochés", () => {
    monter(PETITE);
    act(() => cases()[0].click());
    act(() => cases()[2].click());
    expect(barre().querySelector("a")!.getAttribute("href")).toBe("/stock/fournisseurs/export?ids=f2,f3");
  });

  it("deux cochés : « Fusionner les 2 » ouvre la fusion avec les deux déjà choisis", async () => {
    monter(PETITE);
    act(() => cases()[0].click());
    act(() => cases()[1].click());
    await act(async () => bouton(/Fusionner les 2/).click());
    expect(champChoix(conteneur, "Fournisseur à fusionner (supprimé)").value).toBe("Grossiste Nord");
    expect(champChoix(conteneur, "Fournisseur à conserver").value).toBe("Marché central");
  });

  it("supprimer la sélection : confirmation, puis une requête pour le lot et le bilan", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    monter(PETITE);
    act(() => cases()[0].click());
    act(() => cases()[1].click());
    await act(async () => bouton(/Supprimer \(2\)/).click());
    expect(m.supprimerLot).toHaveBeenCalledWith(["f2", "f1"]);
    expect(conteneur.querySelector('[role="status"]')?.textContent).toBe("2 fournisseur(s) supprimé(s).");
  });

  it("un fournisseur refusé (achats directs) est nommé dans le bilan", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    m.supprimerLot.mockResolvedValueOnce({ traitees: 1, echecs: ["Marché central : Suppression impossible : 3 achat(s) direct(s)…"] });
    monter(PETITE);
    act(() => cases()[0].click());
    act(() => cases()[1].click());
    await act(async () => bouton(/Supprimer \(2\)/).click());
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toContain("1 fournisseur(s) supprimé(s), 1 refusé(s) — Marché central : Suppression impossible");
  });

  it("confirmation refusée : rien n'est supprimé", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    monter(PETITE);
    act(() => cases()[0].click());
    await act(async () => bouton(/Supprimer \(1\)/).click());
    expect(m.supprimerLot).not.toHaveBeenCalled();
  });

  it("hors Direction : cases et export, mais ni suppression ni fusion", () => {
    monter(PETITE, false);
    act(() => cases()[0].click());
    act(() => cases()[1].click());
    expect([...barre().querySelectorAll("button")].some((b) => /Supprimer|Fusionner/.test(b.textContent ?? ""))).toBe(false);
    expect(barre().querySelector("a")).not.toBeNull();
  });
});

describe("Fournisseurs — pagination", () => {
  const BEAUCOUP = Array.from({ length: 120 }, (_, i) => F(`f${i}`, `Fournisseur ${String(i).padStart(3, "0")}`));
  it("50 par page par défaut ; la barre partagée annonce le total ; « Tout sélectionner » agit sur la page", () => {
    monter(BEAUCOUP);
    expect(cases()).toHaveLength(50);
    expect(conteneur.querySelector("[data-pagination-compteur]")!.textContent).toContain("1–50 sur 120");
    act(() => barre().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(barre().textContent).toContain("50 sélectionné(s)");
    expect(barre().textContent).toContain("Sélectionner les 120 fournisseurs");
  });
  it("la recherche porte sur les 120, pas sur la page", () => {
    monter(BEAUCOUP);
    const q = conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(q, "Fournisseur 119");
    act(() => { q.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(cases()).toHaveLength(1);
  });
});
