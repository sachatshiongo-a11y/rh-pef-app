import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { tableauInventaire, TIRET } from "./inventaire-excel";
import { classeurInventaire } from "./export-excel";
import type { LigneInventaire } from "./cloture-inventaire";

const ligne = (id: string, o: Partial<LigneInventaire> = {}): LigneInventaire => ({
  articleId: id, code: id, designation: `Article ${id}`, domaine: "NOURRITURE", unite: "Kg", categorie: "Farines", fournisseur: "Moulin", quantite: 10, stockMinimum: 5, prixUnitaireUSD: 2, ...o,
});
const base = { fige: false, ordreCategories: new Map<string, number>(), uniteParCarton: () => null, mouvements: () => undefined };

/** Les libellés de colonnes de l'ÉCRAN, lus dans le source du tableau (un seul endroit où ils vivent). */
function entetesEcran(): string[] {
  const src = fs.readFileSync(path.join(__dirname, "../app/(stock)/stock/catalogue/catalogue-table.tsx"), "utf8");
  const thead = src.slice(src.indexOf("<thead"), src.indexOf("</thead>"));
  return [...thead.matchAll(/<(?:ThTri|th)\b[^>]*>([^<{]+)<\/(?:ThTri|th)>/g)].map((m) => m[1].trim());
}

describe("les colonnes de l'Excel suivent celles de l'écran Inventaire, dans le même ordre", () => {
  it("l'écran : Code, Désignation, Stock, Unité, Alerte, Min, Catégorie, Fournisseur, Valeur, Prix, Par carton (aucun stock de début de mois)", () => {
    expect(entetesEcran()).toEqual(["Code", "Désignation", "Stock", "Unité", "Alerte", "Min", "Catégorie", "Fournisseur", "Valeur", "Prix", "Par carton"]);
  });

  for (const [titre, params] of [
    ["mois non clôturé", base],
    ["mois clôturé", { ...base, fige: true }],
  ] as const) {
    it(`${titre} : chaque colonne de l'écran est présente et l'ordre est conservé`, () => {
      const { entete } = tableauInventaire({ ...params, lignes: [ligne("1")] });
      // Écran → premier en-tête de l'Excel qui le porte (« Stock » = le stock ; « Valeur » = Valeur USD ; « Prix » = Prix U. USD).
      const motif: Record<string, RegExp> = {
        "Code": /^Code$/, "Désignation": /^Désignation$/, "Stock": /^Stock (actuel|fin de mois)$/, "Unité": /^Unité$/,
        "Alerte": /^Alerte$/, "Min": /^Min$/, "Catégorie": /^Catégorie$/, "Fournisseur": /^Fournisseur$/, "Valeur": /^Valeur/, "Prix": /^Prix/, "Par carton": /^Par carton$/,
      };
      const positions = entetesEcran().map((c) => {
        const i = entete.findIndex((h) => motif[c].test(h));
        expect(i, `colonne « ${c} » de l'écran absente de l'Excel`).toBeGreaterThanOrEqual(0);
        return i;
      });
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(positions).size).toBe(positions.length);
      // Les mouvements du mois sont JUSTE avant le stock, entre la désignation et lui.
      expect(entete.slice(0, positions[2] + 1)).toEqual(["Code", "Désignation", "Entrées du mois", "Sorties du mois", "Ajustements du mois (sens non enregistré)", entete[positions[2]]]);
    });
  }

  it("plus aucune colonne de stock de début de mois, d'« Après le mois » ni d'écart avec la clôture", () => {
    for (const fige of [false, true]) {
      const { entete } = tableauInventaire({ ...base, fige, lignes: [ligne("1")] });
      expect(entete.some((h) => /début de mois|Après le mois|Écart avec la clôture/i.test(h))).toBe(false);
    }
  });
});

