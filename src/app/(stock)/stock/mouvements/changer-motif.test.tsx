// @vitest-environment happy-dom
//
// Barre d'actions groupées des sorties : « Changer le motif » envoie les sorties cochées avec le motif
// choisi ; « Perte » exige une raison avant l'envoi ; le résultat s'affiche en clair.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const requalifier = vi.hoisted(() => vi.fn(async (_ids: string[], _motif: string, _raison?: string): Promise<{ n: number } | { erreur: string }> => ({ n: 2 })));
vi.mock("./actions", () => ({ requalifierSorties: requalifier }));

const { ChangerMotif } = await import("./changer-motif");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom n'a pas de `confirm` : on le fournit, accepté par défaut.
const confirmer = vi.fn((_m?: string) => true);
(window as unknown as { confirm: typeof confirmer }).confirm = confirmer;

let conteneur: HTMLDivElement;
let racine: Root;
const fait = vi.fn();
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); requalifier.mockClear(); fait.mockClear(); });
function monter(ids: string[]) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(ChangerMotif, { ids, onFait: fait })));
}
const select = () => conteneur.querySelector<HTMLSelectElement>('select[aria-label="Nouveau motif"]')!;
const bouton = () => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes("Changer le motif"))!;
function choisir(v: string) {
  act(() => { select().value = v; select().dispatchEvent(new Event("change", { bubbles: true })); });
}
function saisirRaison(v: string) {
  const input = conteneur.querySelector<HTMLInputElement>('input[aria-label="Raison de la perte"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("changer le motif des sorties sélectionnées", () => {
  it("Livraison restaurant : envoie les sorties cochées, annonce que le stock ne change pas", async () => {
    monter(["a", "b"]);
    choisir("LIVRAISON_RESTAURANT");
    await act(async () => { bouton().click(); });
    expect(requalifier).toHaveBeenCalledWith(["a", "b"], "LIVRAISON_RESTAURANT", undefined);
    expect(confirmer).toHaveBeenCalledWith(expect.stringContaining("Le stock du dépôt ne change pas"));
    expect(conteneur.textContent).toContain("2 sortie(s) requalifiée(s)");
    expect(fait).toHaveBeenCalledWith(expect.stringContaining("2 sortie(s) requalifiée(s)"));
  });

  it("Perte : la raison est demandée ; sans elle, rien n'est envoyé", async () => {
    monter(["a"]);
    choisir("PERTE");
    expect(bouton().disabled).toBe(true);
    saisirRaison("cassé");
    expect(bouton().disabled).toBe(false);
    await act(async () => { bouton().click(); });
    expect(requalifier).toHaveBeenCalledWith(["a"], "PERTE", "cassé");
  });

  it("plus d'option « Sans motif » (motif obligatoire, 2026-10-07) ; une erreur du serveur s'affiche telle quelle", async () => {
    requalifier.mockResolvedValueOnce({ erreur: "La période 07/2026 est clôturée." });
    monter(["a"]);
    const options = [...conteneur.querySelectorAll<HTMLOptionElement>('select[aria-label="Nouveau motif"] option')].map((o) => o.textContent);
    expect(options).toEqual(["Motif…", "Livraison restaurant", "Perte"]);
    choisir("LIVRAISON_RESTAURANT");
    await act(async () => { bouton().click(); });
    expect(requalifier).toHaveBeenCalledWith(["a"], "LIVRAISON_RESTAURANT", undefined);
    expect(conteneur.textContent).toContain("La période 07/2026 est clôturée.");
    expect(fait).not.toHaveBeenCalled();
  });
});
