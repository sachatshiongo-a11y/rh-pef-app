import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { lireGabarit, largeurColonne, texteCellule, type FeuilleGabarit, type Gabarit } from "@/lib/modeles-journaliers/gabarit";
import { pagesDuPdf, policesDeRepli, textesPoses, type TextePose } from "@/lib/test/pdf-lecture";
import { LEGUMES } from "@/app/(stock)/stock/legumes/legumes-data";
import { renderPdfBuffer } from "./fonts";
import { COLONNES_FICHE_ACHAT, FicheAchatLegumesDocument, TITRE_FICHE_ACHAT, ficheAchatRemplie, ficheAchatVierge, libelleImprime, type AchatDuJour } from "./fiche-achat-legumes";
import { A4, FACTEUR_RANGEE, LOGO, MARGES, POLICE, PT_PAR_UNITE, RANGEE, UNITES_COLONNES, mesuresFiche } from "./fiche-achat-legumes-modele";

/**
 * FIDÉLITÉ de la fiche « Achat de légumes Marché » (PDF) au modèle de la Direction : l'onglet
 * « Achat légumes » de son classeur (assets/modeles/achat-legumes.xlsx, cf.
 * scripts/modele-achat-legumes.ts). Le classeur est relu ; ce qu'il dit (tailles de police, gras,
 * largeurs, hauteurs, marges, orientation, textes, ordre des colonnes) est comparé aux constantes de
 * la mise en page ; puis le PDF produit est relu avec les positions des textes et comparé à
 * l'IMPRESSION d'Excel du même onglet (mesures ci-dessous).
 *
 * Écarts assumés, et seulement ceux-là (testés plus bas) : « Menthe » et « Feuilles de menthe » à la
 * botte (décision de la Direction du 2026-09-29, postérieure au modèle) ; les notes sous les totaux
 * quand un total est provisoire ou incomplet (règle de l'application, absente du modèle).
 */

const A = (col: number, ligne: number) => ({ col, ligne });
let g: Gabarit;
let f: FeuilleGabarit;
const texte = (col: number, r: number) => texteCellule(f.rangees.find((x) => x.r === r)?.cellules.find((c) => c.col === col), g.partages);
const police = (col: number, r: number) => g.styles.cellules[f.rangees.find((x) => x.r === r)!.cellules.find((c) => c.col === col)!.s]!.police;

beforeAll(async () => {
  g = await lireGabarit(new Uint8Array(fs.readFileSync(path.join(process.cwd(), "assets/modeles/achat-legumes.xlsx"))));
  f = g.feuilles[0]!;
});

/**
 * Impression d'Excel (Mac) de l'onglet, relue avec pdf.js le 2026-10-12 : page A4, corps 12,46 pt
 * (14 x 0,89), abscisses du début du texte, ordonnées de la LIGNE DE BASE depuis le haut de la page.
 */
const EXCEL = {
  echelle: 0.89,
  corps: 12.46,
  date: { x: 309.7, y: 95.2 },
  titre: { centre: 304.85, y: 127.3 },
  entete: { y: 159.3, centres: [176.2, 276.3, 364.4, 460.5] },
  premiere: { x: [110.4, 246.5], y: 176.2 },
  derniere: { designation: "Feuilles de menthe", y: 736.0 },
  pas: 15.14,
  totaux: { donne: { x: 110.4, y: 766.3 }, cdf: { x: 309.7, y: 766.3 }, usd: { x: 309.7, y: 781.4 } },
};
const TOL = { x: 1.5, y: 1.0, corps: 0.05 };

