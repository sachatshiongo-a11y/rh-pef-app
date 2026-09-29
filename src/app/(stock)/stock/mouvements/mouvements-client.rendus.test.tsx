// @vitest-environment happy-dom
//
// Saisie d'une sortie « Livraison restaurant » : si l'article n'alimentera pas le stock du restaurant
// (non rattaché, rattaché à plusieurs articles, unité incompatible), un avertissement NON BLOQUANT
// s'affiche avant la validation. Une perte n'avertit de rien.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({
  mouvementManuel: vi.fn(async () => undefined), supprimerMouvement: vi.fn(async () => undefined), supprimerMouvementsEnLot: vi.fn(async () => undefined),
  requalifierSorties: vi.fn(async () => ({ n: 0 })),
}));

const { MouvementForm, ColonneMouvements, BandeauPlafond, AVERTISSEMENT_LIVRAISON } = await import("./mouvements-client");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [{ id: "farine", designation: "Farine" }, { id: "sel", designation: "Sel" }, { id: "citron", designation: "Citron" }, { id: "vin", designation: "Vin" }, { id: "biere", designation: "Bière" }];
// Conseils calculés par le serveur (`conseilLivraison`) : un par article en défaut, aucun pour la farine.
const CONSEILS = {
  sel: { texte: "non rattaché : rattachez l'article", href: "/stock/restaurant" },
  citron: { texte: "à répartir : plusieurs articles du restaurant rattachés", href: "/stock/restaurant?espace=CUISINE" },
  vin: { texte: "unités incompatibles : corrigez l'unité du restaurant ou le rattachement", href: "/stock/restaurant?espace=BAR" },
  biere: { texte: "unité du restaurant non renseignée : renseignez-la dans Stock restaurant", href: "/stock/restaurant?espace=BAR" },
};

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter() {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(MouvementForm, { articles: ARTICLES, conseilsLivraison: CONSEILS })));
  act(() => bouton("Mouvement manuel").click());
  act(() => bouton("Sortie").click());
}
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte))!;
function choisir(select: HTMLSelectElement, valeur: string) {
  act(() => {
    select.value = valeur;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const motif = () => conteneur.querySelector<HTMLSelectElement>('select[name="categorieSortie"]')!;
const ligne = (i: number) => conteneur.querySelectorAll<HTMLSelectElement>('select[name="articleId"]')[i]!;
const avertissement = () => conteneur.querySelector('[role="status"][data-avertissement="livraison"]');

describe("mouvements — avertissement « Livraison restaurant »", () => {
  it("article non rattaché : avertit, sans bloquer la validation", () => {
    monter();
    choisir(motif(), "LIVRAISON_RESTAURANT");
    choisir(ligne(0), "sel");
    expect(avertissement()?.textContent).toContain("Sel");
    expect(avertissement()?.textContent).toContain(AVERTISSEMENT_LIVRAISON);
    expect(AVERTISSEMENT_LIVRAISON).toBe("cette livraison n'alimentera pas le stock du restaurant");
    const lien = avertissement()?.querySelector('a[href="/stock/restaurant"]');
    expect(lien?.textContent).toBe("non rattaché : rattachez l'article");
    expect(bouton("Valider la sortie").disabled).toBe(false);
  });

  it("chaque cas a son message et son lien : à répartir, unités incompatibles, unité du restaurant non renseignée", () => {
    monter();
    choisir(motif(), "LIVRAISON_RESTAURANT");
    choisir(ligne(0), "citron");
    choisir(ligne(1), "vin");
    choisir(ligne(2), "biere");
    const liens = [...avertissement()!.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(liens).toEqual([
      ["à répartir : plusieurs articles du restaurant rattachés", "/stock/restaurant?espace=CUISINE"],
      ["unités incompatibles : corrigez l'unité du restaurant ou le rattachement", "/stock/restaurant?espace=BAR"],
      ["unité du restaurant non renseignée : renseignez-la dans Stock restaurant", "/stock/restaurant?espace=BAR"],
    ]);
    expect(avertissement()!.textContent).toContain("« Citron »");
    expect(avertissement()!.textContent).toContain("« Bière »");
  });

  it("article bien rattaché, ou motif Perte : aucun avertissement", () => {
    monter();
    choisir(motif(), "LIVRAISON_RESTAURANT");
    choisir(ligne(0), "farine");
    expect(avertissement()).toBeNull();
    choisir(ligne(0), "sel");
    expect(avertissement()).not.toBeNull();
    choisir(motif(), "PERTE");
    expect(avertissement()).toBeNull();
  });
});

describe("colonne des sorties — motif et requalification groupée", () => {
  const M = (id: string, motif: string | null) => ({
    id, articleId: "farine", designation: `Farine ${id}`, dateISO: "2026-07-10", origine: "Import Excel", type: "SORTIE", quantite: 1,
    valeur: null, valeurEstimee: false, facture: null, bc: null, fournId: null, fournNom: null, motif,
  });
  function monterColonne(requalifiable: boolean, estDirection = true) {
    conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    act(() => racine.render(createElement(ColonneMouvements, {
      titre: "Sorties", signe: "−", couleur: "", estDirection, requalifiable,
      mouvements: [M("a", null), M("b", "LIVRAISON_RESTAURANT"), M("c", "PERTE")],
    })));
  }

  it("chaque sortie affiche son motif, « sans motif » compris", () => {
    monterColonne(true);
    const t = conteneur.textContent ?? "";
    expect(t).toContain("sans motif");
    expect(t).toContain("Livraison restaurant");
    expect(t).toContain("Perte");
  });

  it("Direction : « Tout sélectionner » puis « Changer le motif » dans la barre d'actions groupées", () => {
    monterColonne(true);
    const tout = conteneur.querySelector<HTMLInputElement>('input[aria-label="Tout sélectionner (3 affichés)"]')!;
    act(() => tout.click());
    expect(conteneur.textContent).toContain("3 sélectionné(s)");
    expect(bouton("Changer le motif (3)")).toBeTruthy();
  });

  it("pas de requalification hors Direction, ni sur la colonne des entrées", () => {
    monterColonne(false);
    act(() => conteneur.querySelector<HTMLInputElement>('input[aria-label="Sélectionner"]')!.click());
    expect(bouton("Changer le motif")).toBeUndefined();
    act(() => racine.unmount()); conteneur.remove();
    monterColonne(true, false);
    expect(conteneur.querySelector('input[aria-label^="Tout sélectionner"]')).toBeNull();
  });
});

describe("sélectionner TOUT le filtre (décision du 2026-09-29)", () => {
  const M = (id: string) => ({
    id, articleId: "farine", designation: `Farine ${id}`, dateISO: "2026-09-20", origine: "Import Excel", type: "SORTIE", quantite: 1,
    valeur: null, valeurEstimee: false, facture: null, bc: null, fournId: null, fournNom: null, motif: null,
  });
  const FILTRE = { mois: "2026-9", articleId: null, motif: "sans" as const };
  const lien = () => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Sélectionner les "));
  const toutCocher = () => act(() => conteneur.querySelector<HTMLInputElement>('input[aria-label^="Tout sélectionner"]')!.click());
  function monterFiltre(total: number, { estDirection = true, colonne = "SORTIES" as "SORTIES" | "ENTREES" } = {}) {
    conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    act(() => racine.render(createElement(ColonneMouvements, {
      titre: colonne === "SORTIES" ? "Sorties" : "Entrées", signe: "−", couleur: "", estDirection, requalifiable: colonne === "SORTIES",
      mouvements: [M("a"), M("b"), M("c")],
      toutLeFiltre: { filtre: FILTRE, colonne, libelle: "septembre 2026, sans motif", total },
    })));
  }

  it("le lien n'apparaît que si TOUT l'affiché est coché ET que le filtre compte davantage", () => {
    monterFiltre(467);
    expect(conteneur.textContent).toContain("3 affichées sur 467");
    act(() => conteneur.querySelector<HTMLInputElement>('input[aria-label="Sélectionner"]')!.click()); // 1 sur 3
    expect(lien()).toBeUndefined();
    toutCocher();
    expect(lien()?.textContent).toBe("Sélectionner les 467 sorties du filtre (septembre 2026, sans motif)");
    act(() => racine.unmount()); conteneur.remove();

    monterFiltre(3); // le filtre tient entièrement à l'écran
    toutCocher();
    expect(conteneur.textContent).toContain("3 sélectionné(s)");
    expect(lien()).toBeUndefined();
  });

  it("mode actif : la barre nomme l'ensemble ; « Changer le motif » envoie le filtre et le nombre confirmé ; décocher en sort", async () => {
    const actions = await import("./actions");
    const requalifier = vi.mocked(actions.requalifierSorties);
    (window as unknown as { confirm: (m: string) => boolean }).confirm = vi.fn(() => true);
    monterFiltre(467);
    toutCocher();
    act(() => lien()!.click());
    expect(conteneur.querySelector('[data-tout-le-filtre="actif"]')?.textContent).toBe("Les 467 sorties du filtre (septembre 2026, sans motif) sont sélectionnées");
    expect(bouton("Changer le motif (467)")).toBeTruthy();
    const select = conteneur.querySelector<HTMLSelectElement>('select[aria-label="Nouveau motif"]')!;
    act(() => { select.value = "LIVRAISON_RESTAURANT"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    requalifier.mockResolvedValueOnce({ erreur: "Le filtre compte maintenant 470 sorties, et non 467 comme confirmé : rien n'a été modifié.", nouveauNombre: 470 } as never);
    await act(async () => { bouton("Changer le motif (467)").click(); });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/^Changer le motif de 467 sorties \(septembre 2026, sans motif\) en « Livraison restaurant » \?/));
    expect(requalifier).toHaveBeenLastCalledWith({ filtre: FILTRE, colonne: "SORTIES", attendu: 467 }, "LIVRAISON_RESTAURANT", undefined);
    // Refus « le nombre a changé » : le nouveau nombre s'affiche, la prochaine confirmation le nomme.
    expect(conteneur.textContent).toContain("Les 470 sorties du filtre");
    expect(bouton("Changer le motif (470)")).toBeTruthy();

    act(() => conteneur.querySelector<HTMLInputElement>('input[aria-label="Sélectionner"]')!.click());
    expect(conteneur.querySelector('[data-tout-le-filtre="actif"]')).toBeNull();
    expect(conteneur.textContent).toContain("2 sélectionné(s)");
  });

  it("« Supprimer la sélection » en mode filtre : confirmation qui nomme le nombre et le filtre, puis le filtre est envoyé", async () => {
    const actions = await import("./actions");
    const supprimer = vi.mocked(actions.supprimerMouvementsEnLot);
    (window as unknown as { confirm: (m: string) => boolean }).confirm = vi.fn(() => true);
    monterFiltre(812, { colonne: "ENTREES" });
    toutCocher();
    act(() => lien()!.click());
    await act(async () => { bouton("Supprimer la sélection").click(); });
    expect(window.confirm).toHaveBeenCalledWith("Supprimer 812 entrées (septembre 2026, sans motif) ? Leur effet sur le stock sera annulé.");
    expect(supprimer).toHaveBeenLastCalledWith({ filtre: FILTRE, colonne: "ENTREES", attendu: 812 });
  });

  it("au-delà de la borne : pas de lien, une invitation à affiner ; hors Direction : rien", () => {
    monterFiltre(5001);
    toutCocher();
    expect(lien()).toBeUndefined();
    expect(conteneur.textContent).toContain("au-delà de 5000, affinez par mois, produit ou motif");
    act(() => racine.unmount()); conteneur.remove();
    monterFiltre(467, { estDirection: false });
    expect(conteneur.querySelector('input[aria-label^="Tout sélectionner"]')).toBeNull();
    expect(lien()).toBeUndefined();
  });

  it("bandeau au-dessus des colonnes : N affichés sur M, et quoi faire", () => {
    conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    act(() => racine.render(createElement(BandeauPlafond, { affiches: 600, total: 812, estDirection: true })));
    expect(conteneur.querySelector('[data-bandeau="plafond"]')?.textContent).toBe(
      "600 mouvements affichés sur 812 : les plus anciens ne sont pas à l'écran. Sélectionnez tout le filtre ou affinez par mois, produit ou motif.",
    );
  });
});
