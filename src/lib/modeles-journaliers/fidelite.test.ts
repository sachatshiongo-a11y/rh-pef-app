import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { pagesDuPdf, policesDeRepli } from "@/lib/test/pdf-lecture";
import { lireGabarit, lettreColonne, texteCellule, type FeuilleGabarit, type Gabarit, type RangeeBrute } from "./gabarit";
import { chargerModele, excelModele, feuillesCommande, feuillesRapport, pdfModele, type Modele } from "./index";
import { serieExcel, type FeuilleSortie } from "./remplir";
import { fichesCommandeEssai, fichesRapportEssai } from "./donnees-essai";

/**
 * FIDÉLITÉ des documents journaliers aux classeurs de la Direction (assets/modeles/) : l'Excel
 * produit est relu et comparé au modèle — onglets, styles, colonnes, fusions, mise en page
 * d'impression, logo, et chaque rangée du modèle à sa place (textes fixes, styles) — avec les
 * données d'essai (lib/modeles-journaliers/donnees-essai) ; le PDF est relu (pages, textes, polices).
 */

const gabaritDe = (nom: string) => new Uint8Array(fs.readFileSync(path.join(process.cwd(), "assets/modeles", nom)));
const ref = (col: number, r: number) => `${lettreColonne(col)}${r}`;
const sansVariable = (xml: string) => xml
  .replace(/<dimension ref="[^"]*"\/>/, "").replace(/\stabSelected="1"/g, "")
  .replace(/<sortState\b[\s\S]*?<\/sortState>/g, "").replace(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/g, "");

type Produit = { modele: Modele; feuilles: FeuilleSortie[]; sortie: Gabarit; octets: Buffer };

async function produire(modele: Promise<{ modele: Modele; feuilles: FeuilleSortie[] }>): Promise<Produit> {
  const r = await modele;
  const octets = await excelModele(r);
  return { ...r, octets, sortie: await lireGabarit(new Uint8Array(octets)) };
}

/** Chaque rangée du modèle est à sa place dans le document, ses textes fixes et ses styles intacts. */
function verifierRangees(g: Gabarit, modele: FeuilleGabarit, f: FeuilleSortie, sortie: FeuilleGabarit, donnees: Set<number>, colonneDecalee?: number) {
  const parR = new Map(sortie.rangees.map((r) => [r.r, r]));
  const sq = f.squelette!;
  let comparees = 0;
  for (const r of modele.rangees) {
    const R = f.nouvelleLigne(r.r);
    const o = parR.get(R);
    expect(o, `${modele.nom} : rangée ${r.r} → ${R}`).toBeDefined();
    const ecrite = f.rangees.find((x) => x.r === R);
    // Ligne laissée vide dans le modèle (« Supplément ») qui reçoit une ligne de l'application : ses
    // cases prennent le style d'une ligne. Toute autre rangée garde sa hauteur et ses styles.
    if (sq.genres.get(r.r) === "vide" && ecrite?.donnees) continue;
    expect(o!.attributs, `${modele.nom} ${r.r} : attributs`).toBe(r.attributs);
    for (const c of r.cellules) {
      const k = o!.cellules.find((x) => x.col === c.col);
      expect(k, `${modele.nom} ${ref(c.col, r.r)} présente`).toBeDefined();
      const caseDonnee = donnees.has(R) && sq.colsDonnees.includes(c.col);
      // Une case VIDE du modèle où l'application écrit (donnée, date du jour) peut changer de style.
      const ecriteDansVide = c.v === null && c.formule === null && (k!.v !== null || k!.is !== null);
      if (!caseDonnee && !ecriteDansVide && c.col !== colonneDecalee) expect(k!.s, `${modele.nom} ${ref(c.col, r.r)} : style`).toBe(c.s);
      const t = texteCellule(c, g.partages);
      // Textes fixes du modèle (désignations, rubriques, en-têtes, unités des lignes sans article) : à l'identique.
      if (t !== null && !caseDonnee) expect(texteCellule(k, g.partages), `${modele.nom} ${ref(c.col, r.r)} : texte`).toBe(t);
      comparees++;
    }
  }
  return comparees;
}

