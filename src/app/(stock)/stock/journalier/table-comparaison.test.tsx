// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { TableComparaison } from "./table-comparaison";
import type { LigneComparaison } from "@/lib/journalier-restaurant";

// Onglet Comparaison, tableau de la semaine : deux niveaux d'en-tête lisibles, jours séparés, article
// et en-tête figés, écarts en couleur ET en chiffres signés, « — » pour l'inconnu, filtre « seulement
// les écarts ». Aucun chiffre n'est recalculé : voir table-comparaison.valeurs.test.tsx.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOURS = [{ iso: "2026-09-21", label: "Lun 21" }, { iso: "2026-09-22", label: "Mar 22" }];
const L = (p: Partial<LigneComparaison> & { designation: string }): LigneComparaison => ({
  id: p.designation, categorie: "Épicerie", lien: true, cmd: [0, 0], liv: [0, 0], conso: [null, null], ecarts: [null, null], ...p,
});

function monter(lignes: LigneComparaison[], sansMotif = 0) {
  const div = document.createElement("div");
  div.innerHTML = renderToStaticMarkup(<TableComparaison jours={JOURS} lignes={lignes} sansMotif={sansMotif} />);
  return div;
}
const semaine = (div: HTMLElement) => div.querySelector('[data-vue="semaine"]')!;
/** Ce que la case AFFICHE : sa valeur, sans la pastille d'écart. */
const valeur = (td: Element) => (td.querySelector("[data-valeur]") ?? td).textContent?.trim();
const cellules = (div: HTMLElement, designation: string) => [...semaine(div).querySelector(`tr[data-article="${designation}"]`)!.children].map(valeur);

const FARINE = L({ designation: "Farine", cmd: [3, 0], liv: [2, 0], conso: ["1.5", "0.25"], ecarts: ["LIVRE_NON_CONSOMME", "CONSOMME_PLUS_QUE_LIVRE"] });
const SEL = L({ designation: "Sel", cmd: [1, 0], liv: [1, 0] });

