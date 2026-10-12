import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jetonDe } from "@/lib/test/paie-jeton";
import { lireAvertissements } from "@/lib/paie-avertissements";

// Audit paie du 2026-10-10 (preuves Nagi) :
//  #1 embauché APRÈS la fin du mois : bulletin du mois entier (back-office) ou allocations pour 0 h
//     (brigade) → plus aucun bulletin ce mois-là. Absences N/S/M et entrée en cours de mois du
//     back-office : RETENUES depuis les décisions de la Direction du 2026-10-12 (1/26e par jour N/S,
//     tiers d'un jour M non justifié, prorata des jours ouvrables à l'entrée).
//  #5 net négatif possible sans alerte → signalé, et la validation (unitaire comme la clôture) refusée ;
//     l'échéance de prêt du mois est réservée sur le plafond d'acompte.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "d@pef.cd", nom: "Direction", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("refus"); },
  requireModule: () => {}, invaliderProfil: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { calculerPaieDuMois, changerStatutPaie, cloturerPaie } = await import("./actions");
const { calculerBulletinLive } = await import("@/lib/bulletin-live");
const { chargerPlafondAcompte, verifierMontantAcompte } = await import("@/lib/acompte-plafond");

let prisma: PrismaClient; let fermer: () => Promise<void>;
const ids = { absent: "", futurBO: "", futurBrigade: "", entree: "", endette: "", malade: "" };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ligne = (employeeId: string) => prisma.payrollLine.findFirst({ where: { employeeId, payrollRun: { mois: 9, annee: 2026 } } });
async function erreurDe(action: Promise<unknown>): Promise<string | null> {
  try { await action; return null; } catch (e) {
    const m = String((e as Error).message).match(/erreur=([^&]*)/);
    if (m) return decodeURIComponent(m[1]);
    throw e;
  }
}

