// Cas réel du 12/10/2026 (Jeannette Bongota) : le planning du jour fait foi pour la présence posée.
// Modèle hebdo : mercredi 08:30–16:30 (8 h). Planning de la semaine : mercredi 14/10 16:30–22:30 (6 h).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  verifySession: async () => A.user,
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé"); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const PRES = await import("@/app/(app)/presences/actions");
const { chargerHorairesDuMois } = await import("@/lib/horaires-presences");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let matin = "";
let soir = "";
let n = 0;
const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Une salariée façon Jeannette : modèle lun/mer/ven matin, mar/jeu/sam soir ; planning du mercredi 14 = soir. */
async function jeannette() {
  n++;
  const id = (await prisma.employee.create({
    data: { matricule: `JB${n}-PEF`, nom: `Jeannette ${n}`, sexe: "F", etatCivil: "Célibataire", poste: "Serveuse", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 200, dateEmbauche: new Date("2024-01-01"), contrat: "CDI", heuresParJour: 6, heuresHebdomadaires: 36 },
  })).id;
  for (const [j, s] of [[1, matin], [2, soir], [3, matin], [4, soir], [5, matin], [6, soir]] as [number, string][]) {
    await prisma.planningModele.create({ data: { employeeId: id, jour: j, semaine: 0, shiftId: s } });
  }
  await prisma.planningCreneau.create({ data: { employeeId: id, date: jour("2026-10-14"), shiftId: soir } });
  return id;
}

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest()); H.client = prisma;
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T10:00:00Z") }); // 14/10 = jour à venir (seuls ceux-là sont recalés)
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const u = await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } });
  A.user = { ...A.user, id: u.id, nom: u.nom };
  matin = (await prisma.shift.create({ data: { nom: "Matin", heureDebut: "08:30", heureFin: "16:30" } })).id;
  soir = (await prisma.shift.create({ data: { nom: "Soir", heureDebut: "16:30", heureFin: "22:30" } })).id;
}, 120_000);
afterAll(async () => { vi.useRealTimers(); await fermer?.(); });

const heuresDe = async (id: string, iso: string) => {
  const h = await prisma.overtimeEntry.findUnique({ where: { employeeId_date: { employeeId: id, date: jour(iso) } } });
  return h ? Number(h.heuresTravaillees) : null;
};

describe("présence posée un jour planifié : durée ET horaire du planning, jamais du modèle", () => {
  it("unitaire : P le mercredi 14 → 6 h, horaire 16:30–22:30 (source planning)", async () => {
    const id = await jeannette();
    await PRES.saisirPresence(id, "2026-10-14", "P");
    expect(await heuresDe(id, "2026-10-14")).toBe(6);
    const horaires = await chargerHorairesDuMois(prisma, 2026, 10, [id]);
    expect(horaires[`${id}_14`]).toMatchObject({ debut: "16:30", fin: "22:30", source: "PLANNING" });
    // Le lundi 12 (sans créneau) reste au modèle : 8 h, 08:30–16:30.
    await PRES.saisirPresence(id, "2026-10-12", "P");
    expect(await heuresDe(id, "2026-10-12")).toBe(8);
    expect(horaires[`${id}_12`]).toMatchObject({ debut: "08:30", fin: "16:30", source: "MODELE" });
  });

  it("en lot (semaine) : le mercredi prend le planning, les autres jours le modèle", async () => {
    const id = await jeannette();
    const r = await PRES.saisirPresencesEnLot(["2026-10-12", "2026-10-13", "2026-10-14"].map((date) => ({ employeeId: id, date, code: "P" as const })));
    expect(r.erreur).toBeUndefined();
    expect([await heuresDe(id, "2026-10-12"), await heuresDe(id, "2026-10-13"), await heuresDe(id, "2026-10-14")]).toEqual([8, 6, 6]);
  });

  it("le planning posé APRÈS la présence : les heures pré-remplies suivent le planning ; des heures saisies à la main, non (et c'est journalisé)", async () => {
    const { ecrireCreneaux } = await import("@/lib/planning-ecriture");
    const id = await jeannette();
    await prisma.planningCreneau.deleteMany({ where: { employeeId: id } });
    await PRES.saisirPresence(id, "2026-10-14", "P"); // pas encore de planning : modèle, 8 h
    expect(await heuresDe(id, "2026-10-14")).toBe(8);
    await prisma.$transaction((tx) => ecrireCreneaux(tx, A.user.id, [{ employeeId: id, date: jour("2026-10-14"), shiftId: soir }]));
    expect(await heuresDe(id, "2026-10-14")).toBe(6);
    const horaires = await chargerHorairesDuMois(prisma, 2026, 10, [id]);
    expect(horaires[`${id}_14`]).toMatchObject({ debut: "16:30", fin: "22:30", source: "PLANNING" });
    // Heures saisies à la main (9 h) : jamais écrasées par un nouveau changement de planning, journalisées « gardées ».
    await prisma.overtimeEntry.update({ where: { employeeId_date: { employeeId: id, date: jour("2026-10-14") } }, data: { heuresTravaillees: 9 } });
    await prisma.$transaction((tx) => ecrireCreneaux(tx, A.user.id, [{ employeeId: id, date: jour("2026-10-14"), shiftId: matin }]));
    expect(await heuresDe(id, "2026-10-14")).toBe(9);
    const trace = await prisma.journalAudit.findFirstOrThrow({ where: { entiteId: `${id}_2026-10-14`, champ: "heuresGardees" } });
    expect(trace.nouvelleValeur).toContain("prévoit 8 h");
  });

  it("un Repos planifié avec une présence P : la durée ET l'horaire viennent du modèle (même source)", async () => {
    const id = await jeannette();
    const repos = await prisma.shift.create({ data: { nom: `Repos ${n}`, systeme: true } });
    await prisma.planningCreneau.create({ data: { employeeId: id, date: jour("2026-10-16"), shiftId: repos.id } });
    await PRES.saisirPresence(id, "2026-10-16", "P");
    expect(await heuresDe(id, "2026-10-16")).toBe(8);
    const horaires = await chargerHorairesDuMois(prisma, 2026, 10, [id]);
    expect(horaires[`${id}_16`]).toMatchObject({ debut: "08:30", fin: "16:30", source: "MODELE" });
  });
});
