// @vitest-environment happy-dom
//
// Inventaire allégé (2026-10-13, liaisons lentes de Kinshasa) : chaque ligne envoyée au navigateur n'emporte
// plus les valeurs vides ou par défaut. Deux engagements, vérifiés ici :
//  1. MÊME ÉCRAN : le tableau, les cartes du téléphone, les compteurs, les filtres et les tris rendent
//     exactement le même HTML avec les lignes allégées qu'avec les lignes complètes d'avant ;
//  2. TAILLE FIGÉE : la liste des champs d'un article ordinaire et le poids d'une liste de 500 articles ne
//     regrossissent pas sans qu'on le décide.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Prisma } from "@prisma/client";
import { niveauAlerte, type NiveauAlerte } from "@/lib/stock";
import { libellesPrix, prixArticleEnUSD, valeurEnUSD } from "@/lib/prix-article";
import { contenancePourClient } from "@/lib/libelle-article";
import type { ManqueKey } from "@/lib/filtre-inventaire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: vi.fn(), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(), basculerActifArticles: vi.fn(),
  basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), ajouterFournisseurEnMasse: vi.fn(), retirerFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(), corrigerStocksNegatifs: vi.fn(),
}));
const { CatalogueEcran } = await import("./catalogue-ecran");
const { versLigneInventaire } = await import("./ligne-inventaire");
type ArticleInventaire = import("./ligne-inventaire").ArticleInventaire;
type ArticleRow = import("./catalogue-table").ArticleRow;

const D = (v: string | number) => new Prisma.Decimal(v);
const stock = (q: number, min: number, urgent = 0) => ({ quantite: D(q), stockMinimum: D(min), seuilUrgent: D(urgent) });
const base = (id: string, designation: string, x: Partial<ArticleInventaire> = {}): ArticleInventaire => ({
  id, code: null, designation, marque: null, contenance: null, contenanceUnite: null, surFicheCommande: false, domaine: "NOURRITURE",
  categorieId: "c1", fournisseurId: "f1", unite: "Kg", devisePrix: "USD", prixUnitaireUSD: D("2.5"), prixUnitaireCDF: null, uniteParCarton: null,
  stock: stock(10, 5), _count: { fournisseurs: 1 }, ...x,
});
// Des articles qui exercent chaque champ allégé : code, carton, fiche commande, hausse, proposition, francs (avec et sans taux),
// sans prix, sans ligne de stock, stock négatif, sans fournisseur, marque + contenance.
const ARTICLES: ArticleInventaire[] = [
  base("a1", "Riz"),
  base("a2", "Farine", { code: "137", uniteParCarton: D(24), surFicheCommande: true, stock: stock(2, 5) }),
  base("a3", "Huile", { devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: D(7000), stock: stock(0, 4), categorieId: "c2" }),
  base("a4", "Sel", { prixUnitaireUSD: null, unite: null, stock: stock(-3, 0), fournisseurId: null, _count: { fournisseurs: 0 } }),
  base("a5", "Sucre", { stock: null, categorieId: null }),
  base("a6", "Vodka", { domaine: "BOISSON", marque: "Absolut", contenance: D("0.75"), contenanceUnite: "l", prixUnitaireUSD: D("0.1786"), categorieId: "c3", _count: { fournisseurs: 3 } }),
  base("a7", "Lait", { stock: stock(1, 5, 2), fournisseurId: null, _count: { fournisseurs: 2 } }),
];
const HAUSSES = new Map([["a1", 31.4], ["a6", 12]]);
const EN_ATTENTE = new Set(["a2"]);

/** Les lignes COMPLÈTES telles que `CatalogueView` les envoyait avant l'allègement (référence). */
function ligneComplete(a: ArticleInventaire, taux: number | null): ArticleRow {
  const niveau: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum, a.stock.seuilUrgent) : null;
  const v = valeurEnUSD(a, a.stock ? Number(a.stock.quantite) : 0, taux);
  return {
    id: a.id, code: a.code, designation: a.designation, ...contenancePourClient(a), surFicheCommande: a.surFicheCommande, domaine: a.domaine,
    categorieId: a.categorieId, fournisseurId: a.fournisseurId, nbFournisseurs: a._count.fournisseurs, unite: a.unite,
    prix: a.prixUnitaireUSD !== null ? a.prixUnitaireUSD.toString() : null, devisePrix: a.devisePrix,
    prixCDF: a.prixUnitaireCDF !== null ? a.prixUnitaireCDF.toString() : null, prixAutre: libellesPrix(a, taux).autre,
    prixEnUSD: prixArticleEnUSD(a, taux)?.valeur ?? null, valeurUSD: v ? v.valeur : null, valeurApprox: v?.approx ?? false,
    uniteParCarton: a.uniteParCarton !== null ? a.uniteParCarton.toString() : null,
    quantite: a.stock ? a.stock.quantite.toString() : "0", stockMinimum: a.stock ? a.stock.stockMinimum.toString() : "0", niveau,
    haussePct: HAUSSES.get(a.id) ?? null, propositionEnAttente: EN_ATTENTE.has(a.id),
  };
}
const ligneAllegee = (a: ArticleInventaire, taux: number | null) => versLigneInventaire(a, { hausses: HAUSSES, enAttente: EN_ATTENTE, taux });

