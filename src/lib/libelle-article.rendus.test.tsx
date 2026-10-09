// @vitest-environment happy-dom
//
// Le libellé d'article (désignation + contenance, `libelleArticle`) À L'ÉCRAN, une famille d'écran par
// bloc : Inventaire, Liste d'achat (ordinateur et téléphone), articles proches, Mouvements, Factures,
// Réconciliation. La désignation enregistrée, elle, reste ce qui se modifie et ce qui part au serveur.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { champChoix, champsParNom, choisirEnTapant, choisirOption, libellesOuverts, taperChoix } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => h("a", { href: p.href }, p.children as never) }));
vi.mock("@/app/(stock)/stock/catalogue/actions", () => ({
  creerArticle: vi.fn(), modifierArticle: vi.fn(async () => ({})), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(),
  basculerActifArticles: vi.fn(), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(),
  corrigerStocksNegatifs: vi.fn(),
}));
vi.mock("@/app/(stock)/stock/entree/actions", () => ({ entreeListeAchat: vi.fn(async () => ({ crees: [], fournisseursCrees: [], avertissements: [] })), verifierDoublonsListe: vi.fn(async () => ({ avertissements: [] })) }));
vi.mock("@/app/(stock)/stock/mouvements/actions", () => ({
  mouvementManuel: vi.fn(), supprimerMouvement: vi.fn(), supprimerMouvementsEnLot: vi.fn(), requalifierSorties: vi.fn(), changerDateSorties: vi.fn(),
}));
vi.mock("@/app/(stock)/stock/factures/actions", () => ({ creerFacture: vi.fn(), analyserFacturePdf: vi.fn() }));
vi.mock("@/app/(stock)/stock/reconciliation/actions", () => ({ appliquerComptage: vi.fn() }));

const { CatalogueTable } = await import("@/app/(stock)/stock/catalogue/catalogue-table");
const { ListeAchatForm } = await import("@/app/(stock)/stock/entree/entree-client");
const { ChoixArticleProche } = await import("@/components/stock/choix-article-proche");
const { MouvementForm } = await import("@/app/(stock)/stock/mouvements/mouvements-client");
const { NouvelleFactureForm } = await import("@/app/(stock)/stock/factures/nouveau/nouveau-client");
const { ReconciliationForm } = await import("@/app/(stock)/stock/reconciliation/reconciliation-client");

let conteneur: HTMLDivElement;
let racine: Root;
const monter = (el: ReturnType<typeof h>) => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(el));
};
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  document.body.innerHTML = "";
});
const texte = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

// Trois cas : contenance à ajouter, déjà dans le nom (autre écriture), et incohérente (rien n'est ajouté).
const VODKA = { id: "vodka", designation: "Absolut Vodka", contenance: "75", contenanceUnite: "cl" };
const CAMPARI = { id: "campari", designation: "Campari-1L", contenance: "100", contenanceUnite: "cl" };
const COINTREAU = { id: "cointreau", designation: "Cointreau-70cl", contenance: "1", contenanceUnite: "l" };

describe("Inventaire", () => {
  const base = { code: null, nomCourt: null, surFicheCommande: false, domaine: "BOISSON" as const, categorieId: "c1", fournisseurId: null, uniteParCarton: null, prix: "2", haussePct: null, quantite: "5", stockMinimum: "1", niveau: "OK" as const, unite: "Bouteille" };
  const monterInventaire = () => monter(h(CatalogueTable, { articles: [{ ...base, ...VODKA }, { ...base, ...CAMPARI }, { ...base, ...COINTREAU }], categories: [{ id: "c1", nom: "Spiritueux", domaine: "BOISSON" }], fournisseurs: [] }));

  it("le tableau nomme l'article par son libellé (contenance comprise), en lien vers sa fiche", () => {
    monterInventaire();
    const liens = [...conteneur.querySelectorAll('table tbody a[href^="/stock/catalogue/"]')].map((a) => [a.getAttribute("href"), a.textContent]);
    expect(liens).toEqual([["/stock/catalogue/vodka", "Absolut Vodka 75 cl"], ["/stock/catalogue/campari", "Campari-1L"], ["/stock/catalogue/cointreau", "Cointreau-70cl"]]);
  });

  it("la carte du téléphone titre l'article par son libellé, en lien vers sa fiche", () => {
    monterInventaire();
    const titres = [...conteneur.querySelectorAll('[data-article] a[href^="/stock/catalogue/"]:not([aria-label])')].map((a) => [a.getAttribute("href"), a.textContent]);
    expect(titres).toEqual([["/stock/catalogue/vodka", "Absolut Vodka 75 cl"], ["/stock/catalogue/campari", "Campari-1L"], ["/stock/catalogue/cointreau", "Cointreau-70cl"]]);
  });
});

