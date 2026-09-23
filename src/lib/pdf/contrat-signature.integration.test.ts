import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

/**
 * L'ÉCRAN ET LE DOCUMENT DISENT LA MÊME CHOSE.
 *
 * `contrat-buffer` sert l'exemplaire FIGÉ (`pdfAccepteUrl`) quand il est l'exemplaire accepté, et
 * régénère sinon. Depuis le 2026-09-23, SIGNER VAUT ACCEPTATION : la signature pose `accepteLe`
 * au même instant, retire l'ancien exemplaire figé, et un nouveau est figé juste après — il porte
 * le tracé. Restent en base des contrats signés AVANT cette règle (signature tracée, acceptation
 * au clic ou exemplaire figé antérieurs) : leur exemplaire figé est muet et ne doit pas être servi.
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

// L'exemplaire figé est un CONTENU RECONNAISSABLE, pas un PDF : s'il est servi, on le voit tout
// de suite (et `pdf-parse` ne saurait pas le lire — c'est précisément ce qu'on veut détecter).
const FIGE = Buffer.from("%PDF-EXEMPLAIRE-FIGE");
const TRACE = pngMinuscule();
vi.mock("@/lib/storage", () => ({
  lireFichier: async (chemin: string) => (chemin.includes("signatures/") ? TRACE : FIGE),
  televerserFichier: async (chemin: string) => `/fichiers/${chemin}`,
}));

const { genererContratPdf } = await import("./contrat-buffer");
const { enregistrerSignature } = await import("@/lib/signature");

/** Un vrai PNG 2×2, décodable par @react-pdf/renderer (un en-tête suivi de zéros le ferait planter). */
function pngMinuscule(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk+M9QzwAFjDAGAC0GBAG2VOwzAAAAAElFTkSuQmCC",
    "base64",
  );
}

