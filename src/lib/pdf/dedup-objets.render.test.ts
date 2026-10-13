import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { Document, Page, Image } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { renderPdfBrut } from "./fonts";
import { rendreParBlocs, rendreParLots, planDe, PAGES_PAR_LOT, type PlanLots } from "./blocs";
import { dedupliquerObjets } from "./dedup-objets";
import { TableauDocument, TablesDocument, type Cellule } from "./tableau";
import { ComparaisonDocument } from "./comparaison";
import { RapportExploitationDocument } from "./rapport-exploitation";
import { FichesInventaireDocument } from "./fiche-inventaire-resto";
import { BulletinsDocument } from "./bulletin";
import { LivrePaieDocument } from "./livre-paie";
import { lignesExportComparaison, partiesPdfComparaison } from "@/lib/journalier-restaurant";
import { PIED_PDF_COMPARAISON, partiesDocumentComparaison } from "@/lib/journalier-comparaison-export";
import { LABELS_FIXTURE, lignesFixture } from "@/app/(stock)/stock/journalier/comparaison.fixture";
import { rapportFixture } from "@/lib/exploitation/__fixtures__/mois-charge";
import { pixelsDifferentsParPage, policesDeRepli, textesPoses } from "@/lib/test/pdf-lecture";

/**
 * DÉDUPLICATION DES IMAGES (ET DES POLICES STRICTEMENT IDENTIQUES) APRÈS FUSION (13/10/2026) : chaque fenêtre ou lot du
 * rendu par blocs embarquait sa copie du logo et de son masque ; `dedup-objets.ts` les ramène à une seule. Ces tests
 * prouvent trois choses : le document est IDENTIQUE (pixel par pixel, texte par texte) à la fusion sans déduplication ;
 * il n'y a plus qu'un logo ; deux images DIFFÉRENTES ne sont jamais confondues.
 */

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T10:00:00Z") }); });
afterAll(() => { vi.useRealTimers(); });

type ImagePdf = { tag: string; aMasque: boolean; octets: number };
/** Images (XObject /Subtype /Image) réellement écrites dans le fichier : celles qui ont survécu à la déduplication. */
async function imagesDuPdf(pdf: Buffer): Promise<ImagePdf[]> {
  const doc = await PDFDocument.load(pdf);
  const images: ImagePdf[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    images.push({ tag: ref.tag, aMasque: obj.dict.get(PDFName.of("SMask")) instanceof PDFRef, octets: obj.contents.length });
  }
  return images;
}

const arrondi = (n: number) => Math.round(n * 10) / 10;
async function empreinte(pdf: Buffer): Promise<string[]> {
  return (await textesPoses(pdf)).map((t) => `p${t.page} ${t.texte} @${arrondi(t.x)},${arrondi(t.y)} ${arrondi(t.taille)}pt`);
}

/**
 * La fusion du document avec et sans déduplication : mêmes fenêtres, mêmes lots, seul l'écrivain change. L'horloge est figée
 * (voir `beforeAll`) : deux rendus du même document ne doivent différer que par la déduplication, pas par une heure de génération.
 */
async function fusions(doc: ReactElement<DocumentProps>) {
  const plan = planDe(doc);
  if (!plan) throw new Error("document sans plan de découpage");
  const fusionner = (dedupliquer: boolean) => (plan.mode === "fenetres"
    ? rendreParBlocs(plan, renderPdfBrut, { dedupliquer })
    : rendreParLots(plan, renderPdfBrut, PAGES_PAR_LOT, { dedupliquer }));
  return { sans: await fusionner(false), avec: await fusionner(true) };
}

/** Vérifie qu'une fusion dédupliquée est identique à la même fusion sans déduplication. */
async function identique(doc: ReactElement<DocumentProps>, { logo = "repete" }: { logo?: "repete" | "unique" | false } = {}) {
  const { avec, sans } = await fusions(doc);
  const pages = await pixelsDifferentsParPage(avec, sans);
  expect(pages.length).toBeGreaterThanOrEqual(2);
  pages.forEach((n, i) => expect(n, `pixels différents, page ${i + 1}`).toBe(0));
  expect(await empreinte(avec)).toEqual(await empreinte(sans));
  expect(policesDeRepli(avec), "aucune police de repli").toEqual([]);
  expect(avec.length, "le fichier n'est jamais plus lourd").toBeLessThanOrEqual(sans.length);
  if (logo) {
    const [a, s] = [await imagesDuPdf(avec), await imagesDuPdf(sans)];
    // « repete » : le logo est sur chaque page (bulletins, tableaux) ; « unique » : sur la première seulement (rapport), donc déjà un seul.
    if (logo === "repete") {
      expect(avec.length, "le fichier est plus léger").toBeLessThan(sans.length);
      expect(s.filter((i) => i.aMasque).length, "sans déduplication : un logo par fenêtre (le test voit bien le défaut)").toBeGreaterThan(1);
    }
    expect(a.filter((i) => i.aMasque), "avec : UN seul logo").toHaveLength(1);
    expect(a, "avec : le logo et son masque, rien d'autre").toHaveLength(2);
  }
  return { avec, sans };
}

