// @vitest-environment happy-dom
//
// Aperçus d'import — pagination (2026-10-08) : 50 / 100 / Tout, la sélection et les totaux portent sur
// TOUTES les lignes (pas sur la page), « Tout sélectionner » = la page, un lien propose tout le filtre.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIGNES = Array.from({ length: 120 }, (_, i) => ({
  ligne: i + 2, date: "2026-09-10", codeCsv: String(i + 1), designationCsv: `Art ${i + 1}`, entree: 1, sortie: 0,
  articleId: i === 119 ? null : `a${i}`, articleNom: i === 119 ? null : `Article ${i + 1}`, rapprochement: i === 119 ? "inconnu" : "code",
  entreeDejaPresente: false, sortieDejaPresente: false,
}));
const PAIRES = Array.from({ length: 120 }, (_, i) => {
  const m = (id: string, lib: string) => ({ id, articleId: `a${i}`, article: `Article ${i}`, date: "2026-09-10", type: "ENTREE", quantite: 1, batchId: lib, libelle: lib });
  return { retire: m(`r${i}`, "Inventaire"), garde: m(`g${i}`, "Mouvements") };
});
const appliquerMouvementsAction = vi.fn(async (..._a: unknown[]) => ({ resume: { rapprochees: 0, articles: 0, entreesQte: 0, sortiesQte: 0, dejaPresents: 0 } }));
const retirerDoublonsAction = vi.fn(async (..._a: unknown[]) => ({ message: "ok" }));
vi.mock("./actions", () => ({
  analyserMouvementsAction: vi.fn(async () => ({ lignes: LIGNES, resume: { total: 120, rapprochees: 119, inconnues: 1, entreesQte: 119, sortiesQte: 0, articles: 119, sansDate: 0, dejaPresents: 0 }, erreurs: [] })),
  appliquerMouvementsAction: (...a: unknown[]) => appliquerMouvementsAction(...a),
  detecterDoublonsAction: vi.fn(async () => ({
    inventaire: { id: "inv", libelle: "Inventaire", type: "INVENTAIRE", creeLe: "", jour: "" }, mouvements: [{ id: "mv", libelle: "Mouvements", type: "MOUVEMENTS", creeLe: "", jour: "" }],
    paires: PAIRES, sansJumeauInventaire: [], sansJumeauMouvements: [], controle: { verifies: 1, ecarts: [] },
  })),
  retirerDoublonsAction: (...a: unknown[]) => retirerDoublonsAction(...a),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement2(p) }));
function createElement2(p: { href: string; children: unknown }) { return h("a", { href: p.href }, p.children as never); }

const { ImportMouvementsClient } = await import("./import-mouvements-client");
const { DoublonsClient } = await import("./doublons-client");

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => { appliquerMouvementsAction.mockClear(); retirerDoublonsAction.mockClear(); window.history.replaceState(null, "", "/stock/imports"); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(el: ReturnType<typeof h>) {
  conteneur = document.createElement("div"); document.body.appendChild(conteneur);
  racine = createRoot(conteneur); act(() => racine.render(el));
}
const clic = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const parLabel = (txt: string) => [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(txt))!;
const compteur = () => conteneur.querySelector("[data-pagination-compteur]")?.textContent ?? "";
const bouton = (label: string) => conteneur.querySelector<HTMLButtonElement>(`nav[data-pagination] button[aria-label="${label}"]`)!;

describe("aperçu de l'import de mouvements (CSV)", () => {
  async function analyser() {
    monter(h(ImportMouvementsClient));
    await act(async () => { parLabel("Analyser").click(); });
  }
  const lignes = () => conteneur.querySelectorAll("tbody tr input[type=checkbox]").length;

  it("50 lignes par page sur 120, compteur, page 2 ; l'URL n'est PAS touchée (aperçu éphémère)", async () => {
    await analyser();
    expect(lignes()).toBe(50);
    expect(compteur()).toContain("1–50 sur 120");
    clic(bouton("Page suivante"));
    expect(compteur()).toContain("51–100 sur 120");
    expect(window.location.search).toBe("");
    clic(bouton("Afficher tout"));
    expect(lignes()).toBe(120);
  });

  it("la sélection porte sur TOUTES les pages : 119 à importer, envoyées en un coup", async () => {
    await analyser();
    expect(conteneur.textContent).toContain("119 à importer (toutes pages)");
    await act(async () => { parLabel("Importer la sélection").click(); });
    const fd = appliquerMouvementsAction.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(fd.get("lignes")))).toHaveLength(119);
  });

  it("la case d'en-tête décoche la page seule (50 lignes), pas les autres pages", async () => {
    await analyser();
    const entete = conteneur.querySelector<HTMLInputElement>("thead input[type=checkbox]")!;
    act(() => { entete.click(); });
    expect(conteneur.textContent).toContain("69 à importer (toutes pages)"); // 119 - 50
    clic(bouton("Page suivante"));
    expect(conteneur.querySelector<HTMLInputElement>("thead input[type=checkbox]")!.checked).toBe(true);
  });

  it("« Tout décocher » / « Tout cocher » visent tout le filtre et le disent (119)", async () => {
    await analyser();
    expect(parLabel("Tout décocher").textContent).toBe("Tout décocher (119)");
    clic(parLabel("Tout décocher"));
    expect(conteneur.textContent).toContain("0 à importer");
    clic(parLabel("Tout cocher"));
    expect(conteneur.textContent).toContain("119 à importer");
  });
});

