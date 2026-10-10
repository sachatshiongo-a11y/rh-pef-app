import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jetonDe } from "@/lib/test/paie-jeton";
import { pagesDuPdf } from "@/lib/test/pdf-lecture";

// AUDIT PAIE DU 2026-10-10 — DOCUMENTS DE PAIE ET DÉCLARATIONS, rejoués avec les VRAIES actions, les
// VRAIES routes et le VRAI générateur de PDF sur une base réelle :
//  1. un bulletin dont la ligne n'est ni validée ni payée porte PROVISOIRE (unité, liasse, livre, bordereau) ;
//  2. une ligne validée/payée réimprimée garde la fiche salarié de sa validation, pas celle du jour ;
//  3. congés du bulletin bornés au mois, maladie/sans solde à part, période figée dans l'instantané ;
//  4. contrat en CDD/CDF : brut reconstitué en dollars puis reconverti ;
//  5. déclarations : provisoire, marquage refusé, montant figé affiché, taux lus dans les paramètres ;
//  6. Excel des cotisations = mois choisi ; 7. mois clôturé : liasse, ZIP, livre de paie ; 
// Les tests s'enchaînent sur une même base : l'ordre compte.
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
vi.mock("@/lib/garde-page", () => ({ exigerPageRH: async () => A.user }));
vi.mock("@/lib/entreprise", () => ({ chargerEntreprise: async () => ({ entreprise: undefined, logo: undefined, signature: null }) }));
vi.mock("@/lib/storage", () => ({ lireFichier: async () => null, televerserFichier: async (c: string) => `/fichiers/${c}` }));

const { calculerPaieDuMois, changerStatutPaie } = await import("@/app/(app)/paie/actions");
const { genererBulletinPdf } = await import("@/lib/pdf/bulletin-buffer");
const { genererContratPdf } = await import("@/lib/pdf/contrat-buffer");
const { chargerDonneesBulletinsDuMois, bulletinsPourPdf } = await import("@/lib/paie-bulletins");
const { BulletinsDocument } = await import("@/lib/pdf/bulletin");
const { renderPdfBuffer } = await import("@/lib/pdf/fonts");
const { calculerDeclarationsMois } = await import("@/lib/declarations");
const { marquerDeclaration } = await import("@/app/(app)/declarations/actions");
const bulletinsPdf = await import("@/app/(app)/paie/bulletins-pdf/route");
const bulletinsZip = await import("@/app/(app)/paie/bulletins-zip/route");
const exportPdf = await import("@/app/(app)/paie/export-pdf/route");
const exportExcelLivre = await import("@/app/(app)/paie/export/route");
const declExport = await import("@/app/(app)/declarations/export/route");
const declExcel = await import("@/app/(app)/declarations/export-excel/route");
const pageDeclarations = (await import("@/app/(app)/declarations/page")).default;
const pageHistorique = (await import("@/app/(app)/historique/[id]/page")).default;

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let journee = "";
const ids = { ada: "", bob: "" };

