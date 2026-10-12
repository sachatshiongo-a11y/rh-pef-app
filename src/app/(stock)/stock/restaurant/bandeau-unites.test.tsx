// @vitest-environment happy-dom
//
// Bandeau « N article(s) dont l'unité diffère de l'Inventaire » : les écarts sont listés (alignable avec son
// facteur, non convertible avec sa raison), l'alignement montre d'abord son effet, la Direction confirme ;
// un autre compte envoie une demande.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({ alignerUnitesResto: vi.fn<(...a: unknown[]) => Promise<unknown>>() }));
vi.mock("./actions", () => ({ alignerUnitesResto: m.alignerUnitesResto }));
const { BandeauUnites } = await import("./bandeau-unites");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let conteneur: HTMLDivElement; let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); m.alignerUnitesResto.mockReset(); });
const ECARTS = [
  { id: "a", designation: "Sonde", espace: "CUISINE" as const, uniteResto: "kg", uniteInventaire: "g", facteur: "×1 000", raison: null, nbComptages: 12 },
  { id: "b", designation: "Lait", espace: "CUISINE" as const, uniteResto: "kg", uniteInventaire: "L", facteur: null, raison: "aucun facteur entre kg et L", nbComptages: 3 },
];
function monter(estDirection: boolean, ecarts = ECARTS) {
  conteneur = document.createElement("div"); document.body.appendChild(conteneur); racine = createRoot(conteneur);
  act(() => racine.render(createElement(BandeauUnites, { ecarts, estDirection })));
}
const bouton = (t: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(t))!;

describe("bandeau des unités à aligner", () => {
  it("rien à signaler : rien n'est affiché", () => {
    monter(true, []);
    expect(conteneur.innerHTML).toBe("");
  });

  it("liste les écarts : alignable (unités et facteur) et non convertible (raison, sans case à cocher)", () => {
    monter(true);
    expect(conteneur.textContent).toContain("2 articles dont l'unité diffère de l'Inventaire");
    const sonde = conteneur.querySelector('[data-ecart-unite="a"]')!;
    expect(sonde.textContent).toContain("kg → g");
    expect(sonde.textContent).toContain("×1 000");
    expect(sonde.querySelector("input")).not.toBeNull();
    const lait = conteneur.querySelector('[data-ecart-unite="b"]')!;
    expect(lait.textContent).toContain("non convertible : aucun facteur entre kg et L");
    expect(lait.querySelector("input")).toBeNull();
    expect(bouton("Aligner sur l'Inventaire (1)")).toBeTruthy();
  });

  it("Direction : la 1re passe montre l'effet (rien d'écrit), « Confirmer » aligne", async () => {
    m.alignerUnitesResto.mockResolvedValueOnce({ ok: false, aConfirmer: true, message: "« Sonde » : kg → g (×1 000) — 12 comptage(s) convertis (dernier : 4,5 kg → 4 500 g). Aligner maintenant ?" });
    monter(true);
    await act(async () => { bouton("Aligner sur l'Inventaire (1)").click(); });
    expect(m.alignerUnitesResto).toHaveBeenLastCalledWith(["a"], false);
    expect(conteneur.querySelector('[role="alertdialog"]')!.textContent).toContain("4,5 kg → 4 500 g");
    m.alignerUnitesResto.mockResolvedValueOnce({ ok: true, modifies: 1 });
    await act(async () => { bouton("Confirmer").click(); });
    expect(m.alignerUnitesResto).toHaveBeenLastCalledWith(["a"], true);
    expect(conteneur.querySelector('[role="status"]')!.textContent).toContain("Unité alignée sur l'Inventaire");
  });

  it("autre compte : le bouton dit « Demander… » et la réponse annonce la demande envoyée", async () => {
    m.alignerUnitesResto.mockResolvedValueOnce({ ok: false, aConfirmer: true, message: "effet. Envoyer la demande à la Direction ?" });
    monter(false);
    await act(async () => { bouton("Demander l'alignement sur l'Inventaire (1)").click(); });
    m.alignerUnitesResto.mockResolvedValueOnce({ ok: true, modifies: 0, enAttente: 1 });
    await act(async () => { bouton("Confirmer").click(); });
    expect(conteneur.querySelector('[role="status"]')!.textContent).toContain("Demande envoyée à la Direction");
  });

  it("un refus du serveur (non convertible, trop de décimales) est dit en alerte, rien d'autre ne change", async () => {
    m.alignerUnitesResto.mockResolvedValueOnce({ erreur: "« Sonde » : 2 valeur(s) ne tiennent pas en 3 décimales — rien n'a été écrit." });
    monter(true);
    await act(async () => { bouton("Aligner sur l'Inventaire (1)").click(); });
    expect(conteneur.querySelector('[role="alert"]')!.textContent).toContain("ne tiennent pas en 3 décimales");
    expect(conteneur.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
