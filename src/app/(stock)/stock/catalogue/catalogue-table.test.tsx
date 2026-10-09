// @vitest-environment happy-dom
//
// Inventaire sur téléphone (demande de la Direction, 2026-09-29) : chaque article est UNE rangée
// compacte où le stock (quantité + unité) saute aux yeux, colorée selon le niveau d'alerte ; un appui
// déplie les détails. Depuis le 2026-10-09 l'Inventaire est en LECTURE : le nom mène à la fiche article,
// le fournisseur à sa fiche, et rien ne s'y modifie en ligne (tout se modifie depuis la fiche).
// Ce que ces tests ne voient pas : les hauteurs réelles et le débordement à 375 px (vérifiés à l'œil).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: vi.fn(), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(),
  basculerActifArticles: vi.fn(), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(),
  corrigerStocksNegatifs: vi.fn(),
}));

const { CatalogueTable, etatStock } = await import("./catalogue-table");
type ArticleRow = Parameters<typeof CatalogueTable>[0]["articles"][number];

const base = { code: null, nomCourt: null, surFicheCommande: false, domaine: "NOURRITURE" as const, categorieId: "c1", fournisseurId: null, uniteParCarton: null, prix: "2", haussePct: null };
const ARTICLES: ArticleRow[] = [
  { ...base, id: "ok", designation: "Riz", unite: "Kg", quantite: "78", stockMinimum: "20", niveau: "OK" },
  { ...base, id: "bas", designation: "Farine", nomCourt: "Farine T55", unite: "Kg", quantite: "4.83", stockMinimum: "5", niveau: "APPRO" },
  { ...base, id: "rupture", designation: "Beurre", unite: "Kg", quantite: "0", stockMinimum: "3", niveau: "URGENT" },
  { ...base, id: "negatif", designation: "Sucre", unite: "Kg", quantite: "-2.5", stockMinimum: "0", niveau: "OK" },
  { ...base, id: "inconnu", designation: "Amidon", unite: null, quantite: "0", stockMinimum: "0", niveau: null },
];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: [{ id: "c1", nom: "Farines", domaine: "NOURRITURE" }], fournisseurs: [] })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const mobile = () => conteneur.querySelector<HTMLElement>('[data-vue="rangees-mobile"]')!;
const rangee = (id: string) => mobile().querySelector<HTMLElement>(`[data-article="${id}"]`)!;
const stock = (id: string) => rangee(id).querySelector<HTMLElement>("[data-stock]")!;
const bouton = (id: string) => rangee(id).querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const clic = (el: HTMLElement) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const noms = () => [...mobile().querySelectorAll<HTMLElement>("[data-article]")].map((e) => e.dataset.article);

describe("rangée compacte — le stock en évidence", () => {
  it("affiche la quantité et l'unité, à la française", () => {
    expect(stock("bas").textContent).toBe("4,83Kg");
    expect(stock("ok").textContent).toBe("78Kg");
    expect(stock("bas").className).toMatch(/text-xl.*font-bold|font-bold.*text-xl/);
  });

  it("colore selon l'état : rupture rouge, sous le seuil ambre, correct neutre", () => {
    expect(stock("rupture").className).toContain("text-red-700");
    expect(stock("bas").className).toContain("text-amber-700");
    expect(stock("ok").className).toContain("text-foreground");
    expect(stock("ok").className).not.toMatch(/text-(red|amber)/);
  });

  it("reprend les libellés du badge (« À réapprovisionner », « Urgent »), et rien pour un article correct", () => {
    expect(rangee("bas").textContent).toContain("À réapprovisionner");
    expect(rangee("rupture").textContent).toContain("Urgent");
    expect(rangee("ok").textContent).not.toMatch(/Satisfaisant|Urgent|réapprovisionner/);
  });

  it("montre le seuil en petit et le nom court sous le nom", () => {
    expect(rangee("bas").textContent).toContain("min. 5");
    expect(rangee("bas").textContent).toContain("Farine T55");
    expect(rangee("negatif").textContent).toContain("sans seuil");
  });

  it("une quantité inconnue s'affiche « — », jamais 0", () => {
    expect(stock("inconnu").textContent).toBe("—");
    expect(stock("inconnu").className).not.toMatch(/text-(red|amber)/);
  });

  it("un stock négatif reste visible, en rouge et signalé", () => {
    expect(stock("negatif").textContent).toBe("-2,5Kg");
    expect(stock("negatif").className).toContain("text-red-700");
    expect(rangee("negatif").textContent).toContain("Négatif");
  });

  it("garde la case des actions groupées, avec une zone de 44 px", () => {
    const case_ = rangee("ok").querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(case_.closest("label")!.className).toContain("w-11");
    clic(case_);
    expect(conteneur.textContent).toContain("1 sélectionné(s)");
  });

  it("etatStock : n'invente aucun seuil, il lit le niveau d'alerte", () => {
    expect(etatStock({ quantite: "0", niveau: "OK" }).ton).toBe("ok"); // pas de seuil défini → pas d'alerte
    expect(etatStock({ quantite: "3", niveau: "URGENT" }).ton).toBe("rupture");
    expect(etatStock({ quantite: "3", niveau: "APPRO" }).ton).toBe("bas");
    expect(etatStock({ quantite: "", niveau: "OK" }).inconnu).toBe(true);
    expect(etatStock({ quantite: "-1", niveau: "OK" })).toMatchObject({ negatif: true, ton: "rupture" });
  });
});

