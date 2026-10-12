// @vitest-environment happy-dom
//
// Liste d'achat (2026-10-16) : le choix du fournisseur d'une ligne propose D'ABORD les fournisseurs connus de
// l'article choisi (l'habituel en tête), sans empêcher d'en choisir un autre, et sans rien présélectionner.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({ entreeListeAchat: vi.fn(), verifierDoublonsListe: vi.fn(async () => ({ avertissements: [], lignes: [] })) }));
import { ListeAchatForm } from "./entree-client";
import { choisirOption } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "a0", designation: "Farine T55", unite: "Kg", domaine: "NOURRITURE", prix: "1.00", fournisseurs: [{ fournisseurId: "f2", habituel: false }, { fournisseurId: "f1", habituel: true }] },
  { id: "a9", designation: "Sel gris", unite: "Kg", domaine: "NOURRITURE", prix: null },
];
const FOURNISSEURS = [{ id: "f0", nom: "Maman Épiphanie" }, { id: "f1", nom: "Grossiste Kin" }, { id: "f2", nom: "Zébu SARL" }];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(ListeAchatForm, { articles: ARTICLES, fournisseurs: FOURNISSEURS, aujourdhui: "2026-09-30", taux: 2800, estDirection: true })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; });

const ligne = (i: number) => conteneur.querySelectorAll<HTMLElement>("[data-ligne-achat]")[i]!;
const champFourn = (i: number) => conteneur.querySelector<HTMLInputElement>(`[aria-label="Fournisseur de la ligne ${i + 1}"]`)!;
const valeursListe = (id: string) => [...document.querySelectorAll<HTMLOptionElement>(`#${id} option`)].map((o) => o.value);

describe("Liste d'achat — fournisseurs de l'article en tête", () => {
  it("sans article : la liste générale, tous les fournisseurs, rien de présélectionné", () => {
    expect(champFourn(0).getAttribute("list")).toBe("fournisseurs-connus");
    expect(valeursListe("fournisseurs-connus")).toEqual(["Maman Épiphanie", "Grossiste Kin", "Zébu SARL"]);
    expect(champFourn(0).value).toBe("");
  });

  it("article choisi : sa propre liste, l'habituel d'abord puis ses autres fournisseurs, puis TOUS les autres ; le champ reste vide", async () => {
    await choisirOption(ligne(0).querySelector<HTMLInputElement>('input[role="combobox"][data-choix-recherche="articleId"]')!, "a0");
    expect(champFourn(0).getAttribute("list")).toBe("fournisseurs-ligne-0");
    expect(valeursListe("fournisseurs-ligne-0")).toEqual(["Grossiste Kin", "Zébu SARL", "Maman Épiphanie"]);
    expect([...document.querySelectorAll<HTMLOptionElement>("#fournisseurs-ligne-0 option")][0].getAttribute("label")).toMatch(/habituel/);
    expect(champFourn(0).placeholder).toBe("Habituel : Grossiste Kin");
    expect(champFourn(0).value).toBe(""); // jamais présélectionné : un fournisseur posé par erreur serait ajouté à l'article
  });

  it("un article sans fournisseur connu garde la liste générale (et le placeholder d'avant)", async () => {
    await choisirOption(ligne(1).querySelector<HTMLInputElement>('input[role="combobox"][data-choix-recherche="articleId"]')!, "a9");
    expect(champFourn(1).getAttribute("list")).toBe("fournisseurs-connus");
    expect(champFourn(1).placeholder).toBe("Fournisseur");
  });
});
