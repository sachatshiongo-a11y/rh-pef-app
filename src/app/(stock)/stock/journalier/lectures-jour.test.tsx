// @vitest-environment happy-dom
//
// Consommation et Comparaison sur téléphone : la liste d'UN jour, en lecture seule, alimentée par les
// mêmes données que les tableaux de la semaine. « — » pour l'inconnu, jamais 0.
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement as h, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JourMobileProvider } from "@/components/jour-mobile";
import { SelecteurJour } from "@/components/selecteur-jour";
import { TableConso } from "./table-conso";
import { TableComparaison } from "./table-comparaison";
import type { LigneComparaison, LigneConso, LigneJours } from "@/lib/journalier-restaurant";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ISOS = ["2026-09-28", "2026-09-29", "2026-09-30"];
const JOURS = ISOS.map((iso, i) => ({ iso, label: `J${i}` }));
let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(corps: ReturnType<typeof h>, defaultIdx = 2) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(JourMobileProvider, { defaultIdx, children: h(Fragment, null, h(SelecteurJour, { jours: JOURS, aujourdhui: "2026-09-30" }), corps) })));
}
const jour = () => conteneur.querySelector<HTMLElement>('[data-vue="jour"]')!;
const choisir = (prefixe: string) => act(() => { conteneur.querySelector<HTMLButtonElement>(`[data-selecteur-jour] button[aria-label^="${prefixe}"]`)!.click(); });

const LJ = (id: string, jours: number[]): LigneJours => ({ id, designation: id, jours, total: jours.reduce((a, b) => a + b, 0) });
const connue = (quantite: string, extra: Partial<{ negative: boolean; veilleEstimee: boolean }> = {}) =>
  ({ etat: "CONNUE" as const, quantite, negative: false, stockVeille: "5", recu: "2", compte: "3", veilleEstimee: false, ...extra });
const inconnue = { etat: "INCONNUE" as const, raison: "PAS_DE_COMPTAGE" as const };
const CONSO: LigneConso[] = [
  { id: "f", designation: "Farine", unite: "kg", espace: "CUISINE", jours: [inconnue, inconnue, connue("4")] },
  { id: "s", designation: "Sel", unite: "kg", espace: "CUISINE", jours: [inconnue, inconnue, connue("-1", { negative: true })] },
  { id: "t", designation: "Tomate", unite: "kg", espace: "CUISINE", jours: [inconnue, connue("2"), inconnue] },
];

describe("Consommation sur téléphone", () => {
  const rendu = () => h(TableConso, {
    jours: JOURS,
    sorties: { livraisons: [LJ("Riz", [0, 0, 3]), LJ("Huile", [5, 0, 0])], pertes: [LJ("Sucre", [0, 0, 1])], sansMotif: [LJ("Sel", [0, 2, 0])] },
    legumes: [{ nom: "Oignons", jours: [0, 0, 2], total: 2 }],
    consoResto: CONSO,
  });

  it("le jour courant : livré (avec total), pertes, légumes, consommation réelle ; rien d'un autre jour", () => {
    monter(rendu());
    const t = jour().textContent!;
    expect(jour().querySelector("h2")!.textContent).toBe("mercredi 30 septembre");
    for (const attendu of ["Livré au restaurant", "Riz", "Total livré au restaurant3", "Pertes (restent au dépôt)", "Sucre", "Légumes frais (achats du jour)", "Oignons", "Consommation réelle du restaurant", "Farine"]) expect(t).toContain(attendu);
    expect(t).not.toContain("Huile"); // livrée le lundi seulement
    expect(t).not.toContain("Sorties sans motif"); // aucune ce jour-là
  });

  it("consommation : écart négatif signalé en texte, inconnue jamais affichée 0, compte des « — »", () => {
    monter(rendu());
    const t = jour().textContent!;
    expect(t).toContain("écart : plus compté que reçu");
    expect(jour().querySelector('[aria-label*="écart"]')).not.toBeNull();
    expect(t).toContain("1 article(s) sans consommation connue ce jour");
    expect(t).not.toContain("Tomate"); // inconnue ce jour : comptée, pas listée avec un 0
    expect(t).toContain("veille 5 + reçu 2 − compté 3");
  });

  it("changer de jour change la liste ; un jour sans rien le dit", () => {
    monter(rendu());
    choisir("mardi");
    expect(jour().textContent).toContain("Sel");
    expect(jour().textContent).toContain("Sorties sans motif");
    expect(jour().textContent).toContain("Total jour — sorties sans motif2");
    expect(jour().textContent).toContain("Tomate");
    choisir("lundi");
    expect(jour().textContent).toContain("Huile");
  });

  it("le tableau de la semaine reste rendu (colonnes de tous les jours)", () => {
    monter(rendu());
    const semaine = conteneur.querySelector('[data-vue="semaine"]')!;
    expect(semaine.querySelectorAll("thead th")).toHaveLength(JOURS.length + 2);
    expect(semaine.className).toContain("max-lg:hidden");
  });
});

