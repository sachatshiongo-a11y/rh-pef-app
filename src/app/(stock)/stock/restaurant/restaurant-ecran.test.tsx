// @vitest-environment happy-dom
//
// Écran Stock restaurant (demande de la Direction, 2026-09-30) : sur téléphone, titre et Cuisine / Bar
// sur une ligne, semaine sur une ligne avec « Plus » (fiches, export, désactivés, aide), livraisons
// reçues repliées, sélecteur de jour ; sur ordinateur, les rangées d'origine (masquées sous `lg`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({
  majComptage: vi.fn(), modifierArticleResto: vi.fn(), creerArticleResto: vi.fn(), supprimerArticleResto: vi.fn(),
  rattacherArticleResto: vi.fn(), changerActivationArticlesResto: vi.fn(), accepterPropositions: vi.fn(),
}));
const { RestaurantEcran } = await import("./restaurant-ecran");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOURS = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]
  .map((iso, i) => ({ iso, label: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"][i]!, num: `${Number(iso.slice(8))} ${iso.startsWith("2026-10") ? "oct." : "sept."}` }));
let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(p: { estDirection?: boolean; afficherDesactives?: boolean; livraisons?: boolean } = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(RestaurantEcran, {
    espace: "CUISINE", jours: JOURS, aujourdhui: "2026-09-30", estDirection: p.estDirection ?? true, afficherDesactives: p.afficherDesactives ?? false,
    lignes: [{ id: "a", categorie: "Épicerie", designation: "Farine", unite: "kg", base: "", comptages: {}, articleStockId: null, articleStockDesignation: null, recus: {}, signauxJour: {}, theorique: { stock: null, aucunComptage: true, signalements: [] } }],
    categories: ["Épicerie"], catalogue: [],
    livraisonsParJour: p.livraisons === false ? [] : [["2026-09-29", [{ designation: "Riz", quantite: 10 }]]],
    nonRattachees: [], signalements: [], articlesResto: [], propositions: [],
  })));
}
const ouvrirPlus = () => act(() => { conteneur.querySelector<HTMLButtonElement>('button[aria-label^="Plus d\'options"]')!.click(); });

describe("écran Stock restaurant", () => {
  it("titre réduit sur téléphone, Cuisine / Bar en pilules de 44 px, sur la même ligne", () => {
    monter();
    const titre = conteneur.querySelector("h1")!;
    expect(titre.className).toContain("text-lg");
    expect(titre.className).toContain("sm:text-2xl");
    const pilules = [...titre.parentElement!.querySelectorAll("a")].slice(0, 2);
    expect(pilules.map((a) => a.textContent)).toEqual(["Cuisine", "Bar"]);
    expect(pilules[0]!.className).toContain("max-lg:min-h-11");
    expect(titre.parentElement!.className).not.toContain("flex-wrap ");
  });

  it("ordinateur : la rangée de la semaine, les fiches et l'export d'origine, masqués sous lg", () => {
    monter();
    const rangees = [...conteneur.querySelectorAll<HTMLElement>("div.max-lg\\:hidden")];
    const semaine = rangees.find((d) => d.textContent!.includes("Semaine préc."))!;
    for (const t of ["Semaine du 28 sept. au 4 oct.", "Semaine suiv.", "Afficher les désactivés"]) expect(semaine.textContent).toContain(t);
    expect(rangees.some((d) => d.textContent!.includes("Fiche d'inventaire (PDF)") && d.textContent!.includes("Exporter"))).toBe(true);
  });

  it("téléphone : semaine sur une ligne, « Plus » fermé ; ouvert : fiches, export, désactivés, aide, Cette semaine", () => {
    monter();
    const barre = conteneur.querySelector("[data-barre-semaine]")!;
    expect(barre.textContent).toContain("Sem. du 28/9 au 4/10");
    expect(conteneur.querySelector("[data-plus-mobile]")).toBeNull();
    ouvrirPlus();
    const t = conteneur.querySelector("[data-plus-mobile]")!.textContent!;
    for (const attendu of ["Cette semaine", "Vue semaine", "Afficher les désactivés", "Fiche d'inventaire (PDF)", "Exporter", "Tableur éditable", "stock théorique"]) expect(t).toContain(attendu);
    expect(conteneur.querySelector('[data-plus-mobile] a[href*="semaine=2026-09-30"]')).not.toBeNull(); // « Cette semaine » = aujourd'hui
  });

  it("hors Direction : pas d'option « désactivés » ; désactivés affichés : filtre visible avec « Retirer »", () => {
    monter({ estDirection: false });
    ouvrirPlus();
    expect(conteneur.querySelector("[data-plus-mobile]")!.textContent).not.toContain("désactivés");
    act(() => racine.unmount()); conteneur.remove();
    monter({ afficherDesactives: true });
    const chip = conteneur.querySelector("[data-barre-semaine] p")!;
    expect(chip.textContent).toContain("articles désactivés affichés");
    expect(chip.querySelector("a")!.getAttribute("href")).toBe("/stock/restaurant?espace=CUISINE&semaine=2026-09-28");
  });

  it("livraisons reçues : bandeau complet sur ordinateur, ligne repliée « (1 jour) » sur téléphone", () => {
    monter();
    const details = [...conteneur.querySelectorAll("details")].find((d) => d.textContent!.includes("Livraisons reçues"))!;
    expect(details.className).toContain("lg:hidden");
    expect(details.querySelector("summary")!.textContent).toContain("Livraisons reçues cette semaine (1 jour)");
    expect(details.hasAttribute("open")).toBe(false);
    expect([...conteneur.querySelectorAll("div.max-lg\\:hidden")].some((d) => d.textContent!.includes("Livraisons reçues cette semaine") && d.textContent!.includes("Riz (10)"))).toBe(true);
    act(() => racine.unmount()); conteneur.remove();
    monter({ livraisons: false });
    expect([...conteneur.querySelectorAll("details")].some((d) => d.textContent!.includes("Livraisons reçues"))).toBe(false);
  });

  it("le sélecteur de jour et la liste du jour sont là, sur le jour courant", () => {
    monter();
    expect(conteneur.querySelectorAll("[data-selecteur-jour] button")).toHaveLength(7);
    expect(conteneur.querySelector('[data-vue-liste="restaurant"] h2')!.textContent).toBe("mercredi 30 septembre");
    // Ordinateur : le tableau de la semaine est toujours rendu.
    expect(conteneur.querySelector('[data-vue="semaine"] table')).not.toBeNull();
  });
});
