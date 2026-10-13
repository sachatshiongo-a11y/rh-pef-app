import { describe, it, expect } from "vitest";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { renderPdfBuffer, renderPdfBrut } from "./fonts";
import { TableauDocument, TablesDocument, TableauxParPartieDocument, type Cellule } from "./tableau";
import { ComparaisonDocument } from "./comparaison";
import { RapportExploitationDocument } from "./rapport-exploitation";
import { FicheComptageDocument } from "./fiche-comptage";
import { FichesInventaireDocument } from "./fiche-inventaire-resto";
import { BulletinsDocument } from "./bulletin";
import { planDe, SEUIL_PLACES_BLOCS, PAGES_PAR_LOT } from "./blocs";
import { lignesExportComparaison, partiesPdfComparaison } from "@/lib/journalier-restaurant";
import { PIED_PDF_COMPARAISON, partiesDocumentComparaison } from "@/lib/journalier-comparaison-export";
import { LABELS_FIXTURE, lignesFixture } from "@/app/(stock)/stock/journalier/comparaison.fixture";
import { rapportFixture } from "@/lib/exploitation/__fixtures__/mois-charge";
import { pagesDuPdf, pixelsDifferentsParPage, policesDeRepli, textesPoses } from "@/lib/test/pdf-lecture";

/**
 * RENDU PAR BLOCS (13/10/2026) : un PDF long est rendu par fenêtres d'une centaine de lignes puis réuni, au lieu d'un
 * seul bloc dont le coût croît comme le carré du nombre de lignes (voir `blocs.tsx`). Ces tests prouvent que le
 * découpage ne se voit PAS : même nombre de pages, même texte au même endroit sur chaque page (position à 0,1 pt près,
 * « Page x sur y » compris) que le rendu d'un seul tenant du même document.
 */

const arrondi = (n: number) => Math.round(n * 10) / 10;
/** Empreinte d'un PDF : chaque texte avec sa page et sa position. */
async function empreinte(pdf: Buffer): Promise<string[]> {
  return (await textesPoses(pdf)).map((t) => `p${t.page} ${t.texte} @${arrondi(t.x)},${arrondi(t.y)} ${arrondi(t.taille)}pt`);
}

/** Rend `doc` par blocs ET d'un seul tenant ; vérifie que le plan découpe bien (sinon le test ne prouverait rien). */
async function comparer(doc: ReactElement<DocumentProps>, placesMin = SEUIL_PLACES_BLOCS + 1) {
  const plan = planDe(doc);
  expect(plan?.mode).toBe("fenetres");
  expect(plan!.mode === "fenetres" && plan!.places, "le document est assez long pour être découpé").toBeGreaterThanOrEqual(placesMin);
  const par = await renderPdfBuffer(doc); // par blocs
  const seul = await renderPdfBrut(doc); // d'un seul tenant : la référence
  const [a, b] = [await empreinte(par), await empreinte(seul)];
  expect((await pagesDuPdf(par)).length, "nombre de pages").toBe((await pagesDuPdf(seul)).length);
  expect(a.length, "nombre de textes posés").toBe(b.length);
  const ecarts = a.flatMap((x, i) => (x === b[i] ? [] : [`${x}  <>  ${b[i]}`])).slice(0, 5);
  expect(ecarts).toEqual([]);
  // Et le DESSIN : traits, fonds, marges (que la position du texte ne dit pas). Quelques pixels de lissage du pied de page,
  // superposé au lieu d'être dessiné en place, sont normaux ; un trait de tête en trop ou en moins en fait des centaines.
  const pixels = await pixelsDifferentsParPage(par, seul);
  pixels.forEach((n, i) => expect(n, `pixels différents, page ${i + 1}`).toBeLessThan(60));
  return { par, seul };
}

const colonnes3 = [
  { header: "Désignation", width: "40%", align: "left" as const },
  { header: "Catégorie", width: "30%", align: "left" as const },
  { header: "Qté", width: "30%", align: "right" as const },
];
/** Lignes d'un inventaire : une ligne-titre toutes les 23 lignes, des notes dans une cellule sur cinq. */
function lignesInventaire(n: number, total = false) {
  const lignes: Cellule[][] = [], sectionRows: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 23 === 0) { sectionRows.push(lignes.length); lignes.push([`Rubrique ${i / 23 + 1} — 1 234,00 $`, "", ""]); continue; }
    lignes.push([`Article numéro ${i}`, i % 3 ? "Épicerie" : "Boissons", i % 5 ? `${i},5` : { texte: `${i},5`, note: "3 colis" }]);
  }
  if (total) lignes.push(["STOCK TOTAL", "", "99 999,00 $"]);
  return { lignes, sectionRows };
}

