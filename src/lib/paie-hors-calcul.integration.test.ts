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
const { rafraichirPaieDuMois, rafraichirPaieAffichee } = await import("@/lib/paie-refresh");
const { reactiverEmploye } = await import("@/app/(app)/employes/actions");
const { mettreAJourConfig } = await import("@/app/(app)/parametres/actions");
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

  it("paie clôturée avec une ligne hors calcul : l'ouverture de /paie ne la recalcule plus (taux figé, aucune ligne ajoutée)", async () => {
    const avant = await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 }, include: { lignes: true } });
    await prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: 2500 } });
    const embauche = await brigade("CC01-PEF", "Cléo Cibangu"); // embauchée après la clôture
    await rafraichirPaieAffichee(9, 2026);
    const apres = await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 }, include: { lignes: true } });
    expect(Number(apres.tauxChangeUtilise)).toBe(Number(avant.tauxChangeUtilise));
    expect(apres.lignes.map((l) => l.id).sort()).toEqual(avant.lignes.map((l) => l.id).sort());
    await prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: 2300 } });
    await prisma.employee.update({ where: { id: embauche }, data: { actif: false } });
  });

  it("mois passé clôturé : réactiver la fiche aujourd'hui ne fait pas revenir la ligne dans ses totaux ; réactiver = Direction", async () => {
    const bob = await ligne(ids.bob);
    const decl = async () => Object.fromEntries((await calculerDeclarationsMois(9, 2026))!.lignes.map((x) => [x.type, x.montantUSD]));
    const avant = await decl();
    await prisma.config.update({ where: { id: "singleton" }, data: { moisCourant: 10 } }); // septembre est passé
    A.user.role = "MANAGER";
    await expect(reactiverEmploye(ids.ada)).rejects.toThrow(/Accès refusé/);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: ids.ada } })).actif).toBe(false);
    A.user.role = "ADMIN";
    await reactiverEmploye(ids.ada);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: ids.ada } })).actif).toBe(true);
    expect(await prisma.journalAudit.count({ where: { entite: "Employee", entiteId: ids.ada, champ: "actif", nouvelleValeur: "true" } })).toBe(1);
    // Septembre ne bouge pas : la ligne PAS VALIDÉE d'Ada reste hors de ses totaux et de ses exports.
    expect(await decl()).toEqual(avant);
    expect((await decl()).IPR).toBeCloseTo(Number(bob.iprCalculeUSD), 2);
    const run = await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 }, include: { lignes: true } });
    expect((await separerHorsCalcul(prisma, run.lignes)).horsCalcul.map((x) => x.employeeId)).toEqual([ids.ada]);
    await prisma.config.update({ where: { id: "singleton" }, data: { moisCourant: 9 } });
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
    const versionRemise = await prisma.versionBulletin.findFirstOrThrow({ where: { payrollLineId: l.id, numeroVersion: versions } });
    const netRemis = Number((versionRemise.snapshot as { ligne: { salNetUSD: string } }).ligne.salNetUSD);

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
    const texteArchive = (await pagesDuPdf(archive!.buffer)).map((p) => p.plat).join(" ");
    const compact = texteArchive.replace(/[\s\u202f\u00a0]/g, "");
    expect(texteArchive).toContain("Ada Kalala");
    // Les montants REMIS, pas ceux recalculés depuis (prime de 30 ajoutée après la remise).
    expect(compact).toContain(netRemis.toFixed(2).replace(".", ","));
    expect(compact).not.toContain((netRemis + 30).toFixed(2).replace(".", ","));
    // Archive dite comme telle, signature valable pour CETTE version, datée de la remise.
    expect(texteArchive).toMatch(/archive : montants figés/);
    expect(texteArchive).not.toMatch(/à resigner/);
    expect(texteArchive).toMatch(/Accepté électroniquement le/); // signature sans tracé (test) : la mention de CETTE version
    const jourRemise = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Kinshasa" }).format(versionRemise.genereLe);
    expect(texteArchive).toContain(`Fait à Kinshasa, le ${jourRemise}`);

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

describe("mois courant clôturé : une ligne rouverte pour correction reste comptée", () => {
  it("rouverte après clôture : comptée et validable ; on ne change pas de mois tant qu'elle attend sa revalidation", async () => {
    await prisma.config.update({ where: { id: "singleton" }, data: { moisCourant: 9 } });
    await calculerPaieDuMois();
    expect(await ignorerRedirection(cloturerPaie())).toBe("");
    const l = await ligne(ids.ada);
    expect(l.statutPaiement).toBe("VALIDE");
    await changerStatutPaie(l.id, fd({ versStatut: "PAS_VALIDE" })); // rouverte pour correction
    const run = await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 }, include: { lignes: true } });
    expect(run.statut).toBe("VALIDE");
    expect((await separerHorsCalcul(prisma, run.lignes)).horsCalcul).toEqual([]); // comptée
    const changerDeMois = () => mettreAJourConfig(fd({ moisCourant: "10", anneeCourante: "2026", tauxChangeCDF: "2300", jourPaie: "30" }));
    expect(decodeURIComponent(await ignorerRedirection(changerDeMois()))).toMatch(/revalidez-les dans Paie avant de changer de mois/);
    expect((await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } })).moisCourant).toBe(9);
    await changerStatutPaie(l.id, fd({ versStatut: "VALIDE" }));
    expect((await ligne(ids.ada)).statutPaiement).toBe("VALIDE");
    expect(await ignorerRedirection(changerDeMois())).toBe("");
    expect((await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } })).moisCourant).toBe(10);
    await prisma.config.update({ where: { id: "singleton" }, data: { moisCourant: 9 } });
  });
});
