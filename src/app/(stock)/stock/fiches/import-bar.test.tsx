// @vitest-environment happy-dom
//
// « Importer les fiches du bar » : ce que voit la Direction. Le VRAI classeur (fixture) est déposé ;
// les actions serveur sont remplacées par la même logique pure (rattacherFiches…) sur des fiches et
// un catalogue de test. On vérifie la simulation affichée, les correspondances sûres acceptées
// d'office, le blocage d'une unité inconvertible, l'action groupée, et ce qui part au serveur.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  rattacherFiches, rattacherIngredients, type ArticleExistant, type ChoixImportBar, type FicheBarLue, type FicheExistanteBar,
} from "@/lib/fiches/classeur-bar";

const F = (id: string, nom: string, categorie: string, nbIngredients = 0): FicheExistanteBar =>
  ({ id, nom, categorie, type: "BAR", estSousRecette: false, actif: true, nbIngredients, recetteVide: true, prixVenteTTC: 15 });
const FICHES = [F("pc", "Pina Colada", "Cocktail"), F("pm", "Pina Colada", "Mocktail"), F("mo", "Mojito", "Cocktail", 2), F("kir", "Kir Royal", "Apéritif")];
const ARTICLES: ArticleExistant[] = [
  { id: "rum", designation: "Rum Saint James blc 70cl", unite: "L", prixUnitaireUSD: 17.8571, domaine: "BOISSON" },
  { id: "bac", designation: "Bacardi blanc", unite: "Bouteille", prixUnitaireUSD: 15, domaine: "BOISSON" },
];

const appels = vi.hoisted(() => ({
  analyserFichesBar: vi.fn(),
  appliquerImportBar: vi.fn<(lues: unknown, choix: unknown) => Promise<unknown>>(async () => ({
    ok: true as const, remplies: ["Pina Colada"], creees: [], identiques: [], dejaRemplies: [], ignorees: [], nonEcrites: [], articlesCrees: ["Lait de Coco"], lignesIgnorees: [], recettesConservees: [],
  })),
}));
vi.mock("./import-bar-actions", () => appels);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: unknown }) => createElement("a", { href, ...p }, children as never) }));

const { ImportFichesBar } = await import("./import-bar");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OCTETS = fs.readFileSync(path.join(process.cwd(), "src/lib/fiches/__fixtures__/fiches-bar.xlsx"));
let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  appels.analyserFichesBar.mockReset();
  appels.analyserFichesBar.mockImplementation(async (lues: FicheBarLue[]) => ({
    ok: true as const, fiches: rattacherFiches(lues, FICHES), ingredients: rattacherIngredients(lues, ARTICLES), articles: ARTICLES, fichesBar: FICHES,
  }));
  appels.appliquerImportBar.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => racine.unmount());
  conteneur.remove();
});

const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte)) as HTMLButtonElement;
const select = (label: string) => conteneur.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const choisir = (s: HTMLSelectElement, valeur: string) => act(() => { s.value = valeur; s.dispatchEvent(new Event("change", { bubbles: true })); });
const ligne = (nom: string) => [...conteneur.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("td .font-medium")?.textContent === nom)!;

