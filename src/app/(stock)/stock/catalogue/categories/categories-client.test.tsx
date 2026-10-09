// @vitest-environment happy-dom
//
// Écran Inventaire › Catégories (demande de la Direction, 2026-10-09) : les catégories par domaine avec
// leur nombre d'articles ; la Direction coche et agit en lot, crée, modifie, ordonne, archive, supprime ;
// les autres rôles lisent. Ce que ce test ne voit pas : la mise en page réelle (vérifiée à l'œil).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const M = vi.hoisted(() => ({
  basculerActifCategories: vi.fn(async (..._a: unknown[]) => undefined as unknown),
  creerCategorie: vi.fn(async (..._a: unknown[]) => undefined as unknown),
  deplacerCategorie: vi.fn(async (..._a: unknown[]) => undefined as unknown),
  modifierCategorie: vi.fn(async (..._a: unknown[]) => undefined as unknown),
  supprimerCategories: vi.fn(async (..._a: unknown[]) => undefined as unknown),
}));
vi.mock("./actions", () => M);

const { CategoriesClient } = await import("./categories-client");

const CATS = [
  { id: "n1", nom: "Épicerie", domaine: "NOURRITURE", actif: true, nbArticles: 12 },
  { id: "n2", nom: "Surgelés", domaine: "NOURRITURE", actif: false, nbArticles: 1 },
  { id: "n3", nom: "Vide", domaine: "NOURRITURE", actif: true, nbArticles: 0 },
  { id: "b1", nom: "Sodas", domaine: "BOISSON", actif: true, nbArticles: 3 },
];