describe("Liste d'achat", () => {
  const ARTICLES = [{ ...VODKA, unite: "Bouteille", domaine: "BOISSON", prix: "20" }, { id: "riz", designation: "Riz", unite: "Kg", domaine: "NOURRITURE", prix: "1" }];
  it("le choix d'article montre le libellé, se trouve en tapant « vodka 750ml » et n'envoie que l'id", async () => {
    window.localStorage.clear();
    monter(h(ListeAchatForm, { articles: ARTICLES, fournisseurs: [], aujourdhui: "2026-10-09", taux: 2800, estDirection: true, compteId: "u1" }));
    const champ = champChoix(conteneur, "Article, ligne 1");
    await taperChoix(champ, "vodka 750ml");
    expect(libellesOuverts()).toEqual(["Absolut Vodka 75 cl"]);
    await choisirEnTapant(champ, "vodka 750ml");
    expect(champ.value).toBe("Absolut Vodka 75 cl");
    expect((champ.nextElementSibling as HTMLInputElement).value).toBe("vodka");
  });

  it("articles proches (anti-doublon) : « Utiliser » nomme l'article par son libellé", () => {
    monter(h(ChoixArticleProche, { nom: "Absolut", candidats: [{ ...VODKA, unite: "Bouteille", actif: true }], creationPossible: true, onUtiliser: () => {} }));
    expect(texte(conteneur.querySelector("[data-utiliser]"))).toBe("Utiliser « Absolut Vodka 75 cl » (Bouteille)");
  });
});

describe("Mouvements", () => {
  it("le choix du produit et les articles proches proposés montrent le libellé (contenance comprise)", async () => {
    monter(h(MouvementForm, { articles: [
      { ...VODKA, unite: "Bouteille", domaine: "BOISSON", quantite: 3 },
      { id: "vodka1l", designation: "Absolut Vodka", contenance: "1", contenanceUnite: "l", unite: "Bouteille", domaine: "BOISSON", quantite: 10 },
      { ...CAMPARI, unite: "Bouteille", domaine: "BOISSON", quantite: 2 },
    ] }));
    const bouton = (t: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(t))!;
    act(() => bouton("Mouvement manuel").click());
    act(() => bouton("Sortie").click());
    const champ = champsParNom(conteneur, "articleId")[0]!;
    await choisirOption(champ, "vodka");
    const qte = conteneur.querySelector<HTMLInputElement>('input[name="quantite"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(qte, "5"); qte.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(texte(conteneur.querySelector('[data-utiliser="vodka1l"]'))).toMatch(/^Utiliser « Absolut Vodka 1 l »/);
    await choisirOption(champ, "vodka");
    expect(champ.value).toBe("Absolut Vodka 75 cl");
    await choisirOption(champ, "campari");
    expect(champ.value).toBe("Campari-1L");
  });
});

describe("Factures", () => {
  it("le choix d'article montre le libellé ; la désignation pré-remplie de la ligne reste la désignation brute", async () => {
    monter(h(NouvelleFactureForm, {
      articles: [{ ...VODKA, unite: "Bouteille", prix: "20", prixCDF: null, prixFC: null, refDevise: "USD", prixRef: "20,00 $" }],
      fournisseurs: [{ id: "f1", nom: "Brasimba", delaiJours: 30 }], bons: [], bcInitial: null,
    } as never));
    const champ = champChoix(conteneur, "Article, ligne 1");
    await choisirOption(champ, "vodka");
    expect(champ.value).toBe("Absolut Vodka 75 cl");
    expect([...conteneur.querySelectorAll<HTMLInputElement>('input[name="ligne_designation"]')][0]!.value).toBe("Absolut Vodka");
  });
});

describe("Réconciliation", () => {
  const ARTICLES = [
    { id: "vodka", code: "1", designation: "Absolut Vodka", contenance: "75", contenanceUnite: "cl", categorie: "Spiritueux", theorique: 4, domaine: "BOISSON" },
    { id: "gin", code: "2", designation: "Gin", categorie: "Spiritueux", theorique: 2, domaine: "BOISSON" },
  ];
  it("la ligne nomme l'article par son libellé, et la recherche trouve la contenance", () => {
    monter(h(ReconciliationForm, { articles: ARTICLES, domaineInit: "BOISSON" }));
    // Une ligne hors recherche est MASQUÉE (attribut hidden), pas démontée.
    const liens = () => [...conteneur.querySelectorAll('a[href^="/stock/catalogue/"]')].filter((a) => !a.closest("[hidden]")).map((a) => a.textContent);
    expect(liens()).toEqual(["Absolut Vodka 75 cl", "Gin"]);
    expect(conteneur.querySelector('[aria-label="Quantité physique — Absolut Vodka 75 cl"]')).not.toBeNull();
    const recherche = conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher un article"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(recherche, "vodka 75 cl"); recherche.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(liens()).toEqual(["Absolut Vodka 75 cl"]);
  });
});
