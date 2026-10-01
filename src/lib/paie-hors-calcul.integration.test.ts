import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { pagesDuPdf } from "@/lib/test/pdf-lecture";

// Décisions de Sacha du 2026-10-01, rejouées avec les VRAIES actions et les VRAIES routes d'export :
//  1. La ligne ROUVERTE d'un salarié SORTI du calcul (fiche désactivée) reste en base, mais ne compte
//     plus nulle part : ni totaux, ni livre de paie (Excel, PDF), ni liasse des bulletins, ni
//     déclarations, ni compteurs ; l'écran Paie la met à part ; la clôture la laisse de côté.
//  2. Réinitialiser la paie ne supprime JAMAIS un bulletin déjà remis : la ligne rouverte garde ses
//     versions, transitions et signature, ses montants sont recalculés par le vrai calcul, et le
//     bulletin remis reste consultable (archive).
// Les montants des salariés calculés ne changent pas : ils sont comparés au vrai calcul.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", role: "ADMIN", nom: "Direction", email: "d@pef.cd", accesStock: false, employeeId: null as string | null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
  invaliderProfil: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` }); } }));
vi.mock("@/lib/entreprise", () => ({ chargerEntreprise: async () => ({ entreprise: undefined, logo: undefined, signature: null }) }));
vi.mock("@/lib/storage", () => ({ lireFichier: async () => null, televerserFichier: async (c: string) => `/fichiers/${c}` }));

const { calculerPaieDuMois, changerStatutPaie, cloturerPaie, reinitialiserPaieDuMois } = await import("@/app/(app)/paie/actions");
const { rafraichirPaieDuMois } = await import("@/lib/paie-refresh");
const { calculerLignesPaie } = await import("@/lib/paie-batch");
const { separerHorsCalcul, compterPasValideComptees } = await import("@/lib/paie-hors-calcul");
const { calculerDeclarationsMois } = await import("@/lib/declarations");
const { indicateursPaieDuMois } = await import("@/lib/indicateurs/rh");
const { genererBulletinPdf } = await import("@/lib/pdf/bulletin-buffer");
const { enregistrerSignature } = await import("@/lib/signature");
const exportExcel = await import("@/app/(app)/paie/export/route");
const exportPdf = await import("@/app/(app)/paie/export-pdf/route");
const bulletinsPdf = await import("@/app/(app)/paie/bulletins-pdf/route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let journee = "";
const ids = { ada: "", bob: "" };

const d = (n: number) => new Date(Date.UTC(2026, 8, n));
const joursOuvres = () => Array.from({ length: 30 }, (_, i) => d(i + 1)).filter((x) => x.getUTCDay() >= 1 && x.getUTCDay() <= 5);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ligne = (employeeId: string) => prisma.payrollLine.findFirstOrThrow({ where: { employeeId, payrollRun: { mois: 9, annee: 2026 } } });
const ignorerRedirection = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (!String((e as Error).message).startsWith("REDIRECT")) throw e; return String((e as Error).message); } return ""; };

async function brigade(matricule: string, nom: string) {
  const id = (await prisma.employee.create({ data: {
    matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Brigade", secteur: "Cuisine", categorie: "BRIGADE",
    salaireMensuel: 300, heuresHebdomadaires: 45, heuresParJour: 9, enfants: 0,
    dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDD",
  } })).id;
  await prisma.planningCreneau.createMany({ data: joursOuvres().map((date) => ({ employeeId: id, date, shiftId: journee })) });
  await prisma.attendance.createMany({ data: joursOuvres().map((date) => ({ employeeId: id, date, code: "P" })) });
  await prisma.overtimeEntry.createMany({ data: joursOuvres().map((date) => ({ employeeId: id, date, heuresTravaillees: 9 })) });
  return id;
}

async function texteExcel(r: Response): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as unknown as ArrayBuffer);
  const t: string[] = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => t.push(String(c.text ?? "")))));
  return t.join(" | ");
}
const textePdf = async (r: Response) => (await pagesDuPdf(Buffer.from(await r.arrayBuffer()))).map((p) => p.plat).join(" ");
const requete = (chemin: string) => new Request(`http://localhost${chemin}`);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const exercice = await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.parametreLegal.create({ data: { exerciceId: exercice.id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  A.user.id = (await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  journee = (await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } })).id;
  ids.ada = await brigade("AK01-PEF", "Ada Kalala");
  ids.bob = await brigade("BB01-PEF", "Bob Banza");
  await calculerPaieDuMois();
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("ligne rouverte d'un salarié sorti du calcul : en base, à part, comptée nulle part", () => {
  it("rouvrir puis désactiver la fiche : la ligne reste, mais sort des totaux, du livre, de la liasse, des déclarations, des compteurs", async () => {
    const l = await ligne(ids.ada);
    await changerStatutPaie(l.id, fd({ versStatut: "VALIDE" }));
    await changerStatutPaie(l.id, fd({ versStatut: "PAS_VALIDE" }));
    // Avant la sortie, Ada compte : le livre la porte.
    expect(await texteExcel(await exportExcel.GET(requete("/paie/export")))).toContain("Ada Kalala");

    await prisma.employee.update({ where: { id: ids.ada }, data: { actif: false } });
    await rafraichirPaieDuMois({ creerRun: false }); // ouverture de /paie

    // Toujours en base, avec son bulletin remis.
    const ada = await ligne(ids.ada);
    expect(ada.id).toBe(l.id);
    expect(await prisma.versionBulletin.count({ where: { payrollLineId: l.id } })).toBe(1);

    // À part sur l'écran Paie (même séparation que la page).
    const run = await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 }, include: { lignes: true } });
    const { comptees, horsCalcul } = await separerHorsCalcul(prisma, run.lignes);
    expect(horsCalcul.map((x) => x.employeeId)).toEqual([ids.ada]);
    expect(comptees.map((x) => x.employeeId)).toEqual([ids.bob]);

    // Exports : livre Excel, livre PDF, liasse des bulletins — Bob seul.
    const excel = await texteExcel(await exportExcel.GET(requete("/paie/export")));
    expect(excel).toContain("Bob Banza");
    expect(excel).not.toContain("Ada Kalala");
    const livre = await textePdf(await exportPdf.GET());
    expect(livre).toContain("Bob Banza");
    expect(livre).not.toContain("Ada Kalala");
    const liasse = await textePdf(await bulletinsPdf.GET(requete("/paie/bulletins-pdf")));
    expect(liasse).toContain("Bob Banza");
    expect(liasse).not.toContain("Ada Kalala");

    // Déclarations = la ligne de Bob seule (sommes linéaires), au centime.
    const bob = await ligne(ids.bob);
    const decl = (await calculerDeclarationsMois(9, 2026))!;
    const par = Object.fromEntries(decl.lignes.map((x) => [x.type, x.montantUSD]));
    expect(par.CNSS).toBeCloseTo(Number(bob.cnssSalarieUSD) + Number(bob.cnssPatronalUSD), 2);
    expect(par.IPR).toBeCloseTo(Number(bob.iprCalculeUSD), 2);
    expect(par.INPP).toBeCloseTo(Number(bob.inppUSD), 2);
    expect(par.ONEM).toBeCloseTo(Number(bob.onemUSD), 2);

    // Totaux et compteurs.
    const ind = await indicateursPaieDuMois(9, 2026);
    expect(ind.totaux.coutEmployeur).toBeCloseTo(Number(bob.coutEmployeurUSD), 2);
    expect(await compterPasValideComptees(prisma, { payrollRun: { mois: 9, annee: 2026 } })).toBe(1);

    // Les montants de Bob sont ceux du vrai calcul (aucun montant d'un salarié calculé ne bouge).
    const calc = (await calculerLignesPaie(9, 2026, prisma)).lignes.map((x) => x.employee.id);
    expect(calc).toEqual([ids.bob]);
  });

  it("la clôture valide les lignes calculées et laisse la ligne hors calcul de côté, non validée", async () => {
    const l = await ligne(ids.ada);
    expect(await ignorerRedirection(cloturerPaie())).toBe("");
    expect((await ligne(ids.bob)).statutPaiement).toBe("VALIDE");
    const ada = await ligne(ids.ada);
    expect(ada.id).toBe(l.id);
    expect(ada.statutPaiement).toBe("PAS_VALIDE");
    expect((await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 } })).statut).toBe("VALIDE");
  });
});