const d = (n: number) => new Date(Date.UTC(2026, 8, n));
const joursOuvres = () => Array.from({ length: 30 }, (_, i) => d(i + 1)).filter((x) => x.getUTCDay() >= 1 && x.getUTCDay() <= 5);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ligne = (employeeId: string) => prisma.payrollLine.findFirstOrThrow({ where: { employeeId, payrollRun: { mois: 9, annee: 2026 } } });
const requete = (chemin: string) => new Request(`http://localhost${chemin}`);
const valider = async (employeeId: string) => { const l = await ligne(employeeId); await changerStatutPaie(l.id, fd({ versStatut: "VALIDE", jeton: await jetonDe(prisma, l.id) })); return l.id; };
const texte = async (pdf: Buffer) => (await pagesDuPdf(pdf)).map((p) => p.plat).join(" || ");
const textePdf = async (r: Response) => texte(Buffer.from(await r.arrayBuffer()));
const htmlDeclarations = async (q = "mois=9&annee=2026") => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const sp = Object.fromEntries(new URLSearchParams(q));
  return renderToStaticMarkup(await pageDeclarations({ searchParams: Promise.resolve(sp) }));
};
const refus = async (p: Promise<unknown>) => { try { await p; } catch (e) { return decodeURIComponent(String((e as Error).message)); } throw new Error("aucun refus"); };

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

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  A.user.id = (await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  journee = (await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } })).id;
  ids.ada = await brigade("AK01-PEF", "Ada Kalala");
  ids.bob = await brigade("BB01-PEF", "Bob Banza");
  await calculerPaieDuMois();
  await prisma.typeConge.createMany({ data: [
    { nom: "Congé annuel", tauxPct: 100, compteDansSolde: true, ordre: 1 },
    { nom: "Congé maladie", tauxPct: null, compteDansSolde: false, ordre: 2 },
    { nom: "Congé sans solde", tauxPct: 0, compteDansSolde: false, ordre: 3 },
  ], skipDuplicates: true });
  const conge = (type: string, debut: string, fin: string) => prisma.leaveRequest.create({ data: {
    employeeId: ids.ada, type, dateDebut: new Date(`${debut}T00:00:00Z`), dateFin: new Date(`${fin}T00:00:00Z`), nbJours: 1, statut: "APPROUVE",
  } });
  await conge("Congé annuel", "2026-09-21", "2026-10-17"); // à cheval sur septembre / octobre
  await conge("Congé maladie", "2026-09-02", "2026-09-03");
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("1 et 3 — bulletin non validé : PROVISOIRE ; congés bornés au mois, maladie à part", () => {
  it("brouillon : bandeau PROVISOIRE, congé annuel rogné au 30/09 (9 jours, pas 24), maladie sous « Autres absences »", async () => {
    const pdf = await genererBulletinPdf((await ligne(ids.ada)).id, "USD");
    const t = await texte(pdf!.buffer);
    expect(t).toContain("PROVISOIRE — non validé");
    expect(t).toMatch(/du 21\/09\/2026 au 30\/09\/2026 — 9 jour\(s\) ouvrable\(s\)/);
    expect(t).toContain("compté sur ce mois seulement");
    expect(t).toContain("Total congés : 9 jour(s)");
    expect(t).not.toContain("17/10/2026");
    // La maladie n'est ni sous « Congés » ni dans le total des congés.
    expect(t).toMatch(/AUTRES ABSENCES AUTORISÉES[^|]*Congé maladie : du 02\/09\/2026 au 03\/09\/2026 — 2 jour\(s\) ouvrable\(s\)/);
  }, 120_000);

  it("la liasse du mois : seules les pages des bulletins non validés portent PROVISOIRE", async () => {
    // Avant toute validation : les deux pages. (Le ZIP et la liasse partagent `bulletinsPourPdf`.)
    const donnees = (await chargerDonneesBulletinsDuMois(9, 2026))!;
    const pages = await pagesDuPdf(await renderPdfBuffer(BulletinsDocument({ bulletins: bulletinsPourPdf(donnees), devise: "USD" })));
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.plat.includes("PROVISOIRE — non validé"))).toBe(true);
    // Le livre de paie (PDF et Excel) qui contient du non validé le dit aussi.
    expect(await textePdf(await exportPdf.GET(requete("/paie/export-pdf")))).toContain("PROVISOIRE — non validé");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await (await exportExcelLivre.GET(requete("/paie/export"))).arrayBuffer()) as unknown as ArrayBuffer);
    const cellules: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => cellules.push(String(c.text ?? "")))));
    expect(cellules.join(" | ")).toContain("PROVISOIRE");
  }, 120_000);
});

