import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExcelJS from "exceljs";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { creerEspion } from "@/lib/test/espion-ecritures";

/**
 * PRÉSENCES D'UN MOIS PASSÉ (demande de la Direction du 12/10) — base réelle, vraie page, vraie route
 * d'export, vraies actions. Mois RH courant : octobre 2026 ; mois passé consulté : septembre 2026
 * (paie clôturée, bulletins figés). On prouve :
 *   • la navigation (liens, bornes : premier mois avec une paie = juillet ; jamais au-delà d'octobre) ;
 *   • le chargement d'un mois passé n'ÉCRIT RIEN (espion : toute écriture est refusée et notée) — et le
 *     même espion attrape bien la synchro des congés du mois courant (contrôle) ;
 *   • aucun geste d'écriture à l'écran, même pour la Direction, et le serveur refuse chaque action ;
 *   • mêmes chiffres que l'écran du mois courant pour le même mois ; « HS valorisées » = bulletin figé ;
 *   • l'export suit le mois (400 lisible si illisible ou à venir, garde d'abord) ;
 *   • sans paramètre, rien ne change (mois courant, saisie ouverte, import IVMS présent).
 */
const E = vi.hoisted(() => ({ espion: undefined as unknown as ReturnType<typeof import("@/lib/test/espion-ecritures").creerEspion> }));
type Compte = { id: string; email: string; nom: string; role: Role; accesStock: boolean; employeeId: string | null };
const A = vi.hoisted(() => ({ user: null as unknown as Compte }));
const CAPT = vi.hoisted(() => ({ grilles: [] as Record<string, unknown>[], hebdo: [] as Record<string, unknown>[], televerses: 0 }));

vi.mock("@/lib/prisma", async () => {
  const { proxyEspion: p } = await import("@/lib/test/espion-ecritures");
  return { prisma: new Proxy({}, { get: (_t, k) => (p(E.espion) as unknown as Record<string | symbol, unknown>)[k] }) };
});
vi.mock("@/lib/auth", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...vrai, verifySession: async () => A.user };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/fichiers-employe", () => ({ televerserFichierEmploye: async () => { CAPT.televerses++; return "/fichiers/x.pdf"; } }));
vi.mock("./temps-grid", async (orig) => {
  const vrai = await orig<typeof import("./temps-grid")>();
  return { ...vrai, TempsGrid: (p: Parameters<typeof vrai.TempsGrid>[0]) => { CAPT.grilles.push(p as unknown as Record<string, unknown>); return createElement(vrai.TempsGrid, p); } };
});
vi.mock("../heures-supp/weekly-breakdown-table", async (orig) => {
  const vrai = await orig<typeof import("../heures-supp/weekly-breakdown-table")>();
  return { ...vrai, WeeklyBreakdownTable: (p: Parameters<typeof vrai.WeeklyBreakdownTable>[0]) => { CAPT.hebdo.push(p as unknown as Record<string, unknown>); return createElement(vrai.WeeklyBreakdownTable, p); } };
});

