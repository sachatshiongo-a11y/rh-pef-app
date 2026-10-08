import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jetonDe } from "@/lib/test/paie-jeton";

// « LA CLÔTURE DES SALAIRES FAIT PASSER L'ESPACE RH AU MOIS SUIVANT » (demande de Sacha du 2026-10-08),
// rejoué avec les VRAIES actions : clôture (Direction) → mois suivant, dans la transaction de la
// clôture ; décembre → janvier ; jamais de recul ni de saut (mois passé, Config déjà au-delà) ;
// idempotent (deux clôtures en parallèle : un seul passage) ; tout ou rien (passage refusé = rien de
// clôturé) ; effets IDENTIQUES au changement de mois manuel de Paramètres (même cœur) ; journal.
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
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` }); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { calculerPaieDuMois, changerStatutPaie, cloturerPaie } = await import("@/app/(app)/paie/actions");
const { mettreAJourConfig } = await import("@/app/(app)/parametres/actions");
const { passerAuMoisSuivantApresCloture } = await import("@/lib/changement-mois");
const { separerHorsCalcul, compterPasValideComptees } = await import("@/lib/paie-hors-calcul");
const { moisDePaie } = await import("@/lib/indicateurs/rh");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let url = "";
let journee = "";
const ids = { ada: "", bob: "" };

const d = (n: number) => new Date(Date.UTC(2026, 8, n));
const joursOuvres = () => Array.from({ length: 30 }, (_, i) => d(i + 1)).filter((x) => x.getUTCDay() >= 1 && x.getUTCDay() <= 5);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ligne = (employeeId: string) => prisma.payrollLine.findFirstOrThrow({ where: { employeeId, payrollRun: { mois: 9, annee: 2026 } } });
const clore = (mois = 9, annee = 2026) => cloturerPaie(fd({ mois: String(mois), annee: String(annee) }));
/** L'URL de redirection d'une action (succès ou refus), décodée ; "" si l'action n'a pas redirigé. */
const issue = async (p: Promise<unknown>) => {
  try { await p; } catch (e) {
    const m = String((e as Error).message);
    if (!m.startsWith("REDIRECT ")) throw e;
    return decodeURIComponent(m.slice("REDIRECT ".length));
  }
  return "";
};
const moisRH = async () => { const c = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } }); return `${c.moisCourant}/${c.anneeCourante}`; };
const passages = () => prisma.journalAudit.findMany({ where: { entite: "Config", champ: "moisCourant" }, orderBy: { date: "asc" } });
const changerMoisDansParametres = (mois: number, annee = 2026) => issue(mettreAJourConfig(fd({ tauxChangeCDF: "2300", moisCourant: String(mois), anneeCourante: String(annee), jourPaie: "30" })));

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

/**
 * Ce qu'un changement de mois laisse derrière lui, vu de partout : Config (hors horodatage), dernière
 * entrée du journal (origine retirée), mois de paie lu par l'accueil, paie de septembre (état, lignes,
 * séparation « hors calcul »), compteurs du nouveau mois (badges de l'en-tête), nombre de paies.
 */
async function etatApresPassage() {
  const { updatedAt: _u, ...config } = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const j = (await passages()).at(-1)!;
  const sept = await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 }, include: { lignes: true } });
  const { comptees, horsCalcul } = await separerHorsCalcul(prisma, sept.lignes);
  return JSON.parse(JSON.stringify({
    config,
    journal: { entite: j.entite, entiteId: j.entiteId, champ: j.champ, ancienneValeur: j.ancienneValeur, nouveauMois: j.nouvelleValeur?.split(" — ")[0], userId: j.userId },
    moisDePaie: moisDePaie(config, new Date("2026-10-08T10:00:00Z")),
    septembre: {
      statut: sept.statut,
      lignes: sept.lignes.map((l) => `${l.id}:${l.statutPaiement}`).sort(),
      comptees: comptees.map((l) => l.id).sort(),
      horsCalcul: horsCalcul.map((l) => l.id).sort(),
    },
    pasValideDuMoisCourant: await compterPasValideComptees(prisma, { payrollRun: { mois: config.moisCourant, annee: config.anneeCourante } }),
    paies: await prisma.payrollRun.count(),
  }));
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; url = db.url; H.client = prisma;
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

let apresClotureAuto: unknown;

describe("clôture réussie du mois courant → l'espace RH passe au mois suivant", () => {
  it("Direction : septembre validé, fermé, et l'espace RH à octobre — dans la même transaction ; journalisé « automatique »", async () => {
    expect(await issue(clore())).toBe("/paie?msg=Paie de septembre 2026 clôturée — l'espace RH est passé à octobre 2026.");
    expect((await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 } })).statut).toBe("VALIDE");
    expect([(await ligne(ids.ada)).statutPaiement, (await ligne(ids.bob)).statutPaiement]).toEqual(["VALIDE", "VALIDE"]);
    expect(await moisRH()).toBe("10/2026");
    const p = await passages();
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ entite: "Config", entiteId: "singleton", champ: "moisCourant", userId: A.user.id, ancienneValeur: "septembre 2026", nouvelleValeur: "octobre 2026 — automatique (clôture de la paie)" });
    // Le passage n'initialise rien de plus que le geste manuel : aucune paie d'octobre créée.
    expect(await prisma.payrollRun.count({ where: { mois: 10, annee: 2026 } })).toBe(0);
    apresClotureAuto = await etatApresPassage();
  });

  it("effets IDENTIQUES au changement de mois manuel de Paramètres (même cœur) — seule l'origine du journal diffère", async () => {
    expect(await changerMoisDansParametres(9)).toBe(""); // la Direction corrige (geste toujours ouvert)
    expect((await passages()).at(-1)).toMatchObject({ ancienneValeur: "octobre 2026", nouvelleValeur: "septembre 2026 — manuel (Paramètres)", userId: A.user.id });
    expect(await changerMoisDansParametres(10)).toBe("");
    expect((await passages()).at(-1)!.nouvelleValeur).toBe("octobre 2026 — manuel (Paramètres)");
    expect(await etatApresPassage()).toEqual(apresClotureAuto);
  });

  it("réenregistrer les Paramètres sans changer de mois : aucun passage, rien au journal", async () => {
    const avant = (await passages()).length;
    expect(await changerMoisDansParametres(10)).toBe("");
    expect(await passages()).toHaveLength(avant);
    expect(await moisRH()).toBe("10/2026");
  });
});

describe("jamais de recul, jamais de saut, un seul passage", () => {
  it("deux clôtures en parallèle (double clic, deux onglets) : un seul passage, octobre jamais clôturé par ricochet", async () => {
    expect(await changerMoisDansParametres(9)).toBe("");
    const avant = (await passages()).length;
    const issues = (await Promise.all([issue(clore()), issue(clore())])).sort();
    expect(issues).toEqual([
      "/paie?msg=La paie de septembre 2026 est déjà clôturée — l'espace RH est passé à octobre 2026.",
      "/paie?msg=Paie de septembre 2026 clôturée — l'espace RH est passé à octobre 2026.",
    ]);
    expect(await moisRH()).toBe("10/2026");
    expect(await passages()).toHaveLength(avant + 1);
    expect(await prisma.payrollRun.count({ where: { mois: 10, annee: 2026 } })).toBe(0);
  });

  it("clôturer un mois qui n'est plus le mois courant (écran périmé) : rien de clôturé, le mois ne bouge pas", async () => {
    const avant = (await passages()).length;
    const transitions = await prisma.transitionPaie.count();
    // Septembre déjà clos et dépassé : on le dit, sans erreur.
    expect(await issue(clore(9))).toBe("/paie?msg=La paie de septembre 2026 est déjà clôturée — l'espace RH est passé à octobre 2026.");
    // Un mois passé jamais calculé : rien n'a été clôturé.
    expect(await issue(clore(8))).toBe("/paie?erreur=Rien n'a été clôturé : l'espace RH est sur octobre 2026, pas sur août 2026. Rechargez la page.");
    // Un mois à venir (écran trafiqué) : refusé de même, jamais de saut.
    expect(await issue(clore(11))).toBe("/paie?erreur=Rien n'a été clôturé : l'espace RH est sur octobre 2026, pas sur novembre 2026. Rechargez la page.");
    // Sans le mois montré (formulaire incomplet) : refusé.
    expect(await issue(cloturerPaie(new FormData()))).toBe("/paie?erreur=Mois de la paie à clôturer absent : rechargez la page.");
    expect(await moisRH()).toBe("10/2026");
    expect(await passages()).toHaveLength(avant);
    expect(await prisma.transitionPaie.count()).toBe(transitions);
  });

  it("le cœur : un mois clôturé qui n'est pas le mois courant (passé, ou Config déjà au-delà) ne change rien", async () => {
    const avant = (await passages()).length;
    const appel = (mois: number, annee: number) => prisma.$transaction((tx) => passerAuMoisSuivantApresCloture(tx, { close: { mois, annee }, userId: A.user.id }));
    expect(await appel(9, 2026)).toBeNull(); // Config déjà au-delà (octobre)
    expect(await appel(8, 2026)).toBeNull(); // mois passé
    expect(await appel(10, 2025)).toBeNull(); // même mois, autre année
    expect(await moisRH()).toBe("10/2026");
    expect(await passages()).toHaveLength(avant);
  });
});

describe("tout ou rien : un passage refusé annule la clôture entière", () => {
  it("réouverture concurrente pendant la clôture (Direction) : le passage refuse, rien n'est validé ni fermé, le mois ne bouge pas", async () => {
    expect(await changerMoisDansParametres(9)).toBe("");
    // Bob rouvert pour correction : la Direction va clôturer (et le valider en clôturant).
    const bob = await ligne(ids.bob);
    await changerStatutPaie(bob.id, fd({ versStatut: "PAS_VALIDE" }));
    const ada = await ligne(ids.ada);
    expect(ada.statutPaiement).toBe("VALIDE");
    const avant = { passages: (await passages()).length, transitions: await prisma.transitionPaie.count(), versions: await prisma.versionBulletin.count() };

    // Une réouverture d'Ada en cours ailleurs, qui tient aussi la ligne de Bob : la clôture lit Bob seul
    // « pas validé », attend son verrou, puis — Ada rouverte entre-temps — le passage refuse.
    const externe = new Client({ connectionString: url });
    await externe.connect();
    let cloture: Promise<string> | undefined;
    try {
      await externe.query("BEGIN");
      await externe.query(`SELECT "id" FROM "public"."PayrollLine" WHERE "id" = $1 FOR UPDATE`, [bob.id]);
      await externe.query(`UPDATE "public"."PayrollLine" SET "statutPaiement" = 'PAS_VALIDE' WHERE "id" = $1`, [ada.id]);
      let fini = false;
      cloture = issue(clore()).finally(() => { fini = true; });
      await new Promise((r) => setTimeout(r, 600));
      expect(fini).toBe(false); // elle attend la ligne de Bob
      await externe.query("COMMIT");
      expect(await cloture).toBe("/paie?erreur=Clôture annulée (aucun bulletin validé) : 1 bulletin(s) compté(s) resteraient « pas validé » (Ada Kalala) : l'espace RH ne peut pas passer à octobre 2026.");
    } finally {
      await externe.query("ROLLBACK").catch(() => {});
      await cloture?.catch(() => {});
      await externe.end();
    }
    // Rien : Bob toujours « pas validé », aucune transition ni bulletin, mois inchangé, rien au journal.
    expect((await ligne(ids.bob)).statutPaiement).toBe("PAS_VALIDE");
    expect(await prisma.transitionPaie.count()).toBe(avant.transitions);
    expect(await prisma.versionBulletin.count()).toBe(avant.versions);
    expect(await moisRH()).toBe("9/2026");
    expect(await passages()).toHaveLength(avant.passages);
  });

  it("une fois Ada revalidée, la même clôture passe (Bob validé) et l'espace RH passe à octobre", async () => {
    const ada = await ligne(ids.ada);
    await changerStatutPaie(ada.id, fd({ versStatut: "VALIDE", jeton: await jetonDe(prisma, ada.id) }));
    expect(await issue(clore())).toBe("/paie?msg=Paie de septembre 2026 clôturée — l'espace RH est passé à octobre 2026.");
    expect((await ligne(ids.bob)).statutPaiement).toBe("VALIDE");
    expect(await moisRH()).toBe("10/2026");
  });

  it("le refus du geste manuel est le même cœur : Paramètres refuse de quitter septembre clôturé tant qu'un bulletin rouvert attend", async () => {
    expect(await changerMoisDansParametres(9)).toBe("");
    const bob = await ligne(ids.bob);
    await changerStatutPaie(bob.id, fd({ versStatut: "PAS_VALIDE" }));
    const avant = (await passages()).length;
    expect(await changerMoisDansParametres(10)).toBe("/parametres?erreur=La paie du mois en cours est clôturée mais 1 bulletin(s) rouvert(s) attendent d'être revalidés (Bob Banza) : revalidez-les dans Paie avant de changer de mois.");
    expect(await moisRH()).toBe("9/2026");
    expect(await passages()).toHaveLength(avant);
    // La clôture, elle, revalide Bob (Direction) puis passe.
    expect(await issue(clore())).toBe("/paie?msg=Paie de septembre 2026 clôturée — l'espace RH est passé à octobre 2026.");
    expect(await moisRH()).toBe("10/2026");
  });
});

describe("fin d'année", () => {
  it("clôture de décembre → janvier de l'année suivante", async () => {
    expect(await changerMoisDansParametres(12)).toBe("");
    await calculerPaieDuMois();
    expect(await prisma.payrollRun.count({ where: { mois: 12, annee: 2026 } })).toBe(1);
    expect(await issue(clore(12, 2026))).toBe("/paie?msg=Paie de décembre 2026 clôturée — l'espace RH est passé à janvier 2027.");
    expect(await moisRH()).toBe("1/2027");
    expect((await passages()).at(-1)).toMatchObject({ ancienneValeur: "décembre 2026", nouvelleValeur: "janvier 2027 — automatique (clôture de la paie)" });
    expect((await prisma.payrollRun.findFirstOrThrow({ where: { mois: 12, annee: 2026 } })).statut).toBe("VALIDE");
  });
});