const colonnes3 = [
  { header: "Désignation", width: "40%", align: "left" as const },
  { header: "Catégorie", width: "30%", align: "left" as const },
  { header: "Qté", width: "30%", align: "right" as const },
];
function lignesInventaire(n: number, total = false) {
  const lignes: Cellule[][] = [], sectionRows: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 23 === 0) { sectionRows.push(lignes.length); lignes.push([`Rubrique ${i / 23 + 1} — 1 234,00 $`, "", ""]); continue; }
    lignes.push([`Article numéro ${i}`, i % 3 ? "Épicerie" : "Boissons", i % 5 ? `${i},5` : { texte: `${i},5`, note: "3 colis" }]);
  }
  if (total) lignes.push(["STOCK TOTAL", "", "99 999,00 $"]);
  return { lignes, sectionRows };
}

describe("fusion dédupliquée = fusion sans déduplication (pixels et textes), un seul logo", () => {
  it("TableauDocument : sections, total, lignes colorées", async () => {
    const { lignes, sectionRows } = lignesInventaire(260, true);
    await identique(TableauDocument({
      titre: "Inventaire — septembre 2026", sousTitre: "stock total 99 999,00 $", colonnes: colonnes3, lignes, sectionRows,
      totalDerniereLigne: true, couleurLigne: (r) => (r % 4 === 0 ? "#D6EFDB" : undefined), pied: "Mention de bas de tableau.",
    }));
  }, 240_000);

  it("TableauDocument en paysage ; TablesDocument à deux tableaux", async () => {
    await identique(TableauDocument({ titre: "Planning", sousTitre: "semaine 40", colonnes: colonnes3, lignes: lignesInventaire(190).lignes, paysage: true }));
    await identique(TablesDocument({
      titre: "Rapport — Achats", sousTitre: "du 01 septembre 2026 au 28 septembre 2026",
      tables: [{ sousTitre: "Synthèse par article", colonnes: colonnes3, lignes: lignesInventaire(70).lignes }, { sousTitre: "Achats jour par jour", colonnes: colonnes3, lignes: lignesInventaire(140, true).lignes, totalDerniereLigne: true }],
    }));
  }, 240_000);

  it("ComparaisonDocument (deux parties paysage) et RapportExploitationDocument", async () => {
    const d = lignesExportComparaison(lignesFixture(70), LABELS_FIXTURE);
    await identique(ComparaisonDocument({
      titre: "Comparaison commandé / livré / consommé", sousTitre: "Semaine du 21/9 au 27/9",
      parties: partiesDocumentComparaison(d, partiesPdfComparaison(LABELS_FIXTURE)), pied: PIED_PDF_COMPARAISON,
    }));
    const { visuel } = rapportFixture("MENSUEL", "2026-09-01", "2026-09-30");
    await identique(RapportExploitationDocument({ visuel, entreprise: { enseigne: "Pâtes en Folie" } as never, logo: "public/logo-pates-en-folie.png", presentation: "detaille" }), { logo: "unique" });
  }, 240_000);

  it("fiches d'inventaire (pied propre à chaque fiche)", async () => {
    const articles = (n: number, categorie: string) => Array.from({ length: n }, (_, i) => ({ designation: `${categorie} ${i}`, unite: "kg", categorie: `${categorie} ${Math.floor(i / 20)}`, actif: true }));
    await identique(FichesInventaireDocument({ fiches: [{ espace: "CUISINE", articles: articles(90, "Cuisine") }, { espace: "BAR", articles: articles(70, "Bar") }] }), { logo: false });
  }, 240_000);

  it("livre de paie de 130 salariés (deux catégories + récapitulatif)", async () => {
    const ligne = (i: number, categorie: string) => {
      const brut = 212.47 + ((i * 37.13) % 590);
      return {
        salBrutUSD: brut, cnssSalarieUSD: brut * 0.05, iprCalculeUSD: brut * 0.08, transportUSD: 30.55 + (i % 7) * 4.1, salNetUSD: brut * 0.87 + 30.55,
        hsValorisee: 0, heuresSupp30: 0, heuresSupp60: 0, heuresSupp100: 0, statutPaiement: "VALIDE" as const,
        employee: { matricule: `PEF-${String(i).padStart(3, "0")}`, nom: `Salarié numéro ${i}`, categorie },
      };
    };
    const lignes = [...Array.from({ length: 125 }, (_, i) => ligne(i + 1, "BRIGADE")), ...Array.from({ length: 5 }, (_, i) => ligne(200 + i, "BACKOFFICE"))];
    await identique(LivrePaieDocument({ lignes: lignes as never, taux: 2815.5, periode: "septembre 2026" }));
  }, 240_000);

  const NOMS = ["Francine Luyindula", "Jeannette Bongota", "Martine Mutombo", "Myriam Bumbakini", "Célestine Mbukela", "Dominique Tshiongo", "Zoé Kabasele", "Ghislain Ngoyi"];
  const bulletins = (n: number) => Array.from({ length: n }, (_, i) => ({
    employee: {
      id: `e${i}`, matricule: `PEF-${String(i + 1).padStart(3, "0")}`, nom: NOMS[i % NOMS.length], sexe: "F", poste: "Cuisinière", secteur: "Cuisine", categorie: "BRIGADE", contrat: "CDD", enfants: 0,
      salaireMensuel: 250, dateEmbauche: new Date("2025-01-06"), heuresHebdomadaires: 48, transportJourCDF: 10000,
    } as never,
    ligne: {
      id: `l${i}`, employeeId: `e${i}`, payrollRunId: "r1", statutPaiement: "VALIDE", remuneration100: 264.94, remuneration2_3: 0, remunerationJoursPayesUSD: 0, hsValorisee: 0,
      heuresTravaillees: 208, heuresContractuelles: 208, heuresSupp30: 0, heuresSupp60: 0, heuresSupp100: 0, joursPayes100: 26, joursPayes2_3: 0, joursNonPayes: 0,
      joursPayesNonTravailles: 0, joursCongePris: 0, indemniteCongesUSD: 0, fraisMedicauxUSD: 0, transportUSD: 114.78, primesUSD: 0, avantagesNatureUSD: 0, acompteUSD: 0,
      retenuePretUSD: 0, salBrutUSD: 418.51, cnssSalarieUSD: 15.19, netImposableUSD: 288.54, iprCalculeUSD: 34.83, allocFamilialeUSD: 0, salNetUSD: 368.5, salNetCDF: 368.5 * 2800,
      cnssPatronalUSD: 36.46, inppUSD: 9.11, onemUSD: 0.61, coutEmployeurUSD: 464.69, coutEmployeurCDF: 464.69 * 2800, datePaiement: null, modePaiement: null, payeParId: null,
    } as never,
    run: { id: "r1", mois: 9, annee: 2026, tauxChangeUtilise: 2800, statut: "BROUILLON" } as never,
    congesPeriode: [], feries: [], primes: [], codesParJour: {},
  }));

  for (const devise of ["USD", "CDF"] as const) {
    it(`9 bulletins ${devise} (4 lots + 1 page)`, async () => {
      await identique(BulletinsDocument({ bulletins: bulletins(9), devise }));
    }, 240_000);
  }
});