describe("dépliage des détails (lecture seule)", () => {
  it("replié : aucun champ de saisie dans la rangée", () => {
    expect(rangee("bas").querySelector("input:not([type=checkbox])")).toBeNull();
    expect(bouton("bas").getAttribute("aria-expanded")).toBe("false");
  });

  it("un appui déplie les détails en texte simple, un second les replie", () => {
    clic(bouton("bas"));
    expect(bouton("bas").getAttribute("aria-expanded")).toBe("true");
    const details = rangee("bas").querySelector<HTMLElement>("dl")!;
    expect(details.textContent).toContain("Farine T55"); // nom court
    expect(details.textContent).toContain("Farines"); // catégorie
    expect(rangee("bas").querySelector("input:not([type=checkbox]), select, textarea")).toBeNull();
    expect(rangee("bas").querySelector('a[aria-label="Fiche article — Farine"][href="/stock/catalogue/bas"]')).not.toBeNull();
    clic(bouton("bas"));
    expect(rangee("bas").querySelector("dl")).toBeNull();
  });

  it("une valeur absente s'affiche « — », jamais 0 (code, nom court, fournisseur, unités par carton, seuil)", () => {
    clic(bouton("inconnu"));
    const valeurs = [...rangee("inconnu").querySelectorAll("dd")].map((d) => d.textContent);
    expect(valeurs.slice(0, 2)).toEqual(["—", "—"]); // code, nom court
    expect(valeurs[3]).toBe("—"); // fournisseur
    expect(valeurs[4]).toBe("—"); // unité
    expect(valeurs[5]).toBe("—"); // stock min. 0 = pas de seuil
    expect(valeurs[7]).toBe("—"); // unités par carton
  });

  it("un seul article déplié à la fois", () => {
    clic(bouton("bas"));
    clic(bouton("ok"));
    expect(mobile().querySelectorAll('[aria-expanded="true"]').length).toBe(1);
    expect(bouton("ok").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("tri sur téléphone", () => {
  const tri = () => conteneur.querySelector<HTMLSelectElement>('select[aria-label="Trier les articles"]')!;
  const choisir = (v: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(tri(), v);
    tri().dispatchEvent(new Event("change", { bubbles: true }));
  });

  it("propose « stock bas » et classe le plus bas d'abord (même tri que la colonne Stock de l'ordinateur)", () => {
    expect([...tri().options].map((o) => o.value)).toContain("stock:1");
    choisir("stock:1");
    expect(noms()).toEqual(["negatif", "rupture", "inconnu", "bas", "ok"]);
    choisir("stock:-1");
    expect(noms()[0]).toBe("ok");
    choisir("");
    expect(noms()).toEqual(["ok", "bas", "rupture", "negatif", "inconnu"]);
  });

  it("le tri est masqué sur ordinateur (lg:hidden)", () => {
    expect(tri().closest("label")!.className).toContain("lg:hidden");
  });
});

describe("ordinateur — tableau en lecture, noms et fournisseurs cliquables", () => {
  const bloc = () => conteneur.querySelector("table")!.parentElement!;
  const lignes = () => [...bloc().querySelectorAll("tbody tr")].filter((tr) => tr.querySelector('input[type="checkbox"]'));

  it("une ligne par article, masquée sur téléphone, avec sa case d'action groupée", () => {
    expect(bloc().className).toMatch(/hidden.*lg:block/);
    expect(mobile().className).toContain("lg:hidden");
    expect(lignes().length).toBe(ARTICLES.length);
  });

  it("aucun champ modifiable dans le tableau : seules les cases à cocher sont des champs", () => {
    expect(bloc().querySelectorAll('input:not([type="checkbox"]), select, textarea')).toHaveLength(0);
    expect(bloc().querySelector("[contenteditable]")).toBeNull();
  });

  it("la désignation est un lien vers la fiche article, affichée avec sa contenance", () => {
    const lien = lignes()[1].querySelector<HTMLAnchorElement>('a[href="/stock/catalogue/bas"]')!;
    expect(lien.textContent).toBe("Farine");
    expect(lien.className).toContain("text-primary");
    expect(lien.className).toContain("hover:underline");
    expect(lignes().every((tr, i) => tr.querySelector(`a[href="/stock/catalogue/${ARTICLES[i].id}"]`))).toBe(true);
  });

  it("valeurs en texte : nom court, catégorie, unité ; « — » pour une absence, jamais 0", () => {
    const cellules = (i: number) => [...lignes()[i].querySelectorAll("td")].map((td) => td.textContent);
    // case, code, désignation, nom court, stock, alerte, min, catégorie, fournisseur, unité, valeur, prix, par carton
    const farine = cellules(1);
    expect(farine[3]).toBe("Farine T55");
    expect(farine[4]).toBe("4,83");
    expect(farine[6]).toBe("5");
    expect(farine[7]).toBe("Farines");
    expect(farine[9]).toBe("Kg");
    const amidon = cellules(4);
    expect(amidon[1]).toBe("—"); // code
    expect(amidon[3]).toBe("—"); // nom court
    expect(amidon[6]).toBe("—"); // seuil 0 = sans seuil
    expect(amidon[8]).toBe("—"); // fournisseur
    expect(amidon[9]).toBe("—"); // unité
    expect(amidon[12]).toBe("—"); // par carton
  });

  it("nombres alignés à droite (stock, min, valeur, prix, par carton)", () => {
    const tds = [...lignes()[0].querySelectorAll("td")];
    for (const i of [4, 6, 10, 11, 12]) expect(tds[i].className, `colonne ${i}`).toContain("text-right");
  });

  it("le prix s'affiche dans sa devise de saisie, l'autre devise en petit dessous", () => {
    act(() => racine.render(h(CatalogueTable, { articles: [
      { ...base, id: "usd", designation: "Riz", unite: "Kg", quantite: "1", stockMinimum: "1", niveau: "OK", prix: "2.5", prixAutre: "≈ 7 000 FC" },
      { ...base, id: "fc", designation: "Sel", unite: "Kg", quantite: "1", stockMinimum: "1", niveau: "OK", prix: null, devisePrix: "CDF", prixCDF: "7000", prixAutre: "≈ 2,50 $" },
      { ...base, id: "rien", designation: "Eau", unite: "L", quantite: "1", stockMinimum: "1", niveau: "OK", prix: null },
    ], categories: [], fournisseurs: [] })));
    const prix = (id: string) => bloc().querySelector(`a[href="/stock/catalogue/${id}"]`)!.closest("tr")!.querySelectorAll("td")[11];
    expect(prix("usd").firstChild!.textContent).toBe("2,50 $");
    expect(prix("usd").querySelector("span")!.textContent).toBe("≈ 7 000 FC");
    expect(prix("fc").firstChild!.textContent).toBe("7 000 FC");
    expect(prix("fc").querySelector("span")!.textContent).toBe("≈ 2,50 $");
    expect(prix("rien").textContent).toBe("—");
  });

  it("le total « Valeur totale du stock filtré » est toujours là", () => {
    expect(bloc().querySelector("tfoot")!.textContent).toContain("Valeur totale du stock filtré");
  });

  it("le nom mène à la fiche aussi sur la rangée du téléphone", () => {
    expect(rangee("bas").querySelector('a[href="/stock/catalogue/bas"]')!.textContent).toBe("Farine");
  });
});

// ── Bloc du haut sur téléphone (demande de la Direction, 2026-09-29) : voir au moins sept articles
// dès l'ouverture. Les bandeaux deviennent des pilules à compteur dans UNE rangée qui défile de côté ;
// « À compléter », la valeur du stock, l'ajout et l'export passent dans « Plus ». Rien n'est perdu.
// Ce que ces tests ne voient pas : la hauteur réelle (mesurée à 375 × 812 dans un navigateur : 7 rangées entières).
describe("bloc du haut sur téléphone — compact, filtres toujours présents", () => {
  const filtres = () => conteneur.querySelector<HTMLElement>("[data-filtres-mobile]")!;
  const pilule = (t: string) => [...filtres().querySelectorAll("button")].find((b) => b.textContent!.startsWith(t))!;
  const plus = () => conteneur.querySelector<HTMLButtonElement>('button[aria-controls="inventaire-plus"]')!;
  const panneau = () => conteneur.querySelector<HTMLElement>("#inventaire-plus");
  const sansSeuil = ARTICLES.filter((a) => !(Number(a.stockMinimum) > 0)).length;

  it("une seule rangée de pilules, qui défile de côté, sans jamais se couper sur deux lignes", () => {
    expect(filtres().className).toMatch(/overflow-x-auto/);
    expect(filtres().className).toContain("lg:hidden");
    expect(filtres().className).not.toContain("flex-wrap");
    const boutons = [...filtres().querySelectorAll("button")];
    expect(boutons.length).toBeGreaterThanOrEqual(4);
    for (const b of boutons) expect(b.className, b.textContent!).toContain("shrink-0");
  });

  it("les bandeaux (réapprovisionnement, hausse de prix, à compléter) ne s'affichent plus sur téléphone : leurs compteurs sont dans les pilules", () => {
    for (const texte of ["À réapprovisionner", "À compléter :"]) {
      const bandeau = [...conteneur.querySelectorAll("div")].find((d) => d.className.includes("rounded-xl") && d.firstElementChild?.textContent?.includes(texte))!;
      expect(bandeau, texte).toBeTruthy();
      expect(bandeau.className, texte).toContain("max-lg:hidden");
    }
    expect(pilule("Urgent").textContent).toBe("Urgent1");
    expect(pilule("À réappro.").textContent).toBe("À réappro.1");
    expect(pilule("Toutes")).toBeTruthy();
    expect(pilule("Satisfaisant")).toBeTruthy();
  });

  it("une pilule d'alerte filtre la liste des rangées, un second appui la retire", () => {
    clic(pilule("Urgent"));
    expect(noms()).toEqual(["rupture"]);
    expect(pilule("Urgent").getAttribute("aria-pressed")).toBe("true");
    clic(pilule("Toutes"));
    expect(noms().length).toBe(ARTICLES.length);
  });

  it("recherche et tri restent sur la même ligne, avec « Plus » ; l'ordinateur garde ses pilules et son compteur", () => {
    const ligne = plus().parentElement!;
    expect(ligne.querySelector('input[aria-label="Rechercher un article"]')).not.toBeNull();
    expect(ligne.querySelector('select[aria-label="Trier les articles"]')).not.toBeNull();
    expect(ligne.className).not.toMatch(/(^|\s)flex-wrap/); // pas de retour à la ligne sur téléphone
    const bureau = [...ligne.children].filter((e) => e.className.includes("max-lg:hidden"));
    expect(bureau.some((e) => e.textContent!.includes("Satisfaisant"))).toBe(true);
    expect(bureau.some((e) => e.textContent!.includes("/ 5 article(s)"))).toBe(true);
    expect(plus().className).toContain("lg:hidden");
  });

  it("« Plus » est replié au départ, puis montre la valeur du stock, le compteur, À compléter, l'ajout et l'export", () => {
    expect(panneau()).toBeNull();
    expect(plus().getAttribute("aria-expanded")).toBe("false");
    act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: [], fournisseurs: [], actionsPlus: h("button", { "data-export": "" }, "Exporter") })));
    clic(plus());
    expect(plus().getAttribute("aria-expanded")).toBe("true");
    const p = panneau()!;
    expect(p.className).toContain("lg:hidden");
    expect(p.textContent).toContain("Valeur du stock");
    expect(p.textContent).toContain("5 / 5 article(s)");
    expect(p.textContent).toContain(`${sansSeuil} sans seuil`);
    expect(p.textContent).toContain("+ Ajouter un article");
    expect(p.querySelector("[data-export]")).not.toBeNull();
  });

  it("une puce « À compléter » filtre la liste, referme « Plus » et laisse une pilule pour retirer le filtre", () => {
    clic(plus());
    const puce = [...panneau()!.querySelectorAll("button")].find((b) => b.textContent!.includes("sans seuil"))!;
    clic(puce);
    expect(panneau()).toBeNull();
    expect(noms().length).toBe(sansSeuil);
    const retirer = filtres().querySelector<HTMLButtonElement>('button[aria-label^="Retirer le filtre"]')!;
    expect(retirer.textContent).toContain("sans seuil");
    clic(retirer);
    expect(noms().length).toBe(ARTICLES.length);
  });

  it("« Ajouter un article » du menu « Plus » ouvre le formulaire de création", () => {
    expect(conteneur.querySelector('input[name="designation"]')).toBeNull();
    clic(plus());
    clic([...panneau()!.querySelectorAll("button")].find((b) => b.textContent === "+ Ajouter un article")!);
    expect(conteneur.querySelector('input[name="designation"]')).not.toBeNull();
    expect(panneau()).toBeNull();
  });
});