describe("fidélité : par blocs = d'un seul tenant (mêmes pages, mêmes textes aux mêmes places)", () => {
  it("TableauDocument : sections, total en fin, lignes colorées, pied", async () => {
    const { lignes, sectionRows } = lignesInventaire(260, true);
    const { par } = await comparer(TableauDocument({
      titre: "Inventaire — septembre 2026", sousTitre: "stock total 99 999,00 $", colonnes: colonnes3, lignes, sectionRows,
      totalDerniereLigne: true, couleurLigne: (r) => (r % 4 === 0 ? "#D6EFDB" : undefined), couleurCellule: (r, c) => (c === 2 && r % 7 === 0 ? "#b42318" : undefined),
      pied: "Mention de bas de tableau.",
    }));
    expect(policesDeRepli(par)).toEqual([]);
  }, 180_000);

  it("TableauDocument en paysage", async () => {
    const { lignes } = lignesInventaire(190);
    await comparer(TableauDocument({ titre: "Planning", sousTitre: "semaine 40", colonnes: colonnes3, lignes, paysage: true }));
  }, 180_000);

  it("TablesDocument : plusieurs tableaux titrés sur une même page", async () => {
    const t1 = lignesInventaire(70).lignes, t2 = lignesInventaire(140, true).lignes;
    await comparer(TablesDocument({
      titre: "Rapport — Achats", sousTitre: "du 01 septembre 2026 au 28 septembre 2026",
      tables: [{ sousTitre: "Synthèse par article", colonnes: colonnes3, lignes: t1 }, { sousTitre: "Achats jour par jour", colonnes: colonnes3, lignes: t2, totalDerniereLigne: true }],
    }));
  }, 180_000);

  it("TableauxParPartieDocument : parties datées (titre répété), non datées, pied sur la dernière", async () => {
    const a = lignesInventaire(120), b = lignesInventaire(60), c = lignesInventaire(30, true);
    await comparer(TableauxParPartieDocument({
      titre: "Commande journalière", sousTitre: "semaine 40",
      parties: [
        { titre: "Cuisine", sousTitre: "Date : 29/09/2026", colonnes: colonnes3, lignes: a.lignes, sectionRows: a.sectionRows },
        { titre: "Bar", colonnes: colonnes3, lignes: b.lignes, sectionRows: b.sectionRows },
        { titre: "Récapitulatif", colonnes: colonnes3, lignes: c.lignes, totalDerniereLigne: true },
      ],
      pied: "Sorties sans motif, non comptées comme livrées.",
    }));
  }, 180_000);

  it("ComparaisonDocument : deux parties paysage, en-tête à deux niveaux répété", async () => {
    const d = lignesExportComparaison(lignesFixture(70), LABELS_FIXTURE);
    await comparer(ComparaisonDocument({
      titre: "Comparaison commandé / livré / consommé", sousTitre: "Semaine du 21/9 au 27/9",
      parties: partiesDocumentComparaison(d, partiesPdfComparaison(LABELS_FIXTURE)), pied: PIED_PDF_COMPARAISON,
    }));
  }, 180_000);

  for (const presentation of ["detaille", "liste"] as const) {
    it(`RapportExploitationDocument (${presentation}) : cartes en tête, tableaux Recettes et Dépenses, pied « page x sur y »`, async () => {
      const { visuel } = rapportFixture("MENSUEL", "2026-09-01", "2026-09-30");
      await comparer(RapportExploitationDocument({ visuel, entreprise: { enseigne: "Pâtes en Folie" } as never, logo: "public/logo-pates-en-folie.png", presentation }));
    }, 180_000);
  }

  it("fiches à remplir : fiche de comptage, puis fiches d'inventaire Cuisine et Bar (pied propre à chaque fiche)", async () => {
    const rangees = Array.from({ length: 150 }, (_, i): { rubrique: string } | { cellules: string[] } => (i % 25 === 0 ? { rubrique: `Catégorie ${i / 25 + 1}` } : { cellules: [`Article ${i}`, "kg", "A", `${i},5`, "", ""] }));
    await comparer(FicheComptageDocument({ titre: "Fiche de comptage — Nourriture", sousTitre: "13 octobre 2026", rangees }));
    const articles = (n: number, categorie: string) => Array.from({ length: n }, (_, i) => ({ designation: `${categorie} ${i}`, unite: "kg", categorie: `${categorie} ${Math.floor(i / 20)}`, actif: true }));
    const { par } = await comparer(FichesInventaireDocument({ fiches: [{ espace: "CUISINE", articles: articles(90, "Cuisine") }, { espace: "BAR", articles: articles(70, "Bar") }] }));
    // Le pied de chaque page est celui de SA fiche, et la numérotation court sur tout le document.
    const textes = await textesPoses(par);
    const nb = new Set(textes.map((t) => t.page)).size;
    expect(textes.filter((t) => /^Page \d+ sur \d+$/.test(t.texte))).toHaveLength(nb);
    const pieds = textes.filter((t) => /^Fiche d'inventaire (Cuisine|Bar Boissons)$/.test(t.texte) && t.taille < 7).map((t) => t.texte);
    expect(pieds).toHaveLength(nb);
    expect(pieds[0]).toBe("Fiche d'inventaire Cuisine");
    expect(pieds[nb - 1]).toBe("Fiche d'inventaire Bar Boissons");
  }, 180_000);
});

describe("tableau long par blocs : contenu, totaux en fin, « Page x sur y »", () => {
  it("350 lignes : PDF valide, lignes du milieu et dernière extraites, total en fin, pages numérotées exactement", async () => {
    const { lignes, sectionRows } = lignesInventaire(349, true);
    const pdf = await renderPdfBuffer(TableauDocument({ titre: "Inventaire", sousTitre: "Mesure", colonnes: colonnes3, lignes, sectionRows, totalDerniereLigne: true }));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = await pagesDuPdf(pdf);
    const n = pages.length;
    expect(n).toBeGreaterThanOrEqual(8);

    // Toutes les lignes sont là, une seule fois (les jonctions n'en perdent ni n'en dupliquent), dont celle du milieu et la dernière.
    const textes = await textesPoses(pdf);
    for (const i of [1, 2, 99, 100, 101, 174, 175, 176, 250, 347, 348]) {
      if (i % 23 === 0) continue;
      expect(textes.filter((t) => t.texte === `Article numéro ${i}`), `ligne ${i}`).toHaveLength(1);
    }
    expect(textes.filter((t) => /^Article numéro \d+$/.test(t.texte))).toHaveLength(349 - sectionRows.length);
    expect(textes.filter((t) => /^Rubrique \d+/.test(t.texte))).toHaveLength(sectionRows.length);

    // Le total est à la fin du tableau : dernière page, sous toutes les lignes.
    const total = textes.filter((t) => t.texte === "STOCK TOTAL");
    expect(total).toHaveLength(1);
    expect(total[0].page).toBe(n);
    const derniereLigne = textes.filter((t) => t.page === n && /^Article numéro/.test(t.texte)).sort((a, b) => b.y - a.y)[0];
    expect(total[0].y).toBeGreaterThan(derniereLigne.y);

    // « Page x sur y » exact : chaque page porte son numéro et le total réel.
    pages.forEach((p, i) => expect(p.plat, `page ${i + 1}`).toContain(`Page ${i + 1} sur ${n}`));
    // En-tête de colonnes répété sur chaque page, aucune police de repli.
    pages.forEach((p, i) => expect(p.plat, `page ${i + 1}`).toContain("DÉSIGNATION"));
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 180_000);

  it("un document court (≤ seuil) n'est pas découpé : rendu d'un seul tenant", async () => {
    const doc = TableauDocument({ titre: "T", sousTitre: "S", colonnes: colonnes3, lignes: lignesInventaire(60).lignes });
    const plan = planDe(doc);
    expect(plan?.mode === "fenetres" && plan.places).toBeLessThanOrEqual(SEUIL_PLACES_BLOCS);
    const pdf = await renderPdfBuffer(doc);
    expect(await empreinte(pdf)).toEqual(await empreinte(await renderPdfBrut(doc)));
  }, 60_000);
});

describe("la boucle d'événements respire entre deux blocs", () => {
  /** Plus long retard de la boucle d'événements pendant `rendu`, en ms. */
  async function blocageMax(rendu: () => Promise<unknown>): Promise<number> {
    const h = monitorEventLoopDelay({ resolution: 5 });
    h.enable();
    await rendu();
    h.disable();
    return h.max / 1e6;
  }

  it("500 lignes : le plus long blocage par blocs est une fraction de celui d'un seul tenant", async () => {
    const { lignes, sectionRows } = lignesInventaire(500);
    const doc = TableauDocument({ titre: "Inventaire", sousTitre: "Mesure", colonnes: colonnes3, lignes, sectionRows });
    await renderPdfBuffer(TableauDocument({ titre: "e", sousTitre: "e", colonnes: colonnes3, lignes: [["a", "b", "1"]] })); // polices chargées : on mesure le rendu, pas le démarrage
    const parBlocs = await blocageMax(() => renderPdfBuffer(doc));
    const unSeulTenant = await blocageMax(() => renderPdfBrut(doc));
    // Seuil RELATIF (la machine de test est parfois très chargée : les deux mesures gonflent ensemble) et absolu généreux.
    expect(parBlocs, `par blocs ${Math.round(parBlocs)} ms, d'un seul tenant ${Math.round(unSeulTenant)} ms`).toBeLessThan(unSeulTenant / 3);
    expect(parBlocs).toBeLessThan(5000);
  }, 180_000);
});

describe("bulletins groupés : rendus par lots, réunis dans l'ordre", () => {
  const employe = (i: number) => ({
    id: `e${i}`, matricule: `PEF-${String(i).padStart(3, "0")}`, nom: `Employé ${String(i).padStart(2, "0")}`, sexe: "F", poste: "Cuisinière", secteur: "Cuisine",
    categorie: "BRIGADE", contrat: "CDD", enfants: 0, salaireMensuel: 250, dateEmbauche: new Date("2025-01-06"), heuresHebdomadaires: 48, transportJourCDF: 10000,
  });
  const ligne = (i: number) => ({
    id: `l${i}`, employeeId: `e${i}`, payrollRunId: "r1", statutPaiement: "VALIDE", remuneration100: 264.94, remuneration2_3: 0, remunerationJoursPayesUSD: 0, hsValorisee: 0,
    heuresTravaillees: 208, heuresContractuelles: 208, heuresSupp30: 0, heuresSupp60: 0, heuresSupp100: 0, joursPayes100: 26, joursPayes2_3: 0, joursNonPayes: 0,
    joursPayesNonTravailles: 0, joursCongePris: 0, indemniteCongesUSD: 0, fraisMedicauxUSD: 0, transportUSD: 114.78, primesUSD: 0, avantagesNatureUSD: 0, acompteUSD: 0,
    retenuePretUSD: 0, salBrutUSD: 418.51, cnssSalarieUSD: 15.19, netImposableUSD: 288.54, iprCalculeUSD: 34.83, allocFamilialeUSD: 0, salNetUSD: 368.5, salNetCDF: 368.5 * 2800,
    cnssPatronalUSD: 36.46, inppUSD: 9.11, onemUSD: 0.61, coutEmployeurUSD: 464.69, coutEmployeurCDF: 464.69 * 2800, datePaiement: null, modePaiement: null, payeParId: null,
  });
  const run = { id: "r1", mois: 9, annee: 2026, tauxChangeUtilise: 2800, statut: "BROUILLON" };
  const bulletins = (n: number) => Array.from({ length: n }, (_, i) => ({ employee: employe(i + 1) as never, ligne: ligne(i + 1) as never, run: run as never, congesPeriode: [], feries: [], primes: [], codesParJour: {} }));

  it(`${PAGES_PAR_LOT * 2 + 3} bulletins : une page chacun, dans l'ordre, aucune perte aux jonctions des lots`, async () => {
    const n = PAGES_PAR_LOT * 2 + 3;
    const doc = BulletinsDocument({ bulletins: bulletins(n), devise: "USD" });
    expect(planDe(doc)).toMatchObject({ mode: "lots", pages: n });
    const pdf = await renderPdfBuffer(doc);
    const pages = await pagesDuPdf(pdf);
    expect(pages).toHaveLength(n);
    pages.forEach((p, i) => {
      expect(p.plat, `page ${i + 1}`).toContain(`Employé ${String(i + 1).padStart(2, "0")}`);
      expect(p.plat, `page ${i + 1}`).toMatch(/SALAIRE NET\s*253,72 \$/);
    });
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 180_000);

  it("peu de bulletins (≤ un lot) : rendu d'un seul tenant, identique", async () => {
    const doc = BulletinsDocument({ bulletins: bulletins(PAGES_PAR_LOT), devise: "USD" });
    expect(await empreinte(await renderPdfBuffer(doc))).toEqual(await empreinte(await renderPdfBrut(doc)));
  }, 60_000);
});
