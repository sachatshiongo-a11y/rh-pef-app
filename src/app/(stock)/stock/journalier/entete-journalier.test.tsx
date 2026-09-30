// @vitest-environment happy-dom
//
// Haut de page de la Conso. journalière (demande de la Direction, 2026-09-30) : sur téléphone, les
// onglets défilent de côté, la semaine tient sur une ligne, filtre et exports sont dans « Plus », le
// sélecteur de jour est là ; sur ordinateur, les rangées d'origine (masquées sous `lg`).
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnteteJournalier, lienJournalier, type VueJournalier } from "./entete-journalier";
import { JourMobileProvider } from "@/components/jour-mobile";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LUNDI = new Date("2026-09-28T00:00:00Z");
const ISOS = Array.from({ length: 7 }, (_, i) => new Date(LUNDI.getTime() + i * 86_400_000).toISOString().slice(0, 10));
let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(vue: VueJournalier, domaine?: "NOURRITURE" | "BOISSON", importer?: string) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(JourMobileProvider, {
    defaultIdx: 2,
    children: h(EnteteJournalier, { vue, domaine, lundi: LUNDI, jourDefaut: ISOS[2]!, aujourdhui: ISOS[2]!, joursSelecteur: ISOS.map((iso) => ({ iso })), aide: "Note de l'onglet.", importer: importer ? h("button", null, importer) : undefined }),
  })));
}
const ouvrirPlus = () => act(() => { conteneur.querySelector<HTMLButtonElement>('button[aria-label^="Plus d\'options"]')!.click(); });
const panneau = () => conteneur.querySelector<HTMLElement>("[data-plus-mobile]");
const ordinateur = () => [...conteneur.querySelectorAll<HTMLElement>("div")].find((d) => d.className.includes("max-lg:hidden") && d.textContent!.includes("Cette semaine"))!;

describe("haut de la Conso. journalière", () => {
  it("quatre onglets dans une rangée qui défile de côté ; l'actif est marqué", () => {
    monter("ventes");
    const nav = conteneur.querySelector("nav")!;
    expect(nav.parentElement!.className).toContain("overflow-x-auto");
    const onglets = [...nav.querySelectorAll("a")];
    expect(onglets.map((a) => a.textContent)).toEqual(["Commande", "Consommation", "Comparaison", "Rapport journalier"]);
    expect(onglets.map((a) => a.getAttribute("aria-current"))).toEqual([null, null, null, "page"]);
    for (const a of onglets) { expect(a.className).toContain("whitespace-nowrap"); expect(a.className).toContain("min-h-11"); }
    expect(onglets[1]!.getAttribute("href")).toBe("/stock/journalier?vue=conso&semaine=2026-09-28");
  });

  it("titre réduit sur téléphone ; description masquée sous lg (reprise dans « Plus »)", () => {
    monter("conso");
    const titre = conteneur.querySelector("h1")!;
    expect(titre.className).toContain("text-lg");
    expect(titre.className).toContain("sm:text-2xl");
    expect(titre.nextElementSibling!.className).toContain("max-lg:hidden");
  });

  it("ordinateur : semaine, filtres, exports dans la rangée d'origine, masquée sous lg", () => {
    monter("conso");
    const o = ordinateur();
    expect(o.className).toContain("max-lg:hidden");
    for (const t of ["Semaine du 28/9 au 4/10", "Cette semaine", "Tous", "Cuisine (nourriture)", "Bar (boissons)", "Exporter", "PDF", "Excel", "Fiches (PDF / Excel)"]) expect(o.textContent).toContain(t);
  });

  it("téléphone : la semaine sur une ligne (← libellé → Plus), « Plus » fermé au départ", () => {
    monter("conso");
    const barre = conteneur.querySelector("[data-barre-semaine]")!;
    expect(barre.className).toContain("lg:hidden");
    expect(barre.textContent).toContain("Sem. du 28/9 au 4/10");
    expect(barre.querySelector('a[aria-label="Semaine précédente"]')!.getAttribute("href")).toBe("/stock/journalier?vue=conso&semaine=2026-09-21");
    expect(barre.querySelector('a[aria-label="Semaine suivante"]')!.getAttribute("href")).toBe("/stock/journalier?vue=conso&semaine=2026-10-05");
    expect(panneau()).toBeNull();
    // Le sélecteur de jour suit, avec le jour courant choisi.
    expect(conteneur.querySelector('[data-selecteur-jour] button[aria-pressed="true"]')!.getAttribute("aria-label")).toContain("mercredi 30 septembre");
  });

  it("« Plus » range le filtre Cuisine / Bar, « Cette semaine », la vue semaine, les exports et l'aide", () => {
    monter("conso", undefined, "Importer");
    ouvrirPlus();
    const t = panneau()!.textContent!;
    for (const attendu of ["Tous", "Cuisine (nourriture)", "Bar (boissons)", "Cette semaine", "Vue semaine", "Exporter", "PDF", "Excel", "Fiches (PDF / Excel)", "Note de l'onglet.", "Importer"]) expect(t).toContain(attendu);
    const pdf = [...panneau()!.querySelectorAll("a")].find((a) => a.textContent === "PDF" && a.getAttribute("href")!.includes("/pdf"))!;
    expect(pdf.getAttribute("href")).toBe("/stock/journalier/pdf?vue=conso&semaine=2026-09-28");
    for (const el of panneau()!.querySelectorAll("a, button")) if (el.tagName === "A" && !el.closest("details")) expect(el.className).toContain("min-h-11");
  });

  it("un filtre actif reste visible avec son lien « Retirer », et les liens le conservent", () => {
    monter("commande", "BOISSON");
    const chip = conteneur.querySelector("[data-barre-semaine] p")!;
    expect(chip.textContent).toContain("Filtre : Bar");
    expect(chip.querySelector("a")!.getAttribute("href")).toBe("/stock/journalier?vue=commande&semaine=2026-09-28");
    expect(conteneur.querySelector('a[aria-label="Semaine suivante"]')!.getAttribute("href")).toBe("/stock/journalier?vue=commande&semaine=2026-10-05&domaine=BOISSON");
    expect(conteneur.querySelector('button[aria-label^="Plus d\'options"]')!.getAttribute("aria-label")).toContain("Bar");
  });

  it("toucher un lien du panneau le referme", () => {
    monter("conso");
    ouvrirPlus();
    expect(panneau()).not.toBeNull();
    act(() => { [...panneau()!.querySelectorAll("a")].find((a) => a.textContent === "Cette semaine")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(panneau()).toBeNull();
  });

  it("lienJournalier : vue, semaine et filtre", () => {
    expect(lienJournalier({ vue: "conso", semaine: "2026-09-28" })).toBe("/stock/journalier?vue=conso&semaine=2026-09-28");
    expect(lienJournalier({ vue: "ventes", semaine: "2026-09-28", domaine: "NOURRITURE" })).toBe("/stock/journalier?vue=ventes&semaine=2026-09-28&domaine=NOURRITURE");
  });
});
