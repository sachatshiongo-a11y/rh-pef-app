// @vitest-environment happy-dom
//
// Choix d'un élément en tapant son nom (remplace les <select> de longues listes du stock) :
// filtre, clavier (liste ouverte / fermée), souris et doigt, valeur soumise identique à celle d'un
// <select>, liste partagée, portail, placement.
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChoixRecherche } from "./choix-recherche";
import type { OptionChoix } from "@/lib/recherche-options";
import { champChoix, champsChoix, choisirOption, libellesOuverts, listeOuverte, optionsOuvertes, ouvrirChoix, taperChoix, toucheChoix, valeurChoisie } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS: OptionChoix[] = [
  { id: "a1", libelle: "Bacardi blanc-1l", recherche: ["BAC1"] },
  { id: "a2", libelle: "Crème fraîche 1L" },
  { id: "a3", libelle: "Épices mélangées", recherche: ["Mélange maison", "137"] },
  { id: "a4", libelle: "Farine de blé" },
];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => { conteneur = document.createElement("div"); document.body.appendChild(conteneur); racine = createRoot(conteneur); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
const monter = (el: ReturnType<typeof h>) => act(() => racine.render(el));

/** Formulaire d'essai : un champ contrôlé (name=articleId), un second libre, un bouton d'envoi. */
function Demo(p: { onChange?: (v: string) => void; onSubmit?: (fd: FormData) => void; vide?: string; initial?: string; options?: OptionChoix[]; extras?: OptionChoix[] }) {
  const [v, setV] = useState(p.initial ?? "");
  return h("form", { onSubmit: (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); p.onSubmit?.(new FormData(e.currentTarget)); } },
    h(ChoixRecherche, { options: p.options ?? OPTIONS, extras: p.extras, name: "articleId", value: v, vide: p.vide, "aria-label": "Article", onChange: (x: string) => { setV(x); p.onChange?.(x); } }),
    h("button", { type: "submit" }, "Envoyer"));
}
const champ = () => champChoix(conteneur, "Article");

describe("affichage", () => {
  it("fermé : le libellé du choix ; le champ caché porte l'id, le champ visible n'a pas de name", () => {
    monter(h(Demo, { initial: "a2" }));
    expect(champ().value).toBe("Crème fraîche 1L");
    expect(valeurChoisie(champ())).toBe("a2");
    expect(champ().hasAttribute("name")).toBe(false);
    expect(champ().getAttribute("role")).toBe("combobox");
    expect(champ().getAttribute("aria-expanded")).toBe("false");
    expect(listeOuverte()).toBeNull();
  });

  it("rien de choisi : champ vide, texte d'invite = l'option « aucun », id vide soumis", () => {
    monter(h(Demo, { vide: "— libre —" }));
    expect(champ().value).toBe("");
    expect(champ().placeholder).toBe("— libre —");
    expect(valeurChoisie(champ())).toBe("");
  });

  it("valeur absente de la liste (article désactivé depuis) : signalée, id conservé", () => {
    monter(h(Demo, { initial: "archive" }));
    expect(champ().value).toBe("Hors liste");
    expect(valeurChoisie(champ())).toBe("archive");
  });
});