function verifierFeuille(p: Produit, i: number, options: { colonnes?: boolean; colonneDecalee?: number } = {}) {
  const f = p.feuilles[i]!;
  const modele = f.gabarit;
  const sortie = p.sortie.feuilles[i]!;
  // Mise en page : tout ce qui entoure les rangées est celui du modèle (volets, largeurs, marges,
  // échelle, ajustement à la page, fusions, dessin).
  if (options.colonnes !== false) expect(sansVariable(sortie.avant)).toBe(sansVariable(modele.avant));
  expect(sansVariable(sortie.apres)).toBe(sansVariable(modele.apres));
  expect(sortie.fusions).toEqual(modele.fusions);
  expect(sortie.marges).toEqual(modele.marges);
  expect([sortie.echelle, sortie.pagesEnHauteur, sortie.paysage]).toEqual([modele.echelle, modele.pagesEnHauteur, modele.paysage]);
  expect(sortie.dessin?.xml).toBe(modele.dessin?.xml);
  expect(sortie.dessin && p.sortie.parties.get(sortie.dessin.media)).toEqual(modele.dessin && p.modele.gabarit.parties.get(modele.dessin.media));
  if (modele.zone) {
    expect([sortie.zone!.c1, sortie.zone!.r1]).toEqual([modele.zone.c1, modele.zone.r1]);
    expect(sortie.zone!.r2).toBeGreaterThanOrEqual(f.nouvelleLigne(modele.zone.r2));
  }
  const donnees = new Set(f.rangees.filter((x) => x.donnees).map((x) => x.r));
  expect(verifierRangees(p.modele.gabarit, modele, f, sortie, donnees, options.colonneDecalee)).toBeGreaterThan(100);
}

/** Valeurs d'une rangée du document (colonnes données), par désignation. */
function valeurs(sortie: FeuilleGabarit, g: Gabarit, colDesignation: number, designation: string, cols: number[]): (string | number | null)[] {
  const r = sortie.rangees.find((x) => texteCellule(x.cellules.find((c) => c.col === colDesignation), g.partages)?.trim() === designation);
  expect(r, designation).toBeDefined();
  return cols.map((col) => {
    const c = r!.cellules.find((x) => x.col === col);
    if (!c) return null;
    const t = texteCellule(c, g.partages);
    return t !== null ? t : c.v !== null ? Number(c.v) : null;
  });
}
const rangeeDe = (sortie: FeuilleGabarit, g: Gabarit, col: number, texte: string): RangeeBrute | undefined =>
  sortie.rangees.find((x) => texteCellule(x.cellules.find((c) => c.col === col), g.partages)?.trim() === texte);

