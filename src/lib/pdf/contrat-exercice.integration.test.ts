import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

/**
 * LE CONTRAT LIT L'EXERCICE FISCAL ACTIF — ET AUCUN AUTRE.
 *
 * `contrat-buffer` lisait préavis, droits de congé et « salaires saisis en net » dans TOUTE la table
 * `ParametreLegal`, puis prenait la première ligne venue. Avec un seul exercice, personne ne le
 * voyait ; dès qu'un second existe (2027 préparé à l'avance), l'ordre physique des lignes décide —
 * et une simple mise à jour d'une valeur 2026 déplace sa ligne APRÈS celles de 2027.
 *
 * Ici : 2027 INACTIF, créé en premier et aux valeurs toutes différentes (24 j de congé, préavis
 * 45/60 j, salaires en NET) ; 2026 ACTIF (18 j, préavis 14/30 j, salaires au BRUT). Le contrat doit
 * imprimer 2026, même pour un contrat qui prend effet en 2027 (décision : les conditions ACTUELLES,
 * voir `chargerParametresContrat`). Et quand l'exercice actif n'a pas la valeur, il ne va pas la
 * chercher dans l'autre.
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
vi.mock("@/lib/storage", () => ({ lireFichier: async () => null, televerserFichier: async () => "/fichiers/x" }));

const { genererContratPdf } = await import("./contrat-buffer");
const { ParametreLegalManquantError } = await import("@/lib/config");

async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;
let ex2026: number;
let ex2027: number;

async function poser(exerciceId: number, cle: string, valeur: number) {
  await prisma.parametreLegal.upsert({
    where: { exerciceId_cle: { exerciceId, cle } },
    update: { valeur },
    create: { exerciceId, cle, valeur, libelle: cle },
  });
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });

  // 2027 D'ABORD : ses lignes précèdent celles de 2026 dans la table — une lecture qui ne filtre pas
  // l'exercice tombe sur elles.
  ex2027 = (await seedParametresLegaux(prisma, 2027)).id;
  await prisma.exerciceFiscal.update({ where: { id: ex2027 }, data: { actif: false } });
  await poser(ex2027, "droits_conges_annuel", 24);
  await poser(ex2027, "preavis_jours_demission", 45);
  await poser(ex2027, "preavis_jours_licenciement", 60);
  await poser(ex2027, "salaires_saisis_en_net", 1);

  ex2026 = (await seedParametresLegaux(prisma, 2026)).id;
  await poser(ex2026, "preavis_jours_demission", 14);
  await poser(ex2026, "preavis_jours_licenciement", 30);

  empId = (await prisma.employee.create({
    data: {
      matricule: "CE01-PEF", nom: "Céline Exercice", sexe: "F", etatCivil: "Célibataire",
      poste: "Cuisinière", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  })).id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

// Chaque test qui retire une valeur ou bascule l'exercice actif la remet : l'état de départ vaut
// pour tous.
afterEach(async () => {
  await prisma.exerciceFiscal.update({ where: { id: ex2027 }, data: { actif: false } });
  await prisma.exerciceFiscal.update({ where: { id: ex2026 }, data: { actif: true } });
  await poser(ex2026, "droits_conges_annuel", 18);
  await poser(ex2026, "preavis_jours_demission", 14);
  await poser(ex2026, "preavis_jours_licenciement", 30);
  await poser(ex2027, "salaires_saisis_en_net", 1);
  await prisma.parametreLegal.deleteMany({ where: { exerciceId: ex2026, cle: "salaires_saisis_en_net" } });
});

/**
 * Les refus doivent venir de la lecture du CONTRAT. Avec « salaires en net » à 1 en 2027, une
 * lecture fautive passerait par `chargerParametresPaie`, qui lèverait le même message à sa place :
 * le test resterait vert sur un contrat qui aurait emprunté 2027. On coupe ce chemin.
 */
const sansRicochetNet = () => poser(ex2027, "salaires_saisis_en_net", 0);

const contrat = (dateDebut: string) =>
  prisma.contrat.create({
    data: {
      employeeId: empId, type: "CDI", dateDebut: new Date(dateDebut), heuresHebdo: 48,
      salaireMensuel: 300, devise: "USD", poste: "Cuisinière", statut: "ACTIF",
    },
  });

