// @vitest-environment happy-dom
//
// Écran Mouvements allégé (2026-10-13, liaisons lentes de Kinshasa) :
//  1. la liste des articles part UNE fois — le formulaire de saisie et le filtre « Produit » reçoivent le
//     même tableau (la sérialisation de React renvoie au premier envoi) au lieu d'une liste + ses options ;
//  2. les conseils de livraison : chaque texte distinct une fois, l'article n'en porte que le rang ;
//  3. un mouvement n'emporte plus ses champs vides : la colonne les lit absents comme nuls (même HTML).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { regrouperConseils } from "@/lib/stock-restaurant";

vi.mock("./actions", () => ({
  mouvementManuel: vi.fn(), supprimerMouvement: vi.fn(), supprimerMouvementsEnLot: vi.fn(), requalifierSorties: vi.fn(), changerDateSorties: vi.fn(),
}));
const { ColonneMouvements } = await import("./mouvements-client");
type MvtLite = import("./mouvements-client").MvtLite;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Mouvements — une seule liste d'articles", () => {
  const src = readFileSync("src/app/(stock)/stock/mouvements/page.tsx", "utf8");
  it("le formulaire et le filtre « Produit » reçoivent le MÊME tableau ; aucune liste d'options calculée par le serveur", () => {
    expect(src).toMatch(/<MouvementForm articles=\{articlesClient\}/);
    expect(src).toMatch(/<ChoixProduitFiltre articles=\{articlesClient\}/);
    expect(src).not.toMatch(/optionsArticles\(/);
  });
});

describe("Mouvements — conseils de livraison regroupés", () => {
  const NON = { texte: "non rattaché : rattachez l'article", href: "/stock/restaurant" };
  it("chaque conseil distinct une fois, le rang pour chaque article ; un article sans conseil n'y est pas", () => {
    const r = regrouperConseils([["a", NON], ["b", null], ["c", { ...NON }], ["d", { texte: "unité du catalogue non renseignée", href: "/stock/catalogue/d" }]]);
    expect(r.liste).toEqual([NON, { texte: "unité du catalogue non renseignée", href: "/stock/catalogue/d" }]);
    expect(r.parArticle).toEqual({ a: 0, c: 0, d: 1 });
  });
  it("400 articles non rattachés : le texte part une fois (taille figée)", () => {
    const uuid = (i: number) => `${String(i).padStart(8, "0")}-1f2e-4d3c-8b9a-000000000000`;
    const r = regrouperConseils(Array.from({ length: 400 }, (_, i) => [uuid(i), { ...NON }] as const));
    expect(r.liste).toHaveLength(1);
    // Mesuré le 2026-10-13 : 16 501 octets ; un conseil complet par article en faisait 45 601 (− 64 %).
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(18 * 1024);
  });
});

describe("Mouvements — champs vides non envoyés, même colonne", () => {
  let conteneur: HTMLDivElement | null = null;
  let racine: Root | null = null;
  afterEach(() => { if (racine) act(() => racine!.unmount()); conteneur?.remove(); racine = null; conteneur = null; });
  function rendu(mouvements: MvtLite[], titre: string) {
    if (racine) act(() => racine!.unmount());
    conteneur?.remove();
    conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    act(() => racine!.render(createElement(ColonneMouvements, { titre, signe: titre === "Sorties" ? "−" : "+", couleur: "", estDirection: true, requalifiable: titre === "Sorties", peutChangerDate: true, mouvements })));
    return conteneur.innerHTML;
  }
  // La règle de `versLite` (page.tsx) : un champ vide n'est pas écrit, sauf `valeur` (null = sans prix) et le motif d'une SORTIE (null = sans motif).
  const alleger = (m: MvtLite): MvtLite => Object.fromEntries(Object.entries(m).filter(([k, v]) =>
    k === "valeur" || (k === "motif" && m.type === "SORTIE") || (v !== null && v !== false && v !== undefined))) as MvtLite;
  const complet = (x: Partial<MvtLite> & { id: string; type: string }): MvtLite => ({
    articleId: "farine", designation: `Farine ${x.id}`, dateISO: "2026-07-10", origine: null, quantite: 2, unite: null, valeur: null, valeurEstimee: false,
    facture: null, bc: null, fournId: null, fournNom: null, motif: null, dlcISO: null, ...x,
  });
  it("entrées et sorties : même HTML avec ou sans les champs vides", () => {
    const entrees = [
      complet({ id: "e1", type: "ENTREE" }),
      complet({ id: "e2", type: "ENTREE", origine: "Liste d'achat", unite: "kg", valeur: 12.5, valeurEstimee: true, dlcISO: "2026-08-01", fournId: "f1", fournNom: "Kin Marché" }),
      complet({ id: "e3", type: "ENTREE", dateISO: "2026-07-09", facture: { id: "fa", numero: "F-12" }, bc: { id: "bc", numero: "018/PEF" }, valeur: 4 }),
    ];
    const sorties = [
      complet({ id: "s1", type: "SORTIE" }),
      complet({ id: "s2", type: "SORTIE", motif: "PERTE", unite: "L", valeur: 3, origine: "Consommation cuisine" }),
      complet({ id: "s3", type: "SORTIE", motif: "LIVRAISON_RESTAURANT", dateISO: "2026-07-08" }),
    ];
    expect(rendu(entrees.map(alleger), "Entrées")).toBe(rendu(entrees, "Entrées"));
    expect(rendu(sorties.map(alleger), "Sorties")).toBe(rendu(sorties, "Sorties"));
    expect(alleger(sorties[0]!)).toHaveProperty("motif", null); // « sans motif » reste affiché
  });
});