describe("le classeur de la Direction, relu", () => {
  it("un seul onglet « Achat légumes » : A4 portrait, marges 0,7 / 0,75 po, ajusté sur une page", () => {
    expect(g.feuilles.map((x) => x.nom)).toEqual(["Achat légumes"]);
    expect(f.paysage).toBe(false);
    expect(f.pagesEnHauteur).toBe(1);
    expect(f.echelle).toBeCloseTo(EXCEL.echelle, 5); // celle qu'Excel a enregistrée pour les 38 légumes
    expect([f.marges.gauche, f.marges.droite]).toEqual([MARGES.cotes / 72, MARGES.cotes / 72]);
    expect([f.marges.haut, f.marges.bas]).toEqual([MARGES.hautBas / 72, MARGES.hautBas / 72]);
    expect(f.apres).toMatch(/paperSize="9"/); // A4
  });

  it("police : Optima, GRAS, corps 14 sur tout ce qui s'imprime (titre, en-têtes, lignes, totaux, date)", () => {
    const cases = [A(4, 3), A(2, 5), ...[2, 3, 4, 5].map((c) => A(c, 7)), ...[2, 3].map((c) => A(c, 8)), A(2, 45), A(3, 45), A(2, 47), A(4, 47), A(4, 48)];
    for (const c of cases) expect(police(c.col, c.ligne), `colonne ${c.col}, rangée ${c.ligne}`).toMatchObject({ taille: POLICE, gras: true, italique: false, couleur: "#000000" });
    expect(g.styles.cellules[f.rangees.find((r) => r.r === 8)!.cellules[1]!.s]!.fond).toBeNull();
    expect(g.partages.join(" ")).not.toMatch(/Calibri/); // aucun autre corps ne s'imprime
    expect(g.parties.get("xl/styles.xml") && new TextDecoder().decode(g.parties.get("xl/styles.xml"))).toContain('name val="Optima Regular"');
  });

  it("largeurs des colonnes A à E, hauteurs des rangées (19 par défaut ; titre 21 ; en-tête et 1re rangée 20)", () => {
    expect([1, 2, 3, 4, 5].map((c) => largeurColonne(f, c))).toEqual([UNITES_COLONNES.gauche, UNITES_COLONNES.libelle, UNITES_COLONNES.unite, UNITES_COLONNES.quantite, UNITES_COLONNES.montant]);
    expect(f.hauteurDefaut).toBe(RANGEE.defaut);
    const h = (r: number) => f.rangees.find((x) => x.r === r)?.hauteur ?? f.hauteurDefaut;
    expect([h(5), h(7), h(8), h(9), h(45)]).toEqual([RANGEE.titre, RANGEE.entete, RANGEE.premiere, RANGEE.defaut, RANGEE.defaut]);
    expect(f.fusions).toEqual([{ c1: 2, r1: 5, c2: 5, r2: 5 }]); // le titre sur les quatre colonnes
  });

  it("logo à l'angle de la colonne B, à la taille du classeur", () => {
    const a = f.dessin!.ancre;
    expect([a.col, a.ligne]).toEqual([1, 0]);
    expect(a.largeur).toBeCloseTo(LOGO.largeur, 1);
    expect(a.hauteur).toBeCloseTo(LOGO.hauteur, 1);
  });

  it("libellés et ordre des colonnes : titre, en-têtes, « Date : », totaux", () => {
    expect(texte(2, 5)).toBe(TITRE_FICHE_ACHAT);
    expect([2, 3, 4, 5].map((c) => texte(c, 7))).toEqual(COLONNES_FICHE_ACHAT.map((c) => c.entete));
    expect(texte(4, 3)).toBe("Date : ");
    expect([texte(2, 47), texte(4, 47), texte(4, 48)]).toEqual(["Montant donné $", "Montant total CDF", "Montant total $"]);
  });

  it("la liste : les 38 légumes du classeur, dans son ordre, avec leurs unités — aux deux écarts assumés près", () => {
    const modele = Array.from({ length: 38 }, (_, i) => ({ nom: texte(2, 8 + i)!, unite: texte(3, 8 + i) ?? "" }));
    const imprimee = LEGUMES.map((l) => ({ nom: libelleImprime(l.nom), unite: l.unite }));
    const ecarts = modele.flatMap((m, i) => (m.nom === imprimee[i]!.nom && m.unite === imprimee[i]!.unite ? [] : [`${m.nom}|${m.unite} -> ${imprimee[i]!.nom}|${imprimee[i]!.unite}`]));
    expect(ecarts).toEqual(["Menthe| -> Menthe|Botte", "Feuilles de menthe|Boîte -> Feuilles de menthe|Botte"]);
  });
});

describe("mesures de la mise en page, déduites du classeur", () => {
  it("l'échelle des 38 légumes est celle qu'Excel a enregistrée (89 %) ; plus de lignes, plus petit ; jamais agrandie", () => {
    expect(mesuresFiche(38).echelle).toBe(f.echelle);
    expect(mesuresFiche(39).echelle).toBeLessThan(mesuresFiche(38).echelle);
    expect(mesuresFiche(5).echelle).toBe(0.97); // peu de lignes : borné par la LARGEUR de la page (494,5 / 506 pt), jamais agrandi
    expect(mesuresFiche(38).police).toBeCloseTo(EXCEL.corps, 2);
    expect(PT_PAR_UNITE * mesuresFiche(38).echelle * UNITES_COLONNES.libelle).toBeCloseTo(136.17, 1);
    expect(RANGEE.defaut * FACTEUR_RANGEE * mesuresFiche(38).echelle).toBeCloseTo(EXCEL.pas, 1);
  });
});

