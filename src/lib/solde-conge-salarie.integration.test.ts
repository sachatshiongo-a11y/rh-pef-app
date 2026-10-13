import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { chargerCongesFiche, chargerCongesParAnnee, chargerSoldeCongeSalarie, chargerSoldesCongeSalaries } from "@/lib/solde-conge-salarie";
import { chargerSortieFiche, sortieDeFiche } from "@/lib/sortie-salarie";

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
    // Solde plafonné à 18 À TOUT INSTANT (Sacha, 2026-10-12) : 15 au 31/12/2025, puis l'acquisition de
    // chaque 10 du mois remonte le solde jusqu'à 18 en juillet ; au-delà, perdu. Ancienne règle : 11,5.
    expect(soldes.get(a)).toMatchObject({ report: 15, pris: 6.5, solde: 18, plafonne: true });
    expect(soldes.get(b)).toMatchObject({ acquis: 9, pris: 2, solde: 7 });
    expect(soldes.get(c)).toMatchObject({ acquis: 0, pris: 0, solde: 0 });
    expect(soldes.get(a)!.typesDeduits).toEqual(["Congé annuel"]);

    expect(entameLeSolde("Congé annuel")).toBe(true);
    expect(entameLeSolde("Ancien congé")).toBe(true);
    expect(entameLeSolde("Congé maladie")).toBe(false);
    expect(entameLeSolde("Texte libre")).toBe(false);
  });

  // Décisions Direction 2026-10-12 : année civile, congé à cheval réparti, reliquat reporté, plafond.
  it("congé à cheval sur deux années : réparti ; le reliquat de 2025 est reporté, plafonné à 18 j", async () => {
    const d = await salarie("CDI", "2025-06-02");
    // 8 jours ouvrables (aucun férié saisi dans cette base) : 3 en 2025 (29-31/12), 5 en 2026.
    await conge(d, "Congé annuel", "2025-12-29", "2026-01-06", 8);
    const s = await chargerSoldeCongeSalarie(prisma, d, MAINTENANT);
    // 2025 : 6 mois révolus = 9 j − 3 = 6 reportés ; 2026 : 9 mois = 13,5, le solde ne touche jamais 18
    // (5 j pris début janvier) : 6 + 13,5 − 5 = 14,5. Ancienne règle : 18 (congé commencé en décembre, jamais décompté).
    expect(s).toMatchObject({ annee: 2026, report: 6, acquisAnnee: 13.5, acquis: 19.5, plafonne: false, pris: 5, solde: 14.5 });
  });

  it("un salarié inconnu : le chargement unitaire échoue, le lot l'ignore", async () => {
    await expect(chargerSoldeCongeSalarie(prisma, "00000000-0000-0000-0000-000000000000", MAINTENANT)).rejects.toThrow();
    const { soldes } = await chargerSoldesCongeSalaries(prisma, ["00000000-0000-0000-0000-000000000000"], MAINTENANT);
    expect(soldes.size).toBe(0);
  });
});

