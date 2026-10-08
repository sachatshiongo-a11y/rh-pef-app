// @vitest-environment happy-dom
//
// Bons de commande — pagination (2026-10-08) : 50 / 100 / Tout. Tous les bons du filtre sont chargés : les mois
// gardent compteur et total sur TOUT le filtre, la sélection suit la page, un lien prend tout le filtre, et les
// actions groupées reçoivent les identifiants choisis.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const appels = vi.hoisted(() => ({
  validerBonsEnLot: vi.fn<(ids: string[]) => Promise<unknown>>(async () => ({})),
  supprimerBonsEnLot: vi.fn<(ids: string[]) => Promise<unknown>>(async () => ({})),
}));
vi.mock("./actions", () => appels);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const { CommandesListe } = await import("./commandes-liste");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 120 bons BROUILLON, 60 en septembre puis 60 en août (10 $ chacun) ; le n° 1 est le plus récent.
const COMMANDES = Array.from({ length: 120 }, (_, i) => ({
  id: `b${String(i + 1).padStart(3, "0")}`, numero: `BC-${i + 1}`, fournisseurId: "f1", fournisseurNom: "SENEVE",
  date: i < 60 ? "2026-09-05T00:00:00.000Z" : "2026-08-05T00:00:00.000Z", nbLignes: 2, total: 10, statut: "BROUILLON", documentUrl: null,
}));

let conteneur: HTMLDivElement;
let racine: Root;
function monter(props: Partial<Parameters<typeof CommandesListe>[0]> = {}) {
  conteneur = document.createElement("div"); document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(CommandesListe, { commandes: COMMANDES, estDirection: true, paginer: true, ...props })));
}
beforeEach(() => { for (const f of Object.values(appels)) f.mockClear(); window.history.replaceState(null, "", "/stock/commandes"); vi.stubGlobal("confirm", () => true); });
afterEach(() => { vi.unstubAllGlobals(); act(() => racine.unmount()); conteneur.remove(); });

const clic = (el: Element) => act(() => (el as HTMLElement).click());
const lignes = () => conteneur.querySelectorAll("li input[type=checkbox]").length;
const bouton = (label: string) => conteneur.querySelector<HTMLButtonElement>(`nav[data-pagination] button[aria-label="${label}"]`)!;
const texte = () => conteneur.textContent ?? "";

describe("Bons de commande paginés", () => {
  it("page 1 : 50 bons, compteur ; mois coupé : compteur du mois entier + « affiché(s) »", () => {
    monter();
    expect(lignes()).toBe(50);
    expect(texte()).toContain("1–50 sur 120");
    expect(texte()).toContain("Septembre 2026 · 60 bon(s) · 50 affiché(s)");
    expect(texte()).not.toContain("Août 2026");
    expect(texte()).toMatch(/600,00/); // total du mois entier (60 × 10 $), pas des 50 lignes
  });

  it("page 3 (101–120) dans l'URL ; Tout : 120 lignes, plus de mention", () => {
    monter({ pageInit: 3 });
    expect(lignes()).toBe(20);
    expect(texte()).toContain("Août 2026 · 60 bon(s) · 20 affiché(s)");
    clic(bouton("Afficher tout"));
    expect(lignes()).toBe(120);
    expect(texte()).not.toContain("affiché(s)");
    expect(window.location.search).toBe("?par=tout");
  });

  it("« Tout sélectionner » = la page ; le lien = les 120 ; Valider reçoit les 120 brouillons", async () => {
    monter();
    clic(conteneur.querySelector('label input[type="checkbox"]')!);
    expect(texte()).toContain("50 sélectionné(s)");
    clic(conteneur.querySelector('[data-tout-le-filtre="proposer"]')!);
    expect(texte()).toContain("120 sélectionné(s)");
    await act(async () => { [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes("Valider"))!.click(); });
    expect(appels.validerBonsEnLot.mock.calls[0][0]).toHaveLength(120);
  });

  it("la sélection d'une page seule n'envoie que la page", async () => {
    monter();
    clic(conteneur.querySelector('label input[type="checkbox"]')!);
    await act(async () => { [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes("Supprimer"))!.click(); });
    expect(appels.supprimerBonsEnLot.mock.calls[0][0]).toHaveLength(50);
  });

  it("sans `paginer` (fiche fournisseur) : tout s'affiche", () => {
    monter({ paginer: false, sansFournisseur: true });
    expect(lignes()).toBe(120);
    expect(conteneur.querySelector("nav[data-pagination]")).toBeNull();
  });
});
