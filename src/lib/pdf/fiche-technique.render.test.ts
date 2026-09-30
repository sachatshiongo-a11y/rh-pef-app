import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { arrondirCentime, calculerCout } from "@/lib/fiches/cout";
import { formaterUSD, montantSigne } from "@/lib/montant";
import { construireContexte, type ArticleOption, type FicheVue, type LigneFiche } from "@/app/(stock)/stock/fiches/_data/fiche-calc";
import { versFichePdf } from "@/app/(stock)/stock/fiches/_data/fiche-pdf";
import { ecartMinimalEntreRangees, pagesDuPdf, policesDeRepli, textesPoses } from "@/lib/test/pdf-lecture";
import { renderPdfBuffer } from "./fonts";
import { FichesTechniquesDocument, type PhotoPdf } from "./fiche-technique";

/**
 * Fiche technique en PDF (demande de la Direction, 2026-09-30 : « il faut que les fiches soient
 * exportables en pdf »). Les tests RENDENT le document et relisent le texte posé : nom, ingrédients,
 * totaux identiques au moteur, variante « sans prix » sans aucun montant, fiche longue sur deux pages
 * avec en-tête de tableau répété, coût incomplet qualifié, photo présente ou absente.
 */

const art = (id: string, designation: string, unite: string, prix: string | null, contenance?: [string, string]): ArticleOption => ({
  id, designation, unite, prixUnitaireUSD: prix, actif: true,
  contenance: contenance?.[0] ?? null, contenanceUnite: contenance?.[1] ?? null,
});
const ligne = (i: number, articleId: string | null, unite: string, quantite: string, sousFicheId: string | null = null): LigneFiche => ({
  id: `l${i}`, articleId, sousFicheId, unite, quantite, ordre: i,
});
const fiche = (p: Partial<FicheVue> & { id: string; nom: string }): FicheVue => ({
  categorie: "", type: "PLAT", nbPortions: 1, tauxTVA: "0.16", prixVenteTTC: "",
  coefficientMargeCible: "", estSousRecette: false, rendementQuantite: "", rendementUnite: "",
  recette: "", actif: true, photoUrl: null, lignes: [], ...p,
});

const ARTICLES: ArticleOption[] = [
  art("rhum", "Rhum blanc Havana 3 ans", "Bouteille", "14", ["70", "cl"]),
  art("sirop", "Sirop de sucre de canne", "L", "4"),
  art("citron", "Citron vert", "pièce", "0.5"),
  art("menthe", "Menthe fraîche", "botte", "1.2"),
  art("eau", "Eau gazeuse", "L", "1.5"),
  art("safran", "Safran", "g", null), // aucun prix au catalogue : coût partiel
  ...Array.from({ length: 22 }, (_, i) => art(`p${i}`, `Produit de cuisine n°${i + 1}`, "kg", String(2 + i))),
];

const MOJITO = fiche({
  id: "mojito", nom: "Mojito", type: "BAR", categorie: "Cocktail", prixVenteTTC: "12", photoUrl: "/fichiers/fiches-techniques/mojito.jpg",
  recette: "Verre : Tumbler\nMode : Direct au verre\n\nPiler la menthe avec le citron et le sirop.\nAjouter le rhum, la glace pilée, puis l'eau gazeuse.",
  lignes: [ligne(1, "rhum", "cl", "5"), ligne(2, "sirop", "cl", "2"), ligne(3, "citron", "pièce", "0.5"), ligne(4, "menthe", "botte", "0.25"), ligne(5, "eau", "cl", "10")],
});
const RISOTTO = fiche({
  id: "risotto", nom: "Risotto au safran", categorie: "Plats", nbPortions: 4, coefficientMargeCible: "4",
  lignes: [ligne(1, "p0", "g", "320"), ligne(2, "safran", "g", "0.5")],
});
const VIDE = fiche({ id: "vide", nom: "Lasagne", categorie: "Four", prixVenteTTC: "15" });
const LONG = fiche({
  id: "long", nom: "Couscous royal", categorie: "Plats du jour", nbPortions: 10, prixVenteTTC: "25",
  lignes: Array.from({ length: 22 }, (_, i) => ligne(i + 1, `p${i}`, "g", String(100 + 10 * i))),
  recette: Array.from({ length: 45 }, (_, i) => `Étape ${i + 1} : une consigne de préparation assez longue pour occuper une vraie ligne de la fiche technique.`).join("\n"),
});
const VUES = [MOJITO, RISOTTO, VIDE, LONG];
const mapArticles = new Map(ARTICLES.map((a) => [a.id, a]));
const CTX = { contexte: construireContexte(VUES, mapArticles), articles: mapArticles, noms: new Map(VUES.map((v) => [v.id, { nom: v.nom }])) };
const moteur = (v: FicheVue) => calculerCout(CTX.contexte.fiches.get(v.id)!, CTX.contexte);

