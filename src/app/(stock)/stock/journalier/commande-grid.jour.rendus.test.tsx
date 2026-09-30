// @vitest-environment happy-dom
//
// Commande sur téléphone (demande de la Direction, 2026-09-30) : la liste d'UN jour, alimentée par les
// mêmes lignes que la grille de la semaine, et qui écrit par la MÊME action, avec les MÊMES arguments.
// Les deux vues sont dans le DOM (le choix est CSS : liste du jour sous `lg`, tableau dès `lg`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({
  saisirCommandeResto: vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  saisirCommandeLegume: vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  rafraichirJournalier: vi.fn(async () => {}),
}));
vi.mock("./actions", () => m);

import { CommandeGrid, type CmdArticle } from "./commande-grid";
import { JourMobileProvider } from "@/components/jour-mobile";
import { SelecteurJour, BasculeVueSemaine } from "@/components/selecteur-jour";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ISOS = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
const JOURS = ISOS.map((iso, i) => ({ iso, label: `${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"][i]} ${Number(iso.slice(8))}` }));
const ARTICLES: CmdArticle[] = [
  { id: "riz", designation: "Riz parfumé", categorie: "Épicerie" },
  { id: "sucre", designation: "Sucre", categorie: "Épicerie" },
  { id: "lait", designation: "Lait", categorie: "Produits laitiers" },
  { id: "legume:Oignons", designation: "Oignons (kg)", categorie: "Légumes frais" },
];
const COMMANDES = { "riz_2026-09-30": 4, "riz_2026-09-29": 9, "lait_2026-09-30": 2 };

