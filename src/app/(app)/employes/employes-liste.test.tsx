// @vitest-environment happy-dom
//
// Liste des employés : cases à cocher par ligne + barre d'actions groupées (préférence forte de la Direction,
// audit du 10/10/2026, ergonomie 7) — exporter la SÉLECTION en Excel ou en PDF.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: unknown }) => h("a", { href, ...p }, children as never) }));

import { ListeEmployes, type LigneEmploye } from "./employes-liste";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const E = (id: string, nom: string, plus: Partial<LigneEmploye> = {}): LigneEmploye => ({
  id, matricule: `M-${id}`, nom, photoUrl: null, poste: "Cuisinier", secteur: "Cuisine", salaireMensuel: 450.5, heuresHebdomadaires: 48, contrat: "CDI", actif: true, ...plus,
});

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(statut: "actifs" | "inactifs" | "tous" = "actifs") {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(ListeEmployes, {
    brigade: [E("e1", "Aimée Mutita"), E("e2", "Esther Nsundi")], backoffice: [E("e3", "Paul Kasa")],
    totalBrigade: 2, totalBackoffice: 1, statut, peutModifier: true,
  })));
}
// Deux dispositions (téléphone / ordinateur) portent chacune leur case : on lit celles du TABLEAU.
const casesTableau = () => [...conteneur.querySelectorAll<HTMLInputElement>('table tbody input[type="checkbox"]')];
const barre = () => conteneur.querySelector<HTMLElement>(".sticky");

describe("Liste des employés — actions groupées", () => {
  it("une case par ligne ; la barre n'offre d'actions qu'à la sélection", () => {
    monter();
    expect(casesTableau().map((c) => c.getAttribute("aria-label"))).toEqual(["Sélectionner Aimée Mutita", "Sélectionner Esther Nsundi", "Sélectionner Paul Kasa"]);
    expect(barre()!.textContent).toContain("0 sélectionné(s)");
    expect(barre()!.querySelector("a")).toBeNull();
  });

  it("cocher deux lignes (une par section) : « Excel (2) » et « PDF (2) » portent les identifiants cochés", () => {
    monter();
    act(() => casesTableau()[0].click());
    act(() => casesTableau()[2].click());
    expect(barre()!.textContent).toContain("2 sélectionné(s)");
    const liens = [...barre()!.querySelectorAll("a")].map((a) => [a.textContent?.trim(), a.getAttribute("href")]);
    expect(liens).toEqual([["⭳ Excel (2)", "/employes/export?ids=e1,e3"], ["⭳ PDF (2)", "/employes/pdf?ids=e1,e3"]]);
  });

  it("le statut de l'écran suit l'export (un inactif coché sous « Tous » doit être retrouvé)", () => {
    monter("tous");
    act(() => casesTableau()[1].click());
    expect(barre()!.querySelector("a")!.getAttribute("href")).toBe("/employes/export?ids=e2&statut=tous");
  });

  it("« Tout sélectionner » coche toute la page ; « Désélectionner » la vide", () => {
    monter();
    act(() => barre()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(casesTableau().every((c) => c.checked)).toBe(true);
    expect(barre()!.textContent).toContain("3 sélectionné(s)");
    act(() => [...barre()!.querySelectorAll("button")].find((b) => b.textContent?.includes("Désélectionner"))!.click());
    expect(casesTableau().some((c) => c.checked)).toBe(false);
  });

  it("le nom reste un lien vers la fiche (avec son avatar) à côté de la case", () => {
    monter();
    const lien = [...conteneur.querySelectorAll("table a")].find((a) => a.textContent?.includes("Aimée Mutita"));
    expect(lien?.getAttribute("href")).toBe("/employes/e1");
  });
});