// Fiche salarié sur plusieurs années (2026-10-12) : le bilan de l'année en cours EST le solde du chargement
// unitaire ; le report d'une année est le solde de la précédente ; toutes les demandes sont lues (pas 15).
describe("chargerCongesParAnnee", () => {
  it("bilan par année cohérent avec le solde, demandes complètes avec leur part par année", async () => {
    const e = await salarie("CDI", "2025-06-02");
    await conge(e, "Congé annuel", "2025-12-29", "2026-01-06", 8); // 3 j en 2025, 5 j en 2026 (aucun férié saisi)
    await conge(e, "Congé maladie", "2026-04-01", "2026-04-03", 3); // ne se décompte pas
    await conge(e, "Congé annuel", "2026-10-01", "2026-10-02", 2, "EN_ATTENTE");
    for (let i = 0; i < 20; i++) await conge(e, "Congé maladie", `2025-0${(i % 5) + 7}-01`, `2025-0${(i % 5) + 7}-01`, 1);

    const { bilans, demandes, sansConges } = await chargerCongesParAnnee(prisma, e, MAINTENANT);
    expect(sansConges).toBe(false);
    expect(bilans.map((b) => b.annee)).toEqual([2025, 2026]);
    const solde = await chargerSoldeCongeSalarie(prisma, e, MAINTENANT);
    expect(bilans[1]).toEqual({ ...solde, typesDeduits: undefined, enCours: true }); // les types décomptés ne sont pas du bilan
    expect(bilans[0]).toMatchObject({ report: 0, acquisAnnee: 9, pris: 3, solde: 6, enCours: false });
    expect(bilans[1].report).toBe(bilans[0].solde);
    // Toutes les demandes (23 > les 15 d'avant), le congé à cheval réparti, le non décompté sans part.
    expect(demandes).toHaveLength(23);
    const cheval = demandes.find((d) => d.nbJours === 8)!;
    expect(cheval.joursParAnnee).toEqual({ 2025: 3, 2026: 5 });
    expect(cheval.entameLeSolde).toBe(true);
    const maladie = demandes.find((d) => d.type === "Congé maladie" && d.nbJours === 3)!;
    expect(maladie).toMatchObject({ entameLeSolde: false, joursParAnnee: {} });
    expect(demandes.find((d) => d.statut === "EN_ATTENTE")!.joursParAnnee).toEqual({});
  });

  // Relecture 2026-10-12 : les fériés de l'année SUIVANTE comptent pour répartir un congé à cheval posé
  // cette année. 28/12/2026 → 05/01/2027 : 7 jours ouvrables (le 1er janvier férié, le 3 dimanche),
  // 4 en 2026 (28-31/12), 3 en 2027 (2, 4, 5/01). Sans le férié de 2027 : 8 jours, 3,5 j décomptés en 2026.
  it("congé à cheval sur l'année suivante : le férié du 1er janvier suivant est connu", async () => {
    const e = await salarie("CDI", "2024-01-10");
    await prisma.jourFerie.create({ data: { date: new Date("2027-01-01"), designation: "Nouvel an", annee: 2027 } });
    await conge(e, "Congé annuel", "2026-12-28", "2027-01-05", 7);
    const { bilans, demandes } = await chargerCongesParAnnee(prisma, e, MAINTENANT);
    expect(demandes[0].joursParAnnee).toEqual({ 2026: 4, 2027: 3 });
    const solde = await chargerSoldeCongeSalarie(prisma, e, MAINTENANT);
    expect(solde.pris).toBe(4);
    expect(bilans.at(-1)!.pris).toBe(4);
  });
});

// Fiche salarié (13/10/2026) : le solde de l'en-tête et le bilan par année en UNE lecture des entrées, la fiche, ses fins
// de contrat et les droits annuels venant de la page qui les a déjà lus. Mêmes chiffres que les deux chargements séparés,
// et la date de sortie calculée sur les mêmes lignes que `chargerSortieFiche`.
describe("chargerCongesFiche", () => {
  it("rend exactement chargerSoldeCongeSalarie et chargerCongesParAnnee, pour des fiches actives et sorties", async () => {
    const parti = await salarie("CDI", "2023-03-01");
    await prisma.employee.update({ where: { id: parti }, data: { actif: false } });
    await prisma.finContrat.create({ data: { employeeId: parti, motif: "DEMISSION", dateFin: new Date("2026-05-31"), salaireJournalierUSD: 10 } });
    await conge(parti, "Congé annuel", "2026-02-02", "2026-02-04", 3);
    const sansDate = await salarie("CDI", "2025-01-06");
    await prisma.employee.update({ where: { id: sansDate }, data: { actif: false } });
    const avecDate = await salarie("STAGE", "2025-02-03");
    await prisma.employee.update({ where: { id: avecDate }, data: { actif: false, dateSortie: new Date("2026-04-30") } });

    const fiches = await prisma.employee.findMany();
    expect(fiches.length).toBeGreaterThan(5);
    for (const fiche of fiches) {
      const fins = await prisma.finContrat.findMany({ where: { employeeId: fiche.id } });
      const attendu = { solde: await chargerSoldeCongeSalarie(prisma, fiche.id, MAINTENANT), annees: await chargerCongesParAnnee(prisma, fiche.id, MAINTENANT) };
      expect(await chargerCongesFiche(prisma, fiche, { fins }, true, MAINTENANT), fiche.nom).toEqual(attendu);
      expect(await chargerCongesFiche(prisma, fiche, { fins, droitsAnnuels: 18 }, false, MAINTENANT), fiche.nom).toEqual({ solde: attendu.solde, annees: null });
      expect(sortieDeFiche(fiche, fins), fiche.nom).toEqual(await chargerSortieFiche(prisma, fiche.id));
    }
  });
});