describe("2 — ligne validée ou payée réimprimée : la fiche de la validation, pas celle du jour", () => {
  let lignePayee = "";
  it("la validation fige les congés du mois dans l'instantané", async () => {
    lignePayee = await valider(ids.ada);
    const v = await prisma.versionBulletin.findFirstOrThrow({ where: { payrollLineId: lignePayee } });
    const conges = (v.snapshot as { conges: { dateDebut: string; dateFin: string; type: string; categorie: string; jours: number }[] }).conges;
    const annuel = conges.find((c) => c.type === "Congé annuel")!;
    expect(annuel.dateDebut.slice(0, 10)).toBe("2026-09-21");
    expect(annuel.dateFin.slice(0, 10)).toBe("2026-09-30");
    expect(annuel.jours).toBe(9);
    expect(annuel.categorie).toBe("CONGE");
    expect(conges.find((c) => c.type === "Congé maladie")!.categorie).toBe("AUTRE");
  }, 120_000);

  it("hausse de salaire, enfants et banque saisis APRÈS la validation : le bulletin réimprimé garde l'ancien (et plus de bandeau PROVISOIRE)", async () => {
    await prisma.employee.update({ where: { id: ids.ada }, data: { salaireMensuel: 450, enfants: 3, banque: "Equity Bank", compteBancaire: "0123" } });
    await prisma.payrollLine.update({ where: { id: lignePayee }, data: { statutPaiement: "PAYE" } });
    const t = await texte((await genererBulletinPdf(lignePayee, "USD"))!.buffer);
    expect(t).toContain("SALAIRE DE BASE 300,00 $");
    expect(t).not.toContain("450,00 $");
    expect(t).toMatch(/PERSONNES À CHARGE 0\b/);
    expect(t).toContain("Mode de paiement : Espèces");
    expect(t).not.toContain("Equity Bank");
    expect(t).not.toContain("PROVISOIRE");
    // L'identité reste celle de la fiche du jour.
    expect(t).toContain("Ada Kalala");
  }, 120_000);

  it("l'archive (version remise) garde la période de congé figée ; une archive d'avant ce champ n'invente rien", async () => {
    const avec = await texte((await genererBulletinPdf(lignePayee, "USD", { version: 1 }))!.buffer);
    expect(avec).toMatch(/du 21\/09\/2026 au 30\/09\/2026 — 9 jour\(s\) ouvrable\(s\)/);
    expect(avec).toContain("Congé maladie : du 02/09/2026 au 03/09/2026");
    expect(avec).not.toContain("PROVISOIRE");

    const v = await prisma.versionBulletin.findFirstOrThrow({ where: { payrollLineId: lignePayee } });
    const { conges: _retire, ...ancien } = v.snapshot as Record<string, unknown>;
    void _retire;
    await prisma.versionBulletin.update({ where: { id: v.id }, data: { snapshot: ancien as object } });
    const sans = await texte((await genererBulletinPdf(lignePayee, "USD", { version: 1 }))!.buffer);
    expect(sans).not.toContain("CONGÉS PRIS");
    expect(sans).not.toContain("21/09/2026");
  }, 120_000);

  it("la liasse du mois : Ada (validée) sans bandeau, Bob (brouillon) avec", async () => {
    const donnees = (await chargerDonneesBulletinsDuMois(9, 2026))!;
    const pages = await pagesDuPdf(await renderPdfBuffer(BulletinsDocument({ bulletins: bulletinsPourPdf(donnees), devise: "USD" })));
    const ada = pages.find((p) => p.plat.includes("Ada Kalala"))!;
    const bob = pages.find((p) => p.plat.includes("Bob Banza"))!;
    expect(ada.plat).not.toContain("PROVISOIRE");
    expect(ada.plat).toContain("SALAIRE DE BASE 300,00 $"); // la liasse lit aussi l'instantané
    expect(bob.plat).toContain("PROVISOIRE — non validé");

    // Le ZIP (un PDF par salarié) dit la même chose, fichier par fichier.
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(Buffer.from(await (await bulletinsZip.GET(requete("/paie/bulletins-zip"))).arrayBuffer()));
    const parNom = new Map<string, string>();
    for (const [nom, f] of Object.entries(zip.files)) parNom.set(nom, await texte(Buffer.from(await f.async("uint8array"))));
    const duZip = (n: string) => [...parNom.entries()].find(([nom]) => nom.toLowerCase().includes(n))![1];
    expect(duZip("bob")).toContain("PROVISOIRE — non validé");
    expect(duZip("ada")).not.toContain("PROVISOIRE");
  }, 120_000);
});