describe("recherche", () => {
  it("s'ouvre au clic avec toute la liste, dans l'ordre", async () => {
    monter(h(Demo, {}));
    await ouvrirChoix(champ());
    expect(champ().getAttribute("aria-expanded")).toBe("true");
    expect(libellesOuverts()).toEqual(["Bacardi blanc-1l", "Crème fraîche 1L", "Épices mélangées", "Farine de blé"]);
  });

  it("taper filtre : accents et casse ignorés, mots dans le désordre, nom court et code compris", async () => {
    monter(h(Demo, {}));
    await taperChoix(champ(), "bacardi 1l");
    expect(libellesOuverts()).toEqual(["Bacardi blanc-1l"]);
    await taperChoix(champ(), "EPICES");
    expect(libellesOuverts()).toEqual(["Épices mélangées"]);
    await taperChoix(champ(), "creme");
    expect(libellesOuverts()).toEqual(["Crème fraîche 1L"]);
    await taperChoix(champ(), "137");
    expect(libellesOuverts()).toEqual(["Épices mélangées"]);
    await taperChoix(champ(), "maison melange");
    expect(libellesOuverts()).toEqual(["Épices mélangées"]);
    await taperChoix(champ(), "zzz");
    expect(listeOuverte()!.textContent).toContain("Aucun résultat pour « zzz »");
  });

  it("annonce le nombre de résultats aux lecteurs d'écran", async () => {
    monter(h(Demo, {}));
    await taperChoix(champ(), "1l");
    expect(document.querySelector('[role="status"]')!.textContent).toBe("2 résultats");
  });

  it("plus de 200 options : les 200 premières et la mention des autres", async () => {
    const grand = Array.from({ length: 450 }, (_, i) => ({ id: `x${i}`, libelle: `Article ${i}` }));
    monter(h(Demo, { options: grand }));
    await ouvrirChoix(champ());
    expect(optionsOuvertes()).toHaveLength(200);
    expect(listeOuverte()!.textContent).toContain("250 autres");
    await taperChoix(champ(), "article 44");
    expect(optionsOuvertes().length).toBeLessThan(200);
    expect(listeOuverte()!.textContent).not.toContain("autres");
  });
});

