// @vitest-environment happy-dom
//
// Formulaire « Modifier » de la fiche article : RÉUTILISE `modifierArticle` (même action que
// l'Inventaire). Le point à prouver : ce formulaire n'envoie JAMAIS `quantite` — le stock ne se
// modifie que par un mouvement, l'inventaire (comptage) ou une correction de stock négatif — et il
// envoie bien les champs modifiés (texte, catégorie/fournisseur en liste, et les cases numériques).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const appels = vi.hoisted(() => ({ modifier: vi.fn(async (_id: string, _fd: FormData): Promise<unknown> => undefined) }));
vi.mock("../actions", () => ({ modifierArticle: appels.modifier }));

const { EditerArticle } = await import("./editer-article");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLE = {
  id: "art1",
  domaine: "NOURRITURE" as const,
  code: "137",
  designation: "Farine",
  unite: "Kg",
  uniteParCarton: "24",
  prixUnitaireUSD: "2.5",
  categorieId: "cat1",
  fournisseurId: "f1",
  stockMinimum: "10",
  seuilUrgent: "3",
};
const CATEGORIES = [
  { id: "cat1", nom: "Farines", domaine: "NOURRITURE" },
  { id: "cat2", nom: "Épices", domaine: "NOURRITURE" },
  { id: "cat3", nom: "Boissons", domaine: "BOISSON" },
];
const FOURNISSEURS = [{ id: "f1", nom: "Marché central" }, { id: "f2", nom: "Grossiste Nord" }];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); appels.modifier.mockClear(); });

function monter() {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(EditerArticle, { a: ARTICLE, categories: CATEGORIES, fournisseurs: FOURNISSEURS })));
}
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte))!;
const champ = <T extends HTMLElement>(sel: string) => conteneur.querySelector<T>(sel)!;

function taperTexte(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function taperNombreEtValider(el: HTMLInputElement, texte: string) {
  act(() => el.focus());
  taperTexte(el, texte);
  await act(async () => { el.blur(); });
}
async function cliquer(b: HTMLElement) {
  await act(async () => b.click());
}

describe("fiche article — bouton Modifier", () => {
  it("fermé par défaut : seul le bouton « Modifier » est visible, pas de formulaire", () => {
    monter();
    expect(bouton("Modifier")).toBeTruthy();
    expect(conteneur.querySelector("form")).toBeNull();
  });

  it("« Modifier » ouvre le formulaire, pré-rempli avec les champs de l'article", async () => {
    monter();
    await cliquer(bouton("Modifier"));
    expect(champ<HTMLInputElement>('input[name="designation"]').value).toBe("Farine");
    expect(champ<HTMLInputElement>('input[name="code"]').value).toBe("137");
    expect(champ<HTMLInputElement>('input[name="unite"]').value).toBe("Kg");
    expect(champ<HTMLSelectElement>('select[name="categorieId"]').value).toBe("cat1");
    expect(champ<HTMLSelectElement>('select[name="fournisseurId"]').value).toBe("f1");
    // Seules les catégories du domaine de l'article (Nourriture) sont proposées.
    const options = [...champ<HTMLSelectElement>('select[name="categorieId"]').options].map((o) => o.textContent);
    expect(options).toEqual(["— à classer —", "Farines", "Épices"]);
  });

  it("« Annuler » referme le formulaire sans rien envoyer", async () => {
    monter();
    await cliquer(bouton("Modifier"));
    await cliquer(bouton("Annuler"));
    expect(conteneur.querySelector("form")).toBeNull();
    expect(appels.modifier).not.toHaveBeenCalled();
  });

  it("« Enregistrer » sans rien changer envoie les champs de l'article, JAMAIS quantite", async () => {
    monter();
    await cliquer(bouton("Modifier"));
    await cliquer(bouton("Enregistrer"));
    expect(appels.modifier).toHaveBeenCalledTimes(1);
    const [id, fd] = appels.modifier.mock.calls[0];
    expect(id).toBe("art1");
    expect(fd.has("quantite")).toBe(false); // le stock ne bouge pas depuis ce formulaire
    expect(fd.get("designation")).toBe("Farine");
    expect(fd.get("code")).toBe("137");
    expect(fd.get("unite")).toBe("Kg");
    expect(fd.get("categorieId")).toBe("cat1");
    expect(fd.get("fournisseurId")).toBe("f1");
    expect(fd.get("prixUnitaireUSD")).toBe("2.5");
    expect(fd.get("uniteParCarton")).toBe("24");
    expect(fd.get("stockMinimum")).toBe("10");
    expect(fd.get("seuilUrgent")).toBe("3");
  });

  it("modifier un texte, une liste et une case numérique : le formulaire envoie les NOUVELLES valeurs, toujours sans quantite", async () => {
    monter();
    await cliquer(bouton("Modifier"));

    taperTexte(champ<HTMLInputElement>('input[name="designation"]'), "Farine de blé");
    act(() => {
      const select = champ<HTMLSelectElement>('select[name="fournisseurId"]');
      select.value = "f2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await taperNombreEtValider(champ<HTMLInputElement>('input[aria-label="Prix unitaire USD"]'), "3,2");
    await taperNombreEtValider(champ<HTMLInputElement>('input[aria-label="Seuil urgent"]'), "5");

    await cliquer(bouton("Enregistrer"));
    expect(appels.modifier).toHaveBeenCalledTimes(1);
    const [, fd] = appels.modifier.mock.calls[0];
    expect(fd.has("quantite")).toBe(false);
    expect(fd.get("designation")).toBe("Farine de blé");
    expect(fd.get("fournisseurId")).toBe("f2");
    expect(fd.get("prixUnitaireUSD")).toBe("3.2");
    expect(fd.get("seuilUrgent")).toBe("5");
    // Les champs non touchés restent ceux de l'article.
    expect(fd.get("code")).toBe("137");
    expect(fd.get("uniteParCarton")).toBe("24");
    expect(fd.get("stockMinimum")).toBe("10");
  });

  it("après enregistrement réussi, le formulaire se referme", async () => {
    monter();
    await cliquer(bouton("Modifier"));
    await cliquer(bouton("Enregistrer"));
    expect(conteneur.querySelector("form")).toBeNull();
    expect(bouton("Modifier")).toBeTruthy();
  });

  it("une erreur de l'action reste affichée, le formulaire reste ouvert", async () => {
    appels.modifier.mockImplementationOnce(async () => ({ erreur: "Code déjà utilisé par un autre article." }));
    monter();
    await cliquer(bouton("Modifier"));
    await cliquer(bouton("Enregistrer"));
    expect(conteneur.textContent).toContain("Code déjà utilisé par un autre article.");
    expect(conteneur.querySelector("form")).not.toBeNull();
  });
});