async function texteContrat(dateDebut = "2026-03-01") {
  const c = await contrat(dateDebut);
  const pdf = await genererContratPdf(c.id);
  return texteDu(pdf!.buffer);
}

describe("le contrat de travail lit les paramètres légaux de l'exercice fiscal ACTIF", () => {
  it("2026 actif, 2027 inactif aux valeurs différentes → congés, préavis et nature du salaire de 2026", async () => {
    const t = await texteContrat();
    expect(t).toContain("à hauteur de 18 jours ouvrables");
    expect(t).toContain("14 jours en cas de démission");
    expect(t).toContain("30 jours en cas de licenciement");
    expect(t).toContain("rémunération mensuelle brute");
    expect(t, "le droit à congé de 2027 (inactif) est imprimé").not.toContain("24 jours ouvrables");
    expect(t, "un préavis de 2027 (inactif) est imprimé").not.toMatch(/45 jours|60 jours/);
    expect(t, "l'interrupteur « salaires en net » de 2027 (inactif) s'applique").not.toContain("rémunération mensuelle nette");
  }, 90_000);

  it("contrat qui prend effet en 2027 → toujours l'exercice ACTIF (2026), pas celui de la date d'effet", async () => {
    const t = await texteContrat("2027-01-01");
    expect(t).toContain("à hauteur de 18 jours ouvrables");
    expect(t).toContain("14 jours en cas de démission");
    expect(t).not.toContain("24 jours ouvrables");
  }, 90_000);

  it("2027 devenu actif → le contrat suit (preuve que c'est bien l'exercice actif qui décide, pas 2026 en dur)", async () => {
    await prisma.exerciceFiscal.update({ where: { id: ex2026 }, data: { actif: false } });
    await prisma.exerciceFiscal.update({ where: { id: ex2027 }, data: { actif: true } });
    const t = await texteContrat();
    expect(t).toContain("à hauteur de 24 jours ouvrables");
    expect(t).toContain("45 jours en cas de démission");
    expect(t).toContain("60 jours en cas de licenciement");
    expect(t).toContain("rémunération mensuelle nette");
    expect(t).toMatch(/salaire brut : [\d\s  ,.]+ USD/);
  }, 90_000);

  it("« salaires en net » dans l'autre sens : 1 en 2026 actif, 0 en 2027 → contrat au NET", async () => {
    await poser(ex2026, "salaires_saisis_en_net", 1);
    await poser(ex2027, "salaires_saisis_en_net", 0);
    const t = await texteContrat();
    expect(t).toContain("rémunération mensuelle nette");
    expect(t).toContain("à hauteur de 18 jours ouvrables");
  }, 90_000);

  it("préavis absents de l'exercice actif → « préavis légal », jamais ceux de l'autre exercice", async () => {
    await prisma.parametreLegal.deleteMany({ where: { exerciceId: ex2026, cle: { in: ["preavis_jours_demission", "preavis_jours_licenciement"] } } });
    const t = await texteContrat();
    expect(t).toContain("moyennant un préavis légal");
    expect(t).not.toMatch(/45 jours|60 jours/);
  }, 90_000);

  it("droits de congé absents de l'exercice actif → refus qui nomme la clé et l'exercice, sans emprunter 2027", async () => {
    await sansRicochetNet();
    await prisma.parametreLegal.deleteMany({ where: { exerciceId: ex2026, cle: "droits_conges_annuel" } });
    const c = await contrat("2026-03-01");
    const essai = genererContratPdf(c.id);
    await expect(essai).rejects.toBeInstanceOf(ParametreLegalManquantError);
    await expect(essai).rejects.toThrow("Paramètre légal manquant ou vide : droits_conges_annuel (exercice 2026).");
  }, 90_000);

  it("aucun exercice actif → refus clair, pas un contrat sans chiffres", async () => {
    await sansRicochetNet();
    await prisma.exerciceFiscal.update({ where: { id: ex2026 }, data: { actif: false } });
    const c = await contrat("2026-03-01");
    await expect(genererContratPdf(c.id)).rejects.toThrow(/Aucun exercice fiscal actif/);
  }, 90_000);
});
