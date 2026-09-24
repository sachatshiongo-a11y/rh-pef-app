// @vitest-environment happy-dom
//
// Mesure du coût de la saisie dans l'onglet Commande (178 articles × 7 jours = 1 246 cases) :
// combien de LIGNES se re-rendent (1) par frappe, (2) à la validation d'une case, (3) quand le
// serveur renvoie la page (ce que faisait `revalidatePath` après CHAQUE case) — et combien
// d'appels serveur part une case.
//
// Mesuré AVANT le correctif (2026-09-24), avec ce même fichier :
//   frappe : 0 ligne · validation : 1 ligne, 1 action (+ 1 revalidatePath = page entière)
//   rafraîchissement serveur aux valeurs inchangées : 178 lignes re-rendues (toutes).
//
// Compteur de rendus : chaque rendu d'une ligne appelle `qte(total de la ligne)`, qu'on espionne.
// Les totaux de LIGNE valent 1 (ou 13 pour la ligne modifiée) ; ceux du PIED valent 178, 12, 190…
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const appels = vi.hoisted(() => ({ lignes: 0, resto: 0, legume: 0, rafraichir: 0 }));

vi.mock("@/lib/stock", () => ({
  qte: (v: number) => { if (v === 1 || v === 13) appels.lignes++; return String(v); },
}));
vi.mock("./actions", () => ({
  saisirCommandeResto: vi.fn(async () => { appels.resto++; return { ok: true }; }),
  saisirCommandeLegume: vi.fn(async () => { appels.legume++; return { ok: true }; }),
  rafraichirJournalier: vi.fn(async () => { appels.rafraichir++; }),
}));

import { CommandeGrid, type CmdArticle } from "./commande-grid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOURS = Array.from({ length: 7 }, (_, i) => ({ iso: `2026-09-${String(21 + i).padStart(2, "0")}`, label: `J${i}` }));
const NB = 178;
function donnees() {
  const articles: CmdArticle[] = Array.from({ length: NB }, (_, i) => ({
    id: `art${i}`, designation: `Article ${String(i).padStart(3, "0")}`, categorie: `Cat ${Math.floor(i / 15)}`,
  }));
  // Chaque ligne a 1 le lundi : son total est > 0, donc chaque rendu de ligne appelle qte().
  const commandes: Record<string, number> = {};
  for (const a of articles) commandes[`${a.id}_${JOURS[0].iso}`] = 1;
  return { articles, commandes };
}

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  Object.assign(appels, { lignes: 0, resto: 0, legume: 0, rafraichir: 0 });
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

function rendre(props: ReturnType<typeof donnees>) {
  act(() => {
    racine.render(createElement(CommandeGrid, { articles: props.articles, jours: JOURS, commandes: props.commandes, peutModifier: true }));
  });
}
const cellules = () => [...conteneur.querySelectorAll<HTMLInputElement>("tbody input")];
function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Commande — coût d'une saisie (178 × 7)", () => {
  it("la grille a bien 178 × 7 cases, sans aucun champ type=number", () => {
    rendre(donnees());
    expect(cellules()).toHaveLength(NB * 7);
    expect(conteneur.querySelectorAll('input[type="number"]')).toHaveLength(0);
  });

  it("frapper dans une case ne re-rend aucune ligne et n'appelle pas le serveur", () => {
    rendre(donnees());
    const c = cellules()[7 * 10 + 2];
    act(() => c.focus());
    appels.lignes = 0;
    taper(c, "1");
    taper(c, "12");
    expect(appels.lignes).toBe(0);
    expect(appels.resto).toBe(0);
  });

  it("valider une case : 1 appel serveur, pas de revalidation immédiate, seule sa ligne se re-rend", async () => {
    rendre(donnees());
    const c = cellules()[7 * 10 + 2];
    act(() => c.focus());
    taper(c, "12");
    appels.lignes = 0;
    await act(async () => { c.blur(); });
    expect(appels.resto).toBe(1);
    expect(appels.rafraichir).toBe(0); // la revalidation attend le repos de la saisie
    expect(appels.lignes).toBe(1); // la seule ligne touchée (total 13)
  });

  it("repasser par une case sans la changer n'appelle pas le serveur", async () => {
    rendre(donnees());
    const c = cellules()[7 * 10];
    act(() => c.focus());
    await act(async () => { c.blur(); });
    taper(c, "1,0"); // même valeur, autre écriture
    await act(async () => { c.blur(); });
    expect(appels.resto).toBe(0);
  });

  it("des props serveur rafraîchies mais identiques ne re-rendent aucune ligne", () => {
    rendre(donnees());
    appels.lignes = 0;
    rendre(donnees()); // mêmes valeurs, NOUVEAUX objets — ce que renvoie une revalidation
    expect(appels.lignes).toBe(0);
  });

  it("une rafale de saisies ne revalide la page qu'une fois, au repos", async () => {
    vi.useFakeTimers();
    try {
      rendre(donnees());
      const cs = cellules();
      for (const i of [0, 7, 14]) {
        act(() => cs[i].focus());
        taper(cs[i], "5");
        await act(async () => { cs[i].blur(); });
      }
      expect(appels.resto).toBe(3);
      expect(appels.rafraichir).toBe(0);
      await act(async () => { vi.advanceTimersByTime(3500); });
      expect(appels.rafraichir).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("une valeur tapée survit au filtre de recherche (ligne masquée puis ré-affichée)", async () => {
    rendre(donnees());
    const c = cellules()[7 * 3 + 1]; // Article 003, mardi
    act(() => c.focus());
    taper(c, "7");
    await act(async () => { c.blur(); });
    const recherche = conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')!;
    taper(recherche, "Article 100");
    expect(cellules()).toHaveLength(7);
    taper(recherche, "");
    expect(cellules()[7 * 3 + 1].value).toBe("7");
  });
});