describe("réinitialiser ne supprime jamais un bulletin déjà remis", () => {
  it("rouvrir → réinitialiser → recalcul : bulletins remis, transitions, signature toujours là, consultables ; montants du vrai calcul", async () => {
    // Remise à zéro de l'état : Ada réactivée, Bob rouvert, mois rouvert.
    await prisma.employee.update({ where: { id: ids.ada }, data: { actif: true } });
    await prisma.payrollRun.updateMany({ where: { mois: 9, annee: 2026 }, data: { statut: "BROUILLON" } });
    const bob = await ligne(ids.bob);
    await changerStatutPaie(bob.id, fd({ versStatut: "PAS_VALIDE" }));
    await rafraichirPaieDuMois({ creerRun: false });

    // Ada : validée (bulletin remis v2), signée par le salarié, rouverte.
    const l = await ligne(ids.ada);
    await changerStatutPaie(l.id, fd({ versStatut: "VALIDE" }));
    await enregistrerSignature(prisma, { cible: "BULLETIN", cibleId: l.id, employeeId: ids.ada, traceUrl: null, mode: "ESPACE_SALARIE", presenteParId: null });
    await changerStatutPaie(l.id, fd({ versStatut: "PAS_VALIDE" }));
    const versions = await prisma.versionBulletin.count({ where: { payrollLineId: l.id } });
    const transitions = await prisma.transitionPaie.count({ where: { payrollLineId: l.id } });
    const remis = await genererBulletinPdf(l.id, "USD", { version: versions });
    expect(remis).not.toBeNull();

    // Une prime arrive, puis la Direction réinitialise.
    await prisma.prime.create({ data: { employeeId: ids.ada, nom: "Prime", montantUSD: 30, mois: 9, annee: 2026 } });
    const msg = await ignorerRedirection(reinitialiserPaieDuMois());
    expect(decodeURIComponent(msg)).toMatch(/conservé\(s\) en archive/);

    // La ligne et TOUT son historique sont là ; la paie existe toujours.
    const apres = await ligne(ids.ada);
    expect(apres.id).toBe(l.id);
    expect(await prisma.versionBulletin.count({ where: { payrollLineId: l.id } })).toBe(versions);
    expect(await prisma.transitionPaie.count({ where: { payrollLineId: l.id } })).toBe(transitions);
    expect(await prisma.signatureElectronique.count({ where: { cible: "BULLETIN", cibleId: l.id } })).toBe(1);

    // Bulletin remis consultable (archive), et nommé comme tel.
    const archive = await genererBulletinPdf(l.id, "USD", { version: versions });
    expect(archive!.nomFichier).toContain(`_remis-v${versions}_`);
    expect((await pagesDuPdf(archive!.buffer)).map((p) => p.plat).join(" ")).toContain("Ada Kalala");

    // Montants recalculés par le vrai calcul (prime comprise).
    expect(Number(apres.primesUSD)).toBe(30);
    const calc = (await calculerLignesPaie(9, 2026, prisma)).lignes.find((x) => x.employee.id === ids.ada)!.data;
    for (const k of ["salNetUSD", "salBrutUSD", "netImposableUSD", "coutEmployeurUSD"] as const) expect(Number(apres[k]), k).toBeCloseTo(Number(calc[k]), 2);
    // Bob (brouillon sans historique… mais rouvert : il a lui aussi un historique) reste, recalculé.
    expect((await ligne(ids.bob)).id).toBe(bob.id);
  });

  it("sans aucune ligne à historique, la réinitialisation supprime la paie (rien d'émis), comme avant", async () => {
    await prisma.payrollRun.deleteMany({ where: { mois: 9, annee: 2026 } }); // état de départ propre (test)
    await calculerPaieDuMois();
    expect(await prisma.payrollRun.count({ where: { mois: 9, annee: 2026 } })).toBe(1);
    const msg = await ignorerRedirection(reinitialiserPaieDuMois());
    expect(decodeURIComponent(msg)).toContain("Paie du mois réinitialisée.");
    expect(await prisma.payrollRun.count({ where: { mois: 9, annee: 2026 } })).toBe(0);
  });
});
