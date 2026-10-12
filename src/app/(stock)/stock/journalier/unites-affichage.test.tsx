// @vitest-environment happy-dom
//
// Audit restaurant du 10/10/2026 — ce que l'écran dit des UNITÉS et des consommations sur plusieurs
// jours : l'unité du catalogue sur chaque ligne (Commande, Comparaison, Consommation, au téléphone
// comme sur le tableau), jamais des unités différentes additionnées dans un total, et le « ≈ » avec
// « depuis le JJ/MM (N jours) » quand la veille n'a pas été comptée.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const m = vi.hoisted(() => ({
  saisirCommandeResto: vi.fn(async () => ({ ok: true as const })),
  saisirCommandeLegume: vi.fn(async () => ({ ok: true as const })),
  rafraichirJournalier: vi.fn(async () => {}),
}));
vi.mock("./actions", () => m);

import { CommandeGrid, type CmdArticle } from "./commande-grid";
import { TableConso } from "./table-conso";
import { TableComparaison } from "./table-comparaison";
import { JourMobileProvider } from "@/components/jour-mobile";
import { SelecteurJour } from "@/components/selecteur-jour";
import { consommationsSemaine, sortiesParMotif, type LigneComparaison } from "@/lib/journalier-restaurant";
import type { EntreesStockResto } from "@/lib/stock-restaurant";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ISOS = ["2026-10-05", "2026-10-06", "2026-10-07"];
const JOURS = ISOS.map((iso, i) => ({ iso, label: `J${i}` }));
let conteneur: HTMLDivElement;
let racine: Root | null = null;
afterEach(() => { if (racine) act(() => racine!.unmount()); racine = null; conteneur?.remove(); });
function monter(corps: ReturnType<typeof h>, defaultIdx = 0) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(h(JourMobileProvider, { defaultIdx, children: h(Fragment, null, h(SelecteurJour, { jours: JOURS, aujourdhui: "2026-10-05" }), corps) })));
}
const jour = () => conteneur.querySelector<HTMLElement>('[data-vue="jour"]')!;
const semaine = () => conteneur.querySelector<HTMLElement>('[data-vue="semaine"]')!;
const texte = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

const S = (articleId: string, unite: string | null, date: string, quantite: number) => ({ articleId, designation: articleId, unite, date, quantite, categorieSortie: "LIVRAISON_RESTAURANT" });

describe("4. Commande : l'unité sur chaque ligne, un total par unité", () => {
  const ARTICLES: CmdArticle[] = [
    { id: "farine", designation: "Farine", unite: "kg", categorie: "Épicerie" },
    { id: "vin", designation: "Vin rouge", unite: "bouteille", categorie: "Bar" },
    { id: "legume:Ail", designation: "Ail", unite: "Kg", categorie: "Légumes frais" },
    { id: "sel", designation: "Sel", categorie: "Épicerie" }, // unité non renseignée : le nom seul
  ];
  const COMMANDES = { "farine_2026-10-05": 10, "vin_2026-10-05": 5, "legume:Ail_2026-10-05": 2, "sel_2026-10-05": 1 };
  const rendu = () => h(CommandeGrid, { articles: ARTICLES, jours: JOURS, commandes: COMMANDES, peutModifier: true });

  it("tableau de la semaine : l'unité à côté du nom ; le pied dit « 12 kg » et « 5 bouteille », jamais « 18 »", () => {
    monter(rendu());
    const lignes = [...semaine().querySelectorAll("tbody tr")].map((tr) => texte(tr.children[0]!));
    expect(lignes).toContain("Farine (kg)");
    expect(lignes).toContain("Vin rouge (bouteille)");
    expect(lignes).toContain("Ail (Kg)");
    expect(lignes).toContain("Sel"); // jamais une unité inventée
    const pied = [...semaine().querySelectorAll("tfoot td")].map(texte);
    expect(pied[1]).toBe("12 kg5 bouteille1 (unité ?)"); // 10 + 2 kg (Farine + Ail), 5 bouteilles, 1 sans unité
    expect(pied.join("|")).not.toContain("18");
  });

  it("téléphone : l'unité à côté du nom, et le résumé du jour est par unité", () => {
    monter(rendu());
    const t = texte(jour());
    expect(t).toContain("Farine (kg)");
    expect(t).toContain("Vin rouge (bouteille)");
    expect(t).toContain("Total du jour : 12 kg · 5 bouteille · 1 (unité ?)");
    expect(t).not.toContain("18");
  });
});

