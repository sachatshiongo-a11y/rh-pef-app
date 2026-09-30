import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import type { PositionScan } from "@/lib/pointage-qr";

// PREUVE D'ARGENT — décision de la Direction du 2026-09-29 : « la paie ne doit pas être affectée ».
// Trois salariés de brigade IDENTIQUES (salaire, contrat, planning), qui pointent EXACTEMENT les
// mêmes arrivées et départs par le VRAI scan (`enregistrerScan`), contre une vraie base :
//   • A laisse la pause PAR DÉFAUT (30 min, non déduite) ;
//   • B saisit une pause de 0 min — « une journée sans pause » ;
//   • C saisit 30 min — la pause saisie SE DÉDUIT.
// Puis le VRAI moteur de paie (`calculerLignesPaie` : référence sur les heures planifiées, heures
// supp., brut reconstitué depuis le net). A doit être payé AU CENTIME comme B ; C, lui, moins
// (sinon ce test ne verrait pas une déduction).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const { enregistrerScan, saisirPauseScan } = await import("./pointage-scan");
const { calculerLignesPaie } = await import("./paie-batch");

const CODE = "code-affiche-paie";
const RESTAURANT = { lat: -4.3217, lng: 15.3125 };
const AU_RESTAURANT: PositionScan = { lat: -4.3218, lng: 15.3126, precisionM: 20 };
// Lundi 14 → samedi 19 septembre 2026, créneau 8 h → 17 h (9 h). Samedi : départ à 19 h (2 h de plus).
const JOURS = [14, 15, 16, 17, 18, 19];
const d = (n: number) => new Date(Date.UTC(2026, 8, n));
const kin = (n: number, h: number) => new Date(Date.UTC(2026, 8, n, h - 1)); // heure de Kinshasa (UTC+1)

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids = { defaut: "", sansPause: "", saisie30: "" };

async function salarie(matricule: string, nom: string) {
  const emp = await prisma.employee.create({ data: {
    matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Brigade", secteur: "Cuisine", categorie: "BRIGADE",
    salaireMensuel: 300, heuresHebdomadaires: 54, heuresParJour: 9, enfants: 0,
    dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDI",
  } });
  const u = await prisma.user.create({ data: { email: `${matricule.toLowerCase()}@test.pef`, nom, role: "EMPLOYE", employeeId: emp.id } });
  return { employeeId: emp.id, userId: u.id };
}

/** Une semaine pointée par le scan ; `pause` = ce que le salarié saisit après son départ (null = rien). */
async function semaine(qui: { employeeId: string; userId: string }, pause: number | null) {
  for (const n of JOURS) {
    await enregistrerScan(prisma, { ...qui, code: CODE, position: AU_RESTAURANT, maintenant: kin(n, 8) });
    const depart = kin(n, n === 19 ? 19 : 17);
    const r = await enregistrerScan(prisma, { ...qui, code: CODE, position: AU_RESTAURANT, maintenant: depart });
    if (r.etat !== "DEPART") throw new Error(`départ attendu le ${n}`);
    if (pause !== null) await saisirPauseScan(prisma, { ...qui, scanId: r.scanId, pauseMinutes: pause, maintenant: new Date(depart.getTime() + 60_000) });
  }
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.parametreLegal.create({ data: { exerciceId: (await prisma.exerciceFiscal.findFirstOrThrow()).id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
  await prisma.config.create({ data: {
    id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9,
    pointageLatitude: RESTAURANT.lat, pointageLongitude: RESTAURANT.lng, pointageRayonM: 150, pointageCode: CODE,
  } });
  const journee = await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } });

  const a = await salarie("PD01-PEF", "Pause Défaut");
  const b = await salarie("SP01-PEF", "Sans Pause");
  const c = await salarie("PS01-PEF", "Pause Saisie");
  ids.defaut = a.employeeId; ids.sansPause = b.employeeId; ids.saisie30 = c.employeeId;
  for (const q of [a, b, c])
    await prisma.planningCreneau.createMany({ data: JOURS.map((n) => ({ employeeId: q.employeeId, date: d(n), shiftId: journee.id })) });

  await semaine(a, null);
  await semaine(b, 0);
  await semaine(c, 30);
}, 180_000);
afterAll(async () => { await fermer?.(); });

async function heures(employeeId: string) {
  const e = await prisma.overtimeEntry.findMany({ where: { employeeId }, orderBy: { date: "asc" } });
  return e.map((x) => Number(x.heuresTravaillees));
}

describe("pause par défaut — la paie est celle d'une journée sans pause", () => {
  it("heures écrites aux présences : pause par défaut = sans pause (9 h × 5 + 11 h) ; pause saisie 30 min : 30 min de moins par jour", async () => {
    expect(await heures(ids.defaut)).toEqual([9, 9, 9, 9, 9, 11]);
    expect(await heures(ids.sansPause)).toEqual([9, 9, 9, 9, 9, 11]);
    expect(await heures(ids.saisie30)).toEqual([8.5, 8.5, 8.5, 8.5, 8.5, 10.5]);
    expect(await prisma.pointage.count({ where: { employeeId: ids.defaut, pauseParDefaut: true, pauseMinutes: 0 } })).toBe(6);
  });

  it("le moteur de paie brigade (heures planifiées, HS, net → brut) paie A exactement comme B", async () => {
    const { lignes } = await calculerLignesPaie(9, 2026);
    const ligne = (id: string) => lignes.find((l) => l.employee.id === id)!.data;
    const a = ligne(ids.defaut);
    const b = ligne(ids.sansPause);
    const c = ligne(ids.saisie30);

    expect(a.sourceReference).toBe(b.sourceReference);
    expect(a).toEqual(b); // TOUTES les rubriques : heures, HS 30/60/100, brut, retenues, net, coût employeur
    expect(a.heuresTravaillees).toBe(56);
    expect(a.salBrutUSD).toBeGreaterThan(0);

    // La pause saisie, elle, se déduit : 3 h de moins, donc moins d'argent.
    expect(c.heuresTravaillees).toBe(53);
    expect(c.salNetUSD).toBeLessThan(a.salNetUSD);
  });
});
