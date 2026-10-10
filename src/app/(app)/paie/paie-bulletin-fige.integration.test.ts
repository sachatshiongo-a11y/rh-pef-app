import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jetonDe } from "@/lib/test/paie-jeton";

// Audit paie du 2026-10-10 (preuves Nagi) — deux défauts d'argent autour d'un bulletin FIGÉ :
//  #2 réouverture d'un bulletin : la dernière échéance de prêt était perdue (prêt resté SOLDÉ,
//     100 $ versés en trop au recalcul) ;
//  #3 acompte approuvé, prime, frais médical, avantage en nature ajoutés pour un mois dont le
//     bulletin est déjà validé : sur AUCUN bulletin. Désormais refusés, avec la sortie.
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

const { calculerPaieDuMois, changerStatutPaie } = await import("./actions");
const R = await import("./remuneration-actions");
const { rafraichirPaieDuMois } = await import("@/lib/paie-refresh");

let prisma: PrismaClient; let fermer: () => Promise<void>;
let empId = "";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ligne = () => prisma.payrollLine.findFirstOrThrow({ where: { employeeId: empId, payrollRun: { mois: 9, annee: 2026 } } });
/** Message d'erreur renvoyé à l'écran par `?erreur=` (formulaires) — null si l'action a réussi. */
async function erreurDe(action: Promise<unknown>): Promise<string | null> {
  try { await action; return null; } catch (e) {
    const m = String((e as Error).message).match(/erreur=([^&]*)/);
    if (m) return decodeURIComponent(m[1]);
    throw e;
  }
}
async function passer(versStatut: "VALIDE" | "PAS_VALIDE") {
  const l = await ligne();
  const err = await erreurDe(changerStatutPaie(l.id, fd({ versStatut, ...(versStatut === "VALIDE" ? { jeton: await jetonDe(prisma, l.id) } : {}) })));
  expect(err).toBeNull();
  expect((await ligne()).statutPaiement).toBe(versStatut);
}
const pret = () => prisma.pretPersonnel.findFirstOrThrow({ where: { employeeId: empId }, include: { retenues: true } });

beforeAll(async () => {
  const db = await creerBaseTest(); prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  empId = (await prisma.employee.create({ data: {
    matricule: "BO1", nom: "Bea Bureau", sexe: "F", etatCivil: "C", poste: "Compta", secteur: "Bureau", categorie: "BACKOFFICE",
    salaireMensuel: 400, heuresHebdomadaires: 45, heuresParJour: 9, enfants: 0, dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDI" } })).id;
  // Prêt de 100 $ remboursé en UNE échéance (septembre).
  await prisma.pretPersonnel.create({ data: { employeeId: empId, montantUSD: 100, retenueMensuelleUSD: 100 } });
  await calculerPaieDuMois();
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("#2 réouverture d'un bulletin : l'échéance de prêt n'est jamais perdue", () => {
  it("validation : échéance de 100 $ enregistrée, prêt SOLDÉ", async () => {
    expect(Number((await ligne()).retenuePretUSD)).toBe(100);
    await passer("VALIDE");
    const p = await pret();
    expect(p.statut).toBe("SOLDE");
    expect(p.retenues.map((r) => Number(r.montantUSD))).toEqual([100]);
  });

  it("réouverture : l'échéance du mois est annulée et le prêt repasse EN COURS, dans la même transaction ; le recalcul la retient de nouveau", async () => {
    await passer("PAS_VALIDE");
    const p = await pret();
    expect(p.statut).toBe("EN_COURS");
    expect(p.retenues).toHaveLength(0);
    const journal = await prisma.journalAudit.findFirst({ where: { entite: "PretPersonnel", entiteId: p.id, champ: "retenue" } });
    expect(journal?.nouvelleValeur).toContain("annulée");
    await rafraichirPaieDuMois({ creerRun: false });
    expect(Number((await ligne()).retenuePretUSD)).toBe(100); // et non 0 : 100 $ versés en trop avant le correctif
  });

  it("revalidation : une seule échéance de 100 $, prêt SOLDÉ — ni perte ni doublon", async () => {
    await passer("VALIDE");
    const p = await pret();
    expect(p.statut).toBe("SOLDE");
    expect(p.retenues.map((r) => Number(r.montantUSD))).toEqual([100]);
  });
});

describe("#3 élément de paie sur un bulletin déjà validé : refusé, avec la sortie", () => {
  const MESSAGE = "Le bulletin de septembre 2026 est déjà validé : rouvrez-le, ou saisissez l'élément sur le mois suivant.";

  it("acompte approuvé (unitaire puis en lot) : refusé, l'acompte reste en attente, le net figé ne bouge pas", async () => {
    const net = Number((await ligne()).salNetUSD);
    const ac = await prisma.acompteSalaire.create({ data: { employeeId: empId, montantUSD: 50, mois: 9, annee: 2026 } });
    expect(await R.approuverAcompte(ac.id)).toEqual({ ok: false, message: MESSAGE });
    expect(await R.approuverAcomptesEnLot([ac.id])).toEqual({ traites: 0, bloques: 1, message: MESSAGE });
    expect((await prisma.acompteSalaire.findUniqueOrThrow({ where: { id: ac.id } })).statut).toBe("EN_ATTENTE");
    expect(Number((await ligne()).salNetUSD)).toBe(net);
    // Refuser, lui, reste possible (rien n'est versé).
    expect(await R.refuserAcompte(ac.id)).toEqual({ ok: true });
  });

  it("demande d'acompte, prime, frais médical, avantage en nature : refusés (?erreur=), rien d'écrit", async () => {
    expect(await erreurDe(R.demanderAcompte(empId, fd({ montantUSD: "20" })))).toBe(MESSAGE);
    expect(await erreurDe(R.ajouterPrime(empId, fd({ nom: "Prime", montantUSD: "30" })))).toBe(MESSAGE);
    expect(await erreurDe(R.ajouterFraisMedical(empId, fd({ montantUSD: "15" })))).toBe(MESSAGE);
    expect(await erreurDe(R.ajouterAvantageNature(empId, fd({ nature: "Logement", montantUSD: "40" })))).toBe(MESSAGE);
    expect(await prisma.prime.count()).toBe(0);
    expect(await prisma.fraisMedical.count()).toBe(0);
    expect(await prisma.avantageNature.count()).toBe(0);
    expect(await prisma.acompteSalaire.count({ where: { statut: "EN_ATTENTE" } })).toBe(0);
  });

  it("bulletin rouvert : la prime passe et se retrouve sur la ligne ; revalidée, elle ne peut plus être retirée", async () => {
    await passer("PAS_VALIDE");
    expect(await erreurDe(R.ajouterPrime(empId, fd({ nom: "Prime", montantUSD: "30" })))).toBeNull();
    expect(Number((await ligne()).primesUSD)).toBe(30);
    await passer("VALIDE");
    const prime = await prisma.prime.findFirstOrThrow({ where: { employeeId: empId } });
    expect(await erreurDe(R.supprimerPrime(prime.id))).toBe(MESSAGE);
    expect(await prisma.prime.count()).toBe(1);
  });
});
