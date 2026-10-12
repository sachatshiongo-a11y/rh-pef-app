import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jetonDe } from "@/lib/test/paie-jeton";
import { pagesDuPdf } from "@/lib/test/pdf-lecture";

// Décision de la Direction du 2026-10-12 (5) : un bulletin VALIDÉ ou PAYÉ se réimprime et se déclare
// au taux de change ENREGISTRÉ À SA VALIDATION. Avant, chaque recalcul du mois réécrivait le taux de la
// paie (`PayrollRun.tauxChangeUtilise`) et les francs d'un bulletin déjà payé changeaient.
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
vi.mock("@/lib/entreprise", () => ({ chargerEntreprise: async () => ({ entreprise: undefined, logo: undefined, signature: null }) }));

const { calculerPaieDuMois, changerStatutPaie } = await import("./actions");
const { genererBulletinPdf } = await import("@/lib/pdf/bulletin-buffer");
const { calculerDeclarationsMois } = await import("@/lib/declarations");

let prisma: PrismaClient; let fermer: () => Promise<void>;
const ids = { paye: "", brouillon: "" };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ligne = (employeeId: string) => prisma.payrollLine.findFirstOrThrow({ where: { employeeId, payrollRun: { mois: 9, annee: 2026 } } });
const texteBulletin = async (id: string) => (await pagesDuPdf((await genererBulletinPdf(id, "CDF"))!.buffer)).map((p) => p.plat).join(" ");

beforeAll(async () => {
  const db = await creerBaseTest(); prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  const cree = (matricule: string, nom: string) => prisma.employee.create({ data: {
    matricule, nom, sexe: "F", etatCivil: "C", poste: "Poste", secteur: "Secteur", categorie: "BACKOFFICE",
    salaireMensuel: 400, heuresHebdomadaires: 45, heuresParJour: 9, dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDI" } });
  ids.paye = (await cree("TX1", "Tina Taux")).id;
  ids.brouillon = (await cree("TX2", "Bob Brouillon")).id;
  await calculerPaieDuMois();
  const l = await ligne(ids.paye);
  await changerStatutPaie(l.id, fd({ versStatut: "VALIDE", jeton: await jetonDe(prisma, l.id) }));
  await changerStatutPaie(l.id, fd({ versStatut: "PAYE", jeton: await jetonDe(prisma, l.id) }));
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("taux de change figé à la validation", () => {
  it("la validation enregistre le taux de la paie sur la ligne", async () => {
    const l = await ligne(ids.paye);
    expect(l.statutPaiement).toBe("PAYE");
    expect(Number(l.tauxChangeFige)).toBe(2300);
    expect((await ligne(ids.brouillon)).tauxChangeFige).toBeNull();
  });

  it("bulletin payé réimprimé après un changement de taux et un recalcul du mois : identique au centime ; IPR déclaré inchangé", async () => {
    const l = await ligne(ids.paye);
    const avant = await texteBulletin(l.id);
    const declAvant = (await calculerDeclarationsMois(9, 2026))!;
    const iprPaye = Number(l.iprCalculeUSD) * 2300;

    await prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: 2900 } });
    await calculerPaieDuMois(); // réécrit le taux de la paie du mois, comme chaque ouverture de /paie
    expect(Number((await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 } })).tauxChangeUtilise)).toBe(2900);

    expect(await texteBulletin(l.id)).toBe(avant);
    const declApres = (await calculerDeclarationsMois(9, 2026))!;
    const ipr = (d: typeof declApres) => d.lignes.find((x) => x.type === "IPR")!;
    // IPR du bulletin payé : toujours à 2 300 ; celui du brouillon suit le taux du jour (2 900).
    const iprBrouillon = Number((await ligne(ids.brouillon)).iprCalculeUSD) * 2900;
    expect(ipr(declApres).recalculCDF).toBeCloseTo(iprPaye + iprBrouillon, 6);
    expect(declApres.tauxDistincts).toEqual([2300, 2900]);
    expect(declAvant.tauxDistincts).toEqual([2300]);
  }, 120_000);

  it("le brouillon, lui, est PROVISOIRE au taux du jour", async () => {
    const t = await texteBulletin((await ligne(ids.brouillon)).id);
    expect(t).toContain("PROVISOIRE");
  }, 60_000);
});
