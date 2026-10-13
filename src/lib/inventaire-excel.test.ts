import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { tableauInventaire, texteValeurDebutMois, valeurDebutMois, TIRET } from "./inventaire-excel";
import { classeurInventaire } from "./export-excel";
import { stockInitialArticle, type DonneesStockInitial, type StockInitialArticle } from "./stock-initial-mois";
import { debutMoisKinshasa } from "./stock-initial-mois";
import type { LigneInventaire } from "./cloture-inventaire";

const ligne = (id: string, o: Partial<LigneInventaire> = {}): LigneInventaire => ({
  articleId: id, code: id, designation: `Article ${id}`, domaine: "NOURRITURE", unite: "Kg", categorie: "Farines", fournisseur: "Moulin", quantite: 10, stockMinimum: 5, prixUnitaireUSD: 2, ...o,
});
const donnees = (m: Partial<DonneesStockInitial> = {}): DonneesStockInitial => ({
  annee: 2026, mois: 10, debut: debutMoisKinshasa(2026, 10), dansMois: new Map(), apresMois: new Map(), crees: new Map(), avecMouvementAvant: new Set(), horsMouvement: new Map(), ...m,
});
const base = { fige: false, avecApres: false, cloturePrecedente: null, ordreCategories: new Map<string, number>(), uniteParCarton: () => null };
const mv = (entrees: number, sorties: number, net = 0) => ({ entrees, sorties, ajustements: { nb: net === 0 ? 0 : 1, net } });

/** Les libellés de colonnes de l'ÉCRAN, lus dans le source du tableau (un seul endroit où ils vivent). */
function entetesEcran(): string[] {
  const src = fs.readFileSync(path.join(__dirname, "../app/(stock)/stock/catalogue/catalogue-table.tsx"), "utf8");
  const thead = src.slice(src.indexOf("<thead"), src.indexOf("</thead>"));
  return [...thead.matchAll(/<(?:ThTri|th)\b[^>]*>([^<{]+)<\/(?:ThTri|th)>/g)].map((m) => m[1].trim());
}

describe("les colonnes de l'Excel suivent celles de l'écran Inventaire, dans le même ordre", () => {
  it("l'écran : Code, Désignation, Stock début de mois, Stock, Unité, Alerte, Min, Catégorie, Fournisseur, Valeur, Prix, Par carton", () => {
    expect(entetesEcran()).toEqual(["Code", "Désignation", "Stock début de mois", "Stock", "Unité", "Alerte", "Min", "Catégorie", "Fournisseur", "Valeur", "Prix", "Par carton"]);
  });

  for (const [titre, params] of [
    ["mois non clôturé", base],
    ["mois clôturé, avec mouvements après le mois et clôture précédente", { ...base, fige: true, avecApres: true, cloturePrecedente: "septembre 2026" }],
  ] as const) {
    it(`${titre} : chaque colonne de l'écran est présente et l'ordre est conservé`, () => {
      const { entete } = tableauInventaire({ ...params, lignes: [ligne("1")], resultat: () => null });
      // Écran → premier en-tête de l'Excel qui le porte (« Stock » = le stock de fin ; « Valeur » = Valeur USD ; « Prix » = Prix U. USD).
      const motif: Record<string, RegExp> = {
        "Code": /^Code$/, "Désignation": /^Désignation$/, "Stock début de mois": /^Stock début de mois$/, "Stock": /^Stock (actuel|fin de mois)$/, "Unité": /^Unité$/,
        "Alerte": /^Alerte$/, "Min": /^Min$/, "Catégorie": /^Catégorie$/, "Fournisseur": /^Fournisseur$/, "Valeur": /^Valeur/, "Prix": /^Prix/, "Par carton": /^Par carton$/,
      };
      const positions = entetesEcran().map((c) => {
        const i = entete.findIndex((h) => motif[c].test(h));
        expect(i, `colonne « ${c} » de l'écran absente de l'Excel`).toBeGreaterThanOrEqual(0);
        return i;
      });
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(positions).size).toBe(positions.length);
      // Le stock de début précède celui de fin, avec les mouvements du mois entre les deux.
      expect(entete.slice(positions[2], positions[3] + 1).slice(1, -1)).toEqual(expect.arrayContaining(["Entrées du mois", "Sorties du mois"]));
    });
  }

  it("« Écart avec la clôture » seulement quand le mois précédent est clôturé ; « Après le mois » seulement quand il y en a", () => {
    const seul = tableauInventaire({ ...base, lignes: [ligne("1")], resultat: () => null }).entete;
    expect(seul.some((h) => /Écart avec la clôture/.test(h) || /Après le mois/.test(h))).toBe(false);
    const plein = tableauInventaire({ ...base, avecApres: true, cloturePrecedente: "septembre 2026", lignes: [ligne("1")], resultat: () => null }).entete;
    expect(plein).toContain("Après le mois (déjà dans le stock figé)");
    expect(plein.at(-1)).toBe("Écart avec la clôture de septembre 2026");
  });
});

