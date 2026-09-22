import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import type { Employee, PayrollLine, PayrollRun } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { BulletinDocument } from "./bulletin";
import { mentionSignature, traceAAfficher, type SignatureVue } from "@/lib/signature";
import type { SignatureImprimable } from "./layout";

/**
 * LE DOCUMENT DIT LA VÉRITÉ SUR LE GESTE — rendu RÉEL du bulletin, texte relu dans le PDF produit.
 *
 * Quatre situations, quatre phrases différentes : signé depuis l'espace salarié, signé en présence
 * d'un responsable sur l'appareil de l'entreprise, signé PUIS modifié (le tracé disparaît), et pas
 * signé du tout. Un document ne doit jamais écrire « depuis son espace salarié » sur un geste qui
 * a eu lieu sur la tablette du bureau, ni montrer un tracé posé sur des montants qui ont bougé.
 */

async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

/** Polices déclarées dans le PDF (/BaseFont) — une police EMBARQUÉE est préfixée « ABCDEF+ ». */
const policesDuPdf = (pdf: Buffer) =>
  [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map((m) => m[1]);
const estEmbarquee = (nom: string) => /^[A-Z]{6}\+/.test(nom);

/**
 * Nombre d'objets image du PDF. Le générateur écrit tantôt `/Subtype /Image`, tantôt
 * `/Subtype/Image` : l'espace est FACULTATIF dans la syntaxe PDF, une expression qui l'exige
 * compterait 0 partout et le test « pas de tracé si obsolète » passerait au vert sans rien prouver.
 */
const nbImages = (pdf: Buffer) => [...pdf.toString("latin1").matchAll(/\/Subtype\s*\/Image\b/g)].length;

// --- Un vrai PNG, fabriqué ici -------------------------------------------------------------
// @react-pdf/renderer DÉCODE l'image : les octets d'en-tête suivis de zéros qu'utilisent les tests
// des actions (où seule la validation compte) feraient planter le rendu. Il faut aussi que ce PNG
// soit DIFFÉRENT du logo de l'en-tête, sinon le générateur mutualise le même objet image et le
// compte d'images ne bougerait pas entre « signé » et « non signé ».
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const octet of buf) {
    c ^= octet;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function morceau(type: string, donnees: Buffer): Buffer {
  const taille = Buffer.alloc(4);
  taille.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, "latin1"), donnees]);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(corps));
  return Buffer.concat([taille, corps, somme]);
}
function pngTrace(cote = 24): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cote, 0);
  ihdr.writeUInt32BE(cote, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RVBA
  // Une diagonale noire opaque sur fond transparent : de quoi ressembler à un paraphe.
  const lignes: Buffer[] = [];
  for (let y = 0; y < cote; y++) {
    const ligne = Buffer.alloc(1 + cote * 4); // octet de filtre + pixels
    for (let x = 0; x < cote; x++) {
      const opaque = Math.abs(x - y) <= 1;
      ligne[1 + x * 4 + 3] = opaque ? 255 : 0;
    }
    lignes.push(ligne);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau("IHDR", ihdr),
    morceau("IDAT", zlib.deflateSync(Buffer.concat(lignes))),
    morceau("IEND", Buffer.alloc(0)),
  ]);
}
const TRACE_PNG = pngTrace();

// --- Fixtures (mêmes valeurs que bulletin.render.test.ts : Aimée Mutita, sept. 2026) ---------
const employee = {
  id: "e1", matricule: "PEF-007", nom: "Aimée Mutita", sexe: "F", poste: "Cuisinière", secteur: "Cuisine",
  categorie: "BRIGADE", contrat: "CDD", enfants: 0, salaireMensuel: 250, dateEmbauche: new Date("2025-01-06"),
  heuresHebdomadaires: 48, transportJourCDF: 10000,
} as unknown as Employee;

const run = { id: "r1", mois: 9, annee: 2026, tauxChangeUtilise: 2800, statut: "VALIDE" } as unknown as PayrollRun;

