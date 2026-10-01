// @vitest-environment happy-dom
//
// Liste des bons de commande (écran Commandes ET onglet Bons de la fiche fournisseur) : après une
// action groupée réussie, l'écran est actualisé — la fiche d'un fournisseur n'est pas revalidée par
// `validerBonsEnLot` / `supprimerBonsEnLot`, sans cela les bons traités resteraient affichés.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const appels = vi.hoisted(() => ({
  validerBonsEnLot: vi.fn<(ids: string[]) => Promise<unknown>>(async () => ({})),
  supprimerBonsEnLot: vi.fn<(ids: string[]) => Promise<unknown>>(async () => ({})),
}));
vi.mock("./actions", () => appels);
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh }) }));

const { CommandesListe } = await import("./commandes-liste");
type Props = Parameters<typeof CommandesListe>[0];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bon = (id: string, statut: string) => ({ id, numero: `BC-${id}`, fournisseurId: "f1", fournisseurNom: "SENEVE", date: "2026-09-05T00:00:00.000Z", nbLignes: 2, total: 10, statut, documentUrl: null });
const COMMANDES = [bon("a", "BROUILLON"), bon("b", "VALIDE")];

let conteneur: HTMLDivElement;
let racine: Root;
const rendre = (props: Props) => act(() => racine.render(createElement(CommandesListe, props)));
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent!.includes(texte))!;

beforeEach(() => {
  for (const f of Object.values(appels)) f.mockClear();
  refresh.mockClear();
  vi.stubGlobal("confirm", () => true);
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => racine.unmount());
  conteneur.remove();
});

describe("actions groupées sur les bons", () => {
  it("après « Valider » réussi, l'écran est actualisé", async () => {
    rendre({ commandes: COMMANDES, estDirection: true, sansFournisseur: true });
    act(() => (conteneur.querySelector('label input[type="checkbox"]') as HTMLElement).click());
    await act(async () => { bouton("Valider").click(); });
    expect(appels.validerBonsEnLot).toHaveBeenCalledWith(["a"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("après « Supprimer » réussi, l'écran est actualisé", async () => {
    rendre({ commandes: COMMANDES, estDirection: true });
    act(() => (conteneur.querySelector('label input[type="checkbox"]') as HTMLElement).click());
    await act(async () => { bouton("Supprimer").click(); });
    expect(appels.supprimerBonsEnLot).toHaveBeenCalledWith(["a", "b"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("une action refusée affiche l'erreur et n'actualise pas", async () => {
    appels.supprimerBonsEnLot.mockResolvedValueOnce({ erreur: "Refusé." });
    rendre({ commandes: COMMANDES, estDirection: true });
    act(() => (conteneur.querySelector('label input[type="checkbox"]') as HTMLElement).click());
    await act(async () => { bouton("Supprimer").click(); });
    expect(conteneur.textContent).toContain("Refusé.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
