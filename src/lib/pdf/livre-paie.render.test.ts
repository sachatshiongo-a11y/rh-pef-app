import { describe, it, expect } from "vitest";
import type { PaymentStatus } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { formaterNombre } from "@/lib/montant";
import { salaireNetUSD, totalVerseUSD } from "@/lib/paie-net";
import type { Cellule } from "./tableau";
import { LivrePaieDocument, partiesDuLivrePdf, AUCUN_SALARIE_PDF, ENTETE_HS_PDF, TITRE_RECAP_PDF } from "./livre-paie";

/**
 * Livre de paie PDF par catégorie (Direction, 2026-09-24) : la Brigade sur ses pages, le
 * Back-office à partir d'une NOUVELLE page, puis le Récapitulatif. Le PDF est RENDU puis relu
 * page par page, ET ligne par ligne : une cellule qui passe à la ligne (nom coupé « Luyin-dula »,
 * « h » des heures seul en dessous) casse la rangée du texte extrait, et le test la voit.
 */

const TAUX = 2815.5;

type Ligne = {
  salBrutUSD: number; cnssSalarieUSD: number; iprCalculeUSD: number; transportUSD: number; salNetUSD: number;
  hsValorisee: number; heuresSupp30: number; heuresSupp60: number; heuresSupp100: number;
  statutPaiement: PaymentStatus;
  employee: { matricule: string; nom: string; categorie: string };
};

/** Ligne à des montants RÉALISTES (salaires de 200 à 800 $), pour des largeurs de colonne réelles. */
function ligne(i: number, nom: string, categorie: string, o: Partial<Ligne> = {}): Ligne {
  const brut = 212.47 + ((i * 37.13) % 590);
  return {
    salBrutUSD: brut, cnssSalarieUSD: brut * 0.05, iprCalculeUSD: brut * 0.08, transportUSD: 30.55 + (i % 7) * 4.1,
    salNetUSD: brut * 0.87 + 30.55 + (i % 7) * 4.1, hsValorisee: 0, heuresSupp30: 0, heuresSupp60: 0, heuresSupp100: 0,
    statutPaiement: "VALIDE",
    employee: { matricule: `PEF-${String(i).padStart(3, "0")}`, nom, categorie },
    ...o,
  };
}

// Noms RÉELS relevés à la relecture (coupés à 13 %), plus des noms de remplissage.
const NOMS_REELS = ["Francine Luyindula", "Jeannette Bongota", "Martine Mutombo", "Myriam Bumbakini", "Celestine Mbukela", "Dominique Tshiongo"];

// 55 salariés en brigade : la partie tient sur plusieurs pages (en-tête répété à vérifier).
const BRIGADE = Array.from({ length: 55 }, (_, i) => {
  const n = i + 1;
  const nom = n <= 4 ? NOMS_REELS[n - 1] : n === 5 ? "Coco Lala" : `Brigadier ${String(n).padStart(2, "0")}`;
  return ligne(n, nom, "BRIGADE", n === 5 ? { hsValorisee: 12.35, heuresSupp30: 3.5 } : {});
});
const BACKOFFICE = [ligne(101, NOMS_REELS[4], "BACKOFFICE"), ligne(102, NOMS_REELS[5], "BACKOFFICE")];
const TOUTES = [...BACKOFFICE, ...BRIGADE];

// Cas limites d'heures supp. : 100 h pour 1 000 $, et 123,5 h pour 1 234,56 $.
const EXTREMES = [
  ...BACKOFFICE,
  ligne(1, NOMS_REELS[0], "BRIGADE", { hsValorisee: 1000, heuresSupp30: 60, heuresSupp60: 30, heuresSupp100: 10 }),
  ligne(2, NOMS_REELS[3], "BRIGADE", { hsValorisee: 1234.56, heuresSupp30: 100, heuresSupp60: 23.5 }),
  ligne(3, NOMS_REELS[1], "BRIGADE"),
];

type Page = { brut: string; plat: string };
async function pagesDu(buffer: Buffer): Promise<Page[]> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => ({ brut: p.text, plat: p.text.replace(/\s+/g, " ") }));
}

const rendre = (lignes: Ligne[]) => renderPdfBuffer(LivrePaieDocument({ lignes, taux: TAUX, periode: "septembre 2026" }));