const { default: Page } = await import("./page");
const { GET: exporter } = await import("./export/route");
const { saisirPresence, saisirPresencesEnLot } = await import("./actions");
const { saisirHeures, saisirHeuresEnLot } = await import("../heures-supp/actions");
const { marquerMaladieJustifiee, joindreCertificatMaladie } = await import("./maladie-actions");
const { appliquerPointageIVMS, analyserPointageIVMS } = await import("./import-actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids = { alice: "", bob: "", claire: "", admin: "" };
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const compte = (role: Role): Compte => ({ id: ids.admin, email: `${role}@pef.cd`, nom: role, role, accesStock: false, employeeId: null });
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

async function rendre(sp: Record<string, string> = {}) {
  CAPT.grilles = []; CAPT.hebdo = [];
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
}
async function moisCourant(mois: number) {
  await prisma.config.update({ where: { id: "singleton" }, data: { moisCourant: mois, anneeCourante: 2026 } });
}
/** Toutes les présences et heures, triées : deux empreintes égales = rien n'a bougé. */
async function empreinte() {
  const [a, o, i] = await Promise.all([
    prisma.attendance.findMany({ orderBy: [{ employeeId: "asc" }, { date: "asc" }], select: { employeeId: true, date: true, code: true, maladieJustifiee: true, justificatifUrl: true, updatedAt: true } }),
    prisma.overtimeEntry.findMany({ orderBy: [{ employeeId: "asc" }, { date: "asc" }], select: { employeeId: true, date: true, heuresTravaillees: true, updatedAt: true } }),
    prisma.importPointage.count(),
  ]);
  return JSON.stringify({ a, o, i });
}
/** Les feuilles d'un classeur, en tableaux de valeurs. */
async function feuilles(r: Response): Promise<Record<string, unknown[][]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as unknown as ArrayBuffer);
  const out: Record<string, unknown[][]> = {};
  wb.eachSheet((ws) => {
    const lignes: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => lignes.push((row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v))));
    out[ws.name] = lignes;
  });
  return out;
}
const exporterQ = (q = "") => exporter(new Request(`http://localhost/presences/export${q ? `?${q}` : ""}`));

