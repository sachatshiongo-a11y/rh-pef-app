// @vitest-environment happy-dom
//
// Grille du restaurant : le « Reçu du dépôt » s'affiche à côté du comptage, EN LECTURE SEULE (le
// comptage reste la seule saisie, par la case partagée `CelluleNombre`) ; la colonne « Stock
// théorique » montre l'état courant, « — » quand il est inconnu, et ses signalements.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Jour, LigneResto } from "./restaurant-client";
import { champChoix, choisirEnTapant } from "@/lib/test/choix-recherche";

const m = vi.hoisted(() => ({
  ajouterLiensResto: vi.fn<(...a: unknown[]) => Promise<{ n: number }>>(async () => ({ n: 1 })),
  retirerLiensResto: vi.fn<(...a: unknown[]) => Promise<{ n: number }>>(async () => ({ n: 1 })),
}));
vi.mock("./actions", () => ({
  majComptage: vi.fn(async () => undefined), modifierArticleResto: vi.fn(async () => undefined),
  creerArticleResto: vi.fn(async () => undefined), supprimerArticleResto: vi.fn(async () => undefined),
  ajouterLiensResto: m.ajouterLiensResto, retirerLiensResto: m.retirerLiensResto,
}));

const { RestaurantGrille } = await import("./restaurant-client");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOURS: Jour[] = [
  { iso: "2026-09-21", label: "Lun", num: "21 sept." },
  { iso: "2026-09-22", label: "Mar", num: "22 sept." },
];
const ligne = (p: Partial<LigneResto> & { id: string; designation: string }): LigneResto => ({
  categorie: null, unite: "g", base: "", comptages: {}, articlesStock: [],
  recus: {}, signauxJour: {}, theorique: { stock: null, aucunComptage: true, signalements: [] }, ...p,
});

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(lignes: LigneResto[]) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(RestaurantGrille, { espace: "CUISINE", jours: JOURS, lignes, categories: [], estDirection: false, catalogue: [] })));
}
const rangee = (designation: string) => [...conteneur.querySelectorAll("tbody tr")].find((tr) => (tr.querySelector("input") as HTMLInputElement | null)?.value === designation)!;

