// @vitest-environment happy-dom
//
// Achat de légumes frais, sur le modèle de la Liste d'achat : tableur d'UNE rangée par ligne sur
// ordinateur (en-tête unique), carte compacte sur téléphone, cases sans flèches, Entrée qui descend
// (et ajoute une ligne sur la dernière) sans jamais envoyer, ENVOI INCHANGÉ, totaux CDF et ≈ USD.
// Défaut relevé le 2026-09-30 : sans racine `data-tableur`, Entrée restait sur place.
//
// Ce que ce fichier ne voit pas : les pixels. Happy-dom n'applique pas les requêtes de conteneur
// (`@4xl:`) : on vérifie les classes posées ; la mise en page réelle se contrôle à l'œil.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const { creer } = vi.hoisted(() => ({ creer: vi.fn(async () => undefined) }));
vi.mock("./actions", () => ({ creerAchatsLegumes: creer, supprimerAchatLegume: vi.fn() }));

import { AchatLegumesForm, SupprimerAchatBtn } from "./legumes-client";
import { champsParNom, choisirEnTapant, choisirOption, libellesOuverts, optionsOuvertes, ouvrirChoix, taperChoix, valeurChoisie } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  creer.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(AchatLegumesForm, { taux: 2800, estDirection: true })));
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const cas = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="${nom}"]`)!;
const active = () => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label");
const nbLignes = () => conteneur.querySelectorAll('input[aria-label^="Quantité, ligne"]').length;
const lignes = () => [...conteneur.querySelectorAll<HTMLElement>("[data-ligne-achat]")];
const classes = (el: Element) => el.getAttribute("class") ?? "";
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.trim() === texte)!;
const norm = (t: string | null | undefined) => (t ?? "").replace(/[\u202f\u00a0]/g, " ");

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
/** Saisie puis sortie de la case (la case partagée enregistre à la sortie, comme à l'écran). */
async function saisir(el: HTMLInputElement, texte: string) {
  act(() => el.focus());
  taper(el, texte);
  await act(async () => el.blur());
}
/** Ce que le navigateur enverrait : les champs nommés, dans l'ordre du document. */
const donnees = (): [string, string][] =>
  [...conteneur.querySelector("form")!.elements]
    .filter((e): e is HTMLInputElement | HTMLSelectElement => !!(e as HTMLInputElement).name && !(e as HTMLInputElement).disabled && (e as HTMLInputElement).type !== "submit" && (e as HTMLInputElement).type !== "button")
    .map((e) => [e.name, e.value]);

async function entree(el: HTMLElement) {
  let ev!: KeyboardEvent;
  await act(async () => {
    ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  });
  return ev;
}

describe("Achat de légumes frais — navigation au clavier", () => {
  it("la grille est une racine de tableur", () => {
    expect(conteneur.querySelector("[data-tableur]")).not.toBeNull();
    expect(conteneur.querySelector("[data-tableur]")?.contains(cas("Quantité, ligne 1"))).toBe(true);
  });

  it("Entrée descend à la MÊME colonne de la ligne suivante, sans envoyer", async () => {
    act(() => cas("Quantité, ligne 1").focus());
    const ev = await entree(cas("Quantité, ligne 1"));
    expect(ev.defaultPrevented).toBe(true);
    expect(active()).toBe("Quantité, ligne 2");
    act(() => cas("Montant CDF, ligne 2").focus());
    await entree(cas("Montant CDF, ligne 2"));
    expect(active()).toBe("Montant CDF, ligne 3");
    expect(creer).not.toHaveBeenCalled();
  });

  it("Entrée sur la DERNIÈRE ligne ajoute une ligne et s'y place, dans la même colonne", async () => {
    expect(nbLignes()).toBe(3);
    act(() => cas("Montant CDF, ligne 3").focus());
    await entree(cas("Montant CDF, ligne 3"));
    expect(nbLignes()).toBe(4);
    expect(active()).toBe("Montant CDF, ligne 4");
    expect(creer).not.toHaveBeenCalled();
  });
});

describe("Achat de légumes frais — ordinateur : un tableur, une rangée par ligne", () => {
  it("UNE rangée par ligne (3 au départ, une de plus avec « + Ligne »), une seule grille de 6 colonnes", () => {
    expect(lignes()).toHaveLength(3);
    act(() => bouton("+ Ligne").click());
    expect(lignes()).toHaveLength(4);
    // légume, unité, quantité, montant CDF, ≈ USD, ✕.
    for (const l of lignes()) expect(classes(l)).toMatch(/@4xl:grid-cols-\[[^\]]*\]/);
    expect(/@4xl:grid-cols-\[([^\]]*)\]/.exec(classes(lignes()[0]))![1].split("_")).toHaveLength(6);
  });

  it("l'en-tête de colonnes est UNIQUE, hors des lignes, et n'apparaît que sur la liste large", () => {
    const entetes = [...conteneur.querySelectorAll("span")].filter((s) => s.textContent === "Légume");
    expect(entetes).toHaveLength(1);
    const barre = entetes[0].parentElement!;
    expect(classes(barre)).toMatch(/\bhidden\b/);
    expect(classes(barre)).toMatch(/@4xl:grid\b/);
    expect(barre.textContent).toBe("LégumeUnitéQuantitéMontant CDF≈ USDRetirer");
    act(() => bouton("+ Ligne").click());
    expect([...conteneur.querySelectorAll("span")].filter((s) => s.textContent === "Légume")).toHaveLength(1);
    for (const l of lignes()) expect(l.contains(barre)).toBe(false);
  });

  it("le tableur suit la largeur de SA colonne (requête de conteneur), pas celle de l'écran (menu latéral)", () => {
    expect(classes(lignes()[0].parentElement!.parentElement!)).toContain("@container");
    expect(conteneur.innerHTML).not.toMatch(/\b(sm|lg):grid/);
  });
});

describe("Achat de légumes frais — téléphone : une carte compacte par ligne", () => {
  it("chaque ligne est une carte de 5 pistes en 2 rangées : légume + montant + ✕, puis quantité, unité, ≈ USD", () => {
    for (const l of lignes()) {
      expect(classes(l)).toMatch(/\brounded-lg\b/);
      expect(classes(l)).toMatch(/\bborder\b/);
      expect(classes(l)).toContain("grid-cols-[4rem_1rem_4.5rem_minmax(0,1fr)_2.75rem]");
    }
    const ordre = (el: Element) => Number(/\border-(\d+)\b/.exec(classes(el))?.[1]);
    expect(ordre(cas("Légume, ligne 1"))).toBe(1);
    expect(ordre(cas("Montant CDF, ligne 1"))).toBe(2);
    expect(ordre(cas("Retirer la ligne 1"))).toBe(3);
    expect(ordre(cas("Quantité, ligne 1"))).toBe(4);
    expect(ordre(cas("Unité, ligne 1"))).toBe(5);
    expect(ordre(lignes()[0].querySelector("[data-usd-ligne]")!)).toBe(6);
    // Pistes : 3 + 1 + 1 (rangée 1) ; 1 + 2 + 2 (rangée 2) = 2 rangées.
    expect(classes(cas("Légume, ligne 1"))).toContain("col-span-3");
    expect(classes(cas("Unité, ligne 1"))).toContain("col-span-2");
    expect(classes(lignes()[0].querySelector("[data-usd-ligne]")!)).toContain("col-span-2");
    expect(classes(cas("Montant CDF, ligne 1"))).toContain("font-semibold"); // montant en gras
  });

  it("toutes les cibles de la carte font 44 px (h-11) ; ✕ est un carré de 44 px", () => {
    for (const c of lignes()[0].querySelectorAll("input:not([type=hidden]), select, button")) expect(classes(c), c.getAttribute("aria-label") ?? "").toMatch(/\bh-11\b/);
    expect(classes(cas("Retirer la ligne 1"))).toMatch(/\bh-11 w-11\b/);
  });

  it("« ✕ » retire la ligne ; sur la dernière ligne restante, il la vide", async () => {
    await saisir(cas("Quantité, ligne 2"), "4");
    act(() => (cas("Retirer la ligne 1") as unknown as HTMLButtonElement).click());
    expect(nbLignes()).toBe(2);
    expect(cas("Quantité, ligne 1").value).toBe("4");
    act(() => (cas("Retirer la ligne 1") as unknown as HTMLButtonElement).click());
    act(() => (cas("Retirer la ligne 1") as unknown as HTMLButtonElement).click());
    expect(nbLignes()).toBe(1);
  });
});

describe("Achat de légumes frais — cases de nombres du tableur", () => {
  it("quantité et montant sont des CelluleNombre : champs texte au pavé décimal, aucun type=number", () => {
    expect(conteneur.querySelector('input[type="number"]')).toBeNull();
    for (const l of lignes()) {
      const cases = l.querySelectorAll<HTMLInputElement>("input[data-tableur-col]");
      expect([...cases].map((c) => c.dataset.tableurCol)).toEqual(["0", "1"]);
      for (const c of cases) { expect(c.type).toBe("text"); expect(c.getAttribute("inputmode")).toBe("decimal"); }
    }
  });

  it("choisir un légume remplit l'unité (modifiable) ; « — légume — » la vide", async () => {
    const sel = champsParNom(conteneur, "legume")[0];
    const unite = cas("Unité, ligne 1");
    await choisirOption(sel, "Ail");
    expect(unite.value).toBe("Kg");
    await choisirOption(sel, "Ananas");
    expect(unite.value).toBe("Pièce");
    taper(unite, "Caisse");
    expect(unite.value).toBe("Caisse");
    await choisirOption(sel, "");
    expect(unite.value).toBe("");
    await ouvrirChoix(sel);
    expect(optionsOuvertes()).toHaveLength(39); // « — légume — » + les 38 de la fiche
  });

  it("on trouve un légume en tapant son nom (sans accent ni majuscule) ; Entrée choisit, l'unité suit", async () => {
    const sel = champsParNom(conteneur, "legume")[0];
    await taperChoix(sel, "celeri");
    expect(libellesOuverts()).toEqual(["Céléri"]);
    await choisirEnTapant(sel, "epinard");
    expect(valeurChoisie(sel)).toBe("Épinard");
    expect(cas("Unité, ligne 1").value).toBe("Kg");
    expect(donnees().filter(([n]) => n === "legume")[0][1]).toBe("Épinard");
  });
});

describe("Achat de légumes frais — totaux", () => {
  it("total CDF, total ≈ USD (au taux affiché) et ≈ USD de chaque ligne, sans jamais inclure une ligne vide", async () => {
    expect(norm(conteneur.textContent)).toContain("Taux : 1 USD = 2 800 CDF");
    await saisir(cas("Montant CDF, ligne 1"), "14 000");
    await saisir(cas("Montant CDF, ligne 2"), "8400,5");
    const usdLignes = lignes().map((l) => norm(l.querySelector("[data-usd-ligne]")!.textContent));
    expect(usdLignes).toEqual(["≈ 5,00 $", "≈ 3,00 $", "≈ 0,00 $"]);
    expect(norm(conteneur.querySelector("[data-total-cdf]")!.textContent)).toBe("22 400,5 CDF");
    expect(norm(conteneur.querySelector("[data-total-usd]")!.textContent)).toBe(" ≈ 8,00 $");
  });

  it("le bouton « Réinitialiser » (Direction) remet trois lignes vides et un total nul", async () => {
    await saisir(cas("Montant CDF, ligne 1"), "5600");
    act(() => bouton("+ Ligne").click());
    act(() => bouton("Réinitialiser").click());
    expect(nbLignes()).toBe(3);
    expect(norm(conteneur.querySelector("[data-total-cdf]")!.textContent)).toBe("0 CDF");
  });
});

describe("Achat de légumes frais — l'envoi est inchangé", () => {
  // Référence : le FormData produit par l'ANCIEN formulaire (relevé le 2026-09-30, avant la refonte,
  // avec exactement la même saisie — voir `scenario`). Mêmes champs, même ordre, mêmes valeurs
  // (nombres à POINT). La date est celle du jour (le champ n'a pas de valeur fournie).
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const ATTENDU = [
    ["date", aujourdhui],
    ["legume", "Ail"], ["unite", "Kg"], ["quantite", "2.5"], ["montantCDF", "14000"],
    ["legume", "Ananas"], ["unite", "Caisse"], ["quantite", "3"], ["montantCDF", "8400.5"],
    ["legume", ""], ["unite", ""], ["quantite", "1"], ["montantCDF", ""],
  ];
  async function scenario() {
    const sels = () => champsParNom(conteneur, "legume");
    await choisirOption(sels()[0], "Ail");
    await saisir(cas("Quantité, ligne 1"), "2,5");
    await saisir(cas("Montant CDF, ligne 1"), "14 000");
    await choisirOption(sels()[1], "Ananas");
    taper(cas("Unité, ligne 2"), "Caisse");
    await saisir(cas("Quantité, ligne 2"), "3");
    await saisir(cas("Montant CDF, ligne 2"), "8400,5");
    await saisir(cas("Quantité, ligne 3"), "1");
  }

  it("mêmes champs, même ordre, mêmes valeurs que l'ancien formulaire (saisie identique)", async () => {
    await scenario();
    expect(donnees()).toEqual(ATTENDU);
  });

  it("un clic sur « Enregistrer les achats » envoie le formulaire à l'action, une seule fois, avec ces champs", async () => {
    await scenario();
    await act(async () => { conteneur.querySelector("form")!.requestSubmit(); });
    expect(creer).toHaveBeenCalledTimes(1);
    const fd = (creer.mock.calls[0] as unknown as [FormData])[0];
    for (const nom of ["date", "legume", "unite", "quantite", "montantCDF"]) {
      expect(fd.getAll(nom), nom).toEqual(ATTENDU.filter(([n]) => n === nom).map(([, v]) => v));
    }
  });

  it("Entrée dans n'importe quel champ (légume, unité…) n'envoie jamais le formulaire", async () => {
    for (const el of [champsParNom(conteneur, "legume")[0], cas("Unité, ligne 1")]) {
      const ev = await entree(el);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(creer).not.toHaveBeenCalled();
  });
});

describe("Historique des achats de légumes — suppression réservée à la Direction", () => {
  const rendre = (estDirection?: boolean) => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    const r = createRoot(c);
    act(() => r.render(h(SupprimerAchatBtn, { id: "a1", legume: "Ail", ...(estDirection === undefined ? {} : { estDirection }) })));
    return { c, fin: () => { act(() => r.unmount()); c.remove(); } };
  };

  it("sans Direction : aucun ✕ (par défaut aussi)", () => {
    for (const d of [false, undefined]) {
      const { c, fin } = rendre(d);
      expect(c.querySelector("button")).toBeNull();
      fin();
    }
  });

  it("avec Direction : le ✕ est présent", () => {
    const { c, fin } = rendre(true);
    expect(c.querySelector('button[aria-label="Supprimer l\'achat Ail"]')?.textContent).toBe("✕");
    fin();
  });

  it("la page passe estDirection au bouton de chaque ligne", () => {
    const src = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    expect(src).toMatch(/<SupprimerAchatBtn [^>]*estDirection=\{estDirection\}/);
  });
});