const ligne = {
  id: "l1", employeeId: "e1", payrollRunId: "r1", statutPaiement: "VALIDE",
  remuneration100: 264.94, remuneration2_3: 0, remunerationJoursPayesUSD: 0, hsValorisee: 1.96,
  heuresTravaillees: 208, heuresContractuelles: 208, heuresSupp30: 1, heuresSupp60: 0, heuresSupp100: 0,
  joursPayes100: 26, joursPayes2_3: 0, joursNonPayes: 0, joursPayesNonTravailles: 0, joursCongePris: 0,
  indemniteCongesUSD: 0, fraisMedicauxUSD: 0, transportUSD: 114.78, primesUSD: 0, avantagesNatureUSD: 0,
  acompteUSD: 0, retenuePretUSD: 0, salBrutUSD: 418.51, cnssSalarieUSD: 15.19, netImposableUSD: 288.54,
  iprCalculeUSD: 34.83, allocFamilialeUSD: 0, salNetUSD: 368.5, salNetCDF: 368.5 * 2800,
  cnssPatronalUSD: 36.46, inppUSD: 9.11, onemUSD: 0.61, coutEmployeurUSD: 464.69, coutEmployeurCDF: 464.69 * 2800,
  datePaiement: null, modePaiement: null, payeParId: null,
} as unknown as PayrollLine;

// 22/09/2026 13:05 UTC = 14 h 05 à Kinshasa (UTC+1, sans heure d'été).
const vue = (surcharges: Partial<SignatureVue> = {}): SignatureVue => ({
  traceUrl: "/fichiers/signatures/bulletin/l1.png",
  signeLe: new Date("2026-09-22T13:05:00Z"),
  mode: "ESPACE_SALARIE",
  nomSalarie: "Aimée Mutita",
  matricule: "PEF-007",
  nomPresentePar: null,
  obsolete: false,
  ...surcharges,
});

/**
 * Ce que `signatureImprimable` construit — en appelant la MÊME règle (`traceAAfficher`), pas une
 * copie : si ce jeu d'essai redécidait lui-même quand montrer le tracé, il resterait vert alors
 * même que la production se serait mise à l'afficher sur un document périmé.
 */
const imprimable = (v: SignatureVue): SignatureImprimable => ({
  image: traceAAfficher(v) ? { data: TRACE_PNG, format: "png" } : null,
  mention: mentionSignature(v),
});

const rendre = (signatureSalarie?: SignatureImprimable) =>
  renderPdfBuffer(
    BulletinDocument({
      employee, ligne, run, devise: "USD",
      congesPeriode: [], feries: [], primes: [], codesParJour: {},
      signatureSalarie,
    }),
  );

describe("mentionSignature — la phrase imprimée", () => {
  it("espace salarié : nom, matricule, date et heure de Kinshasa", () => {
    expect(mentionSignature(vue())).toBe(
      "Signé électroniquement par Aimée Mutita (matricule PEF-007) le 22/09/2026 à 14 h 05, depuis son espace salarié.",
    );
  });

  it("présentiel : l'appareil de l'entreprise et le responsable présent", () => {
    expect(mentionSignature(vue({ mode: "PRESENTIEL", nomPresentePar: "Dominique Tshiongo" }))).toBe(
      "Signé par Aimée Mutita (matricule PEF-007) le 22/09/2026 à 14 h 05, sur l'appareil de l'entreprise, en présence de Dominique Tshiongo.",
    );
  });

  it("contrat repris (aucun tracé) : on n'invente pas un geste qui n'a pas eu lieu", () => {
    expect(mentionSignature(vue({ traceUrl: null }))).toBe(
      "Accepté électroniquement le 22/09/2026 à 14 h 05, sans signature tracée.",
    );
  });

  it("obsolète : la phrase est préfixée de l'avertissement", () => {
    expect(mentionSignature(vue({ obsolete: true }))).toBe(
      "Document modifié après signature — à resigner. Signé électroniquement par Aimée Mutita (matricule PEF-007) le 22/09/2026 à 14 h 05, depuis son espace salarié.",
    );
  });

  it("aucune espace fine ou insécable : Optima n'en a pas le glyphe, le texte sortirait barré", () => {
    // Ces trois caractères ne sont JAMAIS écrits en littéral ici : un outil d'édition les
    // normalise silencieusement en espace ordinaire, et l'assertion deviendrait une tautologie
    // verte. On les reconstruit donc par leur point de code, seule forme qui ne peut pas être
    // réécrite à notre insu. U+202F = fine insécable (celle qu'émet Intl fr-FR),
    // U+00A0 = insécable, U+2009 = fine. Aucune n'existe dans Optima.
    const INTERDITS = [0x202f, 0x00a0, 0x2009];
    const cas = [
      vue(),
      vue({ mode: "PRESENTIEL", nomPresentePar: "Dominique Tshiongo" }),
      vue({ traceUrl: null }),
      vue({ obsolete: true }),
    ];
    for (const v of cas) {
      const phrase = mentionSignature(v);
      for (const code of INTERDITS) {
        expect(phrase.includes(String.fromCharCode(code)), `U+${code.toString(16).toUpperCase().padStart(4, "0")} dans : ${phrase}`).toBe(false);
      }
    }
  });
});