describe("4. Consommation : unité sur les lignes livrées, totaux par unité, ≈ et « depuis le » sur la consommation", () => {
  const e: EntreesStockResto = {
    articles: [{ id: "f", designation: "Farine", espace: "CUISINE", unite: "kg", rattaches: [] }],
    comptages: [
      { articleRestoId: "f", date: "2026-10-02", quantite: "10" },
      { articleRestoId: "f", date: "2026-10-06", quantite: "4" }, // veille (05) non comptée : 6 kg sur 4 jours
      { articleRestoId: "f", date: "2026-10-07", quantite: "3" },
    ],
    livraisons: [],
  };
  const rendu = () => h(TableConso, {
    jours: JOURS,
    sorties: sortiesParMotif([S("Farine", "kg", "2026-10-05", 10), S("Vin", "bouteille", "2026-10-05", 5), S("Vin", "bouteille", "2026-10-06", 1)], ISOS),
    legumes: [{ nom: "Ail", unite: "Kg", jours: [1, 0, 0], total: 1 }],
    consoResto: consommationsSemaine(e, ISOS),
  });

  it("tableau : « Farine (kg) », « Vin (bouteille) », légume « Ail (Kg) » ; pied par unité", () => {
    const html = renderToStaticMarkup(rendu());
    const div = document.createElement("div");
    div.innerHTML = html;
    const noms = [...div.querySelectorAll('[data-vue="semaine"] tbody tr')].map((tr) => texte(tr.children[0]!));
    expect(noms).toEqual(expect.arrayContaining(["Farine (kg)", "Vin (bouteille)", "Ail (Kg)"]));
    const pied = [...div.querySelectorAll("tfoot td")].map(texte);
    expect(pied[1]).toBe("10 kg5 bouteille"); // lundi : jamais « 15 »
    expect(pied[2]).toBe("1 bouteille");
    expect(pied[4]).toBe("10 kg6 bouteille"); // semaine
  });

  it("tableau : la consommation de plusieurs jours est « ≈ » et dit depuis quand (infobulle et mention visibles)", () => {
    const div = document.createElement("div");
    div.innerHTML = renderToStaticMarkup(rendu());
    const ligne = [...div.querySelectorAll('[data-vue="semaine"] tbody tr')].find((tr) => texte(tr.children[0]!).startsWith("Farine (kg)") && tr.children.length === 5 && texte(tr.children[2]!).includes("≈"))!;
    expect(ligne).toBeTruthy();
    const cellule = ligne.children[2]!;
    expect(texte(cellule)).toBe("≈ 6depuis le 02/10 (4 jours)");
    expect(cellule.getAttribute("title")).toContain("depuis le 02/10 (4 jours)");
    // La veille comptée : un jour, ni ≈ ni mention.
    expect(texte(ligne.children[3]!)).toBe("1");
  });

  it("téléphone : le jour affiche l'unité à côté de la quantité, le total par unité, « ≈ » et la mention", () => {
    monter(rendu(), 0);
    expect(texte(jour())).toContain("Farine10 kg");
    expect(texte(jour())).toContain("Total livré au restaurant10 kg · 5 bouteille");
    act(() => { conteneur.querySelector<HTMLButtonElement>('[data-selecteur-jour] button[aria-label^="mardi"]')!.click(); });
    const t = texte(jour());
    expect(t).toContain("≈ 6");
    expect(t).toContain("veille non comptée : consommation depuis le 02/10 (4 jours)");
  });
});

describe("4. Comparaison : l'unité à côté de l'article ; le consommé de plusieurs jours est « ≈ »", () => {
  const L = (p: Partial<LigneComparaison> & { designation: string }): LigneComparaison => ({
    id: p.designation, categorie: "Épicerie", lien: true, cmd: [0, 0, 0], liv: [0, 0, 0], conso: [null, null, null], ecarts: [null, null, null], ...p,
  });

  it("tableau de la semaine et téléphone", () => {
    const lignes = [L({ designation: "Farine", unite: "kg", cmd: [3, 0, 0], liv: [3, 0, 0], conso: ["6", null, null], consoApprox: ["depuis le 02/10 (4 jours)", null, null], ecarts: ["CONSOMME_PLUS_QUE_LIVRE", null, null] }), L({ designation: "Sel", cmd: [1, 0, 0] })];
    monter(h(TableComparaison, { jours: JOURS, lignes, sansMotif: 0 }), 0);
    const farine = semaine().querySelector('tr[data-article="Farine"]')!;
    expect(texte(farine.children[0]!)).toBe("Farine (kg)");
    expect(texte(semaine().querySelector('tr[data-article="Sel"]')!.children[0]!)).toBe("Sel");
    const conso = farine.children[3]!;
    expect(texte(conso)).toContain("≈ 6");
    expect(texte(conso)).toContain("depuis le 02/10 (4 jours)");
    expect(conso.getAttribute("title")).toContain("consommation depuis le 02/10 (4 jours)");
    const tel = jour().querySelector('[data-article="Farine"]')!;
    expect(texte(tel)).toContain("Farine (kg)");
    expect(texte(tel)).toContain("≈ 6");
    expect(texte(tel)).toContain("depuis le 02/10 (4 jours)");
  });
});