describe("5 — déclarations : provisoire, marquage refusé, montant figé, taux des paramètres", () => {
  it("tant qu'un bulletin n'est pas validé : bordereau provisoire, « déclaré » et « payé » refusés, PDF et Excel marqués", async () => {
    const b = (await calculerDeclarationsMois(9, 2026))!;
    expect(b.provisoire).toBe(true);
    expect(b.nbNonValides).toBe(1);
    expect(b.nbBulletins).toBe(2);
    const message = await refus(marquerDeclaration("CNSS", 9, 2026, "DECLARE"));
    expect(message).toContain("REDIRECT /declarations?erreur=");
    expect(message).toContain("1 bulletin(s) sur 2 ne sont pas encore validés");
    await refus(marquerDeclaration("CNSS", 9, 2026, "PAYE"));
    expect(await prisma.declarationTaxe.count()).toBe(0);

    // L'écran dit « provisoire » et ne propose plus les boutons de marquage.
    const ecran = await htmlDeclarations();
    expect(ecran).toContain("Provisoire.");
    expect(ecran).toContain("1 bulletin(s) sur 2");
    expect(ecran).toContain("Validez la paie d");
    expect(ecran).not.toContain("Marquer déclaré");
    expect(ecran).not.toContain("Marquer payé");
    // « Cotisations (Excel) » porte le mois affiché.
    expect(ecran).toContain("/declarations/export-excel?mois=9&amp;annee=2026");

    const pdf = await texte(Buffer.from(await (await declExport.GET(requete("/declarations/export?mois=9&annee=2026"))).arrayBuffer()));
    expect(pdf).toContain("PROVISOIRE — non validé");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await (await declExcel.GET(requete("/declarations/export-excel?mois=9&annee=2026"))).arrayBuffer()) as unknown as ArrayBuffer);
    const cellules: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => cellules.push(String(c.text ?? "")))));
    expect(cellules.join(" | ")).toContain("PROVISOIRE");
  }, 120_000);

  it("le libellé des taux vient des paramètres légaux (5 % / 13 % aujourd'hui, 4 % / 12 % après modification)", async () => {
    const lib = async () => (await calculerDeclarationsMois(9, 2026))!.lignes.find((l) => l.type === "CNSS")!.detail;
    expect(await lib()).toBe("Part salariale (5 %) + part patronale (13 %) — à déclarer avant le 15 du mois suivant");
    const ex = await prisma.exerciceFiscal.findFirstOrThrow({ where: { actif: true } });
    await prisma.parametreLegal.update({ where: { exerciceId_cle: { exerciceId: ex.id, cle: "cnss_salarie" } }, data: { valeur: 0.04 } });
    await prisma.parametreLegal.update({ where: { exerciceId_cle: { exerciceId: ex.id, cle: "cnss_patronal_famille" } }, data: { valeur: 0.055 } });
    expect(await lib()).toContain("Part salariale (4 %) + part patronale (12 %)");
    await prisma.parametreLegal.update({ where: { exerciceId_cle: { exerciceId: ex.id, cle: "cnss_salarie" } }, data: { valeur: 0.05 } });
    await prisma.parametreLegal.update({ where: { exerciceId_cle: { exerciceId: ex.id, cle: "cnss_patronal_famille" } }, data: { valeur: 0.065 } });
  });

  it("paie entièrement validée : marquage accepté ; le montant déclaré est figé et affiché, l'écart du recalcul signalé (écran et PDF)", async () => {
    await valider(ids.bob);
    const avant = (await calculerDeclarationsMois(9, 2026))!;
    expect(avant.provisoire).toBe(false);
    const cnssAvant = avant.lignes.find((l) => l.type === "CNSS")!;

    await marquerDeclaration("CNSS", 9, 2026, "DECLARE");
    const suivi = await prisma.declarationTaxe.findFirstOrThrow({ where: { type: "CNSS", mois: 9, annee: 2026 } });
    expect(Number(suivi.montantUSD)).toBeCloseTo(cnssAvant.montantUSD, 2);

    // La paie bouge après la déclaration (ligne corrigée à la main en base pour le test).
    const lb = await ligne(ids.bob);
    await prisma.payrollLine.update({ where: { id: lb.id }, data: { cnssSalarieUSD: Number(lb.cnssSalarieUSD) + 10 } });
    const apres = (await calculerDeclarationsMois(9, 2026))!;
    const cnss = apres.lignes.find((l) => l.type === "CNSS")!;
    expect(cnss.montantUSD).toBeCloseTo(cnssAvant.montantUSD, 2); // le montant AFFICHÉ reste le déclaré
    expect(cnss.recalculUSD).toBeCloseTo(cnssAvant.montantUSD + 10, 2);
    expect(cnss.ecartAvecFige).toBe(true);
    expect(apres.lignes.find((l) => l.type === "IPR")!.ecartAvecFige).toBe(false); // IPR pas marquée : pas de figé

    const ecran = await htmlDeclarations();
    expect(ecran).not.toContain("Provisoire.");
    expect(ecran).toContain("figé au marquage");
    expect(ecran).toMatch(/Recalcul d(&#x27;|')aujourd(&#x27;|')hui/);
    expect(ecran).toContain("Marquer payé"); // CNSS déclarée, pas encore payée : le bouton existe (avec sa confirmation, voir plus bas)

    const pdf = await texte(Buffer.from(await (await declExport.GET(requete("/declarations/export?mois=9&annee=2026"))).arrayBuffer()));
    expect(pdf).toContain("Montant figé au marquage");
    expect(pdf).toMatch(/La paie recalculée donne aujourd’hui [\d ,]+ \$/);
    expect(pdf).not.toContain("PROVISOIRE");
    await prisma.payrollLine.update({ where: { id: lb.id }, data: { cnssSalarieUSD: Number(lb.cnssSalarieUSD) } });

    // « Payé » ne change pas le montant figé ; une taxe payée ne redevient pas « déclarée ».
    await marquerDeclaration("CNSS", 9, 2026, "PAYE");
    const paye = await prisma.declarationTaxe.findFirstOrThrow({ where: { type: "CNSS", mois: 9, annee: 2026 } });
    expect(Number(paye.montantUSD)).toBeCloseTo(cnssAvant.montantUSD, 2);
    expect(paye.statut).toBe("PAYE");
    await refus(marquerDeclaration("CNSS", 9, 2026, "DECLARE"));
  }, 120_000);
});