beforeAll(async () => {
  const db = await creerBaseTest(); prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  const cree = (matricule: string, nom: string, categorie: "BACKOFFICE" | "BRIGADE", embauche: string, enfants = 0) =>
    prisma.employee.create({ data: {
      matricule, nom, sexe: "F", etatCivil: "C", poste: "Poste", secteur: "Secteur", categorie,
      salaireMensuel: 400, heuresHebdomadaires: 45, heuresParJour: 9, enfants, dateEmbauche: new Date(`${embauche}T00:00:00Z`), contrat: "CDI" } });
  ids.absent = (await cree("BO1", "Bea Bureau", "BACKOFFICE", "2025-01-06")).id;
  ids.futurBO = (await cree("BO2", "Futur Bureau", "BACKOFFICE", "2026-11-01")).id;
  ids.futurBrigade = (await cree("BR1", "Futur Cuisine", "BRIGADE", "2026-11-01", 4)).id;
  ids.entree = (await cree("BO3", "Entree Mi-Mois", "BACKOFFICE", "2026-09-15")).id;
  ids.endette = (await cree("BO4", "Dora Dette", "BACKOFFICE", "2025-01-06")).id;
  ids.malade = (await cree("BO5", "Mado Malade", "BACKOFFICE", "2025-01-06")).id;
  // Maladie : 2 jours sans justificatif (21 et 22/09), 1 jour justifié par certificat (23/09).
  for (const [j, justifiee] of [[21, false], [22, false], [23, true]] as const)
    await prisma.attendance.create({ data: { employeeId: ids.malade, date: new Date(Date.UTC(2026, 8, j)), code: "M", maladieJustifiee: justifiee } });
  for (let j = 1; j <= 3; j++) await prisma.attendance.create({ data: { employeeId: ids.absent, date: new Date(Date.UTC(2026, 8, j)), code: "N" } });
  await prisma.attendance.create({ data: { employeeId: ids.absent, date: new Date(Date.UTC(2026, 8, 10)), code: "S" } });
  await prisma.attendance.create({ data: { employeeId: ids.absent, date: new Date(Date.UTC(2026, 8, 14)), code: "M" } });
  // Échéance de prêt de 500 $ sur un salaire de 400 $ : net négatif.
  await prisma.pretPersonnel.create({ data: { employeeId: ids.endette, montantUSD: 1000, retenueMensuelleUSD: 500 } });
  await calculerPaieDuMois();
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("#1 embauche postérieure au mois : aucun bulletin", () => {
  it("back-office et brigade embauchés le 01/11 : pas de ligne de septembre (ni salaire, ni allocations pour 0 h)", async () => {
    expect(await ligne(ids.futurBO)).toBeNull();
    expect(await ligne(ids.futurBrigade)).toBeNull();
    // La fiche (aperçu du bulletin) dit la même chose que la paie.
    expect(await calculerBulletinLive(ids.futurBrigade, 9, 2026)).toBeNull();
    expect(await calculerBulletinLive(ids.futurBrigade, 11, 2026)).not.toBeNull();
  });
});

describe("back-office : absences retenues à 1/26e, entrée au prorata, maladie (décisions Direction 2026-10-12)", () => {
  it("N les 01-03/09 + S le 10/09 = 4 j × 400/26 ; M non justifié le 14/09 = 1/3 de 400/26", async () => {
    const l = (await ligne(ids.absent))!;
    // 400 − 61,54 (4 j) − 5,13 (1/3 j) = 333,33 ; le bulletin imprime la base et chaque retenue.
    expect(Number(l.remuneration100)).toBe(333.33);
    expect(Number(l.retenueAbsencesUSD)).toBe(61.54);
    expect(l.joursAbsenceRetenus).toBe(4);
    expect(Number(l.retenueMaladieUSD)).toBe(5.13);
    expect(l.joursMaladieNonJustifies).toBe(1);
    expect(Number(l.remuneration100) + Number(l.retenueAbsencesUSD) + Number(l.retenueMaladieUSD)).toBe(400);
    // Plus d'avertissement « rien n'est retenu » : la retenue est faite.
    expect(lireAvertissements(l.avertissementsPaie).map((a) => a.code)).not.toContain("ABSENCES_NON_DEDUITES");
    // La fiche (aperçu) calcule pareil que le lot.
    expect((await calculerBulletinLive(ids.absent, 9, 2026))!.ligne.remuneration100).toBe(333.33);
  });

  it("embauche le 15/09 : 14 jours ouvrables travaillables, base 26 → 400 × 14/26 = 215,38", async () => {
    const l = (await ligne(ids.entree))!;
    expect(Number(l.remuneration100)).toBe(215.38);
    expect([l.prorataJoursTravailles, l.prorataJoursMois]).toEqual([14, 26]);
    expect((await calculerBulletinLive(ids.entree, 9, 2026))!.ligne.remuneration100).toBe(215.38);
  });

  it("maladie : 2 j sans justificatif aux 2/3, 1 j justifié à 100 % → 400 − 2 × 400/26/3 = 389,74", async () => {
    const l = (await ligne(ids.malade))!;
    expect(Number(l.remuneration100)).toBe(389.74);
    expect(Number(l.retenueMaladieUSD)).toBe(10.26);
    expect([l.joursMaladieNonJustifies, l.joursMaladieJustifies]).toEqual([2, 1]);
  });

  it("la ligne avec retenues se valide", async () => {
    const l = (await ligne(ids.absent))!;
    expect(await erreurDe(changerStatutPaie(l.id, fd({ versStatut: "VALIDE", jeton: await jetonDe(prisma, l.id) })))).toBeNull();
    expect((await ligne(ids.absent))!.statutPaiement).toBe("VALIDE");
  });
});

describe("#5 net à payer négatif : signalé, validation refusée", () => {
  it("échéance de 500 $ sur 400 $ : net négatif signalé sur la ligne", async () => {
    const l = (await ligne(ids.endette))!;
    expect(Number(l.salNetUSD)).toBeLessThan(0);
    expect(lireAvertissements(l.avertissementsPaie).map((a) => a.code)).toContain("NET_NON_POSITIF");
  });

  it("validation unitaire refusée, avec le nom et les montants ; rien d'écrit", async () => {
    const l = (await ligne(ids.endette))!;
    const err = await erreurDe(changerStatutPaie(l.id, fd({ versStatut: "VALIDE", jeton: await jetonDe(prisma, l.id) })));
    expect(err).toMatch(/^Total versé \(net à payer\) négatif ou nul : Dora Dette \(total versé \(\d+,\d\d \$\) ; acompte 0,00 \$, échéance de prêt 500,00 \$\)/);
    expect((await ligne(ids.endette))!.statutPaiement).toBe("PAS_VALIDE");
    expect(await prisma.retenuePret.count()).toBe(0);
  });

  it("la clôture (qui valide tout d'un coup) est refusée de même : rien de validé", async () => {
    const err = await erreurDe(cloturerPaie(fd({ mois: "9", annee: "2026" })));
    expect(err).toContain("Total versé (net à payer) négatif ou nul : Dora Dette");
    expect((await ligne(ids.entree))!.statutPaiement).toBe("PAS_VALIDE");
  });

  it("plafond d'acompte : l'échéance de prêt du mois est réservée (aucun bulletin le mois précédent → fiche 400 $ − 500 $ = 0)", async () => {
    const p = await chargerPlafondAcompte(prisma, { employeeId: ids.endette, mois: 9, annee: 2026 });
    expect(p.echeancePretUSD).toBe(500);
    expect(p.disponibleUSD).toBe(0);
    expect(verifierMontantAcompte(10, p)).toEqual({ ok: false, message: "Acompte plafonné à 400,00 $ (salaire de la fiche (aucun bulletin le mois précédent)). 500,00 $ d'échéance de prêt retenue ce mois, il reste 0,00 $." });
  });
});