describe("contenu d'une ligne", () => {
  it("entrées, sorties, ajustements du mois puis stock : de vrais nombres ; sans mouvement, des 0 (pas de « — »)", () => {
    const t = tableauInventaire({ ...base, lignes: [ligne("a", { quantite: 100 }), ligne("b", { quantite: 3 })], mouvements: (id) => (id === "a" ? { entrees: 30, sorties: 50, ajustements: 5 } : undefined) });
    const h = (nom: string) => t.entete.indexOf(nom);
    const [a, b] = t.lignes;
    expect([a[h("Entrées du mois")], a[h("Sorties du mois")], a[h("Ajustements du mois (sens non enregistré)")], a[h("Stock actuel")]]).toEqual([30, 50, 5, 100]);
    expect([b[h("Entrées du mois")], b[h("Sorties du mois")], b[h("Ajustements du mois (sens non enregistré)")]]).toEqual([0, 0, 0]);
    for (const nom of ["Entrées du mois", "Sorties du mois", "Ajustements du mois (sens non enregistré)", "Stock actuel", "Valeur USD", "Prix U. USD"]) expect(typeof a[h(nom)], nom).toBe("number");
    expect(a[h("Valeur USD")]).toBe(200);
  });

  it("sans prix : valeur et prix VIDES (jamais 0) ; seuil nul et carton inconnu : « — » comme à l'écran", () => {
    const t = tableauInventaire({ ...base, lignes: [ligne("a", { prixUnitaireUSD: 0, sansPrix: true, stockMinimum: 0 })] });
    const r = t.lignes[0];
    expect(r[t.entete.indexOf("Valeur USD")]).toBe("");
    expect(r[t.entete.indexOf("Prix U. USD")]).toBe("");
    expect(r[t.entete.indexOf("Remarque prix")]).toBe("sans prix");
    expect(r[t.entete.indexOf("Min")]).toBe(TIRET);
    expect(r[t.entete.indexOf("Par carton")]).toBe(TIRET);
  });

  it("article au prix en francs : prix saisi en FC et taux en nombres ; sans taux : non valorisé et dit", () => {
    const t = tableauInventaire({ ...base, lignes: [ligne("a", { prixUnitaireCDF: 7000, tauxChange: 2800, prixUnitaireUSD: 2.5 }), ligne("b", { prixUnitaireCDF: 7000, tauxChange: null, prixUnitaireUSD: 0, sansPrix: false })] });
    const h = (n: string) => t.entete.indexOf(n);
    expect(t.lignes[0][h("Prix saisi en FC")]).toBe(7000);
    expect(t.lignes[0][h("Taux FC/$ utilisé")]).toBe(2800);
    expect(t.lignes[1][h("Remarque prix")]).toMatch(/taux non défini/);
  });
});

