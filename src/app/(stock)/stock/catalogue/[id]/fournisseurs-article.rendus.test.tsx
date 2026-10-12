// @vitest-environment happy-dom
//
// Fiche article — section « Fournisseurs » (2026-10-16) : liste complète, habituel marqué, dernier prix de chacun
// dans SA devise de saisie (« ≈ » dans l'autre), date, origine cliquable, « moins cher », actions groupées.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const { habituel, ajouter, retirer } = vi.hoisted(() => ({
  habituel: vi.fn(async () => ({ proposition: false, message: "ok" })),
  ajouter: vi.fn(async () => ({ proposition: true, message: "Proposition envoyée à la Direction." })),
  retirer: vi.fn(async () => ({ proposition: false, message: "ok" })),
}));
vi.mock("../actions", () => ({ definirFournisseurHabituel: habituel, ajouterFournisseursArticle: ajouter, retirerFournisseursArticle: retirer }));
import { FournisseursArticle, type LigneFournisseurArticle } from "./fournisseurs-article";
import { champChoix, choisirEnTapant } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prix = (o: Partial<NonNullable<LigneFournisseurArticle["prix"]>>): NonNullable<LigneFournisseurArticle["prix"]> =>
  ({ devise: "USD", prix: "1.2", prixSaisi: "1.2", uniteLigne: null, motif: null, date: "2026-09-10", origine: "FACTURE", refId: "fac1", refLibelle: "B", autre: { devise: "CDF", valeur: 3360 }, moinsCher: false, ecartPct: 20, nbAchats: 2, ...o });
const LIGNES: LigneFournisseurArticle[] = [
  { fournisseurId: "f1", nom: "Marché central", habituel: true, prix: prix({ devise: "CDF", prix: "2800", prixSaisi: "2800", origine: "LISTE_ACHAT", refId: null, refLibelle: null, autre: { devise: "USD", valeur: 1 }, moinsCher: true, ecartPct: 0, date: "2026-09-01" }) },
  { fournisseurId: "f2", nom: "Grossiste Nord", habituel: false, prix: prix({}) },
  { fournisseurId: "f3", nom: "Épicerie Kasa", habituel: false, prix: null },
  { fournisseurId: "f4", nom: "Marchand de bottes", habituel: false, prix: prix({ prix: null, prixSaisi: "5", uniteLigne: "botte", motif: "conversion impossible", autre: null, ecartPct: null }) },
];

let conteneur: HTMLDivElement;
let racine: Root;
const monter = (estDirection: boolean, etat: "COMPARE" | "UN_SEUL" | "DEVISES_SANS_TAUX" | "AUCUN" = "COMPARE") =>
  act(() => racine.render(h(FournisseursArticle, { articleId: "a1", unite: "kg", lignes: LIGNES, autres: [{ id: "f9", nom: "Ferme Zébu" }], etat, estDirection })));
beforeEach(() => {
  habituel.mockClear(); ajouter.mockClear(); retirer.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; });

const ligne = (id: string) => conteneur.querySelector<HTMLElement>(`[data-fournisseur="${id}"]`)!;
const bouton = (t: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(t))!;
const coche = (id: string) => ligne(id).querySelector<HTMLInputElement>('input[type="checkbox"]')!;

describe("fiche article — fournisseurs et dernier prix", () => {
  it("chaque fournisseur est un lien vers sa fiche ; l'habituel porte un badge couleur + libellé", () => {
    monter(true);
    expect(ligne("f1").querySelector("a")!.getAttribute("href")).toBe("/stock/fournisseurs/f1");
    expect(ligne("f1").textContent).toContain("Habituel");
    expect(ligne("f2").textContent).not.toContain("Habituel");
    expect(ligne("f1").querySelector(".bg-emerald-100")).not.toBeNull();
  });

  it("le prix reste dans sa devise de saisie, l'autre en « ≈ » ; date et origine (lien vers la facture) ; « — » sans prix", () => {
    monter(true);
    expect(ligne("f1").textContent).toContain("2 800 FC");
    expect(ligne("f1").textContent).toContain("≈ 1,00 $");
    expect(ligne("f1").textContent).toContain("01/09/2026");
    expect(ligne("f1").textContent).toContain("Liste d'achat");
    expect(ligne("f2").textContent).toContain("1,20 $");
    expect(ligne("f2").textContent).toContain("≈ 3 360 FC");
    expect(ligne("f2").querySelector('a[href="/stock/factures/fac1"]')!.textContent).toBe("Facture n° B");
    expect(ligne("f3").textContent).toContain("—");
  });

  it("« Moins cher » pour le meilleur, l'écart en % pour les autres, « Unité non comparable » sans classer", () => {
    monter(true);
    expect(ligne("f1").textContent).toContain("Moins cher");
    expect(ligne("f2").textContent).toContain("+20 %");
    expect(ligne("f4").textContent).toContain("Unité non comparable");
    expect(ligne("f4").textContent).toContain("5,00 $ / botte"); // le prix saisi, avec son unité, jamais converti au hasard
  });

  it("la note dit pourquoi il n'y a pas de comparaison (devises mêlées sans taux)", () => {
    monter(true, "DEVISES_SANS_TAUX");
    expect(conteneur.querySelector("[data-note-prix]")!.textContent).toMatch(/taux du jour n'est pas défini/);
  });

  it("actions groupées : « Définir comme habituel » exige UN fournisseur non habituel ; « Retirer » prend toute la sélection", async () => {
    monter(true);
    expect(conteneur.textContent).not.toContain("Définir comme habituel"); // rien de coché : pas de barre
    await act(async () => { coche("f2").click(); coche("f3").click(); });
    expect(bouton("Définir comme habituel").disabled).toBe(true);
    await act(async () => coche("f3").click());
    expect(bouton("Définir comme habituel").disabled).toBe(false);
    await act(async () => bouton("Définir comme habituel").click());
    expect(habituel).toHaveBeenCalledWith("a1", "f2");
    expect(conteneur.querySelector('[role="status"]')!.textContent).toBe("ok");

    await act(async () => { coche("f2").click(); coche("f3").click(); });
    window.confirm = () => true;
    await act(async () => bouton("Retirer").click());
    expect(retirer).toHaveBeenCalledWith("a1", ["f2", "f3"]);
  });

  it("ajouter un fournisseur (hors liste de l'article) en tapant son nom ; hors Direction : proposition annoncée", async () => {
    monter(false);
    expect(bouton("Proposer l'ajout")).toBeTruthy();
    await choisirEnTapant(champChoix(conteneur, "Fournisseur à ajouter à l'article"), "zebu");
    await act(async () => bouton("Proposer l'ajout").click());
    expect(ajouter).toHaveBeenCalledWith("a1", ["f9"]);
    expect(conteneur.querySelector('[role="status"]')!.textContent).toMatch(/Proposition envoyée/);
  });
});