describe("Rapport journalier cuisine et bar : le classeur de la Direction, rempli", () => {
  let p: Produit;
  beforeAll(async () => { p = await produire(feuillesRapport(await fichesRapportEssai(), "2026-09-28")); }, 60_000);

  it("le paquet : onglets, styles, thème, textes partagés, logo du modèle ; léger", async () => {
    const m = await lireGabarit(gabaritDe("rapport-journalier.xlsx"));
    expect(p.sortie.feuilles.map((f) => f.nom)).toEqual(["Cuisine ", "Bar "]);
    expect(p.sortie.styles.xfs.slice(0, m.styles.xfs.length)).toEqual(m.styles.xfs);
    expect(p.sortie.styles.xml.replace(/<cellXfs[\s\S]*<\/cellXfs>/, "")).toBe(m.styles.xml.replace(/<cellXfs[\s\S]*<\/cellXfs>/, ""));
    expect(p.sortie.partages).toEqual(m.partages);
    expect(p.sortie.parties.get("xl/theme/theme1.xml")).toEqual(m.parties.get("xl/theme/theme1.xml"));
    expect(p.octets.length).toBeLessThan(400_000);
    // Le classeur s'ouvre (ExcelJS le relit) et ne garde rien du poste de la Direction.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(p.octets as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Cuisine ", "Bar "]);
    expect(new TextDecoder().decode(p.sortie.parties.get("xl/workbook.xml"))).not.toContain("Downloads");
  });

  it("chaque rangée du modèle à sa place, textes fixes et styles intacts (Cuisine, Bar)", () => {
    verifierFeuille(p, 0);
    verifierFeuille(p, 1);
  });

  it("en-tête : semaine ISO, dates du lundi au samedi (formules du modèle), jours", () => {
    const [cuisine, bar] = p.sortie.feuilles;
    const c = (f: FeuilleGabarit, a: string) => f.rangees.find((r) => r.r === Number(a.slice(1)))!.cellules.find((x) => lettreColonne(x.col) === a[0]);
    expect(c(cuisine!, "C12")!.v).toBe(String(serieExcel("2026-09-28")));
    expect(c(cuisine!, "D12")!.formule).toBe("C12+1");
    expect(c(cuisine!, "H12")!.v).toBe(String(serieExcel("2026-10-03")));
    expect(c(cuisine!, "D9")).toMatchObject({ formule: "WEEKNUM(C12,21)", v: "40" });
    expect(c(cuisine!, "C11")).toMatchObject({ formule: 'PROPER(TEXT(C12,"ddd"))', v: "Lun" });
    expect(c(bar!, "B14")!.v).toBe(String(serieExcel("2026-09-28")));
    expect(c(bar!, "D11")).toMatchObject({ formule: "WEEKNUM(B14,21)", v: "40" });
  });

  it("données : nombre vendu, 0 saisi = 0, « — » non saisi ; ligne du modèle sans plat : vide", () => {
    const g = p.modele.gabarit;
    const [cuisine, bar] = p.sortie.feuilles;
    const cols = [3, 4, 5, 6, 7, 8];
    const carbo = valeurs(cuisine!, g, 2, "Carbonara", cols);
    expect(carbo.slice(3)).toEqual(["—", "—", "—"]);
    expect(carbo.slice(0, 3).every((v) => typeof v === "number")).toBe(true);
    expect(valeurs(cuisine!, g, 2, "Farfalle", cols)).toEqual([null, null, null, null, null, null]); // rubrique « Pâtes » : pas une vente
    expect(valeurs(bar!, g, 1, "Acqua Panna", [2, 3, 4, 5, 6, 7]).slice(3)).toEqual(["—", "—", "—"]);
    // Même chiffres que la fiche (aucun calcul) : toutes les valeurs écrites viennent des fiches d'essai.
    const fiche = p.feuilles[0]!;
    const ecrites = fiche.rangees.filter((x) => x.donnees).length;
    expect(ecrites).toBe(42 + 4); // les 42 plats du classeur hors « Pâtes » + les 4 plats absents du classeur
  });

  it("lignes absentes du classeur : dans leur rubrique (lignes vides de « Supplément » d'abord), sinon rubrique ajoutée en fin de feuille", () => {
    const g = p.modele.gabarit;
    const cuisine = p.sortie.feuilles[0]!;
    const n = (t: string) => rangeeDe(cuisine, g, 2, t)!.r;
    expect(n("Gâteau d'anniversaire")).toBe(n("Trilogie de délices") + 1);
    // Les lignes laissées vides sous « Supplément » reçoivent ses lignes : rien n'est inséré.
    expect(n("Supplément fromage râpé")).toBe(n("Supplément") + 1);
    expect(n("Supplément sauce")).toBe(n("Supplément") + 2);
    expect(p.feuilles[0]!.nouvelleLigne(80)).toBe(81); // une seule rangée insérée avant (« Gâteau d'anniversaire »)
    expect(n("Suggestions du chef")).toBe(82);
    expect(n("Plat du jour")).toBe(n("Suggestions du chef") + 1);
    expect(p.feuilles[0]!.zone!.r2).toBeGreaterThanOrEqual(n("Plat du jour")); // dans la zone d'impression
    expect(p.feuilles[0]!.ajouts.map((a) => a.libelle)).toEqual(["Gâteau d'anniversaire", "Supplément fromage râpé", "Supplément sauce", "Plat du jour"]);
    const bar = p.sortie.feuilles[1]!;
    expect(rangeeDe(bar, g, 1, "Jus de bissap")!.r).toBe(rangeeDe(bar, g, 1, "Passion")!.r + 1);
    // L'en-tête répété du Bar a suivi : toujours juste avant « Vin blanc ».
    expect(rangeeDe(bar, g, 1, "Designation/Date")).toBeDefined();
    const repetes = bar.rangees.filter((x) => texteCellule(x.cellules.find((c) => c.col === 1), g.partages)?.startsWith("Designation"));
    expect(repetes.map((x) => x.r)).toEqual([13, 73, 143]);
    expect(rangeeDe(bar, g, 1, "Vin blanc")!.r).toBe(74);
  });

  it("dimanche vendu : une 7e colonne comme la dernière (largeur, styles, formules), zone d'impression élargie", async () => {
    const d = await produire(feuillesRapport(await fichesRapportEssai({ dimanche: true }), "2026-09-28"));
    const cuisine = d.sortie.feuilles[0]!;
    const c = (a: string) => cuisine.rangees.find((r) => r.r === Number(a.slice(1)))!.cellules.find((x) => lettreColonne(x.col) === a[0]);
    expect(c("I11")).toMatchObject({ formule: 'PROPER(TEXT(I12,"ddd"))', v: "Dim" });
    expect(c("I12")).toMatchObject({ formule: "H12+1", v: String(serieExcel("2026-10-04")) });
    expect(c("I12")!.s).toBe(p.sortie.feuilles[0]!.rangees.find((r) => r.r === 12)!.cellules.find((x) => x.col === 8)!.s); // le style du dernier jour
    expect(cuisine.colonnes.find((k) => k.min === 9)!.largeur).toBe(cuisine.colonnes.find((k) => k.min <= 8 && 8 <= k.max)!.largeur);
    // Bar : la plus large des colonnes de jours (« Mercredi », 22,66) pour « Dimanche ».
    expect(d.sortie.feuilles[1]!.colonnes.find((k) => k.min === 8 && k.max === 8)!.largeur).toBeCloseTo(22.66, 1);
    expect(d.sortie.feuilles[0]!.zone!.c2).toBe(11);
    expect(valeurs(cuisine, d.modele.gabarit, 2, "Salade comme à la côte d'Azur", [9])).toEqual([4]);
    verifierFeuille(d, 0, { colonnes: false, colonneDecalee: 8 });
    const bar = d.sortie.feuilles[1]!;
    const dimanches = bar.rangees.flatMap((r) => r.cellules.filter((x) => texteCellule(x, d.modele.gabarit.partages) === "Dimanche").map((x) => ref(x.col, r.r)));
    expect(dimanches).toEqual(["H72", "H142"]); // « Lundi … Samedi » répété (rangées 71 et 141 du modèle, une ligne ajoutée avant)
  }, 60_000);

  it("autre semaine (2027 : la semaine ISO et celle de WEEKNUM diffèrent) : semaine 1 du 04/01/2027", async () => {
    const d = await produire(feuillesRapport(await fichesRapportEssai({ ajouts: false }), "2027-01-04"));
    const c = d.sortie.feuilles[0]!.rangees.find((r) => r.r === 9)!.cellules.find((x) => x.col === 4)!;
    expect(c).toMatchObject({ formule: "WEEKNUM(C12,21)", v: "1" });
    expect(d.sortie.feuilles[0]!.rangees.find((r) => r.r === 12)!.cellules.find((x) => x.col === 3)!.v).toBe(String(serieExcel("2027-01-04")));
    expect(d.feuilles[0]!.ajouts).toEqual([]);
    expect(d.sortie.feuilles[0]!.zone).toEqual(d.modele.gabarit.feuilles[0]!.zone); // rien ajouté : la zone du modèle
  }, 60_000);

  it("PDF : 1 page Cuisine + 3 pages Bar comme l'impression du modèle, en-tête sur chaque page, tout Optima", async () => {
    const pdf = await pdfModele(p, "Rapport journalier cuisine et bar — semaine 40");
    const pages = await pagesDuPdf(pdf);
    expect(pages).toHaveLength(4);
    expect(pages[0]!.plat).toContain("Rapport journalier cuisine");
    expect(pages[0]!.plat).toMatch(/Semaine\s+40/);
    expect(pages[0]!.plat).toMatch(/Lun\s+Mar\s+Mer\s+Jeu\s+Ven\s+Sam/);
    expect(pages[0]!.plat).toMatch(/28-sept\.\s+29-sept\.\s+30-sept\.\s+1-oct\.\s+2-oct\.\s+3-oct\./);
    expect(pages[0]!.plat).toContain("Plat du jour");
    expect(pages[1]!.plat).toContain("Rapport journalier bar");
    expect(pages[2]!.plat).toMatch(/Lundi\s+Mardi\s+Mercredi\s+Jeudi\s+Vendredi\s+Samedi/);
    expect(pages[2]!.lignes[0]).not.toContain("Remy"); // la page 3 commence par l'en-tête répété du modèle
    expect(pages[3]!.plat).toContain("Gin, Vodka et Tequila");
    const tout = pages.map((x) => x.plat).join(" ");
    expect(tout).not.toMatch(/[ ⚠→−]/);
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);
});

describe("Commande journalière : le classeur de la Direction, rempli", () => {
  let p: Produit;
  beforeAll(async () => { p = await produire(feuillesCommande([{ date: "2026-09-29", fiches: await fichesCommandeEssai() }])); }, 60_000);

  it("le paquet : les trois onglets du modèle (« Salle » vide compris), styles, logo", async () => {
    const m = await lireGabarit(gabaritDe("commande-journaliere.xlsx"));
    expect(p.sortie.feuilles.map((f) => f.nom)).toEqual(["Fiche commande cuisine ", "Fiche commande Bar ", "Fiche commande Salle"]);
    expect(p.sortie.styles.xfs.slice(0, m.styles.xfs.length)).toEqual(m.styles.xfs);
    expect(p.sortie.feuilles[2]!.rangees).toEqual(m.feuilles[2]!.rangees);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(p.octets as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(3);
    expect(p.octets.length).toBeLessThan(400_000);
  });

  it("chaque rangée du modèle à sa place, textes fixes et styles intacts", () => {
    verifierFeuille(p, 0);
    verifierFeuille(p, 1);
  });

  it("en-tête : semaine, date du jour sous « Date : »", () => {
    const [cuisine, bar] = p.sortie.feuilles;
    const c = (f: FeuilleGabarit, col: number, r: number) => f.rangees.find((x) => x.r === r)?.cellules.find((x) => x.col === col);
    expect(c(cuisine!, 3, 8)!.v).toBe("40");
    expect(texteCellule(c(cuisine!, 4, 6), p.modele.gabarit.partages)).toBe("Date : ");
    expect(texteCellule(c(cuisine!, 4, 7), p.modele.gabarit.partages)).toBe("29/09/2026");
    expect(c(cuisine!, 4, 7)!.s).toBe(c(cuisine!, 4, 6)!.s);
    expect(texteCellule(c(bar!, 3, 6), p.modele.gabarit.partages)).toBe("29/09/2026");
  });

  it("données : unité de l'article, commande, livraison ; quantité au format Standard (jamais une date)", () => {
    const g = p.modele.gabarit;
    const cuisine = p.sortie.feuilles[0]!;
    expect(valeurs(cuisine, g, 1, "Carré d'agneau", [2, 3, 4])).toEqual(["Kg", 1, null]);
    // « Filet pur Boeuf » : sa case Commande est au format « d.m » dans le modèle.
    const filet = rangeeDe(cuisine, g, 1, "Filet pur Boeuf")!;
    const modeleFilet = p.modele.gabarit.feuilles[0]!.rangees.find((r) => r.r === 14)!;
    expect(modeleFilet.cellules.find((c) => c.col === 3)!.s).not.toBe(0);
    for (const c of filet.cellules.filter((x) => x.col >= 3 && x.v !== null)) expect(p.sortie.styles.cellules[c.s]!.format).toBe("General");
    // Légume : commande saisie, livraison = achat du jour ; « Lemons / Citrons-verts » trouve « Lemons/ Citrons-verts ».
    expect(valeurs(cuisine, g, 1, "Ail", [2, 3, 4])).toEqual(["Kg", 1, 0.5]);
    expect(rangeeDe(cuisine, g, 1, "Lemons / Citrons-verts")).toBeUndefined();
    expect(rangeeDe(cuisine, g, 1, "Lemons/ Citrons-verts")).toBeDefined();
    // Lignes absentes : « Burrata » au bout de Crèmerie, « Zébu haché » sous une rubrique ajoutée (avec « Commande | Livraison »).
    expect(rangeeDe(cuisine, g, 1, "Burrata")!.r).toBe(rangeeDe(cuisine, g, 1, "Parmesan")!.r + 1);
    const boucherie = rangeeDe(cuisine, g, 1, "Boucherie locale")!;
    expect(boucherie.r).toBeGreaterThan(rangeeDe(cuisine, g, 1, "Sucre vanille")!.r);
    expect(boucherie.cellules.map((c) => texteCellule(c, g.partages)).filter(Boolean)).toEqual(["Boucherie locale", "Commande", "Livraison"]);
    expect(valeurs(cuisine, g, 1, "Zébu haché", [2, 3, 4])).toEqual(["Kg", 3, null]);
    expect(p.feuilles[0]!.zone!.r2).toBe(rangeeDe(cuisine, g, 1, "Zébu haché")!.r);
    const bar = p.sortie.feuilles[1]!;
    expect(rangeeDe(bar, g, 1, "Primus")!.r).toBe(rangeeDe(bar, g, 1, "Tembo")!.r + 1);
  });

  it("toute la semaine : une feuille par jour et par fiche (« Mar 29 Cuisine »), chacune le modèle", async () => {
    const jours = await Promise.all(["2026-09-28", "2026-09-29"].map(async (date) => ({ date, fiches: (await fichesCommandeEssai({ date })).map((f) => ({ ...f, feuille: `${date === "2026-09-28" ? "Lun 28" : "Mar 29"} ${f.espace === "CUISINE" ? "Cuisine" : "Bar"}` })) })));
    const s = await produire(feuillesCommande(jours));
    expect(s.sortie.feuilles.map((f) => f.nom)).toEqual(["Lun 28 Cuisine", "Lun 28 Bar", "Mar 29 Cuisine", "Mar 29 Bar"]);
    for (let i = 0; i < 4; i++) verifierFeuille(s, i);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(s.octets as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(4);
    const classeur = new TextDecoder().decode(s.sortie.parties.get("xl/workbook.xml"));
    expect(classeur.match(/_xlnm\.Print_Area/g)).toHaveLength(4);
    expect(s.sortie.feuilles.filter((f) => /tabSelected="1"/.test(f.avant))).toHaveLength(1);
  }, 60_000);

  it("PDF : 3 pages cuisine + 2 pages bar comme l'impression du modèle ; en-tête de colonnes répété ; tout Optima", async () => {
    const pdf = await pdfModele(p, "Commande journalière");
    const pages = await pagesDuPdf(pdf);
    expect(pages).toHaveLength(5);
    expect(pages[0]!.plat).toMatch(/COMMANDE CUISINE\s+Semaine\s+40/);
    expect(pages[0]!.plat).toMatch(/Date :\s+29\/09\/2026/);
    for (const x of pages.slice(1, 3)) expect(x.lignes[0]).toMatch(/^Désignation\/Date Unité Commande Livraison/);
    expect(pages[3]!.plat).toMatch(/COMMANDE BAR\s+Semaine\s+40/);
    expect(pages[4]!.lignes[0]).toMatch(/^Désignation Commande Livraison/);
    expect(pages.flatMap((x) => x.lignes)).toContain("Carré d'agneau Kg 1");
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);
});

it("les squelettes des deux modèles : en-têtes, corps, rubriques, lignes de l'import", async () => {
  const r = await chargerModele("RAPPORT");
  const [cuisine, bar] = r.feuilles.map((f) => f.squelette!);
  expect([cuisine!.ligneEntete, cuisine!.finEntete, cuisine!.finCorps, cuisine!.colsDonnees]).toEqual([11, 12, 80, [3, 4, 5, 6, 7, 8]]);
  expect(cuisine!.cles.size).toBe(50);
  expect(cuisine!.blocs.at(-1)).toMatchObject({ cle: "Supplément", rangeeRubrique: 70, lignes: [], vides: [71, 72, 73, 74, 75, 76, 77, 78, 79, 80] });
  expect([bar!.ligneEntete, bar!.finEntete, bar!.finCorps, bar!.entetesRepetes]).toEqual([13, 14, 186, [[71, 72], [141, 142]]]);
  expect(bar!.cles.size).toBe(140);
  const c = await chargerModele("COMMANDE");
  const [cc, cb] = c.feuilles.map((f) => f.squelette);
  expect([cc!.ligneEntete, cc!.finCorps, cc!.colsDonnees]).toEqual([9, 210, [2, 3, 4]]);
  expect([cb!.ligneEntete, cb!.finCorps, cb!.colsDonnees]).toEqual([10, 164, [2, 3]]);
  expect(c.feuilles[2]!.squelette).toBeNull();
});
