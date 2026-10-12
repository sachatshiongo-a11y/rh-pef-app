// @vitest-environment happy-dom
//
// Bon de commande (2026-10-16) : le choix du fournisseur propose d'abord ceux qui fournissent les articles déjà
// choisis sur les lignes, sans empêcher d'en choisir un autre.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../actions", () => ({ creerBonCommande: vi.fn(), modifierBonCommande: vi.fn() }));
import { NouveauBonForm } from "./nouveau-client";
import { champChoix, choisirOption, libellesOuverts, ouvrirChoix } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "a1", designation: "Farine", prix: "1", uniteParCarton: null },
  { id: "a2", designation: "Sucre", prix: "2", uniteParCarton: null },
];
const FOURNISSEURS = [{ id: "f0", nom: "Alpha" }, { id: "f1", nom: "Grossiste Kin" }, { id: "f2", nom: "Zébu SARL" }];
const LIENS = [
  { articleId: "a1", fournisseurId: "f2", habituel: true }, { articleId: "a1", fournisseurId: "f1", habituel: false },
  { articleId: "a2", fournisseurId: "f2", habituel: false },
];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(NouveauBonForm, { articles: ARTICLES, fournisseurs: FOURNISSEURS, liens: LIENS })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; });

describe("Bon de commande — fournisseurs des articles choisis en tête", () => {
  it("sans article choisi : la liste simple, par nom", async () => {
    await ouvrirChoix(champChoix(conteneur, "Fournisseur"));
    expect(libellesOuverts()).toEqual(["— fournisseur —", "Alpha", "Grossiste Kin", "Zébu SARL"]);
  });

  it("deux articles choisis : celui qui les fournit tous les deux d'abord (« 2 sur 2 articles »), les autres ensuite — tous restent choisissables", async () => {
    await choisirOption(champChoix(conteneur, "Article, ligne 1"), "a1");
    await choisirOption(champChoix(conteneur, "Article, ligne 2"), "a2");
    await ouvrirChoix(champChoix(conteneur, "Fournisseur"));
    expect(libellesOuverts()).toEqual(["— fournisseur —", "Zébu SARL", "Grossiste Kin", "Alpha"]);
    expect([...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(["— fournisseur —", "Zébu SARL2 sur 2 articles", "Grossiste Kin1 sur 2 articles", "Alpha"]);
  });
});
