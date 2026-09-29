import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { chargerSoldeCongeSalarie, chargerSoldesCongeSalaries } from "@/lib/solde-conge-salarie";

// Le chargement EN LOT (calendrier des congés, 2026-09-29) doit donner, salarié par salarié, le
// même solde que le chargement unitaire (espace salarié, fiche Direction, PDF) : c'est la même
// source, un seul chiffre partout.
let prisma: PrismaClient;
let fermer: () => Promise<void>;
const MAINTENANT = new Date("2026-09-29T10:00:00Z");
let seq = 0;

async function salarie(contrat: "CDI" | "STAGE", dateEmbauche: string) {
  seq++;
  const e = await prisma.employee.create({
    data: {
      matricule: `SC${seq}-PEF`, nom: `Salarié ${seq}`, sexe: "F", etatCivil: "Célibataire", poste: "Cuisinière",
      secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date(dateEmbauche), contrat,
    },
  });
  return e.id;
}
async function conge(employeeId: string, type: string, debut: string, fin: string, nbJours: number, statut: "APPROUVE" | "EN_ATTENTE" = "APPROUVE") {
  await prisma.leaveRequest.create({ data: { employeeId, type, dateDebut: new Date(debut), dateFin: new Date(fin), nbJours, statut } });
}

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest());
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 3 } });
  await seedParametresLegaux(prisma);
  await prisma.typeConge.createMany({
    data: [
      { nom: "Congé annuel", compteDansSolde: true, ordre: 1 },
      { nom: "Congé maladie", compteDansSolde: false, ordre: 2 },
      { nom: "Ancien congé", compteDansSolde: true, actif: false, ordre: 3 },
    ],
  });
}, 120_000);
afterAll(async () => fermer?.());

describe("chargerSoldesCongeSalaries", () => {
  it("donne, pour chacun, exactement le solde du chargement unitaire", async () => {
    const a = await salarie("CDI", "2024-01-10");
    const b = await salarie("CDI", "2026-03-20"); // mois révolus : 6 au 29/09
    const c = await salarie("STAGE", "2025-06-01");
    await conge(a, "Congé annuel", "2026-02-02", "2026-02-06", 5);
    await conge(a, "Congé maladie", "2026-04-01", "2026-04-03", 3);
    await conge(a, "Ancien congé", "2026-05-04", "2026-05-05", 1.5);
    await conge(a, "Congé annuel", "2025-12-22", "2025-12-24", 3); // année précédente
    await conge(b, "Congé annuel", "2026-08-10", "2026-08-11", 2);
    await conge(b, "Congé annuel", "2026-10-01", "2026-10-02", 2, "EN_ATTENTE");

    const { soldes, entameLeSolde } = await chargerSoldesCongeSalaries(prisma, [a, b, c], MAINTENANT);
    for (const id of [a, b, c]) {
      expect(soldes.get(id), id).toEqual(await chargerSoldeCongeSalarie(prisma, id, MAINTENANT));
    }
    expect(soldes.get(a)).toMatchObject({ acquis: 18, pris: 6.5, solde: 11.5 });
    expect(soldes.get(b)).toMatchObject({ acquis: 9, pris: 2, solde: 7 });
    expect(soldes.get(c)).toMatchObject({ acquis: 0, pris: 0, solde: 0 });
    expect(soldes.get(a)!.typesDeduits).toEqual(["Congé annuel"]);

    expect(entameLeSolde("Congé annuel")).toBe(true);
    expect(entameLeSolde("Ancien congé")).toBe(true);
    expect(entameLeSolde("Congé maladie")).toBe(false);
    expect(entameLeSolde("Texte libre")).toBe(false);
  });

  it("un salarié inconnu : le chargement unitaire échoue, le lot l'ignore", async () => {
    await expect(chargerSoldeCongeSalarie(prisma, "00000000-0000-0000-0000-000000000000", MAINTENANT)).rejects.toThrow();
    const { soldes } = await chargerSoldesCongeSalaries(prisma, ["00000000-0000-0000-0000-000000000000"], MAINTENANT);
    expect(soldes.size).toBe(0);
  });
});