const CATS = [{ id: "c1", nom: "Épicerie", domaine: "NOURRITURE" }, { id: "c2", nom: "Huiles", domaine: "NOURRITURE" }, { id: "c3", nom: "Alcools", domaine: "BOISSON" }];
const FOURS = [{ id: "f1", nom: "Kin Marché" }];

let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;
afterEach(() => { if (racine) act(() => racine!.unmount()); conteneur?.remove(); racine = null; conteneur = null; });

type Vue = { q?: string; alerte?: "URGENT" | "APPRO" | "OK"; manque?: ManqueKey; hausse?: boolean; clics?: string[] };
/** HTML de l'écran Inventaire pour ces lignes et ce filtre, après les clics demandés (tri, menu « Plus »…). */
function rendu(rows: ArticleRow[], vue: Vue): string {
  if (racine) act(() => racine!.unmount());
  conteneur?.remove();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(h(CatalogueEcran, { rows, categories: CATS, fournisseurs: FOURS, q: vue.q ?? "", alerte: vue.alerte, manque: vue.manque, hausse: vue.hausse, parInit: "tout" })));
  for (const texte of vue.clics ?? []) {
    const b = [...conteneur.querySelectorAll("button")].find((x) => x.textContent?.trim().startsWith(texte));
    expect(b, `bouton « ${texte} »`).toBeTruthy();
    act(() => b!.click());
  }
  return conteneur.innerHTML;
}

const VUES: Vue[] = [
  {}, { clics: ["Plus"] }, { clics: ["Prix"] }, { clics: ["Prix", "Prix"] }, { clics: ["Code"] }, { clics: ["Valeur"] }, { clics: ["Fournisseur"] },
  { alerte: "URGENT" }, { alerte: "APPRO" }, { hausse: true }, { q: "137" }, { q: "absolut 75cl" },
  { manque: "prix" }, { manque: "fournisseur" }, { manque: "seuil" }, { manque: "unite" }, { manque: "negatif" },
];

describe("Inventaire allégé — même écran qu'avec les lignes complètes", () => {
  for (const taux of [2850, null]) {
    it(`taux du jour ${taux ?? "absent"} : tableau, cartes, compteurs, filtres et tris identiques`, () => {
      const complet = ARTICLES.map((a) => ligneComplete(a, taux));
      const allege = ARTICLES.map((a) => ligneAllegee(a, taux));
      for (const vue of VUES) expect(rendu(allege, vue), JSON.stringify(vue)).toBe(rendu(complet, vue));
    });
  }
});

describe("Inventaire allégé — taille figée", () => {
  it("un article ordinaire (en dollars, sans code ni carton ni hausse) n'emporte que ces champs", () => {
    expect(Object.keys(ligneAllegee(base("x", "Riz"), 2850)).sort()).toEqual(
      ["categorieId", "designation", "domaine", "fournisseurId", "id", "nbFournisseurs", "niveau", "prix", "prixAutre", "quantite", "stockMinimum", "unite", "valeurUSD"],
    );
  });
  it("« sans prix » reste écrit (valeurUSD: null) : absent, l'écran recalculerait prix × stock", () => {
    const l = ligneAllegee(base("x", "Sel", { prixUnitaireUSD: null }), 2850);
    expect(l).toHaveProperty("valeurUSD", null);
    expect(l).not.toHaveProperty("prixAutre");
  });
  it("500 articles ordinaires (identifiants de la base : uuid) pèsent au plus 185 Ko envoyés", () => {
    const uuid = (i: number) => `${String(i).padStart(8, "0")}-1f2e-4d3c-8b9a-${String(i * 7919).padStart(12, "0")}`;
    const lignes = Array.from({ length: 500 }, (_, i) =>
      ligneAllegee(base(uuid(i), `Article numéro ${i} désignation`, { categorieId: uuid(1_000_000 + (i % 18)), fournisseurId: uuid(2_000_000 + (i % 30)) }), 2850));
    const octets = Buffer.byteLength(JSON.stringify(lignes));
    // Mesuré le 2026-10-13 : 180 891 octets (≈ 360 par article) ; les lignes complètes d'avant : 268 891 (− 33 %).
    expect(octets).toBeLessThanOrEqual(185 * 1024);
    expect(Buffer.byteLength(JSON.stringify(lignes.map((_, i) => ligneComplete(base(uuid(i), `Article numéro ${i} désignation`, { categorieId: uuid(1_000_000 + (i % 18)), fournisseurId: uuid(2_000_000 + (i % 30)) }), 2850))))).toBeGreaterThan(octets * 1.4);
  });
});