describe("tableau TRIABLE : aucune ligne-titre, rangé comme l'écran, autofiltre borné aux articles", () => {
  it("catégories dans l'ordre du catalogue, « À classer » en dernier, code gardé dans la catégorie ; une ligne par article", () => {
    const lignes = [
      ligne("1", { categorie: "Huiles" }), ligne("2", { categorie: "Farines" }), ligne("3", { categorie: "" }), ligne("4", { categorie: "Farines" }), ligne("5", { categorie: "Huiles" }),
    ];
    const t = tableauInventaire({ ...base, ordreCategories: new Map([["Farines", 1], ["Huiles", 2]]), lignes, mouvements: () => undefined });
    expect(t.lignes).toHaveLength(5); // pas de ligne-titre : autant de lignes que d'articles
    expect(t.lignes.map((r) => r[0])).toEqual(["2", "4", "1", "5", "3"]);
    const iCat = t.entete.indexOf("Catégorie");
    expect(t.lignes.map((r) => r[iCat])).toEqual(["Farines", "Farines", "Huiles", "Huiles", "À classer"]);
    expect("sectionRows" in t).toBe(false);
  });

  /** Écrit le classeur et relit la feuille : numéro de la ligne d'en-tête, des lignes d'articles, du total. */
  async function ecrire(nbArticles: number, avecTotaux = true) {
    const lignes = Array.from({ length: nbArticles }, (_, i) => ligne(i === 0 ? "a" : `x${i}`, { categorie: i % 2 ? "Huiles" : "Farines", quantite: 7 }));
    const t = tableauInventaire({ ...base, lignes, mouvements: (id) => (id === "a" ? { entrees: 4, sorties: 1, ajustements: 3 } : undefined) });
    const buf = await classeurInventaire({
      periode: "octobre 2026",
      feuilles: [{ nom: "Nourriture", titre: "Inventaire", kpis: [{ label: "x", valeur: "y" }, { label: "z", valeur: "w" }], invEntete: t.entete, invLignes: t.lignes, invFormats: t.formats, invDroite: t.droite, ...(avecTotaux ? { invTotauxCols: [t.colonnes.valeur] } : {}), alerteCol: t.colonnes.alerte, mvtTitre: "MOUVEMENTS", mvtEntete: ["Date", "Code"], mvtLignes: [["01/10/2026", "a"], ["02/10/2026", "b"]] }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    let entete = 0, total = 0;
    ws.eachRow((row, n) => { if (row.getCell(1).value === "Code" && !entete) entete = n; if (row.getCell(1).value === "Total") total = n; });
    return { t, ws, entete, total };
  }
  /** Plage de l'autofiltre relue du fichier (« A12:W17 ») : lignes et colonnes de début et de fin. */
  const refDe = (f: unknown) => {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(f));
    expect(m, `plage d'autofiltre illisible : ${String(f)}`).not.toBeNull();
    const num = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    return { from: { row: Number(m![2]), column: num(m![1]) }, to: { row: Number(m![4]), column: num(m![3]) } };
  };

  it("classeur : l'autofiltre couvre EXACTEMENT l'en-tête et les lignes d'articles (ni indicateurs, ni total, ni mouvements)", async () => {
    const { t, ws, entete, total } = await ecrire(5);
    const f = refDe(ws.autoFilter);
    expect(f.from).toEqual({ row: entete, column: 1 });
    expect(f.to).toEqual({ row: entete + 5, column: t.entete.length }); // dernière ligne = dernier article
    expect(total).toBe(entete + 6); // le total suit, HORS de la plage : un tri ne l'emporte pas au milieu
    expect(f.to.row).toBeLessThan(total);
    // Les indicateurs sont au-dessus, les mouvements en dessous : hors plage.
    ws.eachRow((row, n) => { if (/^(INDICATEURS|MOUVEMENTS)/.test(String(row.getCell(1).value ?? ""))) expect(n < f.from.row || n > f.to.row).toBe(true); });
  });

  it("classeur : aucune ligne-titre ni cellule fusionnée au milieu des articles ; nombres réels, formats, « — » à droite", async () => {
    const { t, ws, entete } = await ecrire(4);
    for (let n = entete + 1; n <= entete + 4; n++) {
      expect(ws.getCell(n, 1).isMerged, `ligne ${n}`).toBe(false);
      expect(String(ws.getCell(n, 1).value)).toMatch(/^(a|x\d)$/); // chaque ligne est un article (son code), jamais un titre « FARINES (2) »
    }
    const col = (nom: string) => t.entete.indexOf(nom) + 1;
    const a = ws.getRow(entete + 1);
    expect(a.getCell(col("Entrées du mois")).value).toBe(4);
    expect(a.getCell(col("Sorties du mois")).value).toBe(1);
    expect(a.getCell(col("Ajustements du mois (sens non enregistré)")).value).toBe(3); // quantité absolue, jamais signée à tort
    expect(a.getCell(col("Entrées du mois")).alignment?.horizontal).toBe("right");
    expect(ws.getRow(entete + 2).getCell(col("Entrées du mois")).value).toBe(0); // aucun mouvement dans le mois : un vrai 0
    expect(a.getCell(col("Valeur USD")).numFmt).toContain("[Red](");
    expect(ws.getRow(entete + 4).getCell(col("Catégorie")).value).toBe("Huiles"); // la colonne Catégorie porte le groupe
  });

  it("classeur : la ligne de total ne compte que les articles ; feuille sans article : pas d'autofiltre", async () => {
    const { t, ws, entete, total } = await ecrire(2);
    expect(Number(ws.getCell(total, t.entete.indexOf("Valeur USD") + 1).value)).toBe(14 + 14);
    const vide = await ecrire(0, false);
    expect(vide.ws.autoFilter).toBeFalsy();
    expect(entete).toBeGreaterThan(0);
  });

  it("stock fin affiché au millième près : 0,125 reste 0,125 (l'identité début + mouvements = fin se lit sur la ligne)", () => {
    const t = tableauInventaire({ ...base, lignes: [ligne("1", { quantite: 0.125 })], mouvements: () => undefined });
    expect(t.lignes[0][t.entete.indexOf("Stock actuel")]).toBe(0.125);
  });
});