describe("le bulletin porte le tracé et la mention", () => {
  it("espace salarié : la phrase complète est imprimée", async () => {
    const t = await texteDu(await rendre(imprimable(vue())));
    expect(t).toContain("Signé électroniquement par Aimée Mutita (matricule PEF-007)");
    expect(t).toContain("depuis son espace salarié");
  }, 60_000);

  it("présentiel : le responsable présent est nommé, et l'espace salarié n'est PAS invoqué", async () => {
    const t = await texteDu(await rendre(imprimable(vue({ mode: "PRESENTIEL", nomPresentePar: "Dominique Tshiongo" }))));
    expect(t).toContain("en présence de Dominique Tshiongo");
    expect(t).toContain("sur l'appareil de l'entreprise");
    expect(t).not.toContain("depuis son espace salarié");
  }, 60_000);

  it("obsolète : l'avertissement est imprimé", async () => {
    const t = await texteDu(await rendre(imprimable(vue({ obsolete: true }))));
    expect(t).toContain("Document modifié après signature");
    expect(t).toContain("à resigner");
  }, 60_000);

  it("non signé : la case du salarié reste, sans aucune mention", async () => {
    const t = await texteDu(await rendre(undefined));
    expect(t).toContain("Signature du salarié");
    expect(t).not.toContain("Signé électroniquement");
    expect(t).not.toContain("Document modifié après signature");
  }, 60_000);

  it("un document modifié après signature ne montre PAS le tracé", async () => {
    const [signe, obsolete, nonSigne] = await Promise.all([
      rendre(imprimable(vue())),
      rendre(imprimable(vue({ obsolete: true }))),
      rendre(undefined),
    ]);
    // Ordre STRICT : si les trois comptes étaient égaux, c'est que le tracé n'est JAMAIS intégré
    // et ce test ne prouverait rien.
    expect(nbImages(signe)).toBeGreaterThan(nbImages(obsolete));
    expect(nbImages(obsolete)).toBe(nbImages(nonSigne));
  }, 90_000);

  it("les quatre mentions se composent en Optima (aucun repli sur une police standard)", async () => {
    // Le symbole « ⚠ » (U+26A0) manque à Optima : mesuré, il fait basculer le PDF sur Helvetica,
    // qui dessine une barre noire à la place — exactement le défaut corrigé dans tout ce dépôt le
    // 2026-09-22 sur les montants. L'avertissement est donc porté par les MOTS, pas par un symbole.
    for (const v of [vue(), vue({ mode: "PRESENTIEL", nomPresentePar: "Dominique Tshiongo" }), vue({ obsolete: true }), vue({ traceUrl: null })]) {
      const pdf = await rendre(imprimable(v));
      const polices = policesDuPdf(pdf);
      expect(polices.length).toBeGreaterThan(0);
      expect(polices.filter((p) => !estEmbarquee(p))).toEqual([]);
    }
  }, 120_000);
});