let conteneur: HTMLDivElement;
let racine: Root;
const monter = (estDirection: boolean) => act(() => racine.render(h(CategoriesClient, { categories: CATS, estDirection })));
beforeEach(() => {
  vi.clearAllMocks();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const ligne = (id: string) => conteneur.querySelector<HTMLElement>(`[data-categorie="${id}"]`)!;
const clic = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const bouton = (parent: ParentNode, texte: string) => [...parent.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === texte)!;
const case_ = (id: string) => ligne(id).querySelector<HTMLInputElement>('input[type="checkbox"]')!;

describe("liste par domaine", () => {
  it("groupe par domaine avec le nombre d'articles de chacune, les archivées marquées", () => {
    monter(true);
    expect(conteneur.querySelector('section[aria-label="Nourriture"]')!.textContent).toContain("Épicerie");
    expect(conteneur.querySelector('section[aria-label="Boissons"]')!.textContent).toContain("Sodas");
    expect(ligne("n1").textContent).toContain("12 articles");
    expect(ligne("n2").textContent).toContain("1 article");
    expect(ligne("n2").textContent).not.toContain("1 articles");
    expect(ligne("n2").textContent).toContain("Archivée");
    expect(ligne("n1").textContent).not.toContain("Archivée");
  });

  it("les pilules de domaine filtrent la liste et affichent le nombre de catégories", () => {
    monter(true);
    const pilules = conteneur.querySelector("[data-pilules-domaine]")!;
    expect(pilules.textContent).toContain("Tous4");
    clic(bouton(pilules, "Boissons1"));
    expect(conteneur.querySelector('section[aria-label="Nourriture"]')).toBeNull();
    expect(ligne("b1")).not.toBeNull();
  });
});

describe("Direction : actions groupées et gestes par ligne", () => {
  it("cases à cocher + barre : Archiver et Réactiver agissent sur les catégories cochées", () => {
    monter(true);
    clic(case_("n1")); clic(case_("b1"));
    expect(conteneur.textContent).toContain("2 sélectionné(s)");
    clic(bouton(conteneur, "Archiver")); // le premier « Archiver » du document est celui de la barre (avant les lignes)
    expect(M.basculerActifCategories).toHaveBeenCalledWith(expect.arrayContaining(["n1", "b1"]), false);
  });

  it("Supprimer en lot : refusé à l'écran si une catégorie cochée a des articles, rien n'est envoyé", () => {
    monter(true);
    clic(case_("n1")); clic(case_("n3"));
    clic(bouton(conteneur, "Supprimer"));
    expect(conteneur.querySelector('[role="alert"]')!.textContent).toContain("« Épicerie » (12 articles)");
    expect(M.supprimerCategories).not.toHaveBeenCalled();
  });

  it("le bouton ✕ d'une catégorie qui a des articles est désactivé, celui d'une vide ne l'est pas", () => {
    monter(true);
    expect(ligne("n1").querySelector<HTMLButtonElement>('button[aria-label="Supprimer Épicerie"]')!.disabled).toBe(true);
    expect(ligne("n3").querySelector<HTMLButtonElement>('button[aria-label="Supprimer Vide"]')!.disabled).toBe(false);
  });

  it("monter / descendre : pas de « monter » sur la première, pas de « descendre » sur la dernière du domaine", () => {
    monter(true);
    expect(ligne("n1").querySelector<HTMLButtonElement>('button[aria-label="Monter Épicerie"]')!.disabled).toBe(true);
    expect(ligne("n3").querySelector<HTMLButtonElement>('button[aria-label="Descendre Vide"]')!.disabled).toBe(true);
    clic(ligne("n3").querySelector('button[aria-label="Monter Vide"]')!);
    expect(M.deplacerCategorie).toHaveBeenCalledWith("n3", "haut");
  });

  it("Modifier : le domaine est verrouillé avec l'explication tant que la catégorie a des articles, libre sinon", () => {
    monter(true);
    clic(bouton(ligne("n1"), "Modifier"));
    expect(ligne("n1").querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
    expect(ligne("n1").textContent).toContain("Déplacez d'abord ses 12 articles");
    clic(bouton(ligne("n1"), "Annuler"));
    clic(bouton(ligne("n3"), "Modifier"));
    expect(ligne("n3").querySelector<HTMLSelectElement>("select")!.disabled).toBe(false);
  });

  it("nom proche : avertissement + « Créer quand même » qui renvoie le drapeau ; doublon certain : refus sec sans bouton", async () => {
    const existante = { id: "n1", nom: "Épicerie", domaine: "NOURRITURE", actif: true };
    M.creerCategorie.mockResolvedValueOnce({ doublon: true, categorie: existante, confirmable: true, message: "« Epicerie sèche » ressemble à la catégorie « Épicerie » (Nourriture)." });
    monter(true);
    clic(bouton(conteneur, "+ Nouvelle catégorie"));
    const form = conteneur.querySelector("form")!;
    (form.querySelector('input[name="nom"]') as HTMLInputElement).value = "Epicerie sèche";
    await act(async () => { form.requestSubmit(); });
    expect(conteneur.querySelector("[data-choix-categorie]")!.textContent).toContain("ressemble à la catégorie « Épicerie »");
    expect((M.creerCategorie.mock.calls[0][0] as FormData).get("quandMeme")).toBeNull();
    await act(async () => { bouton(conteneur, "Créer quand même").click(); });
    expect((M.creerCategorie.mock.calls[1][0] as FormData).get("quandMeme")).toBe("1");
    expect(conteneur.querySelector("[data-choix-categorie]")).toBeNull();

    M.modifierCategorie.mockResolvedValueOnce({ doublon: true, categorie: existante, confirmable: false, message: "La catégorie « Épicerie » (Nourriture) existe déjà." });
    clic(bouton(ligne("n3"), "Modifier"));
    await act(async () => { ligne("n3").querySelector("form")!.requestSubmit(); });
    expect(conteneur.querySelector('[role="alert"]')!.textContent).toContain("existe déjà");
    expect(conteneur.querySelector("[data-choix-categorie]")).toBeNull();
  });

  it("le refus du serveur s'affiche tel quel", async () => {
    M.creerCategorie.mockResolvedValueOnce({ erreur: "La catégorie « Tomates » (Nourriture) existe déjà. Utilisez-la plutôt." });
    monter(true);
    clic(bouton(conteneur, "+ Nouvelle catégorie"));
    const form = conteneur.querySelector("form")!;
    (form.querySelector('input[name="nom"]') as HTMLInputElement).value = "tomate";
    await act(async () => { form.requestSubmit(); });
    expect(conteneur.querySelector('[role="alert"]')!.textContent).toContain("« Tomates » (Nourriture) existe déjà");
  });
});

describe("autres rôles : lecture seule", () => {
  it("la liste et les comptes sont là, mais ni cases, ni barre, ni boutons de geste", () => {
    monter(false);
    expect(ligne("n1").textContent).toContain("12 articles");
    expect(conteneur.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(conteneur.textContent).toContain("seule la Direction peut");
    const textes = [...conteneur.querySelectorAll("button")].map((b) => b.textContent);
    for (const interdit of ["+ Nouvelle catégorie", "Modifier", "Archiver", "Supprimer", "↑", "↓"]) expect(textes).not.toContain(interdit);
  });
});