/** Même lecture des polices que glyphes-manquants.test.ts : toute police non embarquée = repli. */
const policesDuPdf = (pdf: Buffer) => [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map((m) => m[1]);
const estEmbarquee = (nom: string) => /^[A-Z]{6}\+/.test(nom);

const TITRE_BRIGADE = "Brigade — 55 salarié(s)";
const TITRE_BACKOFFICE = "Back-office — 2 salarié(s)";
const texte = (c: unknown) => (c != null && typeof c === "object" ? (c as { texte: string }).texte : String(c ?? ""));
const nombre = (s: string) => Number(s.replace(/ /g, "").replace(",", "."));
const sansEspaces = (s: string) => s.replace(/\s+/g, "");
/** Ce qu'une cellule dessine : son texte, puis sa note en petit. */
const dessin = (c: Cellule) => (c != null && typeof c === "object" ? `${c.texte}${c.note ?? ""}` : String(c));

/**
 * Chaque rangée des tableaux doit sortir sur UNE ligne du texte extrait. Une cellule qui passe à
 * la ligne (mot coupé par un trait d'union, note repoussée dessous) éclate la rangée sur deux
 * lignes : aucune ligne n'est plus égale à la rangée complète. Renvoie les rangées éclatées.
 */
async function rangeesEclatees(lignes: Ligne[]): Promise<string[]> {
  const pages = await pagesDu(await rendre(lignes));
  const lignesTexte = new Set(pages.flatMap((p) => p.brut.split("\n").map(sansEspaces)));
  const eclatees: string[] = [];
  for (const partie of partiesDuLivrePdf(lignes, TAUX)) {
    for (const rangee of partie.lignes) {
      const attendu = sansEspaces(rangee.map(dessin).join(""));
      if (!lignesTexte.has(attendu)) eclatees.push(rangee.map(dessin).join(" | "));
    }
  }
  return eclatees;
}

describe("livre de paie PDF — une partie par catégorie", () => {
  it("la Brigade occupe ses pages (en-tête répété), le Back-office commence sur une NOUVELLE page, le Récapitulatif termine", async () => {
    const pages = (await pagesDu(await rendre(TOUTES))).map((p) => p.plat);
    const iBrigade = pages.findIndex((p) => p.includes(TITRE_BRIGADE));
    const iBack = pages.findIndex((p) => p.includes(TITRE_BACKOFFICE));
    const iRecap = pages.findIndex((p, i) => i > iBack && p.includes(TITRE_RECAP_PDF) && p.includes("TOTAL GÉNÉRAL"));
    expect(iBrigade).toBe(0);
    expect(iBack, "la partie Back-office n'a pas été trouvée").toBeGreaterThan(1); // brigade sur ≥ 2 pages
    expect(iRecap).toBe(pages.length - 1);

    // Pages de la brigade : en-tête de colonnes sur CHACUNE, aucun salarié du back-office.
    for (const p of pages.slice(0, iBack)) {
      expect(p).toContain("MATRICULE");
      expect(p).not.toContain(NOMS_REELS[4]);
    }
    // La page qui précède le Back-office porte la fin de la brigade (sa ligne TOTAL).
    expect(pages[iBack - 1]).toContain("TOTAL 55 salarié(s)");
    // La page N du Back-office : aucun brigadier, ses propres salariés, sa ligne TOTAL.
    expect(pages[iBack]).not.toMatch(/Brigadier \d\d|Coco Lala/);
    expect(pages[iBack]).toContain(NOMS_REELS[4]);
    expect(pages[iBack]).toContain("TOTAL 2 salarié(s)");
    // Numérotation sur tout le document.
    expect(pages[iBack]).toContain(`Page ${iBack + 1} sur ${pages.length}`);
  }, 60_000);

  it("plus de colonne « Cat. » : la partie porte déjà le nom de sa catégorie", async () => {
    const pages = (await pagesDu(await rendre(TOUTES))).map((p) => p.plat);
    for (const p of pages.slice(0, -1)) expect(p).not.toMatch(/\bCAT\.|Back-off\.|Coco Lala Brigade/);
    for (const partie of partiesDuLivrePdf(TOUTES, TAUX)) expect(partie.colonnes.map((c) => c.header)).not.toContain("Cat.");
  }, 60_000);

  it("chaque partie a sa ligne TOTAL, et le récapitulatif reprend ces totaux", async () => {
    const parties = partiesDuLivrePdf(TOUTES, TAUX);
    expect(parties.map((p) => p.titre)).toEqual([TITRE_BRIGADE, TITRE_BACKOFFICE, TITRE_RECAP_PDF]);
    const recap = parties[2];
    for (const [i, p] of parties.slice(0, 2).entries()) {
      const total = p.lignes[p.lignes.length - 1].map(texte);
      expect(total[0]).toBe("TOTAL");
      const ligneRecap = recap.lignes[i].map(texte);
      // Mêmes colonnes de montant, même ordre, mêmes chaînes (Brut $ … Versé $).
      expect(ligneRecap.slice(ligneRecap.length - 7)).toEqual(total.slice(total.length - 7));
    }
    const pages = (await pagesDu(await rendre(TOUTES))).map((p) => p.plat);
    const brutBrigade = formaterNombre(BRIGADE.reduce((s, l) => s + l.salBrutUSD, 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(pages.join(" ")).toContain(brutBrigade);
  }, 60_000);

  it("aucun montant en $ ne change : totaux par catégorie additionnés = total général d'avant la séparation", () => {
    const recap = partiesDuLivrePdf(TOUTES, TAUX)[2];
    const general = recap.lignes[recap.lignes.length - 1].map(texte);
    expect(general[0]).toBe("TOTAL GÉNÉRAL");
    // Référence FIGÉE : la ligne TOTAL unique de la route du 2026-09-23 (somme brute, puis formatage).
    const usd = (n: number) => formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const somme = (f: (l: Ligne) => number) => TOUTES.reduce((s, l) => s + f(l), 0);
    const avantUSD = [
      usd(somme((l) => l.salBrutUSD)), usd(somme((l) => l.transportUSD)), usd(somme((l) => l.cnssSalarieUSD)),
      usd(somme((l) => l.iprCalculeUSD)), usd(somme((l) => salaireNetUSD(l))),
    ];
    const g = general.slice(general.length - 7);
    expect([...g.slice(0, 5), g[6]]).toEqual([...avantUSD, usd(somme((l) => totalVerseUSD(l)))]);
  });

  it("TOTAL GÉNÉRAL = somme des totaux de catégorie AFFICHÉS, colonne par colonne (CDF compris)", () => {
    // Deux lignes à 2 800,4 CDF : chacune s'affiche 2 800, leur somme brute arrondie ferait 5 601.
    // Le total général doit afficher 5 600 — ce que l'œil additionne.
    const lignes = [ligne(1, "A", "BRIGADE", { salNetUSD: 31, transportUSD: 30 }), ligne(2, "B", "BACKOFFICE", { salNetUSD: 31, transportUSD: 30 })];
    for (const [jeu, taux] of [[lignes, 2800.4], [TOUTES, TAUX]] as const) {
      const recap = partiesDuLivrePdf(jeu, taux)[2];
      const general = recap.lignes[recap.lignes.length - 1].map(texte);
      for (let c = 1; c < general.length; c++) {
        const parCategorie = recap.lignes.slice(0, -1).reduce((s, r) => s + nombre(texte(r[c])), 0);
        expect(nombre(general[c]), `colonne ${c}`).toBe(Math.round(parCategorie * 100) / 100);
      }
    }
    const netCDF = partiesDuLivrePdf(lignes, 2800.4)[2].lignes.map((r) => texte(r[r.length - 2]));
    expect(netCDF).toEqual(["2 800", "2 800", "5 600"]);
  });

  it("une catégorie sans salarié garde sa page : « Aucun salarié » et une ligne TOTAL à zéro", async () => {
    const pages = (await pagesDu(await rendre(BRIGADE))).map((p) => p.plat);
    const iBack = pages.findIndex((p) => p.includes("Back-office — 0 salarié(s)"));
    expect(iBack).toBeGreaterThan(0);
    expect(pages[iBack]).toContain(AUCUN_SALARIE_PDF);
    expect(pages[iBack]).toMatch(/TOTAL 0 salarié\(s\) 0,00 0,00 0,00 0,00 0,00 0 0,00/);
  }, 60_000);
});

describe("livre de paie PDF — aucune cellule ne passe à la ligne", () => {
  it("le détecteur voit bien une rangée éclatée (nom plus large que sa colonne)", async () => {
    const trop = [ligne(1, "Francine Luyindula-Mbukela-Bumbakini Tshiongo", "BRIGADE"), ...BACKOFFICE];
    expect(await rangeesEclatees(trop)).not.toEqual([]);
  }, 60_000);

  it("septembre (Coco Lala en heures supp., noms réels) : chaque rangée tient sur une ligne", async () => {
    expect(await rangeesEclatees(TOUTES)).toEqual([]);
  }, 60_000);

  it("100 h pour 1 000 $ et 123,5 h pour 1 234,56 $ : chaque rangée tient sur une ligne, TOTAL compris", async () => {
    expect(await rangeesEclatees(EXTREMES)).toEqual([]);
    const plat = (await pagesDu(await rendre(EXTREMES))).map((p) => p.plat).join(" ");
    expect(plat).toMatch(/Myriam Bumbakini 1 234,56 123,5 h/);
    expect(plat).toMatch(/Francine Luyindula 1 000,00 100 h/);
  }, 60_000);
});

describe("livre de paie PDF — heures supplémentaires", () => {
  it("la colonne n'apparaît que dans une partie qui en compte, totalisée, et au récapitulatif", async () => {
    const pages = (await pagesDu(await rendre(TOUTES))).map((p) => p.plat);
    const iBack = pages.findIndex((p) => p.includes(TITRE_BACKOFFICE));
    const entete = ENTETE_HS_PDF.toUpperCase();
    for (const p of pages.slice(0, iBack)) expect(p).toContain(entete);
    expect(pages[iBack]).not.toContain(entete);
    // Montant et heures en petit, sur la ligne du salarié et sur la ligne TOTAL.
    expect(pages.join(" ")).toMatch(/PEF-005 Coco Lala 12,35 3,5 h/);
    expect(pages.join(" ")).toMatch(/TOTAL 55 salarié\(s\) 12,35 3,5 h/);
    // Sans heures supp. : le montant seul, pas de « 0 h ».
    expect(pages.join(" ")).toMatch(/PEF-006 Brigadier 06 0,00 [\d ]+,\d\d/);
    const recap = pages[pages.length - 1];
    expect(recap).toContain(entete);
    expect(recap).toMatch(/Brigade 55 12,35 3,5 h/);
    expect(recap).toMatch(/Back-office 2 0,00 [\d ]+,\d\d/);
    expect(recap).toMatch(/TOTAL GÉNÉRAL 57 12,35 3,5 h/);
  }, 60_000);

  it("sans heures supp. dans le mois, aucune partie ni le récapitulatif n'ont la colonne", async () => {
    const sansHS = TOUTES.map((l) => ({ ...l, hsValorisee: 0, heuresSupp30: 0 }));
    const pages = (await pagesDu(await rendre(sansHS))).map((p) => p.plat);
    expect(pages.join(" ")).not.toContain(ENTETE_HS_PDF.toUpperCase());
  }, 60_000);

  it("les heures supp. ne changent aucun autre montant de la ligne", () => {
    const avec = partiesDuLivrePdf(TOUTES, TAUX)[0].lignes.map((r) => r.map(texte));
    const sans = partiesDuLivrePdf(TOUTES.map((l) => ({ ...l, hsValorisee: 0, heuresSupp30: 0 })), TAUX)[0].lignes.map((r) => r.map(texte));
    // Avec la colonne, seule la 3e cellule (Heures supp.) s'insère ; le reste est identique.
    expect(avec.map((r) => [...r.slice(0, 2), ...r.slice(3)])).toEqual(sans);
  });
});

describe("livre de paie PDF — police", () => {
  it("n'embarque qu'Optima (aucun repli sur une police standard)", async () => {
    for (const jeu of [TOUTES, EXTREMES]) {
      const polices = policesDuPdf(await rendre(jeu));
      expect(polices.length).toBeGreaterThan(0);
      expect(polices.filter((p) => !estEmbarquee(p))).toEqual([]);
    }
  }, 60_000);
});
