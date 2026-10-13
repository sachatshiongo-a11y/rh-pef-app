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
    const [r] = t.lignes;
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
    expect(t.lignes.map((r) => r[h])).toEqual([TIRET, TIRET]);
    // Calcul indisponible (panne) : tout est « — », y compris les mouvements du mois.
    const panne = tableauInventaire({ ...base, lignes: [ligne("x")], resultat: () => null });
    expect(panne.lignes[0].slice(2, 6)).toEqual([TIRET, TIRET, TIRET, TIRET]);
  });

  it("ajustements au sens inconnu : « — » dans la colonne des ajustements ET dans le stock de début", () => {
    const dd = donnees({ dansMois: new Map([["a", { entrees: 0, sorties: 0, ajustements: { nb: 1, net: null } }]]) });
    const t = tableauInventaire({ ...base, lignes: [ligne("a")], resultat: (id) => stockInitialArticle(dd, id, 10) });
    const r = t.lignes[0];
    expect(r[t.entete.indexOf("Stock début de mois")]).toBe(TIRET);
    expect(r[t.entete.indexOf("Ajustements du mois (comptage)")]).toBe(TIRET);
  });

  it("sans prix : valeur et prix VIDES (jamais 0) ; seuil nul et carton inconnu : « — » comme à l'écran", () => {
    const t = tableauInventaire({ ...base, lignes: [ligne("a", { prixUnitaireUSD: 0, sansPrix: true, stockMinimum: 0 })], resultat: () => null });
    const r = t.lignes[0];
    expect(r[t.entete.indexOf("Valeur USD")]).toBe("");
    expect(r[t.entete.indexOf("Prix U. USD")]).toBe("");
    expect(r[t.entete.indexOf("Remarque prix")]).toBe("sans prix");
    expect(r[t.entete.indexOf("Min")]).toBe(TIRET);
    expect(r[t.entete.indexOf("Par carton")]).toBe(TIRET);
  });

  it("article au prix en francs : prix saisi en FC et taux en nombres ; sans taux : non valorisé et dit", () => {
    const t = tableauInventaire({ ...base, lignes: [ligne("a", { prixUnitaireCDF: 7000, tauxChange: 2800, prixUnitaireUSD: 2.5 }), ligne("b", { prixUnitaireCDF: 7000, tauxChange: null, prixUnitaireUSD: 0, sansPrix: false })], resultat: () => null });
    const h = (n: string) => t.entete.indexOf(n);
    expect(t.lignes[0][h("Prix saisi en FC")]).toBe(7000);
    expect(t.lignes[0][h("Taux FC/$ utilisé")]).toBe(2800);
    expect(t.lignes[1][h("Remarque prix")]).toMatch(/taux non défini/);
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
    expect(t.lignes.map((r) => r[i])).toEqual([4, 0, TIRET]); // a : +4 non expliqué ; b : juste ; c : pas dans la clôture
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

describe("tableau TRIABLE : aucune ligne-titre, rangé comme l'écran, autofiltre borné aux articles", () => {
  it("catégories dans l'ordre du catalogue, « À classer » en dernier, code gardé dans la catégorie ; une ligne par article", () => {
    const lignes = [
      ligne("1", { categorie: "Huiles" }), ligne("2", { categorie: "Farines" }), ligne("3", { categorie: "" }), ligne("4", { categorie: "Farines" }), ligne("5", { categorie: "Huiles" }),
    ];
    const t = tableauInventaire({ ...base, ordreCategories: new Map([["Farines", 1], ["Huiles", 2]]), lignes, resultat: () => null });
    expect(t.lignes).toHaveLength(5); // pas de ligne-titre : autant de lignes que d'articles
    expect(t.lignes.map((r) => r[0])).toEqual(["2", "4", "1", "5", "3"]);
    const iCat = t.entete.indexOf("Catégorie");
    expect(t.lignes.map((r) => r[iCat])).toEqual(["Farines", "Farines", "Huiles", "Huiles", "À classer"]);
    expect("sectionRows" in t).toBe(false);
  });

  /** Écrit le classeur et relit la feuille : numéro de la ligne d'en-tête, des lignes d'articles, du total. */
  async function ecrire(nbArticles: number, avecTotaux = true) {
    const d = donnees({ dansMois: new Map([["a", mv(0, 0, -3)]]) });
    const lignes = Array.from({ length: nbArticles }, (_, i) => ligne(i === 0 ? "a" : `x${i}`, { categorie: i % 2 ? "Huiles" : "Farines", quantite: 7 }));
    const t = tableauInventaire({ ...base, lignes, resultat: (id) => stockInitialArticle(d, id, 7) });
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
    expect(a.getCell(col("Ajustements du mois (comptage)")).value).toBe(-3);
    expect(a.getCell(col("Ajustements du mois (comptage)")).numFmt).toBe("General;[Red]-General");
    expect(a.getCell(col("Stock début de mois")).value).toBe(10); // 7 + 3
    expect(a.getCell(col("Stock début de mois")).alignment?.horizontal).toBe("right");
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
    const t = tableauInventaire({ ...base, lignes: [ligne("1", { quantite: 0.125 })], resultat: () => null });
    expect(t.lignes[0][t.entete.indexOf("Stock actuel")]).toBe(0.125);
  });
});