describe("deux images différentes ne sont jamais fusionnées", () => {
  /** PNG RGBA 60×60 : `couleur` unie ; `alpha(x, y)` donne la transparence de chaque pixel. */
  async function png(couleur: string, alpha: (x: number, y: number) => number): Promise<Buffer> {
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(60, 60);
    const ctx = canvas.getContext("2d");
    const donnees = ctx.createImageData(60, 60);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16));
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) donnees.data.set([r, g, b, alpha(x, y)], (y * 60 + x) * 4);
    ctx.putImageData(donnees, 0, 0);
    return canvas.toBuffer("image/png");
  }
  const page = (i: number, data: Buffer, format: "png" | "jpg") => createElement(Page, { key: i, size: "A5" }, createElement(Image, { src: { data, format } as never, style: { width: 120, height: 120 } }));
  /** Un plan de pages indépendantes : `images[i]` est le logo de la page i. */
  function planDesImages(images: { data: Buffer; format: "png" | "jpg" }[]): PlanLots {
    const lot = (de: number, a: number) => createElement(Document, null, images.slice(de, a).map((im, i) => page(de + i, im.data, im.format))) as ReactElement<DocumentProps>;
    return { mode: "lots", pages: images.length, lot };
  }

  it("même logo : un seul exemplaire ; logos qui ne diffèrent que par la couleur, que par le masque, ou de format : tous conservés", async () => {
    const rouge = await png("#cc2222", (x) => 255 - x * 3);
    const rougeCopie = await png("#cc2222", (x) => 255 - x * 3); // octet pour octet le même logo, encodé à part
    const bleu = await png("#2222cc", (x) => 255 - x * 3); // mêmes dimensions, même masque, autre couleur
    const rougeMasqueAutre = await png("#cc2222", (x) => (x < 30 ? 0 : 255)); // même couleur, MASQUE différent
    const rougeUnPixel = await png("#cc2222", (x, y) => (x === 7 && y === 9 ? 254 : 255 - x * 3)); // un seul pixel de masque change
    const jpg = fs.readFileSync(path.join(process.cwd(), "public/logo-tolya.jpg"));
    const images = [
      { data: rouge, format: "png" as const }, { data: rougeCopie, format: "png" as const }, // lot 1 : deux fois le même logo
      { data: bleu, format: "png" as const }, { data: rougeMasqueAutre, format: "png" as const }, // lot 2
      { data: rougeUnPixel, format: "png" as const }, { data: jpg, format: "jpg" as const }, // lot 3
      { data: rouge, format: "png" as const }, // lot 4 : le premier logo revient
    ];
    const plan = planDesImages(images);
    const avec = await rendreParLots(plan, renderPdfBrut, 2);
    const sans = await rendreParLots(plan, renderPdfBrut, 2, { dedupliquer: false });
    expect((await imagesDuPdf(sans)).length, "avant : des exemplaires en double (un logo et son masque par lot)").toBeGreaterThan(9);

    const a = await imagesDuPdf(avec);
    // 4 PNG distincts (rouge, bleu, rouge à autre masque, rouge à un pixel de masque différent), chacun conservé. Leurs masques :
    // le rouge et le bleu ont EXACTEMENT le même masque (même transparence, autre couleur), qui est légitimement partagé ; les deux
    // autres ont chacun le leur : 3 masques. Plus le JPEG, sans masque.
    expect(a.filter((i) => i.aMasque), "4 logos PNG distincts").toHaveLength(4);
    expect(a.filter((i) => !i.aMasque).length, "3 masques + 1 JPEG").toBe(4);
    expect(a).toHaveLength(8);

    // Et chaque page montre SON logo : identique à la fusion sans déduplication...
    pixelsEgauxA0(await pixelsDifferentsParPage(avec, sans));
    // ... et différente d'un document où toutes les pages auraient le premier logo (la couleur, le masque, le format comptent).
    const tousRouges = await rendreParLots(planDesImages(images.map(() => images[0])), renderPdfBrut, 2);
    const ecarts = await pixelsDifferentsParPage(avec, tousRouges);
    expect(ecarts[0], "page 1 : le même logo").toBe(0);
    expect(ecarts[1], "page 2 : le même logo, copie").toBe(0);
    expect(ecarts[2], "page 3 : bleu").toBeGreaterThan(100);
    expect(ecarts[3], "page 4 : autre masque").toBeGreaterThan(100);
    expect(ecarts[5], "page 6 : JPEG").toBeGreaterThan(100);
    expect(ecarts[6], "page 7 : le premier logo est revenu").toBe(0);
  }, 240_000);

  function pixelsEgauxA0(pages: number[]) {
    pages.forEach((n, i) => expect(n, `pixels différents, page ${i + 1}`).toBe(0));
  }
});

describe("dedupliquerObjets : unité", () => {
  it("un document sans doublon n'est pas touché", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(dedupliquerObjets(doc)).toMatchObject({ supprimes: 0, octetsEconomises: 0 });
  });

  it("deux copies d'un même flux image intégrées à part ne font plus qu'un, les références des pages suivent", async () => {
    const octets = fs.readFileSync(path.join(process.cwd(), "public/logo-pates-en-folie.png"));
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) {
      const image = await doc.embedPng(octets); // trois objets distincts, trois masques
      doc.addPage([200, 100]).drawImage(image, { x: 0, y: 0, width: 100, height: 40 });
    }
    expect((await imagesDuPdf(Buffer.from(await doc.save()))).length).toBe(6);
    const bilan = dedupliquerObjets(doc);
    expect(bilan.supprimes).toBe(4);
    const apres = Buffer.from(await doc.save({ useObjectStreams: false }));
    expect(await imagesDuPdf(apres)).toHaveLength(2);
    const lu = await PDFDocument.load(apres);
    expect(lu.getPageCount()).toBe(3);
  });
});