describe("4 — contrat en CDF, salaire saisi en net : brut reconverti", () => {
  it("600 000 FC net au taux 2 300 : brut imprimé en FC, pas le brut d'un net de 600 000 $", async () => {
    const ex = await prisma.exerciceFiscal.findFirstOrThrow({ where: { actif: true } });
    await prisma.parametreLegal.create({ data: { exerciceId: ex.id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
    await prisma.parametreLegal.createMany({ data: [
      { exerciceId: ex.id, cle: "preavis_jours_demission", valeur: 14, libelle: "x" },
      { exerciceId: ex.id, cle: "preavis_jours_licenciement", valeur: 30, libelle: "x" },
    ], skipDuplicates: true });
    const c = await prisma.contrat.create({ data: {
      employeeId: ids.bob, type: "CDI", dateDebut: new Date("2026-03-01"), heuresHebdo: 48,
      salaireMensuel: 600_000, devise: "CDF", poste: "Cuisinier", statut: "ACTIF",
    } });
    const t = await texte((await genererContratPdf(c.id))!.buffer);
    const { reconstituerBrutDepuisNet } = await import("@/lib/payroll");
    const { chargerParametresPaie } = await import("@/lib/config");
    const p = await chargerParametresPaie();
    const brutFC = reconstituerBrutDepuisNet(600_000 / 2300, p, 0) * 2300;
    const attendu = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(brutFC).replace(/[  ]/g, " ");
    expect(t.replace(/\s+/g, " ")).toContain(`${attendu} CDF`);
    // L'ancien calcul imprimait le brut d'un net lu en dollars : un nombre sans rapport.
    const absurde = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(reconstituerBrutDepuisNet(600_000, p, 0)).replace(/[  ]/g, " ");
    expect(t.replace(/\s+/g, " ")).not.toContain(`${absurde} CDF`);
  }, 120_000);
});

describe("6 et 7 — mois clôturé : liasse, ZIP, livre de paie et Excel des cotisations acceptent ?mois=&annee=", () => {
  it("août 2026 (clôturé) : chaque export lit août, jamais le mois courant ; sans paramètre c'est septembre ; paramètre illisible = 400", async () => {
    const run = await prisma.payrollRun.create({ data: { mois: 8, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
    const emp = await prisma.employee.create({ data: {
      matricule: "CL01-PEF", nom: "Clos Ancien", sexe: "M", etatCivil: "Célibataire", poste: "Serveur", secteur: "Salle",
      categorie: "BRIGADE", salaireMensuel: 200, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    } });
    await prisma.payrollLine.create({ data: {
      payrollRunId: run.id, employeeId: emp.id, statutPaiement: "PAYE", transportUSD: 15, salBrutUSD: 211, cnssSalarieUSD: 10, netImposableUSD: 200,
      iprCalculeUSD: 5, allocFamilialeUSD: 0, salNetUSD: 200, salNetCDF: 560000, cnssPatronalUSD: 27, coutEmployeurUSD: 240, coutEmployeurCDF: 672000,
    } });

    const liasseAout = await textePdf(await bulletinsPdf.GET(requete("/paie/bulletins-pdf?mois=8&annee=2026&devise=USD")));
    expect(liasseAout).toContain("Clos Ancien");
    expect(liasseAout).toContain("août 2026");
    expect(liasseAout).not.toContain("Ada Kalala");
    expect(liasseAout).not.toContain("PROVISOIRE"); // ligne payée

    const liasseCourante = await textePdf(await bulletinsPdf.GET(requete("/paie/bulletins-pdf?devise=USD")));
    expect(liasseCourante).toContain("Ada Kalala");
    expect(liasseCourante).not.toContain("Clos Ancien");

    const JSZip = (await import("jszip")).default;
    const zipAout = await JSZip.loadAsync(Buffer.from(await (await bulletinsZip.GET(requete("/paie/bulletins-zip?mois=8&annee=2026"))).arrayBuffer()));
    expect(Object.keys(zipAout.files)).toHaveLength(1);
    expect(Object.keys(zipAout.files)[0]).toContain("2026-08");

    const livreAout = await textePdf(await exportPdf.GET(requete("/paie/export-pdf?mois=8&annee=2026")));
    expect(livreAout).toContain("Clos Ancien");
    expect(livreAout).not.toContain("Bob Banza");
    const livreCourant = await textePdf(await exportPdf.GET(requete("/paie/export-pdf")));
    expect(livreCourant).toContain("Bob Banza");

    // La page de détail d'un mois de l'historique propose ces documents pour CE mois.
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(await pageHistorique({ params: Promise.resolve({ id: run.id }) }));
    for (const route of ["bulletins-pdf", "bulletins-zip"]) expect(html).toContain(`/paie/${route}?mois=8&amp;annee=2026&amp;devise=USD`);
    expect(html).toContain("/paie/export-pdf?mois=8&amp;annee=2026");

    for (const route of [bulletinsPdf, bulletinsZip, exportPdf, exportExcelLivre]) {
      expect((await route.GET(requete("/x?mois=13&annee=2026"))).status).toBe(400);
    }

    // Excel des cotisations : même mois que l'écran et le PDF.
    await prisma.declarationTaxe.deleteMany({});
    const ExcelJS = (await import("exceljs")).default;
    const lire = async (url: string) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await (await declExcel.GET(requete(url))).arrayBuffer()) as unknown as ArrayBuffer);
      const t: string[] = [];
      wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => t.push(String(c.text ?? "")))));
      return t.join(" | ");
    };
    expect(await lire("/declarations/export-excel?mois=8&annee=2026")).toContain("août 2026");
    expect(await lire("/declarations/export-excel")).toContain("septembre 2026");
    expect((await declExcel.GET(requete("/declarations/export-excel?mois=0&annee=2026"))).status).toBe(400);
  }, 180_000);
});

describe("5 — « Marquer payé » demande une confirmation", () => {
  it("le bouton est un ConfirmSubmitButton (confirmation navigateur) dont le message cite l'organisme, la période et le montant", async () => {
    const source = (await import("node:fs")).readFileSync(new URL("../app/(app)/declarations/page.tsx", import.meta.url), "utf8");
    const i = source.indexOf("Marquer payé");
    const balise = source.lastIndexOf("<ConfirmSubmitButton", i);
    expect(balise).toBeGreaterThan(-1);
    expect(source.slice(balise, i)).toMatch(/message=\{`Marquer \$\{l\.libelle\} comme PAYÉ pour \$\{periode\} \(\$\{money\(l\.montantUSD\)\}\)/);
    // Le bouton « déclaré » n'est pas concerné : seul le paiement, qui clôt le suivi, demande confirmation.
    expect(source.slice(source.indexOf("Marquer déclaré") - 120, source.indexOf("Marquer déclaré"))).not.toContain("ConfirmSubmitButton");
  });
});
