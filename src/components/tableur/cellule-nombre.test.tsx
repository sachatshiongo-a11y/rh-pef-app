// @vitest-environment happy-dom
//
// Comportement « comme Excel » de la case partagée, dans un vrai DOM : clavier, Échap,
// sélection à l'arrivée, saisies illisibles, échecs d'enregistrement visibles, collage.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CelluleNombre, type Enregistreur } from "./cellule-nombre";
import { suivi } from "./suivi";
import { ZoneTableur } from "./messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Grille de test : 4 lignes × 3 colonnes, avec une ligne d'en-tête de catégorie (sans case)
// entre b et c, une case désactivée (b, 1) et une ligne masquée par un filtre (x).
//   a : 1  2  3
//   b : 4  —  6     (—  = désactivée)
//   [en-tête « Catégorie 2 »]
//   x : (masquée)
//   c : 7  8  9
//   d : .  .  .     (vides)
const LIGNES = [
  { id: "a", v: [1, 2, 3], cat: "Catégorie 1" },
  { id: "b", v: [4, 5, 6], desactivee: 1, cat: "Catégorie 1" },
  { id: "x", v: [0, 0, 0], masquee: true, cat: "Catégorie 2" },
  { id: "c", v: [7, 8, 9], cat: "Catégorie 2" },
  { id: "d", v: [null, null, null], cat: "Catégorie 2" },
];

let conteneur: HTMLDivElement;
let racine: Root;
let enregistrer: ReturnType<typeof vi.fn>;

function grille(onEnregistrer: Enregistreur, valeurs?: Record<string, (number | null)[]>, sans?: string) {
  return h(ZoneTableur, null, h("table", { "data-tableur": "" },
    h("tbody", null,
      LIGNES.filter((l) => l.id !== sans).map((l) => h(Fragment, { key: l.id },
        l.id === "x" && h("tr", null, h("td", { colSpan: 3 }, "Catégorie 2")),
        h("tr", { hidden: l.masquee || undefined },
          [0, 1, 2].map((c) => h("td", { key: c },
            h(CelluleNombre, {
              ligne: l.id, col: c, valeur: (valeurs?.[l.id] ?? l.v)[c], onEnregistrer, min: 0, groupe: l.cat,
              disabled: l.desactivee === c, "aria-label": `${l.id}${c}`,
            })))))))));
}
const zone = () => conteneur.querySelector('[role="status"]')!.textContent ?? "";