describe("clavier, liste ouverte", () => {
  it("↓ ↑ parcourent, Entrée choisit : onChange une fois, champ caché à jour, liste fermée", async () => {
    const onChange = vi.fn();
    monter(h(Demo, { onChange }));
    await taperChoix(champ(), "1l"); // Bacardi, Crème fraîche
    expect(optionsOuvertes()[0].hasAttribute("data-actif")).toBe(true);
    await toucheChoix(champ(), "ArrowDown");
    expect(optionsOuvertes()[1].hasAttribute("data-actif")).toBe(true);
    expect(champ().getAttribute("aria-activedescendant")).toBe(optionsOuvertes()[1].id);
    await toucheChoix(champ(), "ArrowDown"); // bute en bas
    expect(optionsOuvertes()[1].hasAttribute("data-actif")).toBe(true);
    await toucheChoix(champ(), "ArrowUp");
    expect(optionsOuvertes()[0].hasAttribute("data-actif")).toBe(true);
    await toucheChoix(champ(), "ArrowDown");
    const ev = await toucheChoix(champ(), "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("a2");
    expect(valeurChoisie(champ())).toBe("a2");
    expect(champ().value).toBe("Crème fraîche 1L");
    expect(listeOuverte()).toBeNull();
  });

  it("Échap ferme sans rien changer, rétablit le libellé, et n'est pas transmis au parent", async () => {
    const surParent = vi.fn();
    const ecoute = (e: Event) => { if ((e as KeyboardEvent).key === "Escape") surParent(); };
    document.addEventListener("keydown", ecoute); // ce que fait une fenêtre ou un tiroir
    onTestFinished(() => document.removeEventListener("keydown", ecoute));
    const onChange = vi.fn();
    monter(h(Demo, { initial: "a4", onChange }));
    await taperChoix(champ(), "bacardi");
    await toucheChoix(champ(), "Escape");
    expect(listeOuverte()).toBeNull();
    expect(champ().value).toBe("Farine de blé");
    expect(onChange).not.toHaveBeenCalled();
    expect(surParent).not.toHaveBeenCalled();
    await toucheChoix(champ(), "Escape"); // fermé : Échap passe au parent (tiroir, fenêtre…)
    expect(surParent).toHaveBeenCalledTimes(1);
  });

  it("Entrée n'envoie jamais le formulaire, liste ouverte ou fermée, même sans résultat", async () => {
    const onSubmit = vi.fn();
    monter(h(Demo, { onSubmit }));
    await taperChoix(champ(), "zzz");
    expect((await toucheChoix(champ(), "Enter")).defaultPrevented).toBe(true);
    await toucheChoix(champ(), "Escape");
    expect((await toucheChoix(champ(), "Enter")).defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Tab choisit l'option en surbrillance quand on a tapé, sans bloquer le passage au champ suivant", async () => {
    const onChange = vi.fn();
    monter(h(Demo, { onChange }));
    await taperChoix(champ(), "farine");
    const ev = await toucheChoix(champ(), "Tab");
    expect(ev.defaultPrevented).toBe(false);
    expect(onChange).toHaveBeenCalledWith("a4");
    expect(listeOuverte()).toBeNull();
  });

  it("Tab sans avoir tapé ferme seulement : le choix ne change pas", async () => {
    const onChange = vi.fn();
    monter(h(Demo, { initial: "a1", onChange }));
    await ouvrirChoix(champ());
    await toucheChoix(champ(), "Tab");
    expect(onChange).not.toHaveBeenCalled();
    expect(listeOuverte()).toBeNull();
  });

  describe("Tab : ne choisit que sans ambiguïté", () => {
    const AMBIGUES: OptionChoix[] = [{ id: "b1", libelle: "Bacardi blanc-1l" }, { id: "b2", libelle: "Bacardi blanc-1l XL" }, { id: "b3", libelle: "Bacardi Carta Oro" }];

    it("plusieurs résultats et aucun libellé exact : rien n'est choisi, le champ revient à son choix d'avant", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { options: AMBIGUES, initial: "b3", onChange }));
      await taperChoix(champ(), "bacardi");
      await toucheChoix(champ(), "Tab");
      expect(onChange).not.toHaveBeenCalled();
      expect(listeOuverte()).toBeNull();
      expect(champ().value).toBe("Bacardi Carta Oro");
    });

    it("plusieurs résultats mais la saisie est exactement un libellé (accents et casse ignorés) : celui-là", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { options: AMBIGUES, onChange }));
      await taperChoix(champ(), "BACARDI  blanc-1L");
      await toucheChoix(champ(), "Tab");
      expect(onChange).toHaveBeenCalledWith("b1");
    });

    it("un seul résultat : choisi (c'est la seule réponse possible)", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { options: AMBIGUES, onChange }));
      await taperChoix(champ(), "carta");
      await toucheChoix(champ(), "Tab");
      expect(onChange).toHaveBeenCalledWith("b3");
    });

    it("texte EFFACÉ, champ non obligatoire : Tab choisit « aucun » (retire l'article)", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { initial: "a2", vide: "— libre —", onChange }));
      await taperChoix(champ(), "");
      await toucheChoix(champ(), "Tab");
      expect(onChange).toHaveBeenCalledWith("");
      expect(valeurChoisie(champ())).toBe("");
    });

    it("texte effacé mais champ obligatoire (ou sans option « aucun ») : le choix d'avant revient", async () => {
      const onChange = vi.fn();
      monter(h("form", null, h(ChoixRecherche, { options: OPTIONS, name: "x", defaultValue: "a2", vide: "— choisir —", required: true, onChange, "aria-label": "Article" })));
      await taperChoix(champ(), "");
      await toucheChoix(champ(), "Tab");
      expect(onChange).not.toHaveBeenCalled();
      expect(champ().value).toBe("Crème fraîche 1L");
      await taperChoix(champ(), ""); // sans `vide` non plus
    });

    it("après ↓ même APRÈS une frappe, Tab choisit l'option SURLIGNÉE : « bacardi » ↓ ↓ Tab → la 3e", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { options: AMBIGUES, onChange }));
      await taperChoix(champ(), "bacardi");
      await toucheChoix(champ(), "ArrowDown");
      await toucheChoix(champ(), "ArrowDown");
      await toucheChoix(champ(), "Tab");
      expect(onChange).toHaveBeenCalledWith("b3");
    });

    it("libellé exact (b1) puis ↓ (b2) puis Tab → b2, pas l'exact", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { options: AMBIGUES, onChange }));
      await taperChoix(champ(), "Bacardi blanc-1l");
      await toucheChoix(champ(), "ArrowDown");
      await toucheChoix(champ(), "Tab");
      expect(onChange).toHaveBeenCalledWith("b2");
    });

    it("texte effacé puis ↓ (1re option réelle) puis Tab → cette option, pas « aucun »", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { options: AMBIGUES, initial: "b3", vide: "— libre —", onChange }));
      await taperChoix(champ(), ""); // liste complète : « — libre — », b1, b2, b3
      await toucheChoix(champ(), "ArrowDown");
      await toucheChoix(champ(), "Tab");
      expect(onChange).toHaveBeenCalledWith("b1");
    });

    it("↓ puis une NOUVELLE frappe puis Tab → la règle de frappe, pas l'ancienne surbrillance", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { options: AMBIGUES, onChange }));
      await taperChoix(champ(), "bacardi");
      await toucheChoix(champ(), "ArrowDown");
      await toucheChoix(champ(), "ArrowDown"); // b3 surligné
      await taperChoix(champ(), "bacard"); // nouvelle frappe : plusieurs résultats, rien d'exact
      await toucheChoix(champ(), "Tab");
      expect(onChange).not.toHaveBeenCalled();
      await taperChoix(champ(), "carta"); // un seul résultat
      await toucheChoix(champ(), "Tab");
      expect(onChange).toHaveBeenCalledWith("b3");
    });

    it("un résultat unique qui est « aucun » ne vide jamais par Tab", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { options: [], initial: "x", vide: "— libre —", onChange }));
      await taperChoix(champ(), "");
      await toucheChoix(champ(), "Tab"); // texte effacé + non obligatoire : « aucun » explicite, voulu
      expect(onChange).toHaveBeenCalledWith("");
    });

    it("après ↓ sans frappe : Tab choisit l'option surlignée, comme Entrée ; sans ↓, il ne change rien", async () => {
      const onChange = vi.fn();
      monter(h(Demo, { initial: "a1", onChange }));
      await ouvrirChoix(champ());
      await toucheChoix(champ(), "Tab");
      expect(onChange).not.toHaveBeenCalled();
      await ouvrirChoix(champ());
      await toucheChoix(champ(), "ArrowDown"); // a1 → a2
      await toucheChoix(champ(), "Tab");
      expect(onChange).toHaveBeenCalledWith("a2");
    });
  });

  it("affiche « N résultats » dans la liste pendant la frappe, et la région vivante existe avant l'ouverture", async () => {
    monter(h(Demo, {}));
    const region = () => document.querySelector<HTMLElement>('[role="status"][data-choix-etat]')!;
    expect(region()).not.toBeNull();
    expect(region().textContent).toBe("");
    await taperChoix(champ(), "1l");
    expect(listeOuverte()!.textContent).toContain("2 résultats");
    expect(region().textContent).toBe("2 résultats");
    await taperChoix(champ(), "farine");
    expect(listeOuverte()!.textContent).toContain("1 résultat");
    expect(listeOuverte()!.textContent).not.toContain("1 résultats");
  });

  it("Entrée sur un résultat déjà choisi ne rappelle pas onChange", async () => {
    const onChange = vi.fn();
    monter(h(Demo, { initial: "a1", onChange }));
    await ouvrirChoix(champ());
    expect(optionsOuvertes()[0].hasAttribute("data-actif")).toBe(true); // le choix courant est en surbrillance
    await toucheChoix(champ(), "Enter");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("à l'ouverture, l'option choisie est en surbrillance", async () => {
    monter(h(Demo, { initial: "a3" }));
    await ouvrirChoix(champ());
    const actives = optionsOuvertes().filter((o) => o.hasAttribute("data-actif"));
    expect(actives.map((o) => o.dataset.choixId)).toEqual(["a3"]);
    expect(optionsOuvertes().find((o) => o.dataset.choixId === "a3")!.getAttribute("aria-selected")).toBe("true");
  });

  it("↓ sur un champ fermé ouvre la liste", async () => {
    monter(h(Demo, {}));
    act(() => champ().focus());
    expect((await toucheChoix(champ(), "ArrowDown")).defaultPrevented).toBe(true);
    expect(listeOuverte()).not.toBeNull();
  });
});