describe("contenu d'une ligne : début + entrées − sorties ± ajustements = fin ; « — » pour l'inconnu", () => {
  const d = donnees({ dansMois: new Map([["a", mv(30, 50, 5)]]) });
  const res = (id: string, fin: number | null) => stockInitialArticle(d, id, fin);

  it("exemple chiffré : fin 100, +30, −50, +5 compté en plus → début 115, et la ligne se recompose", () => {
    const t = tableauInventaire({ ...base, lignes: [ligne("a", { quantite: 100 })], resultat: (id) => res(id, 100) });
    const [, r] = t.lignes; // t.lignes[0] = titre de catégorie
    const h = (nom: string) => t.entete.indexOf(nom);
    expect(r[h("Stock début de mois")]).toBe(115);
    expect(r[h("Entrées du mois")]).toBe(30);
    expect(r[h("Sorties du mois")]).toBe(50);
    expect(r[h("Ajustements du mois (comptage)")]).toBe(5);
    expect(r[h("Stock actuel")]).toBe(100);
    expect(Number(r[h("Stock début de mois")]) + 30 - 50 + 5).toBe(Number(r[h("Stock actuel")]));
    // De vrais nombres (pas du texte), pour que les formules du classeur marchent.
    for (const nom of ["Stock début de mois", "Entrées du mois", "Sorties du mois", "Ajustements du mois (comptage)", "Stock actuel", "Valeur USD", "Prix U. USD"]) expect(typeof r[h(nom)], nom).toBe("number");
    expect(r[h("Valeur USD")]).toBe(200);
  });

  it("un stock initial inconnu ou un article absent au 1er : « — », jamais 0 (et ni entrées ni sorties inventées)", () => {
    const inconnu = (): StockInitialArticle => stockInitialArticle(donnees({ horsMouvement: new Map([["x", "stock posé par un import d'inventaire"]]) }), "x", 10);
    const absent = (): StockInitialArticle => stockInitialArticle(donnees({ crees: new Map([["y", new Date("2026-10-08T08:00:00Z")]]) }), "y", 10);
    const t = tableauInventaire({ ...base, lignes: [ligne("x"), ligne("y")], resultat: (id) => (id === "x" ? inconnu() : absent()) });
    const h = t.entete.indexOf("Stock début de mois");
    expect(t.lignes.filter((_, i) => !t.sectionRows.includes(i)).map((r) => r[h])).toEqual([TIRET, TIRET]);
    // Calcul indisponible (panne) : tout est « — », y compris les mouvements du mois.
    const panne = tableauInventaire({ ...base, lignes: [ligne("x")], resultat: () => null });
    expect(panne.lignes[1].slice(2, 6)).toEqual([TIRET, TIRET, TIRET, TIRET]);
  });

  it("ajustements au sens inconnu : « — » dans la colonne des ajustements ET dans le stock de début", () => {
    const dd = donnees({ dansMois: new Map([["a", { entrees: 0, sorties: 0, ajustements: { nb: 1, net: null } }]]) });
    const t = tableauInventaire({ ...base, lignes: [ligne("a")], resultat: (id) => stockInitialArticle(dd, id, 10) });
    const r = t.lignes[1];
    expect(r[t.entete.indexOf("Stock début de mois")]).toBe(TIRET);
    expect(r[t.entete.indexOf("Ajustements du mois (comptage)")]).toBe(TIRET);
  });

  it("sans prix : valeur et prix VIDES (jamais 0) ; seuil nul et carton inconnu : « — » comme à l'écran", () => {
    const t = tableauInventaire({ ...base, lignes: [ligne("a", { prixUnitaireUSD: 0, sansPrix: true, stockMinimum: 0 })], resultat: () => null });
    const r = t.lignes[1];
    expect(r[t.entete.indexOf("Valeur USD")]).toBe("");
    expect(r[t.entete.indexOf("Prix U. USD")]).toBe("");
    expect(r[t.entete.indexOf("Remarque prix")]).toBe("sans prix");
    expect(r[t.entete.indexOf("Min")]).toBe(TIRET);
    expect(r[t.entete.indexOf("Par carton")]).toBe(TIRET);
  });

  it("article au prix en francs : prix saisi en FC et taux en nombres ; sans taux : non valorisé et dit", () => {
    const t = tableauInventaire({ ...base, lignes: [ligne("a", { prixUnitaireCDF: 7000, tauxChange: 2800, prixUnitaireUSD: 2.5 }), ligne("b", { prixUnitaireCDF: 7000, tauxChange: null, prixUnitaireUSD: 0, sansPrix: false })], resultat: () => null });
    const h = (n: string) => t.entete.indexOf(n);
    expect(t.lignes[1][h("Prix saisi en FC")]).toBe(7000);
    expect(t.lignes[1][h("Taux FC/$ utilisé")]).toBe(2800);
    expect(t.lignes[2][h("Remarque prix")]).toMatch(/taux non défini/);
  });
});

