// @vitest-environment happy-dom
//
// Stock restaurant sur téléphone (demande de la Direction, 2026-09-30) : le comptage d'UN jour, article par
// article, avec le stock théorique et le « reçu du dépôt » en petit sous le nom. Même action
// `majComptage`, mêmes arguments que la grille ; la sélection (Direction) est partagée avec elle.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Jour, LigneResto } from "./restaurant-client";

const m = vi.hoisted(() => ({
  majComptage: vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  changerActivationArticlesResto: vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true })),
}));
vi.mock("./actions", () => ({
  majComptage: m.majComptage, changerActivationArticlesResto: m.changerActivationArticlesResto,
  modifierArticleResto: vi.fn(async () => undefined), creerArticleResto: vi.fn(async () => undefined),
  supprimerArticleResto: vi.fn(async () => undefined), rattacherArticleResto: vi.fn(async () => ({ n: 0 })),
}));

const { RestaurantGrille } = await import("./restaurant-client");
const { JourMobileProvider } = await import("@/components/jour-mobile");
const { SelecteurJour } = await import("@/components/selecteur-jour");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOURS: Jour[] = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]
  .map((iso, i) => ({ iso, label: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"][i]!, num: `${Number(iso.slice(8))} ${iso.startsWith("2026-10") ? "oct." : "sept."}` }));
const ligne = (p: Partial<LigneResto> & { id: string; designation: string }): LigneResto => ({
  categorie: "Épicerie", unite: "kg", base: "", comptages: {}, articleStockId: null, articleStockDesignation: null,
  recus: {}, signauxJour: {}, theorique: { stock: null, aucunComptage: true, signalements: [] }, ...p,
});
const LIGNES = [
  ligne({ id: "farine", designation: "Farine", base: "10", comptages: { "2026-09-30": "3.5", "2026-09-29": "8" }, recus: { "2026-09-30": "2000" }, theorique: { stock: "3.5", aucunComptage: false, signalements: [] } }),
  ligne({ id: "sel", designation: "Sel" }),
  ligne({ id: "cola", designation: "Coca", categorie: "Boissons", unite: "casier", theorique: { stock: "12", aucunComptage: true, signalements: [] }, signauxJour: { "2026-09-30": ["3 l : unité incompatible"] } }),
  ligne({ id: "vieux", designation: "Ancien article", actif: false }),
];

let conteneur: HTMLDivElement;
let racine: Root;
function monter(estDirection: boolean) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(
    <JourMobileProvider defaultIdx={2}>
      <SelecteurJour jours={JOURS} aujourdhui="2026-09-30" />
      <RestaurantGrille espace="CUISINE" jours={JOURS} lignes={LIGNES} categories={[]} estDirection={estDirection} catalogue={[]} />
    </JourMobileProvider>,
  ));
}
beforeEach(() => { m.majComptage.mockClear(); m.changerActivationArticlesResto.mockClear(); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const liste = () => conteneur.querySelector<HTMLElement>('[data-vue="jour"] [data-vue-liste="restaurant"]')!;
const caseJour = (libelle: string) => [...liste().querySelectorAll<HTMLInputElement>('input[data-tableur-col]')].find((i) => i.getAttribute("aria-label") === libelle)!;
function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Stock restaurant sur téléphone — le comptage du jour", () => {
  it("jour courant par défaut : une case de comptage par article, avec la valeur du jour", () => {
    monter(false);
    expect(liste().querySelector("h2")!.textContent).toBe("mercredi 30 septembre");
    const cases = [...liste().querySelectorAll<HTMLInputElement>("input")];
    expect(cases.map((i) => i.getAttribute("aria-label"))).toEqual(["Farine — Mer 30 sept.", "Sel — Mer 30 sept.", "Coca — Mer 30 sept.", "Ancien article — Mer 30 sept."]);
    expect(cases.map((i) => i.value)).toEqual(["3,5", "", "", ""]);
    for (const i of cases) { expect(i.type).toBe("text"); expect(i.className).toContain("h-11"); }
    expect(caseJour("Ancien article — Mer 30 sept.").disabled).toBe(true); // désactivé : pas de saisie
  });

  it("stock théorique et reçu du dépôt en petit sous le nom ; « — » si inconnu ; signalements en clair", () => {
    monter(false);
    const t = liste().textContent!;
    expect(t).toContain("Théorique aujourd'hui : 3,5 kg");
    expect(t).toContain("base 10");
    expect(t).toContain("reçu du dépôt 2 000");
    expect(t).toContain("Théorique aujourd'hui : —"); // Sel : inconnu, jamais 0
    expect(t).toContain("estimé (aucun comptage)"); // Coca : stock 12 sans comptage
    expect(t).toContain("3 l : unité incompatible");
    // Pas de reçu affiché pour un jour sans livraison.
    expect(liste().querySelectorAll('[aria-label^="Reçu du dépôt"]')).toHaveLength(1);
  });

  it("saisie mobile : majComptage(article, date du jour, texte) — comme la grille", async () => {
    monter(false);
    const grille = [...conteneur.querySelectorAll<HTMLInputElement>('[data-vue="semaine"] tbody input')].find((i) => i.getAttribute("aria-label") === "Farine — Mer 30 sept.")!;
    act(() => grille.focus()); taper(grille, "4"); await act(async () => { grille.blur(); });
    const viaGrille = m.majComptage.mock.calls.at(-1);
    m.majComptage.mockClear();
    const c = caseJour("Farine — Mer 30 sept.");
    act(() => c.focus()); taper(c, "4,5"); await act(async () => { c.blur(); });
    expect(viaGrille).toEqual(["farine", "2026-09-30", "4"]);
    expect(m.majComptage.mock.calls).toEqual([["farine", "2026-09-30", "4.5"]]);
  });

  it("changer de jour : autre titre, autres valeurs, autres libellés", () => {
    monter(false);
    act(() => { conteneur.querySelector<HTMLButtonElement>('[data-selecteur-jour] button[aria-label^="mardi"]')!.click(); });
    expect(liste().querySelector("h2")!.textContent).toBe("mardi 29 septembre");
    expect(caseJour("Farine — Mar 29 sept.").value).toBe("8");
    expect(liste().textContent).not.toContain("reçu du dépôt"); // reçu le mercredi seulement
  });

  it("Entrée descend à l'article suivant", async () => {
    monter(false);
    const c = caseJour("Farine — Mer 30 sept.");
    act(() => c.focus());
    await act(async () => { c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(caseJour("Sel — Mer 30 sept."));
  });

  it("Direction : cases à cocher par ligne, « Tout cocher », barre d'actions groupées partagée avec la grille", async () => {
    monter(true);
    const coches = [...liste().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(coches).toHaveLength(LIGNES.length + 1); // + « Tout cocher »
    act(() => { liste().querySelector<HTMLInputElement>('input[aria-label="Sélectionner Sel"]')!.click(); });
    expect(conteneur.textContent).toContain("1 article(s) sélectionné(s)");
    const barre = [...conteneur.querySelectorAll("div")].find((d) => d.textContent?.startsWith("1 article(s) sélectionné(s)"))!;
    expect(barre.className.split(/\s+/)).toContain("colle-sous-entete"); // sous la barre du haut, pas dessus
    await act(async () => { [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Désactiver la sélection")!.click(); });
    expect(m.changerActivationArticlesResto).toHaveBeenCalledWith(["sel"], false, false);
    // La même sélection est cochée dans le tableau de la semaine.
    expect(conteneur.querySelector<HTMLInputElement>('[data-vue="semaine"] input[aria-label="Sélectionner Sel"]')).not.toBeNull();
  });

  it("hors Direction : aucune case à cocher", () => {
    monter(false);
    expect(liste().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("le tableau de la semaine reste rendu, colonnes figées sur mobile (Vue semaine)", () => {
    monter(true);
    const semaine = conteneur.querySelector('[data-vue="semaine"]')!;
    expect(semaine.className).toContain("max-lg:hidden");
    expect(semaine.querySelector("thead th")!.className).toContain("max-lg:sticky");
    expect(semaine.querySelector("tbody td")!.className).toContain("max-lg:sticky");
  });
});