async function deposer() {
  act(() => racine.render(createElement(ImportFichesBar)));
  await act(async () => { bouton("Importer les fiches du bar").click(); });
  const input = conteneur.querySelector<HTMLInputElement>('input[type="file"]')!;
  const fichier = new File([OCTETS], "Fiches techniques du bar.xlsx");
  Object.defineProperty(input, "files", { value: [fichier] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await vi.waitFor(() => expect(conteneur.textContent).toContain("1. Fiches"));
}

describe("Importer les fiches du bar — simulation", () => {
  it("dépose le classeur : 29 feuilles, correspondances sûres acceptées, le reste à décider ; rien n'est écrit", async () => {
    await deposer();
    expect(appels.analyserFichesBar).toHaveBeenCalledTimes(1);
    expect(appels.appliquerImportBar).not.toHaveBeenCalled();
    expect(select("Fiche visée par Piña colada").value).toBe("fiche:pc");
    expect(select("Fiche visée par Virgin Piña Colada").value).toBe("fiche:pm");
    expect(select("Fiche visée par Kir Royal").value).toBe(""); // Apéritif ≠ Cocktail : jamais d'office
    expect(ligne("Kir Royal").textContent).toContain("à décider");
    // « Proches » : jamais sur la seule contenance (« COINTREAU 70CL » ≠ « Rum … 70cl »).
    expect([...select("Article pour COINTREAU 70CL").options].map((o) => o.textContent)).not.toContain("Rum Saint James blc 70cl (L)");
    expect(select("Article pour RUM SAINT JAMES BLC 70CL").value).toBe("art:rum");
    expect(ligne("RUM SAINT JAMES BLC 70CL").textContent).toContain("correspondance sûre");
    expect(select("Article pour Lait de Coco").value).toBe("");
    // Le Mojito a déjà une recette : la case « Remplacer » est proposée, décochée.
    expect(ligne("Mojito").textContent).toContain("Remplacer la recette existante (2 ingrédient(s))");
    expect(conteneur.textContent).toContain("29 feuille(s) · 0 prête(s) · 29 à décider");
    expect(bouton("Appliquer").disabled).toBe(true);
    expect(conteneur.textContent).toContain("« Liste des fournisseurs » (pas une fiche technique");
  });

  it("choisir des articles rend la fiche prête ; une unité inconvertible la bloque et le dit", async () => {
    await deposer();
    for (const l of ["Jus d'Ananas-100", "Lait de Coco", "Sirop de Sucre de canne-70", "MONIN COCONUT FRUIT 1LTR", "BACARDI BLC 1L"]) {
      choisir(select(`Article pour ${l}`), "creer");
    }
    expect(ligne("Piña colada").textContent).toContain("prête");
    expect(ligne("Lait de Coco").textContent).toContain("cl → l"); // « Créer » : article au litre
    expect(bouton("Appliquer").textContent).toBe("Appliquer (2 fiches)");

    choisir(select("Article pour BACARDI BLC 1L"), "art:bac");
    expect(ligne("Piña colada").textContent).toContain("bloquée");
    expect(ligne("Piña colada").textContent).toContain("BACARDI BLC 1L : unité inconvertible : cl → Bouteille");
    expect(ligne("BACARDI BLC 1L").textContent).toContain("cl → Bouteille : inconvertible");
    expect(bouton("Appliquer").textContent).toBe("Appliquer (1 fiche)"); // reste la Virgin Piña Colada, sans rhum
  });

  it("« Accepter les correspondances sûres » remet les choix sûrs ; « Appliquer » envoie lues + choix après confirmation", async () => {
    await deposer();
    choisir(select("Fiche visée par Piña colada"), "ignorer");
    choisir(select("Article pour RUM SAINT JAMES BLC 70CL"), "ignorer");
    await act(async () => { bouton("Accepter les correspondances sûres").click(); });
    expect(select("Fiche visée par Piña colada").value).toBe("fiche:pc");
    expect(select("Article pour RUM SAINT JAMES BLC 70CL").value).toBe("art:rum");
    expect(select("Fiche visée par Kir Royal").value).toBe(""); // l'action groupée ne décide rien d'autre

    for (const l of ["Jus d'Ananas-100", "Lait de Coco", "Sirop de Sucre de canne-70", "MONIN COCONUT FRUIT 1LTR", "BACARDI BLC 1L"]) choisir(select(`Article pour ${l}`), "creer");
    const confirmer = vi.fn<(message: string) => boolean>(() => true);
    vi.stubGlobal("confirm", confirmer);
    await act(async () => { bouton("Appliquer (2 fiches)").click(); });
    expect(confirmer.mock.calls[0]![0]).toContain("· 5 article(s) créé(s) au catalogue");
    expect(appels.appliquerImportBar).toHaveBeenCalledTimes(1);
    const [lues, choix] = appels.appliquerImportBar.mock.calls[0]! as unknown as [FicheBarLue[], ChoixImportBar];
    expect(lues).toHaveLength(29);
    expect(choix.fiches["Pinacolada cocktail"]).toEqual({ cible: "fiche:pc", categorie: "Cocktail", remplacer: false });
    expect(choix.ingredients["lait de coco"]).toEqual({ cible: "creer", domaine: "BOISSON" });
    await vi.waitFor(() => expect(conteneur.textContent).toContain("Import des fiches du bar terminé."));
    expect(conteneur.textContent).toContain("Articles créés au catalogue (1) : Lait de Coco");
  });

  it("refus de confirmation : rien n'est envoyé", async () => {
    await deposer();
    for (const l of ["Jus d'Ananas-100", "Lait de Coco", "Sirop de Sucre de canne-70", "MONIN COCONUT FRUIT 1LTR", "BACARDI BLC 1L"]) choisir(select(`Article pour ${l}`), "creer");
    vi.stubGlobal("confirm", () => false);
    await act(async () => { bouton("Appliquer (2 fiches)").click(); });
    expect(appels.appliquerImportBar).not.toHaveBeenCalled();
  });
});