let PHOTO: PhotoPdf;
beforeAll(async () => {
  PHOTO = { data: await sharp({ create: { width: 300, height: 450, channels: 3, background: "#3a7d44" } }).jpeg().toBuffer(), format: "jpg" };
});

const rendre = (vues: FicheVue[], avecPrix: boolean, photos: Record<string, PhotoPdf> = {}) =>
  renderPdfBuffer(FichesTechniquesDocument({
    fiches: vues.map((v) => versFichePdf(v, CTX, { avecPrix, photo: photos[v.id] ?? null })),
    editeLe: "30/09/2026",
  }));
const texte = async (pdf: Buffer) => (await pagesDuPdf(pdf)).map((p) => p.plat).join(" ");
/**
 * Nombre de PHOTOS du PDF : images JPEG (`/DCTDecode`). Le logo de l'en-tête est un PNG (et son
 * masque de transparence) : il n'est pas compté.
 */
const nbImages = (pdf: Buffer) =>
  new Set([...pdf.toString("latin1").matchAll(/(\d+) 0 obj\s*<<[^>]*\/Subtype\s*\/Image[^>]*>>/g)].filter((m) => m[0].includes("/DCTDecode")).map((m) => m[1])).size;

describe("fiche technique chiffrée", () => {
  it("fiche du bar : identité, ingrédients, technique, date — et les totaux du MOTEUR", async () => {
    const pdf = await rendre([MOJITO], true, { mojito: PHOTO });
    const t = await texte(pdf);
    expect(t).toContain("Mojito");
    expect(t).toContain("Bar · Cocktail");
    expect(t).toContain("Nombre de verres : 1");
    for (const nom of ["Rhum blanc Havana 3 ans", "Sirop de sucre de canne", "Citron vert", "Menthe fraîche", "Eau gazeuse"]) expect(t).toContain(nom);
    expect(t).toContain("Verre : Tumbler");
    expect(t).toContain("Mode : Direct au verre");
    expect(t).toContain("Ajouter le rhum");
    expect(t).toContain("éditée le 30/09/2026");

    // Chiffres : ceux du moteur, au centime près — et, vérifiés à la main, ceux du classeur.
    const r = moteur(MOJITO);
    expect(r.incomplet).toBe(false);
    expect(arrondirCentime(r.coutTotal)).toBe(1.78); // 1,00 + 0,08 + 0,25 + 0,30 + 0,15
    for (const n of [arrondirCentime(r.coutTotal), arrondirCentime(r.coutParPortion), r.prixVenteHT!, r.prixVenteTTC!, r.margeBrute!]) {
      expect(t).toContain(formaterUSD(n));
    }
    expect(t).toContain("10,34 $"); // 12 TTC ÷ 1,16
    expect(t).toContain("8,56 $"); // marge brute
    expect(t).toContain("14,00 $ / Bouteille"); // prix d'achat au catalogue
    expect(t).toContain("Taux de TVA 16 %");
    expect(t).toContain("× 5,81"); // coefficient : 10,3448 HT ÷ 1,78 de coût
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);

  it("coût incomplet : « ≥ », « coût partiel », motif nommé, prix qualifiés — jamais un 0", async () => {
    const t = await texte(await rendre([RISOTTO], true));
    const r = moteur(RISOTTO);
    expect(r.incomplet).toBe(true);
    expect(t).toContain(`≥ ${formaterUSD(arrondirCentime(r.coutTotal))} (coût partiel)`);
    expect(t).toContain("Coût total HT (partiel)");
    expect(t).toContain("non valorisé : Aucun prix d'achat au catalogue");
    expect(t).toContain("Coût partiel : 1 ingrédient(s) au coût indéterminé");
    expect(t).toContain("Prix de vente HT (conseillé, sur coût partiel)");
    expect(t).toContain("ils ne sont pas fiables");
    expect(t).toContain(`≥ ${formaterUSD(r.prixConseille!.ht)} HT`);
    expect(t).toContain("c'est un plancher");
  }, 60_000);

  it("sous-recette partielle : ligne « ≥ », chemin « Sauce › Safran », sous-recette sans bloc prix", async () => {
    const sauce = fiche({
      id: "sauce", nom: "Sauce safranée", categorie: "Bases", estSousRecette: true, rendementQuantite: "1000", rendementUnite: "g",
      lignes: [ligne(1, "p0", "g", "300"), ligne(2, "safran", "g", "1")],
    });
    const plat = fiche({ id: "plat", nom: "Tagliatelles safranées", categorie: "Pâtes", prixVenteTTC: "18", lignes: [ligne(1, "p1", "g", "150"), ligne(2, null, "g", "200", "sauce")] });
    const vues = [sauce, plat];
    const ctx = { ...CTX, contexte: construireContexte(vues, mapArticles), noms: new Map(vues.map((v) => [v.id, { nom: v.nom }])) };
    const r = calculerCout(ctx.contexte.fiches.get("plat")!, ctx.contexte);
    expect(r.lignes[1].partiel).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Sauce safranée › Safran"]);
    const pdf = await renderPdfBuffer(FichesTechniquesDocument({ fiches: vues.map((v) => versFichePdf(v, ctx, { avecPrix: true, photo: null })), editeLe: "30/09/2026" }));
    const pages = await pagesDuPdf(pdf);
    const [pSauce, pPlat] = [pages[0].plat, pages[1].plat];
    // Le plat : ligne de sous-recette minorée, chemin nommé, total minoré — chiffres du moteur.
    expect(pPlat).toContain(`sous-recette ≥ ${formaterUSD(arrondirCentime(r.lignes[1].cout!))}`);
    expect(pPlat).toContain("Sauce safranée › Safran");
    expect(pPlat).toContain(`≥ ${formaterUSD(arrondirCentime(r.coutTotal))} (coût partiel)`);
    // La sous-recette : rendement, coût partiel, et PAS de bloc prix (elle n'a pas de prix de vente).
    expect(pSauce).toContain("Plat · Bases · Sous-recette");
    expect(pSauce).toContain("Rendement : 1 000 g");
    expect(pSauce).toContain("non valorisé : Aucun prix d'achat au catalogue");
    expect(pSauce).not.toContain("PRIX DE VENTE ET MARGE");
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);

  it("fiche sans ingrédient : coût inconnu, « — », jamais 0,00 $", async () => {
    const t = await texte(await rendre([VIDE], true));
    expect(t).toContain("— (coût inconnu)");
    expect(t).toContain("Aucun ingrédient saisi : cette fiche n'a pas de coût connu");
    expect(t).toContain("Prix de vente HT (sur coût inconnu)");
    expect(t).not.toContain("0,00 $");
  }, 60_000);

  it("prix d'achat du catalogue : à 0 → « — » (jamais « 0,00 $ ») ; sous 1 $ → sans arrondi au centime", async () => {
    const arts = new Map<string, ArticleOption>([
      ["zero", art("zero", "Feuille de menthe", "unité", "0")],
      ["cl", art("cl", "Soda au centilitre", "cl", "0.0153")],
    ]);
    const v = fiche({ id: "pc", nom: "Prix catalogue", type: "BAR", categorie: "Mocktail", lignes: [ligne(1, "zero", "unité", "8"), ligne(2, "cl", "cl", "15")] });
    const ctx = { contexte: construireContexte([v], arts), articles: arts, noms: new Map([["pc", { nom: v.nom }]]) };
    const t = await texte(await renderPdfBuffer(FichesTechniquesDocument({ fiches: [versFichePdf(v, ctx, { avecPrix: true, photo: null })], editeLe: "30/09/2026" })));
    expect(t).not.toContain("0,00 $");
    expect(t).toContain("non valorisé : Prix à 0 au catalogue");
    expect(t).toContain("0,0153 $ / cl");
    expect(t).toContain("0,23 $"); // 15 × 0,0153 = 0,2295, arrondi UNE fois par le moteur
  }, 60_000);

  it("une marge négative s'écrit entre parenthèses, jamais avec « − »", async () => {
    const perte = fiche({ id: "perte", nom: "Plat à perte", prixVenteTTC: "1.16", lignes: [ligne(1, "p5", "kg", "1")] }); // coût 7 $, HT 1 $
    const ctx = { ...CTX, contexte: construireContexte([perte], mapArticles), noms: new Map([["perte", { nom: "Plat à perte" }]]) };
    const pdf = await renderPdfBuffer(FichesTechniquesDocument({ fiches: [versFichePdf(perte, ctx, { avecPrix: true, photo: null })], editeLe: "30/09/2026" }));
    const t = await texte(pdf);
    expect(t).toContain(montantSigne(-6, "USD").texte); // « (6,00 $) »
    expect(t).not.toContain("−");
  }, 60_000);
});

describe("fiche technique « sans prix » (au poste)", () => {
  it("aucun montant, aucune marge, aucun coût — mais les quantités, la photo et la technique", async () => {
    const pdf = await rendre([MOJITO, RISOTTO, VIDE, LONG], false, { mojito: PHOTO });
    const t = await texte(pdf);
    // La seule occurrence admise du mot « prix » est la mention qui annonce la version.
    const horsMention = t.replaceAll("sans prix", "");
    for (const interdit of ["$", "USD", "Coût", "coût", "Prix", "prix", "Marge", "marge", "TVA", "Coefficient", "marque", "Ratio", "valoris"]) {
      expect(horsMention, interdit).not.toContain(interdit);
    }
    // Aucun montant du moteur ne s'y glisse, même sans son symbole.
    for (const v of [MOJITO, RISOTTO, LONG]) {
      const r = moteur(v);
      for (const n of [arrondirCentime(r.coutTotal), r.prixVenteHT, r.prixVenteTTC]) {
        if (n !== null && n >= 1) expect(t).not.toContain(formaterUSD(n).replace(" $", ""));
      }
    }
    expect(t).toContain("Rhum blanc Havana 3 ans");
    expect(t).toContain("0,5"); // quantité de citron
    expect(t).toContain("Version poste, sans prix");
    expect(t).toContain("Verre : Tumbler");
    expect(nbImages(pdf)).toBe(1); // la photo du mojito
  }, 60_000);
});

describe("mise en page", () => {
  it("une fiche par page : chaque fiche commence sur une nouvelle page", async () => {
    const pdf = await rendre([MOJITO, RISOTTO, VIDE], true);
    const pages = await pagesDuPdf(pdf);
    expect(pages).toHaveLength(3);
    expect(pages[0].plat).toContain("Mojito");
    expect(pages[1].plat).toContain("Risotto au safran");
    expect(pages[2].plat).toContain("Lasagne");
    expect(pages[1].plat).not.toContain("Mojito");
  }, 60_000);

  it("tableau plus haut qu'une page (45 ingrédients) : il se découpe, en-tête répété sur la page de suite", async () => {
    const tresLong = { ...LONG, id: "tres-long", lignes: Array.from({ length: 45 }, (_, i) => ligne(i + 1, `p${i % 22}`, "g", String(100 + i))) };
    const ctx = { ...CTX, contexte: construireContexte([tresLong], mapArticles), noms: new Map([[tresLong.id, { nom: tresLong.nom }]]) };
    for (const avecPrix of [true, false]) {
      const pdf = await renderPdfBuffer(FichesTechniquesDocument({ fiches: [versFichePdf(tresLong, ctx, { avecPrix, photo: PHOTO })], editeLe: "30/09/2026" }));
      const textes = await textesPoses(pdf);
      const RANGEE = /^Produit de cuisine n°\d+$/;
      const pagesAvecRangees = new Set(textes.filter((x) => RANGEE.test(x.texte)).map((x) => x.page));
      expect(pagesAvecRangees.size, `avecPrix=${avecPrix}`).toBeGreaterThanOrEqual(2);
      expect(textes.filter((x) => RANGEE.test(x.texte))).toHaveLength(45);
      expect(ecartMinimalEntreRangees(textes, RANGEE)).toBeGreaterThanOrEqual(8);
      for (const p of pagesAvecRangees) {
        const surPage = textes.filter((x) => x.page === p);
        const entete = surPage.find((x) => x.texte === "ARTICLE OU SOUS-RECETTE");
        expect(entete, `page ${p}`).toBeDefined();
        // …et AU-DESSUS des rangées de la page, pas perdu ailleurs.
        expect(Math.min(...surPage.filter((x) => RANGEE.test(x.texte)).map((x) => x.y))).toBeGreaterThan(entete!.y);
      }
    }
  }, 120_000);

  it("fiche longue (22 ingrédients + longue technique) : 2 pages, en-tête du tableau répété, rangées jamais superposées", async () => {
    for (const avecPrix of [true, false]) {
      const pdf = await rendre([LONG], avecPrix);
      const textes = await textesPoses(pdf);
      const pages = new Set(textes.map((x) => x.page));
      expect(pages.size, `avecPrix=${avecPrix}`).toBeGreaterThanOrEqual(2);
      const RANGEE = /^Produit de cuisine n°\d+$/;
      expect(textes.filter((x) => RANGEE.test(x.texte))).toHaveLength(22);
      expect(ecartMinimalEntreRangees(textes, RANGEE)).toBeGreaterThanOrEqual(8);
      // Chaque page qui porte des rangées porte aussi la barre d'en-tête du tableau.
      for (const p of new Set(textes.filter((x) => RANGEE.test(x.texte)).map((x) => x.page))) {
        expect(textes.filter((x) => x.page === p).map((x) => x.texte), `page ${p}`).toContain("ARTICLE OU SOUS-RECETTE");
      }
      // La technique arrive en entier, et le pied daté sur chaque page.
      expect(textes.some((x) => x.texte.startsWith("Étape 45 :"))).toBe(true);
      const plat = (await pagesDuPdf(pdf)).map((p) => p.plat);
      for (const p of plat) expect(p).toContain("éditée le 30/09/2026");
      expect(policesDeRepli(pdf)).toEqual([]);
    }
  }, 120_000);

  it("un bloc ne se sépare jamais de son contenu : titre, mises en garde et indicateurs sur la même page", async () => {
    // Couscous de la Direction (2026-09-30, premier essai) : « PRIX DE VENTE ET MARGE » et sa ligne
    // d'origine restaient en bas de la page 1, les prix eux-mêmes partaient seuls en page 2.
    // On décale la fiche ligne par ligne pour faire tomber chaque bloc à tous les endroits de la page.
    for (let n = 14; n <= 22; n++) {
      const v = { ...LONG, id: `long${n}`, lignes: LONG.lignes.slice(0, n) };
      const ctx = { ...CTX, contexte: construireContexte([v], mapArticles), noms: new Map([[v.id, { nom: v.nom }]]) };
      const pdf = await renderPdfBuffer(FichesTechniquesDocument({ fiches: [versFichePdf(v, ctx, { avecPrix: true, photo: null })], editeLe: "30/09/2026" }));
      const textes = await textesPoses(pdf);
      const page = (debut: string) => textes.find((x) => x.texte.startsWith(debut))?.page;
      for (const [titre, contenu] of [
        ["COÛT DE REVIENT", "Coût par portion"],
        ["PRIX DE VENTE ET MARGE", "Ratio matière"],
        ["TECHNIQUE DE PRÉPARATION", "Étape 1 :"],
      ]) {
        expect(page(titre), `${n} lignes : ${titre}`).toBeDefined();
        expect(page(contenu), `${n} lignes : ${titre} / ${contenu}`).toBe(page(titre));
      }
    }
  }, 120_000);
});

describe("technique de préparation d'un seul tenant", () => {
  it("un paragraphe de 8 000 caractères passe en entier sur plusieurs pages, jamais tronqué", async () => {
    // Relecture : titre et première ligne étaient insécables ENSEMBLE — une technique collée d'un
    // seul bloc (sans retour à la ligne) plus haute que la page était coupée en silence.
    const mots = Array.from({ length: 1000 }, (_, i) => `m${String(i).padStart(4, "0")}`);
    const paragraphe = mots.join(" ") + " FIN-DE-TECHNIQUE";
    expect(paragraphe.length).toBeGreaterThan(6000);
    const pave = fiche({ id: "pave", nom: "Pavé", lignes: [ligne(1, "p0", "g", "100")], recette: `${paragraphe}${" plus".repeat(Math.max(0, (8000 - paragraphe.length) / 5))}` });
    expect(pave.recette.length).toBeGreaterThanOrEqual(7995);
    const ctx = { ...CTX, contexte: construireContexte([pave], mapArticles), noms: new Map([["pave", { nom: "Pavé" }]]) };
    for (const avecPrix of [true, false]) {
      const pdf = await renderPdfBuffer(FichesTechniquesDocument({ fiches: [versFichePdf(pave, ctx, { avecPrix, photo: null })], editeLe: "30/09/2026" }));
      const pages = await pagesDuPdf(pdf);
      expect(pages.length, `avecPrix=${avecPrix}`).toBeGreaterThanOrEqual(2);
      const t = pages.map((p) => p.plat).join(" ");
      const trouves = t.match(/m\d{4}/g) ?? [];
      expect(trouves, `avecPrix=${avecPrix}`).toEqual(mots);
      expect(t).toContain("FIN-DE-TECHNIQUE");
      expect((t.match(/\bplus\b/g) ?? []).length).toBe((pave.recette.match(/\bplus\b/g) ?? []).length);
    }
  }, 60_000);
});

describe("photo de la fiche", () => {
  it("présente : embarquée ; absente : aucune photo ; illisible : dit, jamais un cadre muet", async () => {
    expect(nbImages(await rendre([MOJITO], true, { mojito: PHOTO }))).toBe(1);
    const sans = await rendre([MOJITO], true);
    expect(nbImages(sans)).toBe(0);
    expect(await texte(sans)).not.toContain("illisible");
    const illisible = await rendre([MOJITO], true, { mojito: "illisible" });
    expect(nbImages(illisible)).toBe(0);
    expect(await texte(illisible)).toContain("illisible au moment de l'édition");
  }, 60_000);
});

describe("glyphes : texte saisi hostile et ratios à quatre chiffres", () => {
  it("flèches, pictogrammes, espace fine insécable et « − » saisis ne font jamais basculer la police", async () => {
    const hostile = fiche({
      id: "hostile", nom: "Punch → maison ⚠", type: "BAR", categorie: "Cocktail", prixVenteTTC: "116",
      recette: "Verre : Hurricane\nMode : Shaker → verre\n⚠ Glace pilée, 1 000 ml, −2 °C 🍹",
      lignes: [ligne(1, "sirop", "cl", "2")], // coût 0,08 $ : coefficient et taux de marge à 4 chiffres
    });
    const ctx = { ...CTX, contexte: construireContexte([hostile], mapArticles), noms: new Map([["hostile", { nom: hostile.nom }]]) };
    for (const avecPrix of [true, false]) {
      const pdf = await renderPdfBuffer(FichesTechniquesDocument({ fiches: [versFichePdf(hostile, ctx, { avecPrix, photo: null })], editeLe: "30/09/2026" }));
      expect(policesDeRepli(pdf), `avecPrix=${avecPrix}`).toEqual([]);
      const t = await texte(pdf);
      expect(t).toContain("Punch -> maison");
      expect(t).toContain("Shaker -> verre");
      if (avecPrix) expect(t).toMatch(/\d \d{3}(,\d)? %/); // taux de marge ≥ 1 000 %, séparateur ordinaire
    }
  }, 60_000);
});