describe("option « aucun » et options propres à la ligne", () => {
  it("« — libre — » est listée en tête quand rien n'est tapé ; la choisir efface l'article", async () => {
    const onChange = vi.fn();
    monter(h(Demo, { initial: "a1", vide: "— libre —", onChange }));
    await ouvrirChoix(champ());
    expect(libellesOuverts()[0]).toBe("— libre —");
    await choisirOption(champ(), "");
    expect(onChange).toHaveBeenCalledWith("");
    expect(valeurChoisie(champ())).toBe("");
    expect(champ().value).toBe("");
  });

  it("un filet sépare les options d'un groupe de celles qui n'en ont pas (« Créer », « Ignorer » ne se lisent pas sous le titre du groupe)", async () => {
    const extras: OptionChoix[] = [{ id: "p1", libelle: "Proche un", groupe: "Proches" }, { id: "creer", libelle: "Créer" }];
    monter(h(Demo, { extras }));
    await ouvrirChoix(champ());
    const liste = listeOuverte()!;
    // Un vrai groupe, nommé par son titre ; puis un filet, puis les options sans groupe.
    const groupe = liste.querySelector('[role="group"]')!;
    expect(document.getElementById(groupe.getAttribute("aria-labelledby")!)!.textContent).toBe("Proches");
    expect([...groupe.querySelectorAll('[role="option"]')].map((o) => (o as HTMLElement).dataset.choixId)).toEqual(["p1"]);
    const creer = optionsOuvertes().find((o) => o.dataset.choixId === "creer")!;
    expect(creer.closest('[role="group"]')).toBeNull();
    expect(creer.parentElement!.querySelector(".border-t")).not.toBeNull();
  });

  it("n'apparaît plus dès qu'on tape", async () => {
    monter(h(Demo, { vide: "— libre —" }));
    await taperChoix(champ(), "farine");
    expect(libellesOuverts()).toEqual(["Farine de blé"]);
  });

  it("extras : en tête, filtrés aussi, jamais en double avec la liste partagée", async () => {
    const extras: OptionChoix[] = [{ id: "creer", libelle: "Créer l'article « Farine »", groupe: "Actions" }, { id: "a4", libelle: "Farine de blé", groupe: "Proches" }];
    monter(h(Demo, { extras }));
    await ouvrirChoix(champ());
    expect(libellesOuverts()).toEqual(["Créer l'article « Farine »", "Farine de blé", "Bacardi blanc-1l", "Crème fraîche 1L", "Épices mélangées"]);
    expect(listeOuverte()!.textContent).toContain("Actions");
    await taperChoix(champ(), "farine");
    expect(libellesOuverts()).toEqual(["Créer l'article « Farine »", "Farine de blé"]);
    await toucheChoix(champ(), "Enter");
    expect(valeurChoisie(champ())).toBe("creer");
    expect(champ().value).toBe("Créer l'article « Farine »");
  });
});