let conteneur: HTMLDivElement;
let racine: Root;
function monter(defaultIdx = 2, extra: Partial<Parameters<typeof CommandeGrid>[0]> = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(
    <JourMobileProvider defaultIdx={defaultIdx}>
      <SelecteurJour jours={JOURS} aujourdhui="2026-09-30" />
      <BasculeVueSemaine />
      <CommandeGrid articles={ARTICLES} jours={JOURS} commandes={COMMANDES} peutModifier {...extra} />
    </JourMobileProvider>,
  ));
}
beforeEach(() => { m.saisirCommandeResto.mockClear(); m.saisirCommandeLegume.mockClear(); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const liste = () => conteneur.querySelector<HTMLElement>('[data-vue="jour"] [data-vue-liste="commande"]')!;
const casesJour = () => [...liste().querySelectorAll<HTMLInputElement>("input")];
const caseJour = (libelle: string) => casesJour().find((i) => i.getAttribute("aria-label") === libelle)!;
function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const touche = (el: HTMLElement, key: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });

describe("Commande sur téléphone — la liste du jour", () => {
  it("le jour courant par défaut : une case par article, le titre du jour, les valeurs du jour", () => {
    monter();
    expect(liste().querySelector("h2")!.textContent).toBe("mercredi 30 septembre");
    expect(casesJour()).toHaveLength(ARTICLES.length);
    expect(casesJour().map((i) => i.getAttribute("aria-label"))).toEqual(["Riz parfumé — Mer 30", "Sucre — Mer 30", "Lait — Mer 30", "Oignons (kg) — Mer 30"]);
    expect(casesJour().map((i) => i.value)).toEqual(["4", "", "2", ""]);
    // Rubriques et total du jour (4 + 2), pas de capitales criées.
    expect(liste().textContent).toContain("Épicerie");
    expect(liste().textContent).toContain("Total du jour : 6");
    expect(liste().innerHTML).not.toMatch(/(?<!first-letter:)uppercase/); // seule l'initiale du jour prend une majuscule
  });

  it("chaque case est un champ texte au pavé décimal, sans type=number, de 44 px au moins", () => {
    monter();
    for (const i of casesJour()) {
      expect(i.type).toBe("text");
      expect(i.getAttribute("inputmode")).toBe("decimal");
      expect(i.className).toContain("h-11");
    }
  });

  it("changer de jour change les valeurs et les libellés des cases", () => {
    monter();
    act(() => { conteneur.querySelector<HTMLButtonElement>('[data-selecteur-jour] button[aria-label^="mardi"]')!.click(); });
    expect(liste().querySelector("h2")!.textContent).toBe("mardi 29 septembre");
    expect(casesJour().map((i) => i.value)).toEqual(["9", "", "", ""]);
    expect(caseJour("Riz parfumé — Mar 29")).toBeTruthy();
  });

  it("saisie mobile = même action, mêmes arguments que la grille (article, date du jour, quantité)", async () => {
    monter();
    // Grille : Riz, colonne du mercredi (3e colonne de la semaine).
    const grille = [...conteneur.querySelectorAll<HTMLInputElement>('[data-vue="semaine"] tbody input')].find((i) => i.getAttribute("aria-label") === "Riz parfumé — Mer 30")!;
    act(() => grille.focus()); taper(grille, "7"); await act(async () => { grille.blur(); });
    const viaGrille = m.saisirCommandeResto.mock.calls.at(-1)!;
    m.saisirCommandeResto.mockClear();
    // Liste du jour : la même case.
    const mobile = caseJour("Riz parfumé — Mer 30");
    act(() => mobile.focus()); taper(mobile, "8"); await act(async () => { mobile.blur(); });
    const viaMobile = m.saisirCommandeResto.mock.calls.at(-1)!;
    expect(viaGrille).toEqual(["riz", "2026-09-30", 7]);
    expect(viaMobile).toEqual(["riz", "2026-09-30", 8]);
    expect(m.saisirCommandeLegume).not.toHaveBeenCalled();
  });

  it("un légume frais part par l'action des légumes, comme dans la grille", async () => {
    monter();
    const c = caseJour("Oignons (kg) — Mer 30");
    act(() => c.focus()); taper(c, "3,5"); await act(async () => { c.blur(); });
    expect(m.saisirCommandeLegume).toHaveBeenCalledWith("Oignons", "2026-09-30", 3.5);
    expect(m.saisirCommandeResto).not.toHaveBeenCalled();
  });

  it("vider une case envoie 0 (la commande est supprimée), comme la grille", async () => {
    monter();
    const c = caseJour("Riz parfumé — Mer 30");
    act(() => c.focus()); taper(c, ""); await act(async () => { c.blur(); });
    expect(m.saisirCommandeResto).toHaveBeenCalledWith("riz", "2026-09-30", 0);
  });

  it("Entrée descend à l'article suivant de la liste du jour", async () => {
    monter();
    const c = caseJour("Riz parfumé — Mer 30");
    act(() => c.focus());
    await touche(c, "Enter");
    expect(document.activeElement).toBe(caseJour("Sucre — Mer 30"));
  });

  it("la valeur saisie sur mobile apparaît dans le tableau de la semaine, et le total du jour suit", async () => {
    monter();
    const c = caseJour("Sucre — Mer 30");
    act(() => c.focus()); taper(c, "5"); await act(async () => { c.blur(); });
    const grille = [...conteneur.querySelectorAll<HTMLInputElement>('[data-vue="semaine"] tbody input')].find((i) => i.getAttribute("aria-label") === "Sucre — Mer 30")!;
    expect(grille.value).toBe("5");
    expect(liste().textContent).toContain("Total du jour : 11");
  });

  it("une frappe en attente est enregistrée à sa date d'origine quand on change de jour", async () => {
    monter();
    const c = caseJour("Sucre — Mer 30");
    act(() => c.focus()); taper(c, "6");
    await act(async () => { conteneur.querySelector<HTMLButtonElement>('[data-selecteur-jour] button[aria-label^="jeudi"]')!.click(); });
    expect(m.saisirCommandeResto).toHaveBeenCalledWith("sucre", "2026-09-30", 6);
    expect(caseJour("Sucre — Jeu 1").value).toBe("");
  });

  it("la recherche filtre la liste du jour comme le tableau", () => {
    monter();
    const rech = conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')!;
    taper(rech, "lait");
    expect(casesJour().map((i) => i.getAttribute("aria-label"))).toEqual(["Lait — Mer 30"]);
  });

  it("lecture seule : cases désactivées", () => {
    monter(2, { peutModifier: false });
    expect(casesJour().every((i) => i.disabled)).toBe(true);
  });

  it("le tableau de la semaine reste rendu (ordinateur), en colonne figée, et se montre sur mobile en « Vue semaine »", () => {
    monter();
    const semaine = conteneur.querySelector('[data-vue="semaine"]')!;
    expect(semaine.className).toContain("max-lg:hidden");
    expect(semaine.querySelectorAll("thead th")).toHaveLength(9); // Article + 7 jours + Total
    expect(semaine.querySelector("tbody td")!.className).toContain("sticky");
    expect(semaine.querySelectorAll("tbody input")).toHaveLength(ARTICLES.length * 7);
    act(() => { [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes("Vue semaine"))!.click(); });
    expect(conteneur.querySelector('[data-vue="semaine"]')!.className).toBe("");
    expect(conteneur.querySelector('[data-vue="jour"]')!.className).toBe("hidden");
  });
});