beforeEach(() => {
  enregistrer = vi.fn(async () => {});
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(grille(enregistrer as Enregistreur)));
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const cas = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="${nom}"]`)!;
const active = () => (document.activeElement as HTMLInputElement | null)?.getAttribute("aria-label");
function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function touche(el: HTMLInputElement, key: string, opts: KeyboardEventInit = {}) {
  let ev!: KeyboardEvent;
  await act(async () => {
    ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
    el.dispatchEvent(ev);
  });
  return ev;
}
const focus = (el: HTMLInputElement) => act(() => el.focus());

describe("CelluleNombre — rendu", () => {
  it("champ texte au pavé décimal, jamais type=number (pas de flèches d'incrément)", () => {
    const el = cas("a0");
    expect(el.type).toBe("text");
    expect(el.inputMode).toBe("decimal");
    expect(conteneur.querySelectorAll('input[type="number"]')).toHaveLength(0);
  });
  it("affiche à la française", () => {
    act(() => racine.render(grille(enregistrer as Enregistreur, { a: [2.5, 1250, null] })));
    expect(cas("a0").value).toBe("2,5");
    expect(cas("a1").value).toBe("1250");
    expect(cas("a2").value).toBe("");
  });
});

describe("CelluleNombre — clavier", () => {
  it("à l'arrivée dans une case, son contenu est sélectionné (la frappe le remplace)", () => {
    const el = cas("c1");
    focus(el);
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 1]);
  });

  it("Entrée descend dans la même colonne en sautant l'en-tête, la ligne masquée et la case désactivée", async () => {
    focus(cas("a1"));
    const ev = await touche(cas("a1"), "Enter");
    expect(ev.defaultPrevented).toBe(true); // jamais d'envoi du formulaire englobant
    expect(active()).toBe("c1"); // b1 désactivée, x masquée, en-tête sans case
    await touche(cas("b0"), "Enter");
  });

  it("Maj+Entrée remonte ; ↓ et ↑ font de même", async () => {
    focus(cas("c0"));
    await touche(cas("c0"), "Enter", { shiftKey: true });
    expect(active()).toBe("b0");
    await touche(cas("b0"), "ArrowDown");
    expect(active()).toBe("c0");
    await touche(cas("c0"), "ArrowUp");
    expect(active()).toBe("b0");
  });

  it("Entrée sur la dernière ligne : valide et reste dans la case", async () => {
    const el = cas("d2");
    focus(el);
    taper(el, "4");
    const ev = await touche(el, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(active()).toBe("d2");
    expect(enregistrer).toHaveBeenCalledWith(4, { ligne: "d", col: 2, precedente: null });
  });

  it("Tab passe à droite puis à la ligne suivante ; Maj+Tab revient", async () => {
    focus(cas("a2"));
    await touche(cas("a2"), "Tab");
    expect(active()).toBe("b0");
    await touche(cas("b0"), "Tab");
    expect(active()).toBe("b2"); // b1 désactivée
    await touche(cas("b2"), "Tab", { shiftKey: true });
    expect(active()).toBe("b0");
  });

  it("Tab au bout de la grille laisse le navigateur sortir (pas de preventDefault)", async () => {
    focus(cas("d2"));
    const ev = await touche(cas("d2"), "Tab");
    expect(ev.defaultPrevented).toBe(false);
  });

  it("← et → changent de case au bord du texte seulement", async () => {
    const el = cas("c1");
    focus(el); // tout sélectionné
    await touche(el, "ArrowRight");
    expect(active()).toBe("c2");
    const c2 = cas("c2");
    taper(c2, "123");
    act(() => c2.setSelectionRange(1, 1)); // curseur au milieu : → déplace le curseur, pas la case
    const ev = await touche(c2, "ArrowRight");
    expect(ev.defaultPrevented).toBe(false);
    expect(active()).toBe("c2");
    act(() => c2.setSelectionRange(0, 0));
    await touche(c2, "ArrowLeft");
    expect(active()).toBe("c1");
  });

  it("↑ ↓ avec une saisie illisible : la case reste, en rouge, avec sa saisie (comme Entrée)", async () => {
    const el = cas("a0");
    focus(el);
    taper(el, "abc");
    await touche(el, "ArrowDown");
    expect(active()).toBe("a0");
    expect(el.value).toBe("abc");
    expect(el.getAttribute("aria-invalid")).toBe("true");
    expect(zone()).toContain("a0 : « abc » n'est pas un nombre.");
  });

  it("↑ et ↓ ne changent jamais la valeur", async () => {
    const el = cas("a0");
    focus(el);
    await touche(el, "ArrowDown");
    await touche(cas("b0"), "ArrowUp");
    expect(cas("a0").value).toBe("1");
    expect(cas("b0").value).toBe("4");
  });
});

describe("CelluleNombre — enregistrement", () => {
  it("sortir d'une case modifiée enregistre une fois, avec la valeur lue à la française", async () => {
    const el = cas("a0");
    focus(el);
    taper(el, "2,5");
    await act(async () => el.blur());
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(enregistrer).toHaveBeenCalledWith(2.5, { ligne: "a", col: 0, precedente: 1 });
    expect(el.value).toBe("2,5");
  });

  it("pas de réenregistrement si la valeur n'a pas changé (même écrite autrement)", async () => {
    const el = cas("a0");
    focus(el);
    await act(async () => el.blur());
    focus(el);
    taper(el, "1,00");
    await act(async () => el.blur());
    expect(enregistrer).not.toHaveBeenCalled();
    expect(el.value).toBe("1"); // écriture normalisée
  });

  it("vider une case enregistre null (effacement)", async () => {
    const el = cas("a0");
    focus(el);
    taper(el, "");
    await act(async () => el.blur());
    expect(enregistrer).toHaveBeenCalledWith(null, { ligne: "a", col: 0, precedente: 1 });
  });

  it("Échap rétablit la valeur d'origine et n'enregistre rien", async () => {
    const el = cas("a1");
    focus(el);
    taper(el, "99");
    await touche(el, "Escape");
    expect(el.value).toBe("2");
    await act(async () => el.blur());
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it("saisie illisible + Entrée : la case retient, signalée, rien n'est enregistré", async () => {
    const el = cas("a0");
    focus(el);
    taper(el, "2,5,1");
    await touche(el, "Enter");
    expect(active()).toBe("a0");
    expect(el.getAttribute("aria-invalid")).toBe("true");
    expect(el.value).toBe("2,5,1"); // rien n'est perdu : on corrige ou Échap
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it("saisie illisible à la sortie : valeur précédente rétablie, case signalée", async () => {
    const el = cas("a0");
    focus(el);
    taper(el, "abc");
    await act(async () => el.blur());
    expect(el.value).toBe("1");
    expect(el.getAttribute("aria-invalid")).toBe("true");
    expect(el.title).toMatch(/abc.*Valeur précédente rétablie/);
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it("valeur hors bornes (négative) : refusée", async () => {
    const el = cas("a0");
    focus(el);
    taper(el, "-3");
    await act(async () => el.blur());
    expect(el.value).toBe("1");
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it("un échec d'enregistrement est visible sur la case, la saisie reste affichée, et revalider réessaie", async () => {
    enregistrer.mockResolvedValueOnce({ erreur: "Base injoignable." });
    const el = cas("a0");
    focus(el);
    taper(el, "8");
    await act(async () => el.blur());
    expect(el.value).toBe("8");
    expect(el.getAttribute("aria-invalid")).toBe("true");
    expect(el.title).toContain("Base injoignable.");
    expect(suivi.etat().enErreur).toBe(1); // quitter la page demandera confirmation
    expect(zone()).toContain("a0 : non enregistré — Base injoignable."); // en texte, lisible sur téléphone
    focus(el);
    await act(async () => el.blur()); // même texte : mais il n'est pas en base, on réessaie
    expect(enregistrer).toHaveBeenCalledTimes(2);
    expect(el.getAttribute("aria-invalid")).toBeNull();
    expect(suivi.etat().enErreur).toBe(0);
  });

  it("une valeur venue du serveur est adoptée, sauf dans la case en cours de frappe", () => {
    const el = cas("a0");
    focus(el);
    taper(el, "5");
    act(() => racine.render(grille(enregistrer as Enregistreur, { a: [30, 20, 10] })));
    expect(el.value).toBe("5"); // on ne piétine pas la frappe
    expect(cas("a1").value).toBe("20");
  });
});

describe("CelluleNombre — collage d'un bloc Excel", () => {
  function coller(el: HTMLInputElement, texte: string) {
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: () => texte } });
    return act(async () => { el.dispatchEvent(ev); });
  }

  it("remplit à partir de la case active, sans décaler sur les désactivées, et affiche un bilan", async () => {
    await coller(cas("a1"), "10\t11\t12\r\n13\t14\r\n");
    // a1, a2 ; b1 désactivée (13 non collé, pas décalé), b2 ; « 12 » sort de la grille.
    expect(["a1", "a2", "b1", "b2"].map((n) => cas(n).value)).toEqual(["10", "11", "5", "14"]);
    expect(enregistrer).toHaveBeenCalledTimes(3);
    expect(enregistrer).toHaveBeenCalledWith(14, { ligne: "b", col: 2, precedente: 6 });
    expect(zone()).toContain("Collage : 3 cases remplacées, 0 effacée, 2 ignorées (2 hors grille ou non modifiables).");
  });

  it("REFUSÉ, rien n'est écrit, s'il traverse une catégorie (ex. export Excel recollé)", async () => {
    await coller(cas("b0"), "40\n70\n");
    expect(enregistrer).not.toHaveBeenCalled();
    expect([cas("b0").value, cas("c0").value]).toEqual(["4", "7"]);
    expect(zone()).toContain("Le bloc collé traverse une catégorie : collez catégorie par catégorie.");
  });

  it("REFUSÉ s'il compte plus de lignes qu'il n'en reste", async () => {
    await coller(cas("d0"), "1\n2\n");
    expect(enregistrer).not.toHaveBeenCalled();
    expect(zone()).toMatch(/2 lignes, mais il n'en reste que 1/);
  });

  it("une case vide du bloc n'efface JAMAIS une valeur existante", async () => {
    await coller(cas("c0"), "\t80\t\r\n");
    expect(["c0", "c1", "c2"].map((n) => cas(n).value)).toEqual(["7", "80", "9"]);
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(zone()).toContain("2 vides — une case vide n'efface rien");
  });

  it("chaque case collée passe par la même validation (illisible refusé, inchangé ignoré, ambigu signalé)", async () => {
    await coller(cas("a0"), "1\tabc\t3,5");
    expect(cas("a1").value).toBe("2");
    expect(cas("a1").getAttribute("aria-invalid")).toBe("true");
    expect(enregistrer).toHaveBeenCalledTimes(1); // a0 inchangé (1), a2 : 3,5
    expect(enregistrer).toHaveBeenCalledWith(3.5, { ligne: "a", col: 2, precedente: 3 });
    expect(zone()).toContain("1 refusée (illisible ou ambiguë");
    expect(zone()).toContain("1 case déjà à la bonne valeur");
    await coller(cas("c1"), "1,250\t2");
    expect(zone()).toContain("1 valeur ambiguë (ex. « 1,250 ») lue comme décimale");
  });

  it("une seule valeur : collage ordinaire dans la case", async () => {
    const el = cas("a0");
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: () => "42\r\n" } });
    await act(async () => { el.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
    expect(enregistrer).not.toHaveBeenCalled();
  });
});

describe("CelluleNombre — aucune frappe en attente perdue", () => {
  it("dès la frappe, la case entre dans le suivi (confirmation avant de quitter)", () => {
    const el = cas("a0");
    focus(el);
    taper(el, "9");
    expect(suivi.etat().modifiees).toBe(1);
    expect(suivi.etat().ecoute).toBe(true);
  });

  it("une case qui disparaît avec une frappe en attente l'enregistre (ex. ligne filtrée)", async () => {
    const el = cas("c1");
    focus(el);
    taper(el, "55");
    await act(async () => racine.render(grille(enregistrer as Enregistreur, undefined, "c")));
    expect(enregistrer).toHaveBeenCalledWith(55, { ligne: "c", col: 1, precedente: 8 });
    expect(suivi.etat().modifiees).toBe(0);
  });

  it("une frappe illisible qui disparaît est signalée sous la grille, jamais avalée", async () => {
    const el = cas("c1");
    focus(el);
    taper(el, "5,5,5");
    await act(async () => racine.render(grille(enregistrer as Enregistreur, undefined, "c")));
    expect(enregistrer).not.toHaveBeenCalled();
    expect(zone()).toContain("c1 : saisie « 5,5,5 » NON enregistrée");
  });

  it("page masquée (téléphone verrouillé, onglet quitté) : la frappe en attente est enregistrée", async () => {
    const el = cas("a2");
    focus(el);
    taper(el, "33");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    } finally {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    }
    expect(enregistrer).toHaveBeenCalledWith(33, { ligne: "a", col: 2, precedente: 3 });
    expect(suivi.etat().modifiees).toBe(0);
  });

  it("Échap retire la case du suivi", async () => {
    const el = cas("a0");
    focus(el);
    taper(el, "9");
    await touche(el, "Escape");
    expect(suivi.etat().modifiees).toBe(0);
  });
});
