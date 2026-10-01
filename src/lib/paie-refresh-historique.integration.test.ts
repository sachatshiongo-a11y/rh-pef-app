import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jetonDe, jetonsDe } from "@/lib/test/paie-jeton";

// L'HISTORIQUE DE PAIE NE DISPARAÎT JAMAIS (arbitrage Direction du 2026-10-01). Avant : le recalcul
// supprimait puis recréait toutes les lignes non figées ; une ligne ROUVERTE par la Direction
// (VALIDÉ → PAS_VALIDÉ) perdait en cascade ses bulletins émis et ses transitions dès qu'un MANAGER
// recalculait, ou que quelqu'un ouvrait /paie. Rejoué ici : rouvrir → recalcul par un MANAGER →
// versions, transitions, attestation et journal toujours là, même ligne, montants du VRAI calcul.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", role: "ADMIN", nom: "Direction" } }));
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
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

const { calculerPaieDuMois, changerStatutPaie, changerStatutEnLot, cloturerPaie } = await import("@/app/(app)/paie/actions");
const { MESSAGE_LIGNE_RECALCULEE, messageNonCalcules } = await import("@/lib/paie-validation");
const { rafraichirPaieDuMois } = await import("@/lib/paie-refresh");
const { calculerLignesPaie } = await import("@/lib/paie-batch");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let direction = "";
let manager = "";
let journee = "";
const ids = { ada: "", bob: "" };

const d = (n: number) => new Date(Date.UTC(2026, 8, n));
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ligne = (employeeId: string) => prisma.payrollLine.findFirstOrThrow({ where: { employeeId, payrollRun: { mois: 9, annee: 2026 } } });
const joursOuvres = () => Array.from({ length: 30 }, (_, i) => d(i + 1)).filter((x) => x.getUTCDay() >= 1 && x.getUTCDay() <= 5);
const en = (role: "ADMIN" | "MANAGER") => { A.user = { id: role === "ADMIN" ? direction : manager, role, nom: role }; };

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