describe("doublons : paires jumelles", () => {
  async function chercher() {
    monter(h(DoublonsClient, {
      inventaires: [{ id: "inv", libelle: "Inventaire", type: "INVENTAIRE", creeLe: "", jour: "" }],
      mouvements: [{ id: "mv", libelle: "Mouvements", type: "MOUVEMENTS", creeLe: "", jour: "" }],
      defaut: { inventaireId: "inv", mouvementsIds: ["mv"] },
    }));
    await act(async () => { parLabel("Rechercher les doublons").click(); });
  }
  const cases = () => conteneur.querySelectorAll("ul.divide-y li input[type=checkbox]").length;
  const caseTout = () => conteneur.querySelector<HTMLInputElement>(".sticky input[type=checkbox]")!; // case de la barre d'actions groupées

  it("50 paires par page ; « Tout sélectionner » coche la page puis propose les 120 paires", async () => {
    await chercher();
    expect(cases()).toBe(50);
    expect(compteur()).toContain("1–50 sur 120");
    act(() => { caseTout().click(); });
    expect(conteneur.textContent).toContain("50 sélectionné(s)");
    const proposer = conteneur.querySelector<HTMLButtonElement>('[data-tout-le-filtre="proposer"]')!;
    expect(proposer.textContent).toBe("Sélectionner les 120 paires");
    clic(proposer);
    expect(conteneur.textContent).toContain("120 sélectionné(s)");
    expect(conteneur.querySelector('[data-tout-le-filtre="proposer"]')).toBeNull();
  });

  it("le retrait envoie les identifiants de toutes les pages sélectionnées", async () => {
    await chercher();
    act(() => { caseTout().click(); });
    clic(conteneur.querySelector('[data-tout-le-filtre="proposer"]')!);
    vi.stubGlobal("confirm", () => true);
    await act(async () => { parLabel("✕ Retirer 120").click(); });
    expect(retirerDoublonsAction).toHaveBeenCalledTimes(1);
    expect((retirerDoublonsAction.mock.calls[0][2] as string[])).toHaveLength(120);
    vi.unstubAllGlobals();
  });

  it("la sélection d'une page puis d'une autre s'additionne (100), décocher la page 2 la retire", async () => {
    await chercher();
    act(() => { caseTout().click(); });
    clic(bouton("Page suivante"));
    act(() => { caseTout().click(); });
    expect(conteneur.textContent).toContain("100 sélectionné(s)");
    act(() => { caseTout().click(); });
    expect(conteneur.textContent).toContain("50 sélectionné(s)");
  });
});

describe("listes des aperçus (articles sans correspondance, lignes lues…)", () => {
  it("ne s'arrêtent plus en silence à 50 : paginées, la dernière ligne reste atteignable", async () => {
    const { ListePaginee } = await import("@/components/liste-paginee");
    const items = Array.from({ length: 120 }, (_, i) => `Ligne ${i + 1}`);
    monter(h(ListePaginee<string>, { items, libelle: "lignes", ligne: (t: string) => h("li", { key: t }, t) }));
    expect(conteneur.querySelectorAll("li")).toHaveLength(50);
    clic(bouton("Page suivante"));
    clic(bouton("Page suivante"));
    const li = [...conteneur.querySelectorAll("li")].map((e) => e.textContent);
    expect(li).toHaveLength(20);
    expect(li[19]).toBe("Ligne 120");
    expect(window.location.search).toBe("");
  });
});
