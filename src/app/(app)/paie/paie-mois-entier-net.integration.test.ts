import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jetonDe } from "@/lib/test/paie-jeton";
import { lireAvertissements } from "@/lib/paie-avertissements";

// Audit paie du 2026-10-10 (preuves Nagi) :
//  #1 embauché APRÈS la fin du mois : bulletin du mois entier (back-office) ou allocations pour 0 h
//     (brigade) → plus aucun bulletin ce mois-là. Absences N/S/M et entrée en cours de mois du
//     back-office : AUCUN montant changé (décision Direction en attente), mais un signalement nommé.
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
const ids = { absent: "", futurBO: "", futurBrigade: "", entree: "", endette: "" };
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

describe("#1 back-office : absences et entrée en cours de mois signalées, montants inchangés", () => {
  it("N les 01-03/09, S le 10/09, M le 14/09 : salaire entier (décision en attente) mais chaque jour nommé", async () => {
    const l = (await ligne(ids.absent))!;
    expect(Number(l.remuneration100)).toBe(400);
    const msgs = lireAvertissements(l.avertissementsPaie).filter((a) => a.code === "ABSENCES_NON_DEDUITES").map((a) => a.message);
    expect(msgs).toEqual([
      "Payé au mois entier, rien n'est retenu pour : absence injustifiée (N) les 01/09, 02/09, 03/09 (3 j) ; sans solde (S) le 10/09 ; maladie (M) le 14/09. Retenue à décider par la Direction (règle en attente).",
    ]);
  });

  it("embauche le 15/09 : mois entier versé, signalé", async () => {
    const l = (await ligne(ids.entree))!;
    expect(Number(l.remuneration100)).toBe(400);
    expect(lireAvertissements(l.avertissementsPaie).map((a) => a.message)).toContain(
      "Mois incomplet (embauche le 15/09/2026) : salaire du mois entier versé, sans prorata. Prorata à décider par la Direction (règle en attente).",
    );
  });

  it("le signalement ne bloque pas : la ligne se valide", async () => {
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
