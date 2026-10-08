// @vitest-environment happy-dom
//
// Écran Fiches de poste (refonte 2026-10-08) : recherche, regroupement par département, sélection
// et actions groupées, fiche ouverte en pleine largeur. Ce qui NE change PAS est vérifié aussi :
// mêmes champs envoyés à `enregistrerFichePoste`, mêmes droits (suppression = Direction, PDF =
// Direction / Responsable RH, lecture seule pour la consultation).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({
  enregistrerFichePoste: vi.fn(), renommerPoste: vi.fn(), supprimerFichePoste: vi.fn(), supprimerFichesPoste: vi.fn(), supprimerPoste: vi.fn(),
}));

import { ListeFichesPoste } from "./liste-fiches-poste";
import { lignesFichesPoste, type FicheDePoste } from "@/lib/fiches-poste-liste";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fiche = (poste: string, extra: Partial<FicheDePoste> = {}): FicheDePoste => ({
  id: `id-${poste.length}`, poste, descriptionPoste: null, description: null, typeContrat: null, echelleSalariale: null, categorieProfessionnelle: null,
  superieurHierarchique: null, tempsTravail: null, competencesTechniques: null, savoirEtre: null, formationsRequises: null, diplomesRequis: null,
  experiencesExigees: null, fichierUrl: null, fichierNom: null, ...extra,
});
const LIGNES = lignesFichesPoste(
  [
    { id: "e1", nom: "Aimée Mutita", photoUrl: null, poste: "Cuisinière", secteur: "Cuisine" },
    { id: "e2", nom: "Esther Nsundi", photoUrl: null, poste: "Serveuse", secteur: "Salle" },
  ],
  [fiche("Cuisinière", { descriptionPoste: "Prépare les plats", typeContrat: "CDI" }), fiche("Chef de cuisine")],
);

let conteneur: HTMLDivElement;
let racine: Root;
function monter(role: "ADMIN" | "MANAGER" | "VIEWER", posteOuvert?: string) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(ListeFichesPoste, { lignes: LIGNES, peutGerer: role !== "VIEWER", estAdmin: role === "ADMIN", posteOuvert })));
}
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const postesAffiches = () => [...conteneur.querySelectorAll("li[data-poste]")].map((li) => li.getAttribute("data-poste"));
const bouton = (texte: RegExp) => [...conteneur.querySelectorAll("button")].find((b) => texte.test(b.textContent ?? ""));
function taper(el: HTMLInputElement, texte: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, texte);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("liste des fiches de poste", () => {
  it("regroupée par département (titres), « Sans salarié actif » en dernier", () => {
    monter("ADMIN");
    expect([...conteneur.querySelectorAll("section h2")].map((t) => t.textContent)).toEqual(["Cuisine (1)", "Salle (1)", "Sans salarié actif (1)"]);
    expect(postesAffiches()).toEqual(["Cuisinière", "Serveuse", "Chef de cuisine"]);
  });

  it("recherche (sans accents) et filtre « À documenter »", () => {
    monter("ADMIN");
    taper(conteneur.querySelector<HTMLInputElement>('input[type="search"]')!, "cuisiniere");
    expect(postesAffiches()).toEqual(["Cuisinière"]);
    taper(conteneur.querySelector<HTMLInputElement>('input[type="search"]')!, "");
    act(() => bouton(/^À documenter/)!.click());
    expect(postesAffiches()).toEqual(["Serveuse", "Chef de cuisine"]);
  });

  it("actions groupées : seules les lignes AVEC fiche se cochent ; le lot PDF porte les ids cochés ; suppression = Direction", () => {
    monter("ADMIN");
    const cases = [...conteneur.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]')];
    expect(cases.map((c) => c.getAttribute("aria-label"))).toEqual(["Sélectionner la fiche Cuisinière", "Sélectionner la fiche Chef de cuisine"]);
    act(() => cases[0].click());
    const lot = [...conteneur.querySelectorAll("a")].find((a) => a.textContent?.includes("Télécharger les fiches PDF (1)"))!;
    expect(lot.getAttribute("href")).toBe(`/fiches-poste/pdf-lot?ids=${LIGNES.find((l) => l.poste === "Cuisinière")!.fiche!.id}`);
    expect([...conteneur.querySelectorAll('input[name="ficheId"]')].map((i) => (i as HTMLInputElement).value)).toEqual([LIGNES.find((l) => l.poste === "Cuisinière")!.fiche!.id]);
    expect(bouton(/Supprimer les fiches \(1\)/)).toBeTruthy();
  });

  it("Responsable RH : PDF en lot oui, suppression groupée non", () => {
    monter("MANAGER");
    act(() => conteneur.querySelector<HTMLInputElement>('li input[type="checkbox"]')!.click());
    expect(conteneur.textContent).toContain("Télécharger les fiches PDF (1)");
    expect(bouton(/Supprimer les fiches/)).toBeUndefined();
  });

  it("fiche ouverte : occupants cliquables et EXACTEMENT les champs d'avant pour enregistrerFichePoste", () => {
    monter("ADMIN", "Cuisinière");
    const li = conteneur.querySelector('li[data-poste="Cuisinière"]')!;
    expect(li.querySelector('a[href="/employes/e1"]')?.textContent).toContain("Aimée Mutita");
    const form = [...li.querySelectorAll("form")].find((f) => f.querySelector('[name="descriptionPoste"]'))!;
    const noms = [...form.querySelectorAll("[name]")].map((e) => e.getAttribute("name")).sort();
    expect(noms).toEqual([
      "categorieProfessionnelle", "competencesTechniques", "description", "descriptionPoste", "diplomesRequis", "echelleSalariale",
      "experiencesExigees", "fichier", "formationsRequises", "poste", "savoirEtre", "superieurHierarchique", "tempsTravail", "typeContrat",
    ]);
    expect((form.querySelector('[name="typeContrat"]') as HTMLInputElement).value).toBe("CDI");
    expect((form.querySelector('[name="poste"]') as HTMLInputElement).value).toBe("Cuisinière");
  });

  it("consultation : ni cases, ni formulaire, ni PDF — la description se lit", () => {
    monter("VIEWER");
    expect(conteneur.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(conteneur.textContent).not.toContain("Fiche PDF");
    act(() => bouton(/^Lire/)!.click());
    expect(conteneur.querySelector("form")).toBeNull();
    expect(conteneur.textContent).toContain("Prépare les plats");
  });
});
