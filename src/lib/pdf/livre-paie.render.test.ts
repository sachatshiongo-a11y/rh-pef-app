import { describe, it, expect } from "vitest";
import type { PaymentStatus } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { formaterNombre } from "@/lib/montant";
import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "@/lib/paie-net";
import { LivrePaieDocument, partiesDuLivrePdf, AUCUN_SALARIE_PDF, ENTETE_HS_PDF, TITRE_RECAP_PDF } from "./livre-paie";

/**
 * Livre de paie PDF par catégorie (Direction, 2026-09-24) : la Brigade sur ses pages, le
 * Back-office à partir d'une NOUVELLE page, puis le Récapitulatif. Le PDF est RENDU puis relu
 * page par page ; les montants exacts sont relus sur les parties prêtes à rendre.
 */

const TAUX = 2815.5;

type Ligne = {
  salBrutUSD: number; cnssSalarieUSD: number; iprCalculeUSD: number; transportUSD: number; salNetUSD: number;
  hsValorisee: number; heuresSupp30: number; heuresSupp60: number; heuresSupp100: number;
  statutPaiement: PaymentStatus;
  employee: { matricule: string; nom: string; categorie: string };
};

function ligne(i: number, nom: string, categorie: string, o: Partial<Ligne> = {}): Ligne {
  return {
    // Montants ≥ 1 000 en CDF (et en $ sur certaines lignes) : le séparateur de milliers est composé.
    salBrutUSD: 412.47 + i * 23.13, cnssSalarieUSD: 15.19 + i, iprCalculeUSD: 7.03 * i, transportUSD: 30.55 + i,
    salNetUSD: 390.31 + i * 19.07, hsValorisee: 0, heuresSupp30: 0, heuresSupp60: 0, heuresSupp100: 0,
    statutPaiement: "VALIDE",
    employee: { matricule: `PEF-${String(i).padStart(3, "0")}`, nom, categorie },
    ...o,
  };
}

// 55 salariés en brigade : la partie tient sur plusieurs pages (en-tête répété à vérifier).
const BRIGADE = Array.from({ length: 55 }, (_, i) =>
  ligne(i + 1, `Brigadier ${String(i + 1).padStart(2, "0")}`, "BRIGADE", i === 4 ? { hsValorisee: 1234.5, heuresSupp30: 6, heuresSupp60: 2 } : {}));
const BACKOFFICE = [ligne(101, "Rachel Lunda", "BACKOFFICE"), ligne(102, "Benoît Ilunga", "BACKOFFICE")];
const TOUTES = [...BACKOFFICE, ...BRIGADE];

async function pagesDu(buffer: Buffer): Promise<string[]> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text.replace(/\s+/g, " "));
}

const rendre = (lignes: Ligne[]) => renderPdfBuffer(LivrePaieDocument({ lignes, taux: TAUX, periode: "septembre 2026" }));