const CMP: LigneComparaison[] = [
  { id: "riz", designation: "Riz", categorie: "Épicerie", lien: true, cmd: [0, 0, 4], liv: [0, 0, 2], conso: [null, null, "0"], ecarts: [null, null, "LIVRE_NON_CONSOMME"] },
  { id: "sel", designation: "Sel", categorie: "Épicerie", lien: false, cmd: [0, 0, 0], liv: [0, 0, 0], conso: [null, null, null], ecarts: [null, null, null] },
  { id: "lait", designation: "Lait", categorie: "Frais", lien: true, cmd: [0, 3, 0], liv: [0, 3, 0], conso: [null, "1.5", "1.5"], ecarts: [null, null, null] },
];

describe("Comparaison sur téléphone", () => {
  const rendu = () => h(TableComparaison, { jours: JOURS, lignes: CMP, sansMotif: 2 });

  it("trois valeurs par article (commandé, livré, consommé), la couleur d'écart, « — » si inconnu", () => {
    monter(rendu());
    const riz = jour().querySelector('[data-article="Riz"]')!;
    const v = [...riz.querySelectorAll("span")].map((s) => s.textContent);
    expect(v).toEqual(["4", "2", "0"]);
    expect(riz.querySelector("[data-ecart]")!.getAttribute("data-ecart")).toBe("LIVRE_NON_CONSOMME");
    expect(riz.querySelector("[data-ecart]")!.className).toContain("bg-sky-100"); // même couleur que le tableau
    expect(jour().textContent).toContain("Commandé");
    expect(jour().textContent).toContain("Livré");
    expect(jour().textContent).toContain("Consommé");
  });

  it("n'y figurent que les articles qui ont bougé ce jour-là ; le compte est dit", () => {
    monter(rendu());
    expect(jour().querySelector('[data-article="Sel"]')).toBeNull();
    expect(jour().textContent).toContain("2 / 3 article(s) ce jour");
    choisir("mardi");
    expect(jour().querySelector('[data-article="Riz"]')).toBeNull();
    const lait = jour().querySelector('[data-article="Lait"]')!;
    expect([...lait.querySelectorAll("span")].map((s) => s.textContent)).toEqual(["3", "3", "1,5"]);
  });

  it("consommé inconnu : « — », jamais 0 ; le lien vers la fiche du catalogue est conservé", () => {
    monter(rendu(), 1);
    // Mardi : Lait a 1.5 de consommé ; Riz n'a rien ce jour-là. On passe au jour où Riz a un « — ».
    expect(jour().querySelector('[data-article="Lait"] a')!.getAttribute("href")).toBe("/stock/catalogue/lait");
    const ligneSansConso = h(TableComparaison, { jours: JOURS, lignes: [{ ...CMP[0]!, conso: [null, null, null], ecarts: [null, null, null] }], sansMotif: 0 });
    act(() => racine.unmount()); conteneur.remove();
    monter(ligneSansConso);
    expect([...jour().querySelector('[data-article="Riz"]')!.querySelectorAll("span")].map((s) => s.textContent)).toEqual(["4", "2", "—"]);
  });

  it("l'anomalie « sorties sans motif » est annoncée, et le tableau de la semaine reste rendu", () => {
    monter(rendu());
    expect(jour().textContent).toContain("2 article(s) sorti(s) du dépôt sans motif");
    expect(conteneur.querySelector('[data-vue="semaine"] table')).not.toBeNull();
  });
});