describe("écart avec la clôture de M-1 dans l'Excel", () => {
  const clot = { annee: 2026, mois: 9, figeLe: new Date("2026-10-03T10:30:00Z"), stocks: new Map([["a", 108], ["b", 20]]), mouvements: new Map([["a", mv(0, 8)], ["b", mv(0, 0)]]) };
  const d = donnees({ dansMois: new Map([["a", mv(40, 10)], ["b", mv(0, 0)]]), cloturePrecedente: clot });
  it("0 quand la clôture retombe juste, l'écart SIGNÉ sinon, « — » quand la comparaison est impossible", () => {
    const t = tableauInventaire({
      ...base, cloturePrecedente: "septembre 2026",
      lignes: [ligne("a", { quantite: 146 + 4 }), ligne("b", { quantite: 20 }), ligne("c", { quantite: 3 })],
      resultat: (id) => stockInitialArticle(d, id, id === "a" ? 150 : id === "b" ? 20 : 3),
    });
    const i = t.entete.length - 1;
    const rows = t.lignes.filter((_, k) => !t.sectionRows.includes(k));
    expect(rows.map((r) => r[i])).toEqual([4, 0, TIRET]); // a : +4 non expliqué ; b : juste ; c : pas dans la clôture
  });
});

describe("valeur du stock au 1er : partielle annoncée, jamais 0 pour un inconnu", () => {
  const usd = (n: number) => `${n.toFixed(2)} $`;
  const ok = (q: number): StockInitialArticle => ({ initial: { etat: "ok", quantite: q }, entrees: 0, sorties: 0, ajustements: 0, apres: 0, referenceCloture: null });
  it("somme des seuls articles connus et prix connus ; le reste est compté", () => {
    const lignes = [ligne("a"), ligne("b", { prixUnitaireUSD: 0 }), ligne("c"), ligne("d")];
    const r = new Map<string, StockInitialArticle>([["a", ok(10)], ["b", ok(5)], ["c", { initial: { etat: "inconnu", raison: "x" }, entrees: 0, sorties: 0, ajustements: null, apres: 0, referenceCloture: null }], ["d", { initial: { etat: "absent", raison: "x" }, entrees: 0, sorties: 0, ajustements: 0, apres: 0, referenceCloture: null }]]);
    const v = valeurDebutMois(lignes, (id) => r.get(id) ?? null);
    expect(v).toMatchObject({ montantUSD: 20, nbSansPrix: 1, nbInconnus: 1, nbAbsents: 1, indeterminee: false });
    expect(texteValeurDebutMois(v, usd)).toBe("20.00 $ (partiel : 1 sans prix, 1 stock initial non calculable)");
  });
  it("rien de valorisable alors que des valeurs manquent : « — », pas « 0 $ »", () => {
    const v = valeurDebutMois([ligne("c")], () => ({ initial: { etat: "inconnu", raison: "x" }, entrees: 0, sorties: 0, ajustements: null, apres: 0, referenceCloture: null }));
    expect(v.indeterminee).toBe(true);
    expect(texteValeurDebutMois(v, usd)).toMatch(/^— \(non calculable : 1 stock initial non calculable\)$/);
  });
  it("tout est connu et vraiment nul : 0 est une valeur (pas de mention)", () => {
    const v = valeurDebutMois([ligne("a")], () => ok(0));
    expect(texteValeurDebutMois(v, usd)).toBe("0.00 $");
  });
});