/** Montants et heures de la ligne enregistrée, tels que la base les garde (chaînes). */
const MONTANTS = ["salBrutUSD", "salNetUSD", "salNetCDF", "netImposableUSD", "iprCalculeUSD", "cnssSalarieUSD", "coutEmployeurUSD", "heuresContractuelles", "heuresTravaillees", "primesUSD"] as const;
const montants = (l: Record<string, unknown>) => Object.fromEntries(MONTANTS.map((k) => [k, String(l[k])]));

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const exercice = await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.parametreLegal.create({ data: { exerciceId: exercice.id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  direction = (await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  manager = (await prisma.user.create({ data: { email: "rh@pef.cd", nom: "Responsable RH", role: "MANAGER" } })).id;
  journee = (await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } })).id;
  ids.ada = await brigade("AK01-PEF", "Ada Kalala");
  ids.bob = await brigade("BB01-PEF", "Bob Banza");
  en("ADMIN");
  await calculerPaieDuMois();
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("recalcul de la paie : une ligne rouverte garde tout son historique", () => {
  it("rouvrir → recalcul par un MANAGER (bouton puis ouverture de /paie) → versions, transitions, attestation, journal toujours là", async () => {
    // La Direction valide (bulletin émis + transition), une attestation s'y rattache, puis elle rouvre.
    const l = await ligne(ids.ada);
    en("ADMIN");
    await changerStatutPaie(l.id, fd({ versStatut: "VALIDE", jeton: await jetonDe(prisma, l.id) }));
    const att = await prisma.attestation.create({ data: { employeeId: ids.ada, type: "SALAIRE", payrollLineId: l.id } });
    await changerStatutPaie(l.id, fd({ versStatut: "PAS_VALIDE" }));
    expect((await ligne(ids.ada)).statutPaiement).toBe("PAS_VALIDE");
    const versions = await prisma.versionBulletin.count({ where: { payrollLineId: l.id } });
    const transitions = await prisma.transitionPaie.count({ where: { payrollLineId: l.id } });
    expect(versions).toBeGreaterThanOrEqual(1);
    expect(transitions).toBe(2);

    // Une prime saisie entre-temps : le recalcul DOIT changer le montant, sur la MÊME ligne.
    await prisma.prime.create({ data: { employeeId: ids.ada, nom: "Prime", montantUSD: 25, mois: 9, annee: 2026 } });
    en("MANAGER");
    await calculerPaieDuMois();
    await rafraichirPaieDuMois({ creerRun: false }); // ouverture de /paie

    const apres = await ligne(ids.ada);
    expect(apres.id).toBe(l.id);
    expect(apres.statutPaiement).toBe("PAS_VALIDE");
    expect(await prisma.versionBulletin.count({ where: { payrollLineId: l.id } })).toBe(versions);
    expect(await prisma.transitionPaie.count({ where: { payrollLineId: l.id } })).toBe(transitions);
    expect((await prisma.attestation.findUniqueOrThrow({ where: { id: att.id } })).payrollLineId).toBe(l.id);
    expect(await prisma.journalAudit.count({ where: { entite: "PayrollLine", entiteId: l.id } })).toBeGreaterThan(0);

    // Montants : ceux du VRAI calcul, au centime (rien n'est inventé par la mise à jour en place).
    expect(Number(apres.primesUSD)).toBe(25);
    const { lignes } = await calculerLignesPaie(9, 2026, prisma);
    const calc = lignes.find((x) => x.employee.id === ids.ada)!.data;
    for (const k of MONTANTS) expect(Number(apres[k]), k).toBeCloseTo(Number(calc[k]), 2);
  });

  it("mise à jour en place = EXACTEMENT les colonnes d'une ligne recréée (comparée à un salarié identique sans historique)", async () => {
    // Bob a le même planning, les mêmes heures, la même prime qu'Ada : sa ligne est un brouillon
    // sans historique, donc remplacée comme avant. Les deux lignes doivent être identiques.
    await prisma.prime.create({ data: { employeeId: ids.bob, nom: "Prime", montantUSD: 25, mois: 9, annee: 2026 } });
    en("MANAGER");
    await calculerPaieDuMois();
    const ada = await ligne(ids.ada);
    const bob = await ligne(ids.bob);
    expect(montants(ada)).toEqual(montants(bob));
    expect([ada.datePaiement, ada.modePaiement, ada.payeParId]).toEqual([null, null, null]);
  });

  it("brouillon sans historique : toujours remplacé (nouvel identifiant), comme avant", async () => {
    const avant = await ligne(ids.bob);
    await rafraichirPaieDuMois({ creerRun: false });
    expect((await ligne(ids.bob)).id).not.toBe(avant.id);
  });

  it("écran périmé : la ligne rouverte recalculée depuis l'affichage n'est PAS validée (jeton des montants affichés)", async () => {
    const l = await ligne(ids.ada);
    const affiche = await jetonDe(prisma, l.id); // ce que la Direction lit
    await prisma.prime.create({ data: { employeeId: ids.ada, nom: "Prime tardive", montantUSD: 40, mois: 9, annee: 2026 } });
    en("MANAGER");
    await rafraichirPaieDuMois({ creerRun: false }); // quelqu'un ouvre /paie : même ligne, nouveau montant
    const apres = await ligne(ids.ada);
    expect(apres.id).toBe(l.id);
    expect(await jetonDe(prisma, apres.id)).not.toBe(affiche);
    en("ADMIN");
    expect(await changerStatutEnLot([l.id], "VALIDE", null, { [l.id]: affiche })).toEqual({ erreur: MESSAGE_LIGNE_RECALCULEE });
    await expect(changerStatutPaie(l.id, fd({ versStatut: "VALIDE", jeton: affiche }))).rejects.toThrow(`REDIRECT /paie?erreur=${encodeURIComponent(MESSAGE_LIGNE_RECALCULEE)}`);
    expect((await ligne(ids.ada)).statutPaiement).toBe("PAS_VALIDE");
    // Rechargée : le jeton de l'écran est à jour, la validation passe… puis on rouvre pour la suite.
    expect(await changerStatutEnLot([l.id], "VALIDE", null, { [l.id]: await jetonDe(prisma, apres.id) })).toBe(1);
    await changerStatutPaie(l.id, fd({ versStatut: "PAS_VALIDE" }));
  });

  it("salarié désactivé dont la ligne rouverte a un historique : la ligne reste (jamais supprimée par un recalcul)", async () => {
    const l = await ligne(ids.ada);
    await prisma.employee.update({ where: { id: ids.ada }, data: { actif: false } });
    en("MANAGER");
    await calculerPaieDuMois();
    expect(await prisma.payrollLine.count({ where: { id: l.id } })).toBe(1);
    expect(await prisma.versionBulletin.count({ where: { payrollLineId: l.id } })).toBeGreaterThanOrEqual(1);
    // Jamais validée, avec un message qui dit comment en sortir (jamais « rechargez » seul) ; la
    // clôture la laisse de côté (ligne hors calcul, 2026-10-01) au lieu de rester bloquée sur elle.
    en("ADMIN");
    expect(await changerStatutEnLot([l.id], "VALIDE", null, await jetonsDe(prisma, [l.id]))).toEqual({ erreur: messageNonCalcules(["Ada Kalala"]) });
    await expect(cloturerPaie()).resolves.toBeUndefined();
    expect((await ligne(ids.ada)).statutPaiement).toBe("PAS_VALIDE");
    // Sortie annoncée : fiche réactivée → recalcul → validation possible.
    await prisma.employee.update({ where: { id: ids.ada }, data: { actif: true } });
    await rafraichirPaieDuMois({ creerRun: false });
    const remise = await ligne(ids.ada);
    expect(remise.id).toBe(l.id);
    expect(await changerStatutEnLot([l.id], "VALIDE", null, { [l.id]: await jetonDe(prisma, remise.id) })).toBe(1);
  });
});