describe("le PDF, comparé à l'impression d'Excel du modèle", () => {
  let pdf: Buffer;
  let t: TextePose[];
  const poses = (s: string) => t.filter((x) => x.texte === s);
  beforeAll(async () => {
    pdf = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche: ficheAchatVierge(LEGUMES) }));
    t = await textesPoses(pdf);
  }, 60_000);

  it("une page A4 portrait, tout en Optima GRAS (aucune police de repli, aucune police maigre)", async () => {
    const pages = await pagesDuPdf(pdf);
    expect(pages).toHaveLength(1);
    expect(policesDeRepli(pdf)).toEqual([]);
    const polices = [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map((m) => m[1]!);
    expect(polices.length).toBeGreaterThan(0);
    for (const p of polices) expect(p, p).toMatch(/Optima-?Bold/i);
    const media = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"))!;
    expect([Number(media[1]), Number(media[2])].map((x) => Math.round(x))).toEqual([Math.round(A4.largeur), Math.round(A4.hauteur)]);
  });

  it("tailles de police : toutes à 14 x l'échelle d'Excel (12,46 pt), du titre aux lignes et aux totaux", () => {
    expect(t.length).toBeGreaterThan(80);
    for (const x of t) expect(x.taille, x.texte).toBeCloseTo(EXCEL.corps, 1);
  });

  it("rangée de départ, pas des rangées, dernière rangée : à la place d'Excel", () => {
    const ail = poses("Ail")[0]!;
    expect(ail.x).toBeCloseTo(EXCEL.premiere.x[0]!, 0);
    expect(Math.abs(ail.x - EXCEL.premiere.x[0]!)).toBeLessThanOrEqual(TOL.x);
    expect(Math.abs(ail.y - EXCEL.premiere.y)).toBeLessThanOrEqual(TOL.y);
    const kg = poses("Kg")[0]!;
    expect(Math.abs(kg.x - EXCEL.premiere.x[1]!)).toBeLessThanOrEqual(TOL.x);
    const derniere = poses(EXCEL.derniere.designation)[0]!;
    expect(Math.abs(derniere.y - EXCEL.derniere.y)).toBeLessThanOrEqual(TOL.y);
    // Pas régulier : 15,14 pt entre deux légumes consécutifs de la liste.
    const ys = LEGUMES.map((l) => poses(libelleImprime(l.nom)).find((x) => x.x < 130)!.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!, LEGUMES[i]!.nom).toBeGreaterThan(EXCEL.pas - 0.6);
    expect(Math.abs((ys.at(-1)! - ys[0]!) / (ys.length - 1) - EXCEL.pas)).toBeLessThan(0.1);
  });

  it("titre centré, en-têtes centrés sur leurs colonnes, dans l'ordre Désignation | Unité | QTÉ | Montant", () => {
    const titre = poses(TITRE_FICHE_ACHAT)[0]!;
    expect(Math.abs(titre.x + titre.largeur / 2 - EXCEL.titre.centre)).toBeLessThanOrEqual(TOL.x);
    expect(Math.abs(titre.y - EXCEL.titre.y)).toBeLessThanOrEqual(TOL.y);
    const entetes = COLONNES_FICHE_ACHAT.map((c) => poses(c.entete)[0]!);
    entetes.forEach((e, i) => {
      expect(Math.abs(e.x + e.largeur / 2 - EXCEL.entete.centres[i]!), e.texte).toBeLessThanOrEqual(TOL.x);
      expect(Math.abs(e.y - EXCEL.entete.y), e.texte).toBeLessThanOrEqual(TOL.y);
    });
    expect(entetes.map((e) => e.x)).toEqual([...entetes.map((e) => e.x)].sort((a, b) => a - b));
  });

  it("« Date : » sur la colonne D, les trois totaux à leur place", () => {
    const date = poses("Date :")[0]!;
    expect(Math.abs(date.x - EXCEL.date.x)).toBeLessThanOrEqual(TOL.x);
    expect(Math.abs(date.y - EXCEL.date.y)).toBeLessThanOrEqual(TOL.y);
    for (const [libelle, attendu] of [["Montant donné $", EXCEL.totaux.donne], ["Montant total CDF", EXCEL.totaux.cdf], ["Montant total $", EXCEL.totaux.usd]] as const) {
      const p = poses(libelle)[0]!;
      expect(Math.abs(p.x - attendu.x), libelle).toBeLessThanOrEqual(TOL.x);
      expect(Math.abs(p.y - attendu.y), libelle).toBeLessThanOrEqual(TOL.y);
    }
  });

  it("aucun pied de page de marque, aucun fond : le modèle n'en a pas", async () => {
    const [page] = await pagesDuPdf(pdf);
    expect(page!.plat).not.toMatch(/Kinshasa|E-mail|Pâtes en Folie SARL|Montants en CDF/i);
  });
});