describe("onglet Comparaison, tableau de la semaine", () => {
  it("Cmd / Livré / Conso par jour ; « — » quand le consommé est inconnu, cases vides pour 0", () => {
    const div = monter([FARINE, SEL]);
    expect(cellules(div, "Farine")).toEqual(["Farine", "3", "2", "1,5", "", "", "0,25", "3", "2", "1,75"]);
    expect(cellules(div, "Sel")).toEqual(["Sel", "1", "1", "—", "", "", "—", "1", "1", "—"]);
  });

  it("les écarts gardent leur couleur ET portent leur signe : -0,5 livré non consommé, +0,25 consommé en plus", () => {
    const div = monter([FARINE]);
    const cs = [...semaine(div).querySelectorAll("tbody [data-ecart]")];
    expect(cs.map((td) => [td.getAttribute("data-ecart"), td.getAttribute("title")])).toEqual([["LIVRE_NON_CONSOMME", "livré non consommé"], ["CONSOMME_PLUS_QUE_LIVRE", "consommé plus que livré"]]);
    expect(cs[0]!.className).toContain("bg-sky-100");
    expect(cs[1]!.className).toContain("bg-violet-100");
    // Consommé 1,5 pour 2 livrés : -0,5. Consommé 0,25 pour 0 livré : +0,25.
    expect(cs.map((td) => td.querySelector("[data-signe]")?.getAttribute("data-signe"))).toEqual(["-0,5", "+0,25"]);
    // Livré 2 pour 3 commandés : -1, sur la case Livré.
    const livre = semaine(div).querySelector('tr[data-article="Farine"] [data-ecart-livre]')!;
    expect(livre.querySelector("[data-signe]")!.getAttribute("data-signe")).toBe("-1");
    // Une case sans écart ne porte aucune pastille.
    expect(semaine(monter([SEL])).querySelectorAll("tbody [data-signe]")).toHaveLength(0);
  });

  it("deux niveaux d'en-tête : le jour et sa date, puis Cmd / Livré / Conso en toutes lettres courtes, sans capitales", () => {
    const div = monter([FARINE]);
    const lignes = [...semaine(div).querySelectorAll("thead tr")];
    expect(lignes).toHaveLength(2);
    const jours = [...lignes[0]!.querySelectorAll("th[data-jour]")];
    expect(jours.map((th) => th.getAttribute("data-jour"))).toEqual(["2026-09-21", "2026-09-22", "total"]);
    expect(jours.map((th) => th.textContent)).toEqual(["Lun21", "Mar22", "Totalsemaine"]);
    expect(jours.every((th) => th.getAttribute("colspan") === "3")).toBe(true);
    expect([...lignes[1]!.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Cmd", "Livré", "Conso", "Cmd", "Livré", "Conso", "Cmd", "Livré", "Conso"]);
    expect([...lignes[1]!.querySelectorAll("th")].every((th) => th.getAttribute("title"))).toBe(true); // infobulle : le sens complet
    expect(semaine(div).querySelector("thead")!.innerHTML).not.toMatch(/uppercase/);
  });

  it("les jours sont séparés : filet marqué avant chaque jour, fond alterné", () => {
    const div = monter([FARINE]);
    const tds = [...semaine(div).querySelectorAll('tr[data-article="Farine"] td')];
    // 1 article + 2 jours × 3 + 3 totaux. Le premier td de chaque jour (et du total) porte le filet.
    expect(tds).toHaveLength(10);
    expect([1, 4, 7].map((i) => tds[i]!.className.includes("border-l-2"))).toEqual([true, true, true]);
    expect([2, 3, 5, 6].map((i) => tds[i]!.className.includes("border-l-2"))).toEqual([false, false, false, false]);
    // Fond alterné : le 2e jour est teinté, le 1er non (une case sans écart, pour lire le fond du jour).
    const sel = [...semaine(monter([SEL])).querySelectorAll('tr[data-article="Sel"] td')];
    expect(sel[1]!.className).not.toContain("bg-muted/60");
    expect(sel[4]!.className).toContain("bg-muted/60");
  });

  it("l'article est figé à gauche, l'en-tête en haut, le total à droite ; les rubriques se distinguent", () => {
    const div = monter([FARINE, L({ designation: "Coca", categorie: "Boissons" })]);
    const s = semaine(div);
    expect(s.querySelector("thead")!.className).toContain("sticky");
    expect(s.querySelector("thead")!.className).toContain("top-0");
    expect(s.querySelector('tr[data-article="Farine"] td')!.className).toContain("sticky left-0");
    expect(s.querySelector("thead th")!.className).toContain("sticky left-0");
    const tds = [...s.querySelectorAll('tr[data-article="Farine"] td')];
    expect(tds.slice(-3).every((td) => td.className.includes("sticky"))).toBe(true);
    expect(tds.slice(-1)[0]!.className).toContain("right-0");
    expect([...s.querySelectorAll("tr[data-rubrique]")].map((tr) => tr.getAttribute("data-rubrique"))).toEqual(["Épicerie", "Boissons"]);
  });

  it("les sorties sans motif sont annoncées, pas comptées comme livrées", () => {
    expect(monter([], 2).textContent).toContain("2 article(s) sorti(s) du dépôt sans motif");
    expect(monter([], 0).textContent).not.toContain("sans motif cette semaine");
  });
});

describe("filtre « Afficher seulement les écarts »", () => {
  let racine: Root, conteneur: HTMLElement;
  beforeEach(() => { conteneur = document.createElement("div"); document.body.append(conteneur); racine = createRoot(conteneur); });
  afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

  const articles = () => [...conteneur.querySelectorAll('[data-vue="semaine"] tr[data-article]')].map((tr) => tr.getAttribute("data-article"));
  const case_ = () => conteneur.querySelector<HTMLInputElement>('[data-vue="semaine"] input[type="checkbox"]')!;

  it("ne garde que les lignes avec au moins un écart dans la semaine, décoche pour tout revoir", () => {
    const CL = L({ designation: "Beurre", cmd: [2, 0], liv: [3, 0] }); // livré ≠ commandé, sans comptage
    const RAS = L({ designation: "Eau", cmd: [2, 0], liv: [2, 0], conso: ["2", "0"] }); // rien à signaler
    const AUTRE = L({ designation: "Huile", categorie: "Autre", cmd: [1, 0], liv: [1, 0], conso: ["1", "0"] });
    act(() => racine.render(createElement(TableComparaison, { jours: JOURS, lignes: [FARINE, SEL, CL, RAS, AUTRE], sansMotif: 0 })));
    expect(articles()).toEqual(["Farine", "Sel", "Beurre", "Eau", "Huile"]);
    expect(conteneur.querySelector("[data-compte-ecarts]")!.textContent).toContain("2 article(s) sur 5");
    act(() => case_().click());
    expect(articles()).toEqual(["Farine", "Beurre"]);
    // La rubrique sans écart disparaît avec ses lignes.
    expect([...conteneur.querySelectorAll('[data-vue="semaine"] tr[data-rubrique]')].map((tr) => tr.getAttribute("data-rubrique"))).toEqual(["Épicerie"]);
    act(() => case_().click());
    expect(articles()).toHaveLength(5);
  });

  it("aucun écart : le dit, sans tableau vide muet", () => {
    act(() => racine.render(createElement(TableComparaison, { jours: JOURS, lignes: [SEL], sansMotif: 0 })));
    act(() => case_().click());
    expect(articles()).toEqual([]);
    expect(conteneur.querySelector('[data-vue="semaine"]')!.textContent).toContain("Aucun écart cette semaine");
  });
});