describe("souris et doigt", () => {
  it("un clic sur une option la choisit, le champ garde le focus", async () => {
    const onChange = vi.fn();
    monter(h(Demo, { onChange }));
    await choisirOption(champ(), "a3");
    expect(onChange).toHaveBeenCalledWith("a3");
    expect(champ().value).toBe("Épices mélangées");
    expect(listeOuverte()).toBeNull();
    expect(document.activeElement).toBe(champ());
  });

  it("un appui dans la liste ne retire pas le focus du champ (mousedown neutralisé)", async () => {
    monter(h(Demo, {}));
    await ouvrirChoix(champ());
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => { optionsOuvertes()[0].dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(listeOuverte()).not.toBeNull();
  });

  it("quitter le champ (clic ailleurs) ferme et rétablit le choix : une frappe sans choix ne change rien", async () => {
    const onChange = vi.fn();
    monter(h(Demo, { initial: "a4", onChange }));
    await taperChoix(champ(), "bacardi");
    await act(async () => { champ().blur(); });
    expect(listeOuverte()).toBeNull();
    expect(champ().value).toBe("Farine de blé");
    expect(valeurChoisie(champ())).toBe("a4");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("doigt : si le champ perd le focus PENDANT un appui dans la liste (Safari iOS), la liste reste ouverte et le clic choisit", async () => {
    const onChange = vi.fn();
    monter(h(Demo, { onChange }));
    await ouvrirChoix(champ());
    const option = optionsOuvertes()[2];
    await act(async () => { option.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await act(async () => { champ().blur(); });
    expect(listeOuverte()).not.toBeNull(); // pas fermée avant le clic
    await act(async () => { option.click(); });
    expect(onChange).toHaveBeenCalledWith("a3");
    expect(listeOuverte()).toBeNull();
  });

  it("un appui ailleurs sur la page ferme la liste, même sans perte de focus ; un appui sur le champ ne la ferme pas", async () => {
    monter(h(Demo, { initial: "a4" }));
    await taperChoix(champ(), "bacardi");
    await act(async () => { champ().dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(listeOuverte()).not.toBeNull();
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(listeOuverte()).toBeNull();
    expect(champ().value).toBe("Farine de blé");
  });

  it("la liste flotte dans le <body>, hors du tableau qui défile", async () => {
    monter(h("div", { style: { overflow: "auto" }, id: "defile" }, h("table", null, h("tbody", null, h("tr", null, h("td", null, h(Demo, {})))))));
    await ouvrirChoix(champ());
    const liste = listeOuverte()!;
    expect(liste.closest("#defile")).toBeNull();
    expect(liste.parentElement).toBe(document.body);
    expect(liste.style.position).toBe("fixed");
  });
});

describe("placement dans la zone visible", () => {
  const cadre = (bas: number, top: number) => vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 20, y: top, left: 20, top, right: 220, bottom: bas, width: 200, height: bas - top, toJSON: () => ({}) } as DOMRect);

  it("sous le champ quand il y a de la place", async () => {
    cadre(140, 100);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: { offsetTop: 0, offsetLeft: 0, height: 800, width: 400, addEventListener() {}, removeEventListener() {} } });
    monter(h(Demo, {}));
    await ouvrirChoix(champ());
    const s = listeOuverte()!.style;
    expect(s.top).toBe("144px");
    expect(s.bottom).toBe("");
    expect(parseInt(s.maxHeight)).toBeGreaterThan(100);
  });

  it("au-dessus du champ quand le clavier d'un téléphone réduit la zone visible sous lui", async () => {
    cadre(440, 400);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: { offsetTop: 0, offsetLeft: 0, height: 480, width: 400, addEventListener() {}, removeEventListener() {} } });
    monter(h(Demo, {}));
    await ouvrirChoix(champ());
    const s = listeOuverte()!.style;
    expect(s.top).toBe("");
    expect(s.bottom).not.toBe("");
    expect(parseInt(s.maxHeight)).toBeLessThanOrEqual(352);
    expect(parseInt(s.maxHeight)).toBeGreaterThanOrEqual(120);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  });
});

describe("tableur : Entrée, liste fermée, reprend le comportement de la grille", () => {
  function Grille({ n = 3 }: { n?: number }) {
    return h("div", { "data-tableur": "" },
      Array.from({ length: n }, (_, i) => h("div", { key: i },
        h(ChoixRecherche, { options: OPTIONS, name: "articleId", "aria-label": `Article ${i + 1}` }),
        h("input", { "aria-label": `Qté ${i + 1}` }))));
  }
  it("Entrée passe à l'article de la ligne suivante, Maj+Entrée à la précédente", async () => {
    monter(h(Grille, {}));
    const [a, b, c] = champsChoix(conteneur);
    act(() => a.focus());
    await toucheChoix(a, "Enter");
    expect(document.activeElement).toBe(b);
    await toucheChoix(b, "Enter");
    expect(document.activeElement).toBe(c);
    await toucheChoix(c, "Enter"); // dernière ligne : on reste
    expect(document.activeElement).toBe(c);
    await toucheChoix(c, "Enter", { shiftKey: true });
    expect(document.activeElement).toBe(b);
  });

  it("liste ouverte, Entrée pilote la liste et ne quitte pas la ligne", async () => {
    monter(h(Grille, {}));
    const [a, b] = champsChoix(conteneur);
    await taperChoix(a, "farine");
    await toucheChoix(a, "Enter");
    expect(valeurChoisie(a)).toBe("a4");
    expect(document.activeElement).toBe(a);
    expect(valeurChoisie(b)).toBe("");
  });

  it("une liste partagée pour trente lignes : fermées, aucune ne rend d'option ; ouverte, une seule liste", async () => {
    monter(h(Grille, { n: 30 }));
    expect(champsChoix(conteneur)).toHaveLength(30);
    expect(optionsOuvertes()).toHaveLength(0);
    await ouvrirChoix(champsChoix(conteneur)[7]);
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    expect(optionsOuvertes()).toHaveLength(OPTIONS.length);
  });
});

describe("formulaire", () => {
  it("soumet l'id dans le même name qu'un <select> (et « » pour aucun)", async () => {
    const onSubmit = vi.fn();
    monter(h(Demo, { onSubmit, vide: "— libre —" }));
    await act(async () => { conteneur.querySelector("form")!.requestSubmit(); });
    expect(onSubmit.mock.calls[0][0].getAll("articleId")).toEqual([""]);
    await choisirOption(champ(), "a3");
    await act(async () => { conteneur.querySelector("form")!.requestSubmit(); });
    expect(onSubmit.mock.calls[1][0].getAll("articleId")).toEqual(["a3"]);
    expect([...onSubmit.mock.calls[1][0].keys()]).toEqual(["articleId"]); // le texte tapé ne part pas
  });

  it("mode libre (defaultValue) : le choix s'affiche et se soumet sans état parent", async () => {
    const onSubmit = vi.fn();
    monter(h("form", { onSubmit: (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)); } },
      h(ChoixRecherche, { options: OPTIONS, name: "articleId", defaultValue: "a2", "aria-label": "Article" })));
    expect(champ().value).toBe("Crème fraîche 1L");
    await choisirOption(champ(), "a4");
    await act(async () => { conteneur.querySelector("form")!.requestSubmit(); });
    expect(onSubmit.mock.calls[0][0].get("articleId")).toBe("a4");
  });

  it("mode libre : la remise à zéro du formulaire (celle de React 19 après une action) rend le choix initial", async () => {
    monter(h("form", null, h(ChoixRecherche, { options: OPTIONS, name: "articleId", defaultValue: "", vide: "— article —", "aria-label": "Article" })));
    await choisirOption(champ(), "a3");
    expect(valeurChoisie(champ())).toBe("a3");
    await act(async () => { conteneur.querySelector("form")!.reset(); });
    expect(valeurChoisie(champ())).toBe("");
    expect(champ().value).toBe("");
    expect([...new FormData(conteneur.querySelector("form")!).values()]).toEqual([""]);
  });

  it("mode libre : la remise à zéro rend le defaultValue (pas toujours vide) ; le mode contrôlé n'est pas touché", async () => {
    monter(h("form", null,
      h(ChoixRecherche, { options: OPTIONS, name: "libre", defaultValue: "a2", "aria-label": "Libre" }),
      h(Demo, { initial: "a4" })));
    await choisirOption(champChoix(conteneur, "Libre"), "a1");
    await act(async () => { conteneur.querySelector("form")!.reset(); });
    expect(valeurChoisie(champChoix(conteneur, "Libre"))).toBe("a2");
    expect(champChoix(conteneur, "Article").value).toBe("Farine de blé"); // contrôlé : la valeur est celle du parent
  });

  it("la remise à zéro informe le parent (onChange) quand la valeur change, et seulement alors", async () => {
    const onChange = vi.fn();
    monter(h("form", null, h(ChoixRecherche, { options: OPTIONS, name: "x", defaultValue: "", vide: "— article —", onChange, "aria-label": "Article" })));
    await act(async () => { conteneur.querySelector("form")!.reset(); });
    expect(onChange).not.toHaveBeenCalled(); // déjà à la valeur initiale
    await choisirOption(champ(), "a2");
    onChange.mockClear();
    await act(async () => { conteneur.querySelector("form")!.reset(); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("required : le champ visible est invalide tant que rien n'est choisi", async () => {
    monter(h("form", null, h(ChoixRecherche, { options: OPTIONS, name: "x", required: true, "aria-label": "Article" })));
    expect(champ().required).toBe(true);
    expect(champ().checkValidity()).toBe(false);
    await choisirOption(champ(), "a1");
    expect(champ().checkValidity()).toBe(true);
  });

  it("désactivé : ni ouverture ni envoi", async () => {
    monter(h("form", null, h(ChoixRecherche, { options: OPTIONS, name: "x", defaultValue: "a1", disabled: true, "aria-label": "Article" })));
    await ouvrirChoix(champ());
    expect(listeOuverte()).toBeNull();
    expect([...new FormData(conteneur.querySelector("form")!).keys()]).toEqual([]);
  });
});