describe("groupement par catégorie (comme l'écran) et rendu Excel", () => {
  it("lignes-titres « NOM (n) » dans l'ordre du catalogue, « À classer » en dernier ; ordre par code gardé dans la catégorie", () => {
    const lignes = [
      ligne("1", { categorie: "Huiles" }), ligne("2", { categorie: "Farines" }), ligne("3", { categorie: "" }), ligne("4", { categorie: "Farines" }), ligne("5", { categorie: "Huiles" }),
    ];
    const t = tableauInventaire({ ...base, ordreCategories: new Map([["Farines", 1], ["Huiles", 2]]), lignes, resultat: () => null });
    expect(t.sectionRows.map((i) => t.lignes[i][0])).toEqual(["FARINES (2)", "HUILES (2)", "À CLASSER (1)"]);
    expect(t.lignes.filter((_, i) => !t.sectionRows.includes(i)).map((r) => r[0])).toEqual(["2", "4", "1", "5", "3"]);
  });

  it("classeur : titres fusionnés, PAS d'autofiltre, nombres réels, formats (négatif rouge), « — » à droite, total hors sections", async () => {
    const d = donnees({ dansMois: new Map([["a", mv(0, 0, -3)]]) });
    const t = tableauInventaire({ ...base, lignes: [ligne("a", { quantite: 7 }), ligne("b", { categorie: "Huiles", quantite: 1 })], resultat: (id) => stockInitialArticle(d, id, id === "a" ? 7 : 1) });
    const buf = await classeurInventaire({
      periode: "octobre 2026",
      feuilles: [{ nom: "Nourriture", titre: "Inventaire", kpis: [{ label: "x", valeur: "y" }], invEntete: t.entete, invLignes: t.lignes, invSectionRows: t.sectionRows, invFormats: t.formats, invDroite: t.droite, invTotauxCols: [t.colonnes.valeur], alerteCol: t.colonnes.alerte, mvtTitre: "MOUVEMENTS", mvtEntete: ["Date"], mvtLignes: [] }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.autoFilter).toBeFalsy();
    let enteteRow = 0;
    ws.eachRow((row, n) => { if (row.getCell(1).value === "Code") enteteRow = n; });
    const col = (nom: string) => t.entete.indexOf(nom) + 1;
    const titre = ws.getRow(enteteRow + 1);
    expect(String(titre.getCell(1).value)).toBe("FARINES (1)");
    expect(ws.getCell(titre.number, 1).isMerged).toBe(true);
    const a = ws.getRow(enteteRow + 2);
    expect(a.getCell(col("Ajustements du mois (comptage)")).value).toBe(-3);
    expect(a.getCell(col("Ajustements du mois (comptage)")).numFmt).toBe("General;[Red]-General");
    expect(a.getCell(col("Stock début de mois")).value).toBe(10); // 7 + 3
    expect(a.getCell(col("Stock début de mois")).alignment?.horizontal).toBe("right");
    expect(a.getCell(col("Valeur USD")).numFmt).toContain("[Red](");
    // Le total ne compte que la valeur, pas les lignes-titres.
    let total: number | undefined;
    ws.eachRow((row) => { if (row.getCell(1).value === "Total") total = Number(row.getCell(col("Valeur USD")).value); });
    expect(total).toBe(14 + 2);
  });
});
