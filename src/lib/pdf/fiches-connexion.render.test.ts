import { describe, it, expect, beforeAll, vi } from "vitest";
import { ORIGINE_AFFICHE } from "@/lib/pointage-origines";
import { qrLuSurLaPage } from "@/lib/test/qr-pdf";

// `espace-employe` importe le client Prisma de l'application : aucun accès base ici, mais on ne
// laisse même pas un client se construire sur le `.env` (qui pointe la PRODUCTION).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { genererMotDePasseTemporaire } = await import("@/lib/espace-employe");
const { genererFichesConnexionPdf, FICHES_PAR_PAGE } = await import("./fiches-connexion");

/**
 * Les fiches de connexion, relues sur le PDF PRODUIT : chaque matricule et chaque mot de passe
 * atteignent la page, sans AUCUNE police de repli (méthode de `glyphes-manquants.test.ts`) — un
 * caractère de mot de passe que la police n'a pas serait imprimé faux ou barré, et le salarié ne
 * pourrait jamais se connecter. Le QR se relit et ouvre l'application officielle.
 */

function policesDuPdf(pdf: Buffer): string[] {
  return [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map((m) => m[1]);
}
const estEmbarquee = (nom: string) => /^[A-Z]{6}\+/.test(nom);

async function lire(pdf: Buffer): Promise<{ texte: string; pages: number }> {
  const { PDFParse } = await import("pdf-parse");
  const { pages, total } = await new PDFParse({ data: new Uint8Array(pdf) }).getText();
  return { texte: pages.map((p) => p.text).join("\n").replace(/\s+/g, " "), pages: total };
}

/** Tous les caractères que le générateur produit (50 000 tirages : aucun ne manque en pratique). */
function caracteresDesMotsDePasse(): string[] {
  const vus = new Set<string>();
  for (let i = 0; i < 5000; i++) for (const c of genererMotDePasseTemporaire()) vus.add(c);
  return [...vus].sort();
}

const NOMS = [
  "Kabeya Mbuyi Éléonore", "N'Galula Jean-Pierre", "Lukusa Tshibangu", "Mputu Ilunga Grâce",
  "Nsimba Makiese", "Kalonji Mukendi Béatrice", "Tshisekedi Kanku", "Mbala Nzuzi", "Kasongo Mwamba",
];

let alphabet: string[];
let fiches: { nom: string; matricule: string; motDePasse: string }[];
let pdf: Buffer;

beforeAll(async () => {
  alphabet = caracteresDesMotsDePasse();
  // Des mots de passe au format réel (5 + « - » + 5) qui, ENSEMBLE, couvrent tout l'alphabet du
  // générateur : chaque caractère possible est composé au moins une fois, dans le style réel.
  const sansTiret = alphabet.filter((c) => c !== "-");
  fiches = NOMS.map((nom, i) => {
    const pioche = (k: number) => sansTiret[(i * 10 + k) % sansTiret.length];
    const mdp = `${[0, 1, 2, 3, 4].map(pioche).join("")}-${[5, 6, 7, 8, 9].map(pioche).join("")}`;
    return { nom, matricule: `PEF-${String(i + 1).padStart(3, "0")}`, motDePasse: mdp };
  });
  pdf = await genererFichesConnexionPdf({ fiches, urlApplication: ORIGINE_AFFICHE });
}, 60_000);

describe("mots de passe temporaires : l'alphabet du générateur", () => {
  it("ne contient que des lettres majuscules (sans I ni O), des chiffres 2 à 9 et le tiret", () => {
    expect(alphabet.join("")).toBe("-23456789ABCDEFGHJKLMNPQRSTUVWXYZ");
  });

  it("chaque caractère possible figure sur au moins une fiche du jeu d'essai", () => {
    const composes = new Set(fiches.flatMap((f) => [...f.motDePasse]));
    expect(alphabet.filter((c) => !composes.has(c))).toEqual([]);
  });
});

describe("fiches de connexion (PDF A4, à découper)", () => {
  it("chaque fiche porte le nom, le matricule et le mot de passe", async () => {
    const { texte } = await lire(pdf);
    for (const f of fiches) {
      expect(texte).toContain(f.nom);
      expect(texte).toContain(f.matricule);
      expect(texte).toContain(f.motDePasse);
    }
  }, 60_000);

  it("chaque fiche dit que le mot de passe est à changer et donne l'adresse de l'application", async () => {
    const { texte } = await lire(pdf);
    const adresse = new URL(ORIGINE_AFFICHE).host;
    expect(texte.split("À changer à la première connexion.").length - 1).toBe(fiches.length);
    expect(texte.split(adresse).length - 1).toBeGreaterThanOrEqual(fiches.length);
  }, 60_000);

  it(`huit fiches par page : ${NOMS.length} salariés tiennent sur 2 pages`, async () => {
    expect(FICHES_PAR_PAGE).toBe(8);
    expect((await lire(pdf)).pages).toBe(2);
  }, 60_000);

  it("n'embarque qu'Optima : aucune police de repli, mots de passe compris", () => {
    const polices = policesDuPdf(pdf);
    expect(polices.length).toBeGreaterThan(0);
    expect(polices.filter((p) => !estEmbarquee(p))).toEqual([]);
  });

  it("le QR de CHACUNE des huit fiches de la page se relit, et ouvre l'application officielle", async () => {
    // Une fiche = un quart de la hauteur et une moitié de la largeur de la page (2 × 4).
    const lus: (string | null)[] = [];
    for (let rang = 0; rang < 4; rang++)
      for (let col = 0; col < 2; col++)
        lus.push(await qrLuSurLaPage(pdf, { x: col / 2, y: rang / 4, largeur: 1 / 2, hauteur: 1 / 4 }));
    expect(lus).toEqual(Array(8).fill(ORIGINE_AFFICHE));
  }, 60_000);

  it("refuse de produire un document vide", async () => {
    await expect(genererFichesConnexionPdf({ fiches: [], urlApplication: ORIGINE_AFFICHE })).rejects.toThrow("Aucune fiche");
  });
});