async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const emp = await prisma.employee.create({
    data: {
      matricule: "CS01-PEF", nom: "Claire Signature", sexe: "F", etatCivil: "Célibataire",
      poste: "Cuisinière", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  empId = emp.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

async function creerContrat() {
  return prisma.contrat.create({
    data: {
      employeeId: empId, type: "CDI", dateDebut: new Date("2025-01-01"), heuresHebdo: 48,
      salaireMensuel: 300, devise: "USD", poste: "Cuisinière", statut: "ACTIF",
    },
  });
}

const signer = (contratId: string) =>
  enregistrerSignature(prisma, {
    cible: "CONTRAT", cibleId: contratId, employeeId: empId,
    traceUrl: `/fichiers/signatures/contrat/${contratId}-abc.png`,
    mode: "ESPACE_SALARIE", presenteParId: null,
  });

/** L'ancien clic « Lu et approuvé » (supprimé le 2026-09-23) : horodate et fige l'exemplaire du moment. */
const accepterEtFiger = (contratId: string, quand = new Date()) =>
  prisma.contrat.update({
    where: { id: contratId },
    data: { accepteLe: quand, pdfAccepteUrl: `/fichiers/contrats/${contratId}.pdf` },
  });

/** Ce que fait `lib/signer-document.ts` après la signature : fige l'exemplaire (qui porte le tracé). */
const figerApresSignature = (contratId: string) =>
  prisma.contrat.update({ where: { id: contratId }, data: { pdfAccepteUrl: `/fichiers/contrats/${contratId}.pdf` } });

/**
 * Une signature tracée d'AVANT la règle « signer vaut acceptation » : la signature existe, mais le
 * contrat n'a pas été touché — on remet donc ses champs d'acceptation tels qu'ils étaient.
 */
async function signerAvantLaRegle(contratId: string) {
  const { accepteLe, pdfAccepteUrl } = await prisma.contrat.findUniqueOrThrow({ where: { id: contratId } });
  await signer(contratId);
  await prisma.contrat.update({ where: { id: contratId }, data: { accepteLe, pdfAccepteUrl } });
}

describe("signer vaut acceptation : l'exemplaire figé est celui de la signature", () => {
  it("SIGNER pose accepteLe = signeLe et retire l'exemplaire figé antérieur (muet)", async () => {
    const c = await creerContrat();
    await prisma.contrat.update({ where: { id: c.id }, data: { pdfAccepteUrl: `/fichiers/contrats/${c.id}.pdf` } }); // figé par la Direction
    await signer(c.id);

    const relu = await prisma.contrat.findUniqueOrThrow({ where: { id: c.id } });
    const sig = await prisma.signatureElectronique.findUniqueOrThrow({ where: { cible_cibleId: { cible: "CONTRAT", cibleId: c.id } } });
    expect(relu.accepteLe?.getTime()).toBe(sig.signeLe.getTime());
    expect(relu.pdfAccepteUrl, "l'exemplaire figé AVANT la signature (sans tracé) est resté en place").toBeNull();

    const pdf = await genererContratPdf(c.id);
    expect(pdf!.buffer.equals(FIGE)).toBe(false);
    expect(await texteDu(pdf!.buffer)).toContain("Signé électroniquement par Claire Signature");
  }, 90_000);

  it("signé PUIS figé → l'exemplaire figé fait foi (il porte le tracé)", async () => {
    const c = await creerContrat();
    await signer(c.id);
    await figerApresSignature(c.id);

    const pdf = await genererContratPdf(c.id);
    expect(pdf!.buffer.equals(FIGE), "l'exemplaire figé par la signature n'est pas servi : on régénère").toBe(true);
  }, 60_000);

  it("signature devenue OBSOLÈTE → pas l'exemplaire figé : les conditions actuelles, « à resigner »", async () => {
    // Le salarié invité à resigner doit lire ce qu'il va signer, pas la version d'avant.
    const c = await creerContrat();
    await signer(c.id);
    await figerApresSignature(c.id);
    await prisma.contrat.update({ where: { id: c.id }, data: { salaireMensuel: 450, pdfAccepteObsolete: true } });

    const pdf = await genererContratPdf(c.id);
    expect(pdf!.buffer.equals(FIGE), "l'ancien exemplaire est servi à un salarié invité à resigner").toBe(false);
    const t = await texteDu(pdf!.buffer);
    expect(t).toContain("Document modifié après signature");
    expect(t).toContain("450");
  }, 90_000);

  it("un contrat signé n'écrit pas DEUX FOIS son acceptation", async () => {
    // La mention de signature est la formulation la plus précise ; la ligne historique
    // « Accepté numériquement le … » dit exactement le même fait et doit s'effacer devant elle.
    const c = await creerContrat();
    await signer(c.id);

    const t = await texteDu((await genererContratPdf(c.id))!.buffer);
    expect(t).toContain("Signé électroniquement par Claire Signature");
    expect(t, "l'acceptation est écrite deux fois sur le même document").not.toContain("Accepté numériquement le");
  }, 90_000);
});

describe("contrats d'AVANT la règle : l'exemplaire figé ne peut pas rendre le document muet", () => {
  it("ACCEPTÉ d'un clic puis SIGNÉ → le contrat servi porte le tracé et la mention, pas l'exemplaire figé", async () => {
    const c = await creerContrat();
    await accepterEtFiger(c.id, new Date("2026-09-22T08:00:00Z"));
    await signerAvantLaRegle(c.id);

    const pdf = await genererContratPdf(c.id);
    expect(pdf).not.toBeNull();
    expect(
      pdf!.buffer.equals(FIGE),
      "l'exemplaire figé date de l'acceptation : il ne porte pas le tracé, il ne doit pas être servi",
    ).toBe(false);
    expect(await texteDu(pdf!.buffer)).toContain("Signé électroniquement par Claire Signature");
  }, 90_000);

  it("SIGNÉ puis ACCEPTÉ d'un clic → le contrat servi porte aussi le tracé et la mention", async () => {
    const c = await creerContrat();
    await signerAvantLaRegle(c.id);
    await accepterEtFiger(c.id);

    const pdf = await genererContratPdf(c.id);
    expect(pdf!.buffer.equals(FIGE)).toBe(false);
    expect(await texteDu(pdf!.buffer)).toContain("Signé électroniquement par Claire Signature");
  }, 90_000);

  it("un contrat accepté mais JAMAIS signé garde sa ligne « Accepté numériquement le … »", async () => {
    // Sans mention de signature, cette ligne est le seul témoin : elle ne doit pas disparaître.
    const c = await creerContrat();
    await prisma.contrat.update({ where: { id: c.id }, data: { accepteLe: new Date("2026-03-12T09:30:00Z") } });

    const t = await texteDu((await genererContratPdf(c.id))!.buffer);
    expect(t).toContain("Accepté numériquement le");
  }, 90_000);

  it("accepté SANS jamais signer → l'exemplaire figé fait toujours foi (rien n'a changé)", async () => {
    const c = await creerContrat();
    await accepterEtFiger(c.id);

    const pdf = await genererContratPdf(c.id);
    expect(pdf!.buffer.equals(FIGE), "sans signature tracée, l'exemplaire figé reste celui qui fait foi").toBe(true);
  }, 60_000);
});

describe("« Fait à Kinshasa, le … » : la date de la signature, à l'heure de Kinshasa", () => {
  // 1er avril à 00 h 30 à Kinshasa, encore le 31 mars en UTC (l'heure du serveur). Loin
  // d'« aujourd'hui » à dessein : une date de signature égale au jour du test laisserait passer
  // un contrat daté du jour de génération.
  const INSTANT = new Date("2026-03-31T23:30:00.000Z");
  const aujourdhui = () =>
    new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Kinshasa", day: "numeric", month: "long", year: "numeric" })
      .format(new Date()).replace(/^1 /, "1er ");

  async function signerA(contratId: string, quand: Date) {
    await signer(contratId);
    // Même instant sur les deux lignes, comme l'écrit `enregistrerSignature`.
    await prisma.signatureElectronique.update({ where: { cible_cibleId: { cible: "CONTRAT", cibleId: contratId } }, data: { signeLe: quand } });
    await prisma.contrat.update({ where: { id: contratId }, data: { accepteLe: quand } });
  }

  it("contrat signé (à jour) → le jour de la signature à Kinshasa, pas le jour de génération ni la veille UTC", async () => {
    const c = await creerContrat();
    await signerA(c.id, INSTANT);

    const t = await texteDu((await genererContratPdf(c.id))!.buffer);
    expect(t, "le contrat signé porte la date du jour de génération, ou la veille UTC").toContain("Fait à Kinshasa, le 1er avril 2026");
  }, 90_000);

  it("signature OBSOLÈTE → la date du jour, comme un contrat jamais signé", async () => {
    const c = await creerContrat();
    await signerA(c.id, INSTANT);
    await prisma.contrat.update({ where: { id: c.id }, data: { salaireMensuel: 480 } });

    const t = await texteDu((await genererContratPdf(c.id))!.buffer);
    expect(t).toContain(`Fait à Kinshasa, le ${aujourdhui()}`);
  }, 90_000);

  it("contrat jamais signé → la date du jour à Kinshasa", async () => {
    const c = await creerContrat();
    const t = await texteDu((await genererContratPdf(c.id))!.buffer);
    expect(t).toContain(`Fait à Kinshasa, le ${aujourdhui()}`);
  }, 90_000);
});

