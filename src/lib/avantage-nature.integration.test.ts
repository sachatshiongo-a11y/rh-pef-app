import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// Test d'INTÉGRATION — la garantie CENTRALE des avantages en nature : ils sont consignés et
// remontés sur le bulletin, mais ne déplacent AUCUN montant (décision 2026-08-16, traitement
// fiscal À VALIDER par un comptable).
//
// Méthode : on calcule la paie SANS avantage, on relève tous les montants, on ajoute un avantage
// de 150 $, on recalcule, et on exige l'égalité stricte champ par champ. Un test qui vérifierait
// seulement « avantagesNatureUSD vaut 150 » raterait exactement le défaut qu'on craint — qu'un
// avantage se soit glissé dans l'assiette.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { calculerLignesPaie } = await import("./paie-batch");
const { calculerBulletinLive } = await import("./bulletin-live");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;

/** Tous les champs monétaires d'une ligne de paie — aucun ne doit bouger. */
const CHAMPS_ARGENT = [
  "remuneration100", "remuneration2_3", "hsValorisee", "indemniteCongesUSD", "fraisMedicauxUSD",
  "transportUSD", "primesUSD", "acompteUSD", "retenuePretUSD", "salBrutUSD", "cnssSalarieUSD",
  "netImposableUSD", "iprCalculeUSD", "allocFamilialeUSD", "salNetUSD", "salNetCDF",
  "cnssPatronalUSD", "inppUSD", "onemUSD", "coutEmployeurUSD", "coutEmployeurCDF",
] as const;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 7 } });

  const emp = await prisma.employee.create({
    data: {
      matricule: "AN01-PEF", nom: "Avantage Test", sexe: "F", etatCivil: "Marié(e)",
      poste: "Cuisinier", secteur: "Cuisine", categorie: "BRIGADE",
      salaireMensuel: 260, heuresParJour: 8, heuresHebdomadaires: 48,
      transportJourCDF: 2300, dateEmbauche: new Date("2024-01-01"), contrat: "CDI", enfants: 2,
    },
  });
  empId = emp.id;

  const joursP = [
    "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
    "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
  ];
  await prisma.attendance.createMany({
    data: joursP.map((d) => ({ employeeId: empId, date: new Date(d), code: "P" as const })),
  });
  await prisma.overtimeEntry.createMany({
    data: joursP.map((d) => ({ employeeId: empId, date: new Date(d), heuresTravaillees: 8 })),
  });
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("Avantages en nature — neutralité totale sur la paie", () => {
  it("n'altère AUCUN montant du bulletin, et se contente d'y être recopié", async () => {
    const avant = (await calculerLignesPaie(7, 2026)).lignes.find((l) => l.employee.id === empId);
    expect(avant).toBeTruthy();
    const montantsAvant = Object.fromEntries(
      CHAMPS_ARGENT.map((c) => [c, Number(avant!.data[c])])
    );
    expect(avant!.data.avantagesNatureUSD).toBe(0);
    // Garde-fou du test lui-même : si la paie sortait à 0 partout, l'égalité serait triviale.
    expect(montantsAvant.salNetUSD).toBeGreaterThan(0);

    await prisma.avantageNature.create({
      data: { employeeId: empId, nature: "Logement", montantUSD: 150, mois: 7, annee: 2026 },
    });

    const apres = (await calculerLignesPaie(7, 2026)).lignes.find((l) => l.employee.id === empId);
    for (const champ of CHAMPS_ARGENT) {
      expect(Number(apres!.data[champ]), `le champ ${champ} a bougé`).toBe(montantsAvant[champ]);
    }
    expect(Number(apres!.data.avantagesNatureUSD)).toBe(150);
  });

  it("additionne plusieurs avantages du mois sans toucher au net", async () => {
    const netAvant = (await calculerLignesPaie(7, 2026)).lignes.find((l) => l.employee.id === empId)!.data.salNetUSD;

    await prisma.avantageNature.create({
      data: { employeeId: empId, nature: "Nourriture", montantUSD: 40, mois: 7, annee: 2026 },
    });

    const apres = (await calculerLignesPaie(7, 2026)).lignes.find((l) => l.employee.id === empId)!;
    expect(Number(apres.data.avantagesNatureUSD)).toBe(190); // 150 + 40
    expect(Number(apres.data.salNetUSD)).toBe(Number(netAvant));
  });

  it("ignore les avantages d'un AUTRE mois", async () => {
    await prisma.avantageNature.create({
      data: { employeeId: empId, nature: "Véhicule", montantUSD: 500, mois: 8, annee: 2026 },
    });
    const juillet = (await calculerLignesPaie(7, 2026)).lignes.find((l) => l.employee.id === empId)!;
    expect(Number(juillet.data.avantagesNatureUSD)).toBe(190); // toujours 150 + 40
  });

  it("remonte aussi les avantages dans l'aperçu en direct, sans changer son net", async () => {
    const apercu = await calculerBulletinLive(empId, 7, 2026);
    expect(apercu).toBeTruthy();
    expect(apercu!.avantagesNatureUSD).toBe(190);
    expect(apercu!.avantagesNature.map((a) => a.nature).sort()).toEqual(["Logement", "Nourriture"]);

    const ligne = (await calculerLignesPaie(7, 2026)).lignes.find((l) => l.employee.id === empId)!;
    expect(apercu!.ligne.salNetUSD).toBeCloseTo(Number(ligne.data.salNetUSD), 2);
  });
});