describe("grille du restaurant — reçu du dépôt et stock théorique", () => {
  it("le reçu du dépôt s'affiche à côté du comptage, en lecture seule", () => {
    monter([
      ligne({
        id: "farine", designation: "Farine", comptages: { "2026-09-22": "900" }, articlesStock: [{ id: "cat", designation: "Farine", unite: "kg" }],
        recus: { "2026-09-21": "2000" }, theorique: { stock: "900", aucunComptage: false, signalements: [] },
      }),
    ]);
    const tr = rangee("Farine");
    const recu = tr.querySelector('[aria-label="Reçu du dépôt — Farine — Lun 21 sept."]')!;
    expect(recu).not.toBeNull();
    expect(recu.textContent).toContain("2 000");
    expect(recu.tagName).not.toBe("INPUT");
    expect(recu.querySelector("input")).toBeNull();
    // Aucun reçu le mardi : rien n'est affiché (pas de 0 inventé).
    expect(tr.querySelector('[aria-label="Reçu du dépôt — Farine — Mar 22 sept."]')).toBeNull();
    // Saisies : désignation, unité, stock de base et un comptage par jour — rien de plus.
    expect(tr.querySelectorAll("input").length).toBe(3 + JOURS.length);
    expect(conteneur.textContent).toContain("Reçu du dépôt");
  });

  it("colonne « Stock théorique » : valeur, « — » si inconnue, mention sans comptage, signalements", () => {
    monter([
      ligne({ id: "a", designation: "Farine", theorique: { stock: "3500", aucunComptage: false, signalements: [] } }),
      ligne({ id: "b", designation: "Sel" }),
      ligne({ id: "c", designation: "Tomate", theorique: { stock: "2000", aucunComptage: true, signalements: [] } }),
      ligne({ id: "d", designation: "Citron", unite: "pièce", theorique: { stock: "10", aucunComptage: false, signalements: ["12 pièce du 22/09 à répartir"] } }),
    ]);
    expect([...conteneur.querySelectorAll("thead th")].some((th) => th.textContent?.includes("Stock théorique"))).toBe(true);
    const cellule = (d: string) => rangee(d).querySelector('[data-colonne="stock-theorique"]')!;
    expect(cellule("Farine").textContent).toContain("3 500 g");
    expect(cellule("Sel").textContent?.trim()).toBe("—");
    expect(cellule("Tomate").textContent).toContain("estimé");
    expect(cellule("Tomate").getAttribute("title") ?? cellule("Tomate").innerHTML).toContain("aucun comptage : stock estimé à partir des seules livraisons");
    expect(cellule("Citron").textContent).toContain("12 pièce du 22/09 à répartir");
  });

  it("deux signalements identiques (deux livraisons de 12 pièces le même jour) : pas de clé React en double", () => {
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
    monter([ligne({
      id: "d", designation: "Citron", unite: "pièce",
      signauxJour: { "2026-09-21": ["12 pièce : à répartir", "12 pièce : à répartir"] },
      theorique: { stock: "10", aucunComptage: false, signalements: ["12 pièce du 21/09 : à répartir", "12 pièce du 21/09 : à répartir"] },
    })]);
    expect(erreurs.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    // Deux vues dans le DOM (liste du jour du téléphone, tableau de la semaine) : deux signalements chacune.
    for (const vue of ["jour", "semaine"]) {
      expect(conteneur.querySelector(`[data-vue="${vue}"]`)!.textContent!.split("12 pièce du 21/09 : à répartir").length - 1).toBe(2);
    }
    erreurs.mockRestore();
  });
});

describe("grille du restaurant — plusieurs articles du catalogue par ligne (plusieurs marques)", () => {
  const CATALOGUE = [
    { id: "president", designation: "Beurre Président 250 g", unite: "Pièce" },
    { id: "lurpak", designation: "Beurre Lurpak 500 g", unite: "Pièce", recherche: ["Lurpak"] },
    { id: "vache", designation: "Beurre La Vache qui rit", unite: "Pièce" },
  ];
  const montes = (lignes: LigneResto[]) => {
    conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    act(() => racine.render(createElement(RestaurantGrille, { espace: "CUISINE", jours: JOURS, lignes, categories: [], estDirection: false, catalogue: CATALOGUE })));
  };
  const beurre = ligne({ id: "beurre", designation: "Beurre", unite: "kg", articlesStock: [{ id: "president", designation: "Beurre Président 250 g", unite: "Pièce" }, { id: "lurpak", designation: "Beurre Lurpak 500 g", unite: "Pièce" }] });

  it("chaque article rattaché est listé (lien vers sa fiche, unité), avec « + Ajouter une marque » ; sans lien : « Non rattaché »", () => {
    montes([beurre, ligne({ id: "sel", designation: "Sel" })]);
    const liens = [...conteneur.querySelectorAll("[data-article-rattache]")];
    expect(liens.map((l) => l.getAttribute("data-article-rattache"))).toEqual(["president", "lurpak"]);
    expect(liens[0]!.querySelector("a")!.getAttribute("href")).toBe("/stock/catalogue/president");
    expect(liens[0]!.textContent).toContain("(Pièce)");
    const texte = conteneur.textContent!;
    expect(texte).toContain("+ Ajouter une marque");
    expect(texte).toContain("Non rattaché");
  });

  it("retirer une marque demande confirmation, puis appelle l'action avec CE seul article", async () => {
    m.retirerLiensResto.mockClear();
    montes([beurre]);
    const bouton = conteneur.querySelector<HTMLButtonElement>('[aria-label="Détacher Beurre Lurpak 500 g de Beurre"]')!;
    vi.stubGlobal("confirm", vi.fn(() => false));
    await act(async () => { bouton.click(); });
    expect(m.retirerLiensResto).not.toHaveBeenCalled(); // refusé à la confirmation : rien n'est détaché
    vi.stubGlobal("confirm", vi.fn(() => true));
    await act(async () => { bouton.click(); });
    vi.unstubAllGlobals();
    expect(m.retirerLiensResto).toHaveBeenCalledWith("beurre", ["lurpak"]);
  });

  it("ajouter : le choix d'article au clavier (taper « lurpak » trouve par le nom court), l'action reçoit l'article choisi", async () => {
    m.ajouterLiensResto.mockClear();
    montes([ligne({ id: "beurre", designation: "Beurre", unite: "kg" })]);
    await act(async () => { [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Rattacher")!.click(); });
    const champ = champChoix(conteneur, "Article du catalogue à rattacher à Beurre");
    await choisirEnTapant(champ, "lurpak");
    expect(m.ajouterLiensResto).toHaveBeenCalledWith("beurre", ["lurpak"]);
  });

  it("un rattachement ou un détachement demandé à la Direction s'affiche « en attente de validation » (le lien posé reste visible, sans ✕ pour le retrait demandé)", () => {
    montes([ligne({
      id: "beurre", designation: "Beurre", unite: "kg",
      articlesStock: [{ id: "president", designation: "Beurre Président 250 g", unite: "Pièce" }, { id: "lurpak", designation: "Beurre Lurpak 500 g", unite: "Pièce" }],
      liensEnAttente: [{ id: "lurpak", designation: "Beurre Lurpak 500 g", op: "RETRAIT" }, { id: "vache", designation: "Beurre La Vache qui rit", op: "AJOUT" }],
    })]);
    const lurpak = conteneur.querySelector('[data-article-rattache="lurpak"]')!;
    expect(lurpak.querySelector('[data-en-attente="RETRAIT"]')!.textContent).toBe("retrait en attente de validation");
    expect(lurpak.querySelector("button")).toBeNull(); // pas de second détachement pendant la demande
    expect(conteneur.querySelector('[data-article-rattache="president"] button')).not.toBeNull();
    const vache = conteneur.querySelector('[data-article-en-attente="vache"]')!;
    expect(vache.textContent).toContain("Beurre La Vache qui rit");
    expect(vache.querySelector('[data-en-attente="AJOUT"]')!.textContent).toBe("en attente de validation");
    expect(conteneur.querySelector('[data-article-rattache="vache"]')).toBeNull(); // pas encore rattaché
  });

  it("la réponse « demande envoyée » de l'action est annoncée à l'écran (Direction pas encore passée)", async () => {
    m.ajouterLiensResto.mockResolvedValueOnce({ n: 0, enAttente: 1 } as never);
    montes([ligne({ id: "beurre", designation: "Beurre", unite: "kg" })]);
    await act(async () => { [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Rattacher")!.click(); });
    await choisirEnTapant(champChoix(conteneur, "Article du catalogue à rattacher à Beurre"), "lurpak");
    expect(conteneur.querySelector('[role="status"]')!.textContent).toContain("Demande envoyée à la Direction");
  });
});