async function creerLigne(runId: string, employeeId: string, statutPaiement: "VALIDE" | "PAYE", hsValorisee: number) {
  await prisma.payrollLine.create({
    data: {
      payrollRunId: runId, employeeId, statutPaiement, hsValorisee,
      salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 10, allocFamilialeUSD: 0,
      salNetUSD: 290, salNetCDF: 667000, cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 772800,
    },
  });
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;
  E.espion = creerEspion();
  E.espion.client = prisma;
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T10:00:00Z") });
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  ids.admin = (await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  A.user = compte("ADMIN");
  const emp = async (matricule: string, nom: string, extra: Record<string, unknown>) => (await prisma.employee.create({
    data: {
      matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Cuisinière", secteur: "Cuisine", categorie: "BRIGADE",
      salaireMensuel: 300, dateEmbauche: d("2025-01-06"), contrat: "CDI", heuresParJour: 8, heuresHebdomadaires: 48, ...extra,
    },
  })).id;
  ids.alice = await emp("AL01-PEF", "Alice Brigade", {});
  ids.bob = await emp("BO02-PEF", "Bob Sorti", { actif: false, dateSortie: d("2026-09-15") }); // sorti le 15/09
  ids.claire = await emp("CL03-PEF", "Claire Bureau", { categorie: "BACKOFFICE", poste: "Comptable", secteur: "Bureau" });

  // Septembre : semaine à cheval (lundi 31/08 → dimanche 06/09), heures supp., un jour M, Bob jusqu'au 15.
  const jours: { e: string; iso: string; code: "P" | "M" | "O"; h?: number }[] = [
    { e: ids.alice, iso: "2026-08-31", code: "P", h: 12 },
    ...["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((iso) => ({ e: ids.alice, iso, code: "P" as const, h: 10 })),
    { e: ids.alice, iso: "2026-09-07", code: "M" },
    { e: ids.alice, iso: "2026-09-08", code: "P", h: 9 },
    { e: ids.bob, iso: "2026-09-14", code: "P", h: 11 },
    { e: ids.bob, iso: "2026-09-15", code: "P", h: 8 },
    { e: ids.claire, iso: "2026-09-10", code: "P", h: 8 },
    { e: ids.alice, iso: "2026-10-05", code: "P", h: 8 },
  ];
  for (const j of jours) {
    await prisma.attendance.create({ data: { employeeId: j.e, date: d(j.iso), code: j.code } });
    if (j.h) await prisma.overtimeEntry.create({ data: { employeeId: j.e, date: d(j.iso), heuresTravaillees: j.h } });
  }
  await prisma.jourFerie.create({ data: { date: d("2026-09-21"), designation: "Férié de test", annee: 2026 } });

  // Paies : juillet (la plus ancienne → borne de navigation), septembre clôturée avec bulletins figés.
  await prisma.payrollRun.create({ data: { mois: 7, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
  const sept = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
  await creerLigne(sept.id, ids.alice, "VALIDE", 42.5); // montant FIGÉ, différent d'un recalcul
  await creerLigne(sept.id, ids.bob, "PAYE", 7); // sorti depuis : ses HS ont été payées
  await creerLigne(sept.id, ids.claire, "VALIDE", 0); // back-office : « — »

  // Un congé approuvé d'AOÛT (paie non calculée → mois non figé) sans codes posés : la synchro du
  // chargement l'écrirait. Elle ne doit pas tourner sur un mois passé.
  await prisma.leaveRequest.create({ data: { employeeId: ids.claire, type: "Congé annuel", dateDebut: d("2026-08-10"), dateFin: d("2026-08-11"), nbJours: 2, statut: "APPROUVE" } });
}, 180_000);
afterAll(async () => { vi.useRealTimers(); await fermer?.(); });

describe("un mois passé n'écrit RIEN au chargement", () => {
  it("septembre (passé) : aucune écriture, même avec un congé à rattraper en base", async () => {
    const avant = await empreinte();
    E.espion.refus = []; E.espion.actif = true;
    try {
      await rendre({ mois: "9", annee: "2026" });
      await rendre({ mois: "9", annee: "2026", vue: "mois" });
      await rendre({ mois: "8", annee: "2026", vue: "employe" });
    } finally { E.espion.actif = false; }
    expect(E.espion.refus).toEqual([]);
    expect(E.espion.lectures).toBeGreaterThan(0);
    expect(await empreinte()).toBe(avant);
  });

  it("contrôle : sur le mois COURANT, l'espion voit bien la synchro des congés tenter d'écrire", async () => {
    E.espion.refus = []; E.espion.actif = true;
    try {
      await expect(rendre()).rejects.toThrow(/écriture interdite/);
    } finally { E.espion.actif = false; }
    expect(E.espion.refus).toContain("attendance.createMany");
  });
});

describe("navigation", () => {
  it("mois courant sans paramètre : ← Préc. vers septembre, Suiv. inactif, pas de retour ni de bandeau", async () => {
    const html = await rendre();
    expect(html).toContain('href="/presences?mois=9&amp;annee=2026"');
    expect(html).toMatch(/<span aria-disabled="true"[^>]*>Suiv\. →<\/span>/);
    expect(texte(html)).not.toContain("Revenir au mois en cours");
    expect(texte(html)).not.toContain("Mois passé — lecture seule");
    expect(html).toContain('href="/presences/export"'); // export du mois courant : adresse inchangée
  });

  it("mois passé : Préc./Suiv., retour au mois en cours, vue conservée dans les liens", async () => {
    const html = await rendre({ mois: "9", annee: "2026", vue: "employe", emp: ids.alice });
    expect(html).toContain(`href="/presences?mois=8&amp;annee=2026&amp;vue=employe&amp;emp=${ids.alice}"`);
    expect(html).toContain(`href="/presences?vue=employe&amp;emp=${ids.alice}"`); // Suiv. = octobre = mois courant, sans mois/année
    expect(texte(html)).toContain("Revenir au mois en cours");
    expect(texte(html)).toContain("Mois passé — lecture seule");
    expect(texte(html)).toMatch(/septembre 2026/i);
    // les onglets de vue restent sur septembre
    expect(html).toContain('href="/presences?vue=mois&amp;mois=9&amp;annee=2026"');
  });

  it("sem est conservé tel que reçu", async () => {
    const html = await rendre({ mois: "9", annee: "2026", sem: "2026-09-14" });
    expect(html).toContain('href="/presences?mois=8&amp;annee=2026&amp;sem=2026-09-14"');
  });

  it("borne basse : juillet (première paie) n'a plus de précédent", async () => {
    const html = await rendre({ mois: "7", annee: "2026" });
    expect(html).toMatch(/<span aria-disabled="true"[^>]*>← Préc\.<\/span>/);
    expect(html).toContain('href="/presences?mois=8&amp;annee=2026"');
  });

  it("mois à venir ou illisible : refus lisible, aucune grille, lien de retour", async () => {
    for (const sp of [{ mois: "11", annee: "2026" }, { mois: "13", annee: "2026" }, { mois: "9" }] as Record<string, string>[]) {
      const html = await rendre(sp);
      expect(CAPT.grilles, JSON.stringify(sp)).toHaveLength(0);
      expect(texte(html)).toMatch(/pas encore ouvert|Mois ou année invalide/);
      expect(html).toContain('href="/presences"');
    }
  });
});

describe("lecture seule à l'écran (même la Direction)", () => {
  it("Direction, mois passé : ni import IVMS, ni cases à cocher, ni saisie", async () => {
    A.user = compte("ADMIN");
    const html = await rendre({ mois: "9", annee: "2026", vue: "mois" });
    expect(texte(html)).not.toContain("Importer un rapport de pointage");
    expect(html).not.toContain("pour une action groupée");
    expect(html).not.toContain("Sélectionner Alice");
    expect(CAPT.grilles.every((g) => g.peutModifier === false && g.peutEffacer === false)).toBe(true);
  });

  it("Direction, mois courant : la saisie reste ouverte (rien ne change)", async () => {
    const html = await rendre({ vue: "mois" });
    expect(texte(html)).toContain("Importer un rapport de pointage");
    expect(html).toContain("pour une action groupée");
    expect(CAPT.grilles.every((g) => g.peutModifier === true && g.peutEffacer === true)).toBe(true);
  });

  it("droits : lecteur (VIEWER) lit le mois passé ; un salarié est renvoyé", async () => {
    A.user = compte("VIEWER");
    const html = await rendre({ mois: "9", annee: "2026" });
    expect(texte(html)).toContain("Mois passé — lecture seule");
    A.user = compte("EMPLOYE");
    await expect(rendre({ mois: "9", annee: "2026" })).rejects.toThrow(/NEXT_REDIRECT/);
    A.user = compte("STOCK");
    await expect(rendre({ mois: "9", annee: "2026" })).rejects.toThrow(/NEXT_REDIRECT/);
    A.user = compte("ADMIN");
  });
});

/** Copie d'un objet sans certaines clés. */
const sans = (o: Record<string, unknown>, ...cles: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !cles.includes(k)));
/** Ce que reçoivent les grilles et le tableau hebdomadaire, sans ce qui DOIT différer (droits, montant HS). */
function contenu() {
  const grilles = CAPT.grilles.map((g) => ({
    ...sans(g, "peutModifier", "peutEffacer", "params", "joursFeries", "employees"),
    joursFeries: [...(g.joursFeries as Set<string>)].sort(),
    employees: (g.employees as Record<string, unknown>[]).map((e) => sans(e, "hsValoriseePaie", "hsMoisFigees")),
  }));
  const hebdo = CAPT.hebdo.map((h) => ({
    nbSemaines: h.nbSemaines as number,
    employees: (h.employees as Record<string, unknown>[]).map((e) => sans(e, "hsValoriseePaie", "hsMoisFigees")),
    semaines: Object.fromEntries(Object.entries(h.semainesParEmploye as Record<string, Record<string, unknown>[]>).map(([k, v]) => [k, v.map((x) => sans(x, "hsValorisee"))])),
  }));
  return { grilles, hebdo };
}
const hsAffichees = () => Object.fromEntries((CAPT.grilles.flatMap((g) => g.employees as { id: string; hsValoriseePaie: number | null }[])).map((e) => [e.id, e.hsValoriseePaie]));

describe("mêmes chiffres que l'écran du mois courant", () => {
  it("septembre vu du passé = septembre quand il était le mois courant (codes, heures, HS par semaine, semaine à cheval, sortis)", async () => {
    await moisCourant(10);
    await rendre({ mois: "9", annee: "2026" });
    const passe = contenu();
    const hsPasse = hsAffichees();
    await moisCourant(9);
    await rendre();
    const courant = contenu();
    const hsCourant = hsAffichees();
    await moisCourant(10);

    expect(passe).toEqual(courant);
    // garde-fous du contenu : la comparaison porte sur de vraies données
    const brigade = passe.grilles[0] as unknown as { employees: { id: string; heuresAvantMois: unknown[]; sortieLe: string | null }[]; hoursMap: Record<string, number> };
    expect(brigade.employees.map((e) => e.id).sort()).toEqual([ids.alice, ids.bob].sort());
    expect(brigade.employees.find((e) => e.id === ids.alice)!.heuresAvantMois).toEqual([{ date: "2026-08-31", heures: 12 }]);
    expect(brigade.employees.find((e) => e.id === ids.bob)!.sortieLe).toBe("2026-09-15");
    expect(brigade.hoursMap[`${ids.alice}_1`]).toBe(10);
    const semAlice = passe.hebdo[0].semaines[ids.alice] as { semaine: number; hs30: number }[];
    expect(semAlice.find((s) => s.semaine === 1)!.hs30).toBeGreaterThan(0);

    // HS valorisées : le passé lit le bulletin FIGÉ, le courant recalcule
    expect(hsPasse).toEqual({ [ids.alice]: 42.5, [ids.bob]: 7, [ids.claire]: null });
    expect(hsCourant[ids.alice]).not.toBe(42.5);
    expect(hsCourant[ids.bob]).toBeNull(); // le recalcul ignorait les HS payées d'un salarié sorti depuis
  });
});

describe("export Excel du mois", () => {
  it("?mois=9 : le classeur de septembre, HS valorisées = bulletin figé, « — » par semaine", async () => {
    A.user = compte("VIEWER");
    const r = await exporterQ("mois=9&annee=2026");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Disposition")).toContain("Presences_heures_2026-09.xlsx");
    const f = await feuilles(r);
    const alice = f["Heures par jour"].find((l) => l.includes("AL01-PEF"))!;
    expect(alice[alice.length - 1]).toBe(42.5);
    const claire = f["Heures par jour"].find((l) => l.includes("CL03-PEF"))!;
    expect(claire[claire.length - 1]).toBe("—");
    const semaines = f["Détail hebdomadaire"].filter((l) => l.includes("AL01-PEF"));
    expect(semaines.every((l) => l[7] === "—")).toBe(true); // valorisation par semaine (col. 8) : pas de taux figé
    A.user = compte("ADMIN");
  });

  it("mêmes feuilles que l'export du mois courant pour le même mois (hors HS du bulletin et remarque)", async () => {
    // Doivent différer, et seulement elles : HS 30/60/100 + montant (bulletin figé vs recalcul) ; la
    // valorisation par semaine et la remarque (mois passé seulement).
    const sansHs = (f: Record<string, unknown[][]>, passe: boolean) => ({
      p: f["Présences"],
      h: f["Heures par jour"].map((l) => l.slice(0, -4)),
      s: f["Détail hebdomadaire"].map((l) => l.slice(0, passe ? -2 : -1)),
    });
    const passe = sansHs(await feuilles(await exporterQ("mois=9&annee=2026")), true);
    await moisCourant(9);
    const courant = sansHs(await feuilles(await exporterQ()), false);
    await moisCourant(10);
    expect(passe).toEqual(courant);
    expect(passe.p.some((l) => l.includes("BO02-PEF"))).toBe(true); // salarié sorti dans le mois
  });

  it("un mois de six semaines (août 2026 commence un samedi) : la 6e semaine figure au détail", async () => {
    const f = await feuilles(await exporterQ("mois=8&annee=2026"));
    const s6 = f["Détail hebdomadaire"].find((l) => l.includes("AL01-PEF") && l.includes("Semaine 6"));
    expect(s6, "la semaine du lundi 31 août manque").toBeDefined();
    expect(s6![3]).toBe(12);
  });

  it("illisible : 400 lisible ; à venir : refus ; sans paramètre : mois courant", async () => {
    const r1 = await exporterQ("mois=13&annee=2026");
    expect(r1.status).toBe(400);
    expect(await r1.text()).toMatch(/Mois ou année invalide/);
    const r2 = await exporterQ("mois=11&annee=2026");
    expect(r2.status).toBe(400);
    expect(await r2.text()).toMatch(/novembre 2026 n'est pas encore ouvert/);
    const r3 = await exporterQ();
    expect(r3.headers.get("Content-Disposition")).toContain("Presences_heures_2026-10.xlsx");
  });

  it("droits : la garde passe AVANT la lecture du mois (salarié → refus, même avec un mois illisible)", async () => {
    A.user = compte("EMPLOYE");
    const r = await exporterQ("mois=13&annee=2026");
    expect(r.status).toBe(403);
    A.user = compte("STOCK");
    expect((await exporterQ("mois=9&annee=2026")).status).toBe(403);
    A.user = compte("ADMIN");
  });
});

describe("le serveur refuse toute écriture sur un mois passé", () => {
  it("saisie unitaire, lot, heures, maladie, certificat, import IVMS : refusés, rien n'a bougé", async () => {
    A.user = compte("ADMIN");
    const avant = await empreinte();
    const r1 = await saisirPresence(ids.alice, "2026-09-10", "N");
    expect(r1.erreur).toMatch(/Mois passé — lecture seule : septembre 2026/);
    // lot mêlant octobre (ouvert) et septembre : TOUT est refusé
    const r2 = await saisirPresencesEnLot([{ employeeId: ids.alice, date: "2026-10-06", code: "P" }, { employeeId: ids.alice, date: "2026-09-30", code: "P" }]);
    expect(r2.erreur).toMatch(/Mois passé/);
    // Heures : refus RENVOYÉ (pas levé — une exception d'action serveur perd son message en production)
    expect(await saisirHeures(ids.alice, "2026-09-08", "5")).toEqual({ erreur: "Mois passé — lecture seule : septembre 2026 est antérieur au mois en cours (octobre 2026). Rien n'a été enregistré." });
    expect(await saisirHeuresEnLot([{ employeeId: ids.alice, date: "2026-10-06", heures: "8" }, { employeeId: ids.alice, date: "2026-08-31", heures: "1" }])).toEqual({ ignores: [], erreur: "Mois passé — lecture seule : août 2026 est antérieur au mois en cours (octobre 2026). Rien n'a été enregistré." });
    const r3 = await marquerMaladieJustifiee([{ employeeId: ids.alice, date: "2026-09-07" }], true);
    expect(r3.erreur).toMatch(/Mois passé/);
    const fd = new FormData();
    fd.set("employeeId", ids.alice); fd.set("date", "2026-09-07");
    fd.set("fichier", new File([new Uint8Array([37, 80, 68, 70])], "certificat.pdf", { type: "application/pdf" }));
    const r4 = await joindreCertificatMaladie(fd);
    expect(r4.erreur).toMatch(/Mois passé/);
    expect(CAPT.televerses).toBe(0); // refusé AVANT de téléverser
    // IVMS : août n'a pas de paie validée (l'ancien verrou ne l'arrêtait pas) — le mois passé, si
    const r5 = await appliquerPointageIVMS([{ employeeId: ids.alice, date: "2026-08-20", heures: 8 }]);
    expect(r5).toMatchObject({ ok: true, nbAppliques: 0, nbIgnores: 1 });
    expect(r5.message).toMatch(/mois passé/);
    const apres = JSON.parse(await empreinte());
    const av = JSON.parse(avant);
    expect(apres.a).toEqual(av.a);
    expect(apres.o).toEqual(av.o);
  });

  it("import IVMS à cheval sur deux mois : l'aperçu ANNONCE les jours du mois passé (jamais cochés), le mois courant reste importable", async () => {
    A.user = compte("ADMIN");
    const avant = await empreinte();
    // Août : pas de paie validée (seul le verrou « mois passé » l'arrête) ; septembre : paie validée (statut
    // prioritaire) ; octobre : mois courant.
    const csv = [
      "ID,Date/Heure",
      "AL01-PEF,20/08/2026 08:00", "AL01-PEF,20/08/2026 16:00",
      "AL01-PEF,29/09/2026 08:00", "AL01-PEF,29/09/2026 16:00",
      "AL01-PEF,07/10/2026 08:00", "AL01-PEF,07/10/2026 16:00",
    ].join("\n");
    const f = new FormData();
    f.set("fichier", new File([csv], "rapport.csv", { type: "text/csv" }));
    const a = await analyserPointageIVMS(null, f);
    const statuts = Object.fromEntries((a.lignes ?? []).map((l) => [l.date, l.statut]));
    expect(statuts).toEqual({ "2026-08-20": "MOIS_PASSE", "2026-09-29": "PAIE_FIGEE", "2026-10-07": "OK" });
    expect(await empreinte()).toBe(avant); // l'aperçu n'écrit rien
  });

  it("le mois courant reste ouvert à la saisie", async () => {
    const r = await saisirPresence(ids.alice, "2026-10-06", "P");
    expect(r.erreur).toBeUndefined();
    expect(await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: ids.alice, date: d("2026-10-06") } } })).toMatchObject({ code: "P" });
    await saisirHeures(ids.alice, "2026-10-06", "9");
    expect(Number((await prisma.overtimeEntry.findUnique({ where: { employeeId_date: { employeeId: ids.alice, date: d("2026-10-06") } } }))!.heuresTravaillees)).toBe(9);
  });
});

