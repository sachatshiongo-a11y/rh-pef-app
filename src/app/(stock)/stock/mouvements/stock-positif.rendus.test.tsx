// @vitest-environment happy-dom
//
// Un stock ne passe jamais sous 0 (Sacha, 2026-10-09) — ce que voit la personne qui saisit une sortie :
// le stock disponible à côté de la quantité, la ligne qui dépasse en rouge avec les articles proches
// en stock (« Utiliser … », jamais de remplacement automatique), le bouton bloqué ; et, si le serveur
// refuse quand même (stock changé entre-temps), son message et ses propositions.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { mouvementManuel } = vi.hoisted(() => ({ mouvementManuel: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ demande: false, message: "Sortie enregistrée : stock décrémenté." })) }));
vi.mock("./actions", () => ({
  mouvementManuel, supprimerMouvement: vi.fn(async () => undefined), supprimerMouvementsEnLot: vi.fn(async () => undefined),
  requalifierSorties: vi.fn(async () => ({ n: 0 })), changerDateSorties: vi.fn(async () => ({ n: 0, deja: 0, date: "2026-10-09" })),
}));

import { champsParNom, choisirOption, valeurChoisie } from "@/lib/test/choix-recherche";

const { MouvementForm, depassements } = await import("./mouvements-client");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "tomate", designation: "Tomate", unite: "kg", domaine: "NOURRITURE", quantite: 5 },
  { id: "tomates", designation: "Tomates", unite: "kg", domaine: "NOURRITURE", quantite: 12 },
  { id: "tomates-b", designation: "Tomates", unite: "kg", domaine: "BOISSON", quantite: 40 },
  { id: "riz", designation: "Riz", unite: "Sac", domaine: "NOURRITURE", quantite: 0 },
  { id: "vodka", designation: "Absolut Vodka-75cl", unite: "Bouteille", domaine: "BOISSON", quantite: 2 },
  { id: "beurre", designation: "Beurre", unite: null, domaine: "NOURRITURE", quantite: -3 },
];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); mouvementManuel.mockClear(); });
function monter() {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(MouvementForm, { articles: ARTICLES })));
  act(() => bouton("Mouvement manuel").click());
  act(() => bouton("Sortie").click());
  const motif = conteneur.querySelector<HTMLSelectElement>('select[name="categorieSortie"]')!;
  act(() => { motif.value = "LIVRAISON_RESTAURANT"; motif.dispatchEvent(new Event("change", { bubbles: true })); });
}
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte))!;
const ligne = (i: number) => champsParNom(conteneur, "articleId")[i]!;
const qteDe = (i: number) => conteneur.querySelectorAll<HTMLInputElement>('input[name="quantite"]')[i]!;
function saisir(input: HTMLInputElement, v: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const valider = () => bouton("Valider la sortie") as HTMLButtonElement;
const alerte = (id: string) => conteneur.querySelector(`[data-depasse="${id}"]`);

describe("sortie : stock disponible à côté de la quantité, dépassement bloqué", () => {
  it("stock 5 : 5 laisse le bouton actif ; 6 met la ligne en rouge, nomme le stock et bloque le bouton", async () => {
    monter();
    await choisirOption(ligne(0), "tomate");
    expect(conteneur.querySelector("[data-stock-dispo]")?.textContent).toBe("Stock : 5 kg");
    saisir(qteDe(0), "5");
    expect(alerte("tomate")).toBeNull();
    expect(valider().disabled).toBe(false);
    saisir(qteDe(0), "6");
    expect(alerte("tomate")?.textContent).toContain("Dépasse le stock : 5 kg disponibles, 6 kg demandés.");
    expect(qteDe(0).getAttribute("aria-invalid")).toBe("true");
    expect(valider().disabled).toBe(true);
  });

  it("deux lignes du même article s'additionnent (3 + 3 sur 5)", async () => {
    monter();
    await choisirOption(ligne(0), "tomate"); saisir(qteDe(0), "3");
    await choisirOption(ligne(1), "tomate"); saisir(qteDe(1), "3");
    expect(alerte("tomate")?.textContent).toContain("5 kg disponibles, 6 kg demandés (toutes les lignes de cet article)");
    expect(valider().disabled).toBe(true);
  });

  it("propose les articles proches EN STOCK du même domaine ; « Utiliser » remplace l'article de la ligne, la quantité reste", async () => {
    monter();
    await choisirOption(ligne(0), "tomate"); saisir(qteDe(0), "8");
    const propositions = [...alerte("tomate")!.querySelectorAll("[data-utiliser]")].map((b) => b.textContent);
    expect(propositions).toEqual(["Utiliser « Tomates » (12 kg)"]); // pas celles des Boissons
    expect(valeurChoisie(ligne(0))).toBe("tomate"); // rien de remplacé d'office
    act(() => (alerte("tomate")!.querySelector('[data-utiliser="tomates"]') as HTMLButtonElement).click());
    expect(valeurChoisie(ligne(0))).toBe("tomates");
    expect(qteDe(0).value).toBe("8");
    expect(conteneur.querySelector("[data-depasse]")).toBeNull();
    expect(valider().disabled).toBe(false);
  });

  it("stock nul ou déjà négatif, unité absente : dit tel quel, sans unité inventée ; bouteilles comptées en bouteilles", async () => {
    monter();
    await choisirOption(ligne(0), "beurre"); saisir(qteDe(0), "1");
    expect(conteneur.querySelector("[data-stock-dispo]")?.textContent).toBe("Stock : -3");
    expect(alerte("beurre")?.textContent).toContain("Stock déjà négatif (-3) : aucune sortie possible avant sa correction.");
    await choisirOption(ligne(1), "vodka"); saisir(qteDe(1), "2,5");
    expect(alerte("vodka")?.textContent).toContain("2 Bouteille disponibles, 2,5 Bouteille demandés");
    expect(alerte("vodka")?.textContent).toContain("Aucun article proche n'a de stock.");
  });

  it("une entrée n'est jamais bloquée par le stock", async () => {
    monter();
    act(() => bouton("Entrée").click());
    await choisirOption(ligne(0), "riz"); saisir(qteDe(0), "50");
    expect(conteneur.querySelector("[data-depasse]")).toBeNull();
    expect((bouton("Valider l'entrée") as HTMLButtonElement).disabled).toBe(false);
  });

  it("refus du serveur (stock changé entre-temps) : message tel quel, lignes gardées, propositions du serveur", async () => {
    mouvementManuel.mockResolvedValueOnce({
      erreur: "Stock insuffisant — un stock ne passe jamais sous 0 : Tomate : 2 kg disponibles, 4 kg demandés. Rien n'a été enregistré.",
      insuffisants: [{ articleId: "tomate", designation: "Tomate", unite: "kg", disponible: 2, demande: 4, proches: [{ id: "tomates", designation: "Tomates", unite: "kg", disponible: 9 }] }],
    });
    monter();
    await choisirOption(ligne(0), "tomate"); saisir(qteDe(0), "4");
    await act(async () => { conteneur.querySelector("form")!.requestSubmit(); });
    await vi.waitFor(() => expect(conteneur.textContent).toContain("Tomate : 2 kg disponibles, 4 kg demandés"));
    expect(valeurChoisie(ligne(0))).toBe("tomate");
    expect(alerte("tomate")?.querySelector('[data-utiliser="tomates"]')?.textContent).toBe("Utiliser « Tomates » (9 kg)");
  });
});

describe("depassements (pur)", () => {
  it("millièmes exacts, stock inconnu non jugé, lignes illisibles ignorées", () => {
    const stock = new Map([["a", 0.3], ["b", 5]]);
    expect(depassements([{ articleId: "a", quantite: "0,1" }, { articleId: "a", quantite: "0,2" }], stock).size).toBe(0);
    expect(depassements([{ articleId: "a", quantite: "0,301" }], stock).get("a")).toEqual({ disponible: 0.3, demande: 0.301 });
    expect(depassements([{ articleId: "inconnu", quantite: "99" }, { articleId: "b", quantite: "abc" }], stock).size).toBe(0);
  });
});

describe("unité de l'article à côté de chaque quantité (2026-10-09)", () => {
  it("colonnes Entrées/Sorties : « 3 kg », « 2 Bouteille » ; sans unité : « — », jamais devinée", async () => {
    const { ColonneMouvements } = await import("./mouvements-client");
    conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    const m = (id: string, designation: string, quantite: number, unite: string | null) => ({ id, articleId: id, designation, dateISO: "2026-10-09", origine: null, type: "SORTIE", quantite, unite, valeur: null, valeurEstimee: false, facture: null, bc: null, fournId: null, fournNom: null, motif: "PERTE" });
    act(() => racine.render(createElement(ColonneMouvements, { titre: "Sorties", signe: "−", couleur: "", estDirection: false, mouvements: [m("riz", "Riz", 3, "kg"), m("vodka", "Vodka", 2, "Bouteille"), m("sel", "Sel", 1, null)] })));
    expect([...conteneur.querySelectorAll("[data-unite]")].map((e) => e.closest("div")!.textContent)).toEqual(["−3 kg", "−2 Bouteille", "−1 —"]);
  });
});
