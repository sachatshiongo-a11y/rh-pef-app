// @vitest-environment happy-dom
//
// Fusion de deux fournisseurs : chacun se trouve en TAPANT son nom (la liste de fournisseurs est
// longue) ; le fournisseur déjà choisi d'un côté n'est pas proposé de l'autre (on ne fusionne pas
// un fournisseur avec lui-même) ; l'appel est celui d'avant.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { champChoix, choisirEnTapant, libellesOuverts, ouvrirChoix } from "@/lib/test/choix-recherche";

const appels = vi.hoisted(() => ({ fusionner: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({})), creer: vi.fn() }));
vi.mock("./actions", () => ({ creerFournisseur: appels.creer, fusionnerFournisseurs: appels.fusionner }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: unknown }) => createElement("a", { href, ...p }, children as never) }));

const { FournisseursClient } = await import("./fournisseurs-client");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const F = (id: string, nom: string, plus: Partial<{ telephone: string; ville: string; nbArticles: number }> = {}) =>
  ({ id, nom, contactNom: "", telephone: "", ville: "", rccm: "", idNational: "", delaiPaiement: "", delaiLivraison: "", nbArticles: 0, ...plus });
const FOURNISSEURS = [F("f1", "Marché central", { ville: "Kinshasa", nbArticles: 12 }), F("f2", "Grossiste Nord", { telephone: "+243 81 000 00 00", nbArticles: 1 }), F("f3", "Marché de la Liberté")];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { vi.unstubAllGlobals(); act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; appels.fusionner.mockClear(); });

async function ouvrirFusion() {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(FournisseursClient, { fournisseurs: FOURNISSEURS, estDirection: true })));
  await act(async () => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes("Fusionner"))!.click());
}

describe("fusion de fournisseurs — choisir en tapant", () => {
  it("chaque côté se choisit en tapant ; le fournisseur de l'autre côté n'est pas proposé", async () => {
    await ouvrirFusion();
    const source = champChoix(conteneur, "Fournisseur à fusionner (supprimé)");
    const cible = champChoix(conteneur, "Fournisseur à conserver");
    await choisirEnTapant(source, "liberte");
    expect(source.value).toBe("Marché de la Liberté");
    await ouvrirChoix(cible);
    expect(libellesOuverts()).not.toContain("Marché de la Liberté");
    expect(libellesOuverts()).toEqual(["— choisir —", "Grossiste Nord", "Marché central"]);
  });

  it("« Fusionner » envoie les deux ids (source puis cible) après confirmation", async () => {
    await ouvrirFusion();
    vi.stubGlobal("confirm", () => true);
    await choisirEnTapant(champChoix(conteneur, "Fournisseur à fusionner (supprimé)"), "nord");
    await choisirEnTapant(champChoix(conteneur, "Fournisseur à conserver"), "marche central");
    await act(async () => [...conteneur.querySelectorAll("button")].filter((b) => b.textContent === "Fusionner")[0]!.click());
    expect(appels.fusionner).toHaveBeenCalledWith("f2", "f1");
  });

  it("chaque option porte de quoi distinguer deux noms proches : ville, téléphone, nombre d'articles (ce qui existe)", async () => {
    await ouvrirFusion();
    await ouvrirChoix(champChoix(conteneur, "Fournisseur à conserver"));
    const details = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => [o.dataset.choixId, o.children[1]?.textContent ?? null]);
    expect(details).toEqual([["", null], ["f2", "+243 81 000 00 00 · 1 article"], ["f1", "Kinshasa · 12 articles"], ["f3", null]]);
  });
});