describe("HS d'un mois passé : le bulletin fait foi (cas Esther)", () => {
  // Esther : fiche passée de 51,92 h à 54 h/semaine APRÈS août (décision du 2026-09-24). Semaine du 17 au
  // 22 août : 53 h. Le bulletin d'août a payé 53 − 51,92 = 1,08 h à +30 % ; un recalcul avec la fiche
  // d'aujourd'hui (54 h) n'en trouve aucune. L'écran et l'export d'août montrent les heures du BULLETIN ;
  // le détail hebdomadaire, figé nulle part, reste recalculé et le dit sur une ligne.
  it("totaux HS figés à l'écran et dans l'export, mention à côté du détail hebdomadaire ; « — » sans bulletin", async () => {
    A.user = compte("ADMIN");
    const esther = (await prisma.employee.create({ data: {
      matricule: "ES04-PEF", nom: "Esther Brigade", sexe: "F", etatCivil: "Célibataire", poste: "Cuisinière", secteur: "Cuisine", categorie: "BRIGADE",
      salaireMensuel: 300, dateEmbauche: d("2025-01-06"), contrat: "CDI", heuresParJour: 10, heuresHebdomadaires: 54,
    } })).id;
    const semaine: [string, number][] = [["2026-08-17", 9], ["2026-08-18", 9], ["2026-08-19", 9], ["2026-08-20", 9], ["2026-08-21", 9], ["2026-08-22", 8]];
    for (const [iso, h] of semaine) {
      await prisma.attendance.create({ data: { employeeId: esther, date: d(iso), code: "P" } });
      await prisma.overtimeEntry.create({ data: { employeeId: esther, date: d(iso), heuresTravaillees: h } });
    }
    const aout = await prisma.payrollRun.create({ data: { mois: 8, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
    await creerLigne(aout.id, esther, "PAYE", 2.81);
    await prisma.payrollLine.updateMany({ where: { payrollRunId: aout.id, employeeId: esther }, data: { heuresSupp30: 1.08 } });

    // Écran : la grille reçoit les heures figées ; le recalcul (54 h) n'aurait rien trouvé.
    const html = await rendre({ mois: "8", annee: "2026" });
    const row = (CAPT.grilles.flatMap((g) => g.employees as { id: string; hsMoisFigees?: unknown; hsValoriseePaie: unknown }[])).find((e) => e.id === esther)!;
    expect(row.hsMoisFigees).toEqual({ hs30: 1.08, hs60: 0, hs100: 0 });
    expect(row.hsValoriseePaie).toBe(2.81);
    const hebdo = CAPT.hebdo[0] as { semainesParEmploye: Record<string, { hs30: number }[]>; mentions: Record<string, string> };
    expect(hebdo.semainesParEmploye[esther].reduce((s, x) => s + x.hs30, 0)).toBe(0); // recalcul à 54 h
    expect(hebdo.mentions[esther]).toBe("recalculé avec la fiche d'aujourd'hui — le bulletin fait foi");
    expect(texte(html)).toContain("Esther Brigade recalculé avec la fiche d'aujourd'hui — le bulletin fait foi");
    // Alice n'a pas de bulletin en août : « — », jamais un recalcul présenté comme payé ; pas de mention.
    const alice = (CAPT.grilles.flatMap((g) => g.employees as { id: string; hsMoisFigees?: unknown }[])).find((e) => e.id === ids.alice)!;
    expect(alice.hsMoisFigees).toBeNull();
    expect(hebdo.mentions[ids.alice]).toBeUndefined();

    // Vue Employé : la tuile dit d'où vient le chiffre et montre celui du bulletin (le recalcul donnerait 0).
    const vueE = texte(await rendre({ mois: "8", annee: "2026", vue: "employe", emp: esther }));
    expect(vueE).toMatch(/Heures supp\. \(bulletin\) 1,08/);
    expect(texte(await rendre({ mois: "8", annee: "2026", vue: "employe", emp: ids.alice }))).toMatch(/Heures supp\. \(bulletin\) —/);

    // Mois COURANT : rien de figé, les totaux restent recalculés (champ absent).
    await rendre();
    expect((CAPT.grilles.flatMap((g) => g.employees as { id: string }[])).every((e) => !("hsMoisFigees" in e))).toBe(true);
    expect(Object.keys((CAPT.hebdo[0] as { mentions: Record<string, string> }).mentions)).toEqual([]);

    // Export d'août : HS 30/60/100 du bulletin, « — » sans bulletin, remarque sur la 1re semaine d'Esther.
    const f = await feuilles(await exporterQ("mois=8&annee=2026"));
    const entete = f["Heures par jour"].find((l) => l.includes("Matricule"))!;
    const col = entete.indexOf("HS 30% (bulletin)");
    expect(col).toBeGreaterThan(0);
    const ligneE = f["Heures par jour"].find((l) => l.includes("ES04-PEF"))!;
    expect(ligneE.slice(col, col + 4)).toEqual([1.08, 0, 0, 2.81]);
    const ligneA = f["Heures par jour"].find((l) => l.includes("AL01-PEF"))!;
    expect(ligneA.slice(col, col + 4)).toEqual(["—", "—", "—", "—"]);
    const semE = f["Détail hebdomadaire"].filter((l) => l.includes("ES04-PEF"));
    expect(semE[0][semE[0].length - 1]).toBe("recalculé avec la fiche d'aujourd'hui — le bulletin fait foi");
    expect(f["Détail hebdomadaire"].filter((l) => l.includes("AL01-PEF")).every((l) => l.length < 9 || !l[8])).toBe(true);
  });
});