/** Même lecture des polices que glyphes-manquants.test.ts : toute police non embarquée = repli. */
const policesDuPdf = (pdf: Buffer) => [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map((m) => m[1]);
const estEmbarquee = (nom: string) => /^[A-Z]{6}\+/.test(nom);

const TITRE_BRIGADE = "Brigade — 55 salarié(s)";
const TITRE_BACKOFFICE = "Back-office — 2 salarié(s)";
const texte = (c: unknown) => (c != null && typeof c === "object" ? (c as { texte: string }).texte : String(c ?? ""));
const nombre = (s: string) => Number(s.replace(/ /g, "").replace(",", "."));

describe("livre de paie PDF — une partie par catégorie", () => {
  it("la Brigade occupe ses pages (en-tête répété), le Back-office commence sur une NOUVELLE page, le Récapitulatif termine", async () => {
    const pages = await pagesDu(await rendre(TOUTES));
    const iBrigade = pages.findIndex((p) => p.includes(TITRE_BRIGADE));
    const iBack = pages.findIndex((p) => p.includes(TITRE_BACKOFFICE));
    const iRecap = pages.findIndex((p, i) => i > iBack && p.includes(TITRE_RECAP_PDF) && p.includes("TOTAL GÉNÉRAL"));
    expect(iBrigade).toBe(0);
    expect(iBack, "la partie Back-office n'a pas été trouvée").toBeGreaterThan(1); // brigade sur ≥ 2 pages
    expect(iRecap).toBe(pages.length - 1);

    // Pages de la brigade : en-tête de colonnes sur CHACUNE, aucun salarié du back-office.
    for (const p of pages.slice(0, iBack)) {
      expect(p).toContain("MATRICULE");
      expect(p).not.toContain("Rachel Lunda");
    }
    // La page qui précède le Back-office porte la fin de la brigade (sa ligne TOTAL).
    expect(pages[iBack - 1]).toContain("TOTAL 55 salarié(s)");
    // La page N du Back-office : aucun brigadier, ses propres salariés, sa ligne TOTAL.
    expect(pages[iBack]).not.toMatch(/Brigadier \d\d/);
    expect(pages[iBack]).toContain("Rachel Lunda");
    expect(pages[iBack]).toContain("TOTAL 2 salarié(s)");
    // Numérotation sur tout le document.
    expect(pages[iBack]).toContain(`Page ${iBack + 1} sur ${pages.length}`);
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
      const montantsPartie = total.slice(total.length - 7);
      const montantsRecap = ligneRecap.slice(ligneRecap.length - 7);
      expect(montantsRecap).toEqual(montantsPartie);
    }
    const pages = await pagesDu(await rendre(TOUTES));
    const brutBrigade = formaterNombre(BRIGADE.reduce((s, l) => s + l.salBrutUSD, 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(pages.join(" ")).toContain(brutBrigade);
  }, 60_000);

  it("aucun montant ne change : totaux par catégorie additionnés = total général d'avant la séparation", () => {
    const recap = partiesDuLivrePdf(TOUTES, TAUX)[2];
    const general = recap.lignes[recap.lignes.length - 1].map(texte);
    expect(general[0]).toBe("TOTAL GÉNÉRAL");
    // Référence FIGÉE : la ligne TOTAL unique de la route du 2026-09-23 (somme brute, puis formatage).
    const usd = (n: number) => formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const somme = (f: (l: Ligne) => number) => TOUTES.reduce((s, l) => s + f(l), 0);
    const avant = [
      usd(somme((l) => l.salBrutUSD)), usd(somme((l) => l.transportUSD)), usd(somme((l) => l.cnssSalarieUSD)),
      usd(somme((l) => l.iprCalculeUSD)), usd(somme((l) => salaireNetUSD(l))),
      formaterNombre(Math.round(somme((l) => salaireNetCDF(l, TAUX)))), usd(somme((l) => totalVerseUSD(l))),
    ];
    expect(general.slice(general.length - 7)).toEqual(avant);
    // Et la somme des lignes de catégorie retombe sur ce total, colonne par colonne.
    for (let c = general.length - 7; c < general.length; c++) {
      const parCategorie = recap.lignes.slice(0, -1).reduce((s, r) => s + nombre(texte(r[c])), 0);
      expect(Math.round(parCategorie * 100) / 100, `colonne ${c}`).toBe(nombre(general[c]));
    }
  });

  it("une catégorie sans salarié garde sa page : « Aucun salarié » et une ligne TOTAL à zéro", async () => {
    const pages = await pagesDu(await rendre(BRIGADE));
    const iBack = pages.findIndex((p) => p.includes("Back-office — 0 salarié(s)"));
    expect(iBack).toBeGreaterThan(0);
    expect(pages[iBack]).toContain(AUCUN_SALARIE_PDF);
    expect(pages[iBack]).toMatch(/TOTAL 0 salarié\(s\) 0,00 0,00 0,00 0,00 0,00 0 0,00/);
  }, 60_000);
});

describe("livre de paie PDF — heures supplémentaires", () => {
  it("la colonne n'apparaît que dans une partie qui en compte, totalisée, et au récapitulatif", async () => {
    const pages = await pagesDu(await rendre(TOUTES));
    const iBack = pages.findIndex((p) => p.includes(TITRE_BACKOFFICE));
    const entete = ENTETE_HS_PDF.toUpperCase();
    for (const p of pages.slice(0, iBack)) expect(p).toContain(entete);
    expect(pages[iBack]).not.toContain(entete);
    // Montant (≥ 1 000) et heures en petit, sur la ligne du salarié et sur la ligne TOTAL.
    expect(pages.join(" ")).toMatch(/Brigadier 05 Brigade 1 234,50 8 h/);
    expect(pages.join(" ")).toMatch(/TOTAL 55 salarié\(s\) 1 234,50 8 h/);
    const recap = pages[pages.length - 1];
    expect(recap).toContain(entete);
    expect(recap).toMatch(/Brigade 55 1 234,50 8 h/);
    expect(recap).toMatch(/Back-office 2 0,00 [\d ]+,\d\d/); // pas de « 0 h » : le montant seul
    expect(pages.join(" ")).toMatch(/Brigadier 04 Brigade 0,00 [\d ]+,\d\d/);
    expect(recap).toMatch(/TOTAL GÉNÉRAL 57 1 234,50 8 h/);
  }, 60_000);

  it("sans heures supp. dans le mois, aucune partie ni le récapitulatif n'ont la colonne", async () => {
    const sansHS = TOUTES.map((l) => ({ ...l, hsValorisee: 0, heuresSupp30: 0, heuresSupp60: 0 }));
    const pages = await pagesDu(await rendre(sansHS));
    expect(pages.join(" ")).not.toContain(ENTETE_HS_PDF.toUpperCase());
  }, 60_000);

  it("les heures supp. ne changent aucun autre montant de la ligne", () => {
    const avec = partiesDuLivrePdf(TOUTES, TAUX)[0].lignes.map((r) => r.map(texte));
    const sans = partiesDuLivrePdf(TOUTES.map((l) => ({ ...l, hsValorisee: 0, heuresSupp30: 0, heuresSupp60: 0 })), TAUX)[0].lignes.map((r) => r.map(texte));
    // Avec la colonne, seule la 4e cellule (Heures supp.) s'insère ; le reste est identique.
    expect(avec.map((r) => [...r.slice(0, 3), ...r.slice(4)])).toEqual(sans);
  });
});

describe("livre de paie PDF — police", () => {
  it("n'embarque qu'Optima (aucun repli sur une police standard)", async () => {
    const polices = policesDuPdf(await rendre(TOUTES));
    expect(polices.length).toBeGreaterThan(0);
    expect(polices.filter((p) => !estEmbarquee(p))).toEqual([]);
  }, 60_000);
});
