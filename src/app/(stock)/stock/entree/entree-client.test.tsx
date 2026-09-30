// @vitest-environment happy-dom
//
// Liste d'achat (Stock → Achats & mouvements) : mise en page « tableur » sur ordinateur (UNE rangée
// par ligne, en-tête de colonnes unique), carte compacte sur téléphone, cases de nombres sans
// flèches, Entrée qui descend sans jamais envoyer, et ENVOI INCHANGÉ (mêmes champs, même ordre).
//
// Ce que ce fichier ne voit pas : les pixels. Happy-dom n'applique pas les requêtes de conteneur
// (`@4xl:`) ; on vérifie donc les classes posées, et la mise en page réelle se contrôle à l'œil
// (1440 × 900 et 375 × 812 — voir le compte rendu de la livraison).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const { entree, verifier } = vi.hoisted(() => ({
  entree: vi.fn(async () => ({ crees: [], fournisseursCrees: [], avertissements: [] })),
  verifier: vi.fn(async () => ({ avertissements: [] })),
}));
vi.mock("./actions", () => ({ entreeListeAchat: entree, verifierDoublonsListe: verifier }));

import { ListeAchatForm } from "./entree-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "a0", designation: "Farine T55", unite: "Kg", domaine: "NOURRITURE", prix: "1.00" },
  { id: "a2", designation: "Huile de palme", unite: "pièce", domaine: "NOURRITURE", prix: "1.70" },
  { id: "a16", designation: "Eau minérale 1,5 L", unite: "L", domaine: "BOISSON", prix: "6.60" },
];
const FOURNISSEURS = [{ id: "f0", nom: "Maman Épiphanie" }, { id: "f1", nom: "Grossiste Kin" }];

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  entree.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(ListeAchatForm, { articles: ARTICLES, fournisseurs: FOURNISSEURS, aujourdhui: "2026-09-30", taux: 2800, estDirection: true })));
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const lignes = () => [...conteneur.querySelectorAll<HTMLElement>("[data-ligne-achat]")];
const form = () => conteneur.querySelector("form")!;
const cas = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="${nom}"]`)!;
const active = () => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label");
const classes = (el: Element) => el.getAttribute("class") ?? "";
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.trim() === texte)!;

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** Saisie puis sortie de la case (la case partagée enregistre à la sortie, comme à l'écran). */
async function saisir(el: HTMLInputElement, texte: string) {
  act(() => el.focus());
  taper(el, texte);
  await act(async () => el.blur());
}
function choisir(el: HTMLSelectElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, valeur);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function entree_(el: HTMLElement) {
  let ev!: KeyboardEvent;
  await act(async () => {
    ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  });
  return ev;
}
/**
 * Ce que le navigateur enverrait : les champs nommés, dans l'ordre du document, SANS les champs
 * désactivés (happy-dom, lui, les inclut — le domaine figé d'un article du catalogue doublerait).
 */
function donnees(): [string, string][] {
  return [...form().elements]
    .filter((e): e is HTMLInputElement | HTMLSelectElement => "name" in e && !!(e as HTMLInputElement).name && !(e as HTMLInputElement).disabled && (e as HTMLInputElement).type !== "submit" && (e as HTMLInputElement).type !== "button")
    .map((e) => [e.name, e.value]);
}

describe("Liste d'achat — ordinateur : un tableur, une rangée par ligne", () => {
  it("UNE rangée par ligne d'achat (4 au départ, une de plus avec « + Ligne »)", () => {
    expect(lignes()).toHaveLength(4);
    act(() => bouton("+ Ligne").click());
    expect(lignes()).toHaveLength(5);
    // Une rangée = une seule grille de 9 colonnes : article, désignation, unité, domaine, qté, PU, montant, fournisseur, ✕.
    for (const l of lignes()) expect(classes(l)).toMatch(/@4xl:grid-cols-\[[^\]]*\]/);
    const gabarit = /@4xl:grid-cols-\[([^\]]*)\]/.exec(classes(lignes()[0]))![1];
    expect(gabarit.split("_")).toHaveLength(9);
  });

  it("l'en-tête de colonnes est UNIQUE (pas répété dans chaque ligne) et n'apparaît que sur la liste large", () => {
    const entetes = [...conteneur.querySelectorAll("span")].filter((s) => s.textContent === "Article (catalogue)");
    expect(entetes).toHaveLength(1);
    const barre = entetes[0].parentElement!;
    expect(classes(barre)).toMatch(/\bhidden\b/);
    expect(classes(barre)).toMatch(/@4xl:grid\b/);
    expect(barre.textContent).toBe("Article (catalogue)Désignation (libre si nouveau)UnitéDomaineQtéPU USDMontant USDFournisseur (facultatif)Retirer");
    act(() => bouton("+ Ligne").click());
    expect([...conteneur.querySelectorAll("span")].filter((s) => s.textContent === "Article (catalogue)")).toHaveLength(1);
    // L'en-tête n'est dans aucune ligne.
    for (const l of lignes()) expect(l.contains(barre)).toBe(false);
  });

  it("la devise choisie en haut se lit dans les en-têtes (PU CDF, Montant CDF)", () => {
    act(() => bouton("CDF (FC)").click());
    const barre = [...conteneur.querySelectorAll("span")].find((s) => s.textContent === "Article (catalogue)")!.parentElement!;
    expect(barre.textContent).toContain("PU CDF");
    expect(barre.textContent).toContain("Montant CDF");
    expect(barre.textContent).not.toContain("USD");
  });

  it("la liste suit la largeur de SA colonne (requête de conteneur), pas celle de l'écran", () => {
    const enveloppe = lignes()[0].parentElement!.parentElement!;
    expect(classes(enveloppe)).toContain("@container");
  });
});

describe("Liste d'achat — téléphone : une carte compacte par ligne", () => {
  it("chaque ligne est une carte (bordure arrondie) de 5 pistes, réordonnée : article + montant + ✕, puis qté × PU, unité, ⋯", () => {
    for (const l of lignes()) {
      expect(classes(l)).toMatch(/\brounded-lg\b/);
      expect(classes(l)).toMatch(/\bborder\b/);
      expect(classes(l)).toContain("grid-cols-[4rem_1rem_4.5rem_minmax(0,1fr)_2.75rem]");
    }
    const l = lignes()[0];
    const ordre = (nom: string) => Number(/\border-(\d+)\b/.exec(classes(cas(nom)))?.[1]);
    const art = Number(/\border-(\d+)\b/.exec(classes(l.querySelector("select[name=articleId]")!))?.[1]);
    // Rangée 1 : article (1), montant (2), ✕ (3) — rangée 2 : qté (4), × (5), PU (6), unité (7), ⋯ (8).
    expect(art).toBe(1);
    expect(ordre("Montant USD, ligne 1")).toBe(2);
    expect(ordre("Retirer la ligne 1")).toBe(3);
    expect(ordre("Quantité, ligne 1")).toBe(4);
    expect(ordre("Prix unitaire USD, ligne 1")).toBe(6);
    expect(ordre("Unité, ligne 1")).toBe(7);
    expect(ordre("Fournisseur et détails, ligne 1")).toBe(8);
    // Le montant est mis en évidence.
    expect(classes(cas("Montant USD, ligne 1"))).toContain("font-semibold");
  });

  it("toutes les cibles de la carte font 44 px (h-11) ; ✕ et ⋯ sont des carrés de 44 px", () => {
    const l = lignes()[0];
    for (const c of l.querySelectorAll("input:not([type=hidden]), select, button")) expect(classes(c), c.getAttribute("aria-label") ?? c.getAttribute("name") ?? "").toMatch(/\bh-11\b/);
    for (const nom of ["Retirer la ligne 1", "Fournisseur et détails, ligne 1"]) expect(classes(cas(nom))).toMatch(/\bh-11 w-11\b/);
  });

  it("ligne libre : désignation et domaine à saisir sont visibles ; article du catalogue : ils se replient (simple recopie)", () => {
    const l = lignes()[0];
    const des = l.querySelector<HTMLInputElement>("input[name=designation]")!;
    const dom = l.querySelector<HTMLSelectElement>("select[name=domaine]")!;
    expect(classes(des)).not.toMatch(/\bhidden\b/);
    expect(classes(dom)).not.toMatch(/\bhidden\b/);
    choisir(l.querySelector<HTMLSelectElement>("select[name=articleId]")!, "a2");
    expect(des.value).toBe("Huile de palme");
    expect(classes(des)).toMatch(/\bhidden @4xl:block\b/);
    expect(classes(l.querySelector("select[name=domaine]")!)).toMatch(/\bhidden @4xl:block\b/);
    // …mais restent dans le formulaire : l'envoi est le même.
    expect(donnees().filter(([n]) => n === "designation")[0][1]).toBe("Huile de palme");
  });

  it("le fournisseur est replié sur la carte, et ⋯ le déplie (aria-expanded) ; jamais replié sur la liste large", () => {
    const four = conteneur.querySelectorAll<HTMLInputElement>("input[name=fournisseurNom]")[0];
    expect(classes(four)).toMatch(/\bhidden @4xl:block\b/);
    const plus = cas("Fournisseur et détails, ligne 1") as unknown as HTMLButtonElement;
    expect(plus.getAttribute("aria-expanded")).toBe("false");
    expect(classes(plus)).toMatch(/@4xl:hidden/); // bouton de la carte seulement
    act(() => plus.click());
    expect(plus.getAttribute("aria-expanded")).toBe("true");
    expect(classes(four)).not.toMatch(/\bhidden\b/);
    expect(classes(four)).toContain("order-11");
  });

  it("un fournisseur renseigné se signale sur ⋯ (le nom est lu à l'écran)", () => {
    taper(cas("Fournisseur de la ligne 1"), "Grossiste Kin");
    const plus = conteneur.querySelector("button[aria-expanded]")!;
    expect(plus.getAttribute("aria-label")).toContain("Grossiste Kin");
    expect(classes(plus)).toContain("text-primary");
  });
});

describe("Liste d'achat — cases de nombres du tableur", () => {
  it("quantité, PU et montant sont des CelluleNombre : champs texte au pavé décimal, aucun type=number (pas de flèches)", () => {
    expect(conteneur.querySelector('input[type="number"]')).toBeNull();
    for (const l of lignes()) {
      const cases = l.querySelectorAll<HTMLInputElement>("input[data-tableur-col]");
      expect([...cases].map((c) => c.dataset.tableurCol)).toEqual(["0", "1", "2"]);
      for (const c of cases) {
        expect(c.type).toBe("text");
        expect(c.getAttribute("inputmode")).toBe("decimal");
      }
    }
    expect(conteneur.querySelector("[data-tableur]")).not.toBeNull();
  });

  it("Entrée descend à la MÊME colonne de la ligne suivante, sans envoyer le formulaire", async () => {
    act(() => cas("Prix unitaire USD, ligne 1").focus());
    const ev = await entree_(cas("Prix unitaire USD, ligne 1"));
    expect(ev.defaultPrevented).toBe(true);
    expect(active()).toBe("Prix unitaire USD, ligne 2");
    await entree_(cas("Montant USD, ligne 2"));
    expect(active()).toBe("Montant USD, ligne 3");
    expect(entree).not.toHaveBeenCalled();
  });

  it("Entrée sur la DERNIÈRE ligne ajoute une ligne et se place dans la même colonne (comme « + Ligne »)", async () => {
    act(() => cas("Quantité, ligne 4").focus());
    await entree_(cas("Quantité, ligne 4"));
    expect(lignes()).toHaveLength(5);
    expect(active()).toBe("Quantité, ligne 5");
    expect(entree).not.toHaveBeenCalled();
  });

  it("Entrée dans n'importe quel champ (désignation, fournisseur…) n'envoie jamais le formulaire", async () => {
    for (const el of [conteneur.querySelector<HTMLInputElement>("input[name=designation]")!, cas("Fournisseur de la ligne 1"), cas("Unité, ligne 1")]) {
      const ev = await entree_(el);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(entree).not.toHaveBeenCalled();
  });

  it("quantité × PU remplit le montant, la virgule française est lue, le montant reste modifiable (règle inchangée)", async () => {
    await saisir(cas("Quantité, ligne 1"), "2,5");
    await saisir(cas("Prix unitaire USD, ligne 1"), "3");
    expect(cas("Montant USD, ligne 1").value).toBe("7,5");
    await saisir(cas("Montant USD, ligne 1"), "8");
    expect(cas("Montant USD, ligne 1").value).toBe("8");
    await saisir(cas("Quantité, ligne 1"), "4"); // quantité modifiée et PU renseigné → recalculé
    expect(cas("Montant USD, ligne 1").value).toBe("12");
  });
});

describe("Liste d'achat — l'envoi est inchangé", () => {
  // Référence : le FormData produit par l'ANCIEN formulaire (champs `type=number`, une carte de 3 rangées
  // par ligne), relevé dans un navigateur avec exactement la même saisie — voir `scenario` ci-dessous.
  // Mêmes champs, même ordre, mêmes valeurs (nombres à POINT), même conversion CDF.
  const ATTENDU = [
    ["date", "2026-09-30"], ["origine", ""], ["devise", "CDF"],
    ["articleId", "a2"], ["designation", "Huile de palme"], ["unite", "pièce"], ["domaine", "NOURRITURE"], ["quantite", "2.5"], ["montant", "21000"], ["fournisseurNom", "Maman Épiphanie"], ["fournisseurId", "f0"],
    ["articleId", ""], ["designation", "Sel gris"], ["unite", "Kg"], ["domaine", "BOISSON"], ["quantite", "4"], ["montant", "29400"], ["fournisseurNom", "Nouveau Fournisseur"], ["fournisseurId", ""],
    ["articleId", ""], ["designation", ""], ["unite", ""], ["domaine", "NOURRITURE"], ["quantite", "7"], ["montant", "24500"], ["fournisseurNom", ""], ["fournisseurId", ""],
    ["articleId", ""], ["designation", ""], ["unite", ""], ["domaine", "NOURRITURE"], ["quantite", ""], ["montant", ""], ["fournisseurNom", ""], ["fournisseurId", ""],
  ];

  async function scenario() {
    const L = (i: number) => lignes()[i];
    choisir(L(0).querySelector("select[name=articleId]")!, "a2");
    await saisir(cas("Quantité, ligne 1"), "2.5");
    await saisir(cas("Prix unitaire USD, ligne 1"), "3");
    taper(cas("Fournisseur de la ligne 1"), "Maman Épiphanie");
    taper(L(1).querySelector<HTMLInputElement>("input[name=designation]")!, "Sel gris");
    taper(L(1).querySelector<HTMLInputElement>("input[name=unite]")!, "Kg");
    choisir(L(1).querySelector("select[name=domaine]")!, "BOISSON");
    await saisir(cas("Quantité, ligne 2"), "4");
    await saisir(cas("Montant USD, ligne 2"), "10.5");
    taper(cas("Fournisseur de la ligne 2"), "Nouveau Fournisseur");
    await saisir(cas("Quantité, ligne 3"), "7");
    await saisir(cas("Prix unitaire USD, ligne 3"), "1.25");
    act(() => bouton("CDF (FC)").click());
  }

  it("mêmes champs, même ordre, mêmes valeurs que l'ancien formulaire (saisie identique, devise CDF)", async () => {
    await scenario();
    expect(donnees()).toEqual(ATTENDU);
  });

  it("le PU n'est jamais envoyé ; un champ par ligne et par nom (aucun doublon d'une présentation à l'autre)", async () => {
    await scenario();
    const noms = donnees().map(([n]) => n);
    for (const nom of ["articleId", "designation", "unite", "domaine", "quantite", "montant", "fournisseurNom", "fournisseurId"]) expect(noms.filter((n) => n === nom)).toHaveLength(4);
    expect(noms.filter((n) => n === "date" || n === "origine" || n === "devise")).toHaveLength(3);
    expect(noms).toHaveLength(3 + 4 * 8);
  });

  it("les montants partent avec un POINT décimal, même tapés à la virgule ou avec un espace de milliers", async () => {
    await saisir(cas("Quantité, ligne 1"), "1 250,5");
    await saisir(cas("Montant USD, ligne 1"), "3,75");
    const d = donnees();
    expect(d.filter(([n]) => n === "quantite")[0][1]).toBe("1250.5");
    expect(d.filter(([n]) => n === "montant")[0][1]).toBe("3.75");
  });

  it("un clic sur « Valider » envoie le formulaire à l'action, une seule fois", async () => {
    await scenario();
    await act(async () => { form().requestSubmit(); });
    expect(entree).toHaveBeenCalledTimes(1);
    const fd = (entree.mock.calls[0] as unknown as [FormData])[0];
    // Champ par champ (happy-dom ajoute le domaine du <select> désactivé, que le navigateur n'envoie pas :
    // c'est `donnees()` qui reproduit l'envoi réel, ci-dessus).
    for (const nom of ["date", "origine", "devise", "articleId", "designation", "unite", "quantite", "montant", "fournisseurNom", "fournisseurId"]) {
      expect(fd.getAll(nom), nom).toEqual(ATTENDU.filter(([n]) => n === nom).map(([, v]) => v));
    }
    expect(fd.getAll("domaine")).toContain("BOISSON");
  });
});