describe("remplie : même mise en page, règles de l'application conservées", () => {
  const achat = (legume: string, unite: string | null, quantite: number, montantCDF: number | null, montantUSD: number | null = null): AchatDuJour => ({ legume, unite, quantite, montantCDF, montantUSD });

  it("quantités et montants alignés à droite dans leurs colonnes, texte à gauche, même corps", async () => {
    const pdf = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche: ficheAchatRemplie(LEGUMES, [achat("Ail", "Kg", 2.5, 12500, 4.46), achat("Oignons", "Kg", 10, 25000, 8.93)], 2800), date: "28/09/2026" }));
    const t = await textesPoses(pdf);
    const m = mesuresFiche(38);
    const x = (c: number) => MARGES.cotes + m.gauche + m.colonnes.slice(0, c).reduce((s, w) => s + w, 0);
    for (const nombre of ["2,5", "12 500", "10", "25 000"]) {
      const p = t.find((y) => y.texte === nombre)!;
      expect(p, nombre).toBeDefined();
      expect(p.taille).toBeCloseTo(EXCEL.corps, 1);
      const colonne = ["2,5", "10"].includes(nombre) ? 2 : 3;
      expect(Math.abs(p.x + p.largeur - (x(colonne + 1) - m.marge)), `${nombre} : bord droit de sa colonne`).toBeLessThanOrEqual(TOL.x);
    }
    expect(t.find((y) => y.texte === "Date : 28/09/2026")).toBeDefined();
  }, 60_000);

  it("quelques lignes de plus : une page, corps réduit comme Excel le ferait (jamais sous le plancher)", async () => {
    const f = ficheAchatRemplie(LEGUMES, [achat("Champignons de Paris", "Kg", 1, 1000, 0.36), achat("Fraises", "Kg", 2, 2000, 0.71)], 2800);
    const pdf = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche: f }));
    expect(await pagesDuPdf(pdf)).toHaveLength(1);
    const m = mesuresFiche(40);
    expect(m.echelle).toBeLessThan(0.89);
    for (const x of await textesPoses(pdf)) expect(x.taille, x.texte).toBeCloseTo(m.police, 1);
  }, 60_000);

  it("beaucoup de lignes : l'en-tête du tableau est répété sur la page suivante, aucune rangée coupée", async () => {
    const achats = Array.from({ length: 40 }, (_, i) => achat(`Autre légume ${i + 1}`, "Kg", i + 1, 1000));
    const pdf = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche: ficheAchatRemplie(LEGUMES, achats, 2800), date: "28/09/2026" }));
    const pages = await pagesDuPdf(pdf);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[1]!.lignes[0]).toMatch(/^Désignation Unité QTÉ Montant/);
    expect(pages.map((p) => p.plat).join(" ")).toContain("Autre légume 40");
  }, 60_000);

  it("total inconnu : « — » et la note qui le dit ; jamais de case vide, jamais de glyphe interdit", async () => {
    const f = ficheAchatRemplie(LEGUMES, [achat("Thym", "Botte", 1, 5600, null)], 0);
    expect(f.totalUSD).toBeNull();
    const pdf = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche: f, date: "28/09/2026" }));
    const [page] = await pagesDuPdf(pdf);
    expect(page!.plat).toMatch(/Montant total \$ —/);
    expect(page!.plat).toMatch(/total en dollars incomplet/);
    expect(page!.plat).not.toMatch(/[\u202F\u26A0\u2192\u2212]/); // espace fine, ⚠, →, − : absents d'Optima
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);

  it("fiche vierge : les totaux restent vides (à écrire à la main), pas de « — »", async () => {
    const pdf = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche: ficheAchatVierge(LEGUMES) }));
    const [page] = await pagesDuPdf(pdf);
    expect(page!.plat).not.toContain("—");
    expect(page!.plat).toMatch(/Montant donné \$ Montant total CDF Montant total \$/);
  }, 60_000);
});
