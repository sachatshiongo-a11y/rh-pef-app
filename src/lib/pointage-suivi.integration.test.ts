import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { bornesSemaineKinshasa, resumeSemaineCourante } from "@/lib/pointage-suivi";

// Le compteur de la semaine du Suivi (§3 de la conception), contre une VRAIE base : la garantie
// utile n'est pas `resumeSemaine` (déjà testée en pur) mais la BORNE de la requête — qu'elle
// n'aspire ni la semaine précédente ni la suivante, avec le même découpage lundi→dimanche que le
// reste du dépôt.

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let seq = 0;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma;
  fermer = db.fermer;
});

afterAll(async () => {
  await fermer();
});

async function nouvelEmploye(): Promise<string> {
  seq += 1;
  const emp = await prisma.employee.create({
    data: {
      matricule: `SU${String(seq).padStart(2, "0")}-PEF`, nom: `Salarié ${seq}`, sexe: "F", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  return emp.id;
}

/** Un pointage du jour donné (DATE Kinshasa, minuit UTC) avec un scan ARRIVEE au verdict donné. */
async function pointageAvecScan(jourISO: string, verdict: "AU_RESTAURANT" | "A_VERIFIER") {
  const employeeId = await nouvelEmploye();
  const date = new Date(`${jourISO}T00:00:00Z`);
  const pointage = await prisma.pointage.create({
    data: { employeeId, date, heureDebut: new Date(`${jourISO}T07:00:00Z`), source: "QR" },
  });
  await prisma.scanPointage.create({
    data: {
      pointageId: pointage.id, employeeId, moment: "ARRIVEE", instant: pointage.heureDebut,
      verdict, motif: verdict === "A_VERIFIER" ? "LOIN" : null, distanceM: verdict === "A_VERIFIER" ? 2000 : 50,
    },
  });
}

describe("bornesSemaineKinshasa", () => {
  it("le lundi (Kinshasa) → lundi 00:00 UTC au dimanche 00:00 UTC de la même semaine", () => {
    // Mardi 15/09/2026 8h Kinshasa (7h UTC) : la semaine est lundi 14/09 → dimanche 20/09.
    const { debut, fin } = bornesSemaineKinshasa(new Date("2026-09-15T07:00:00Z"));
    expect(debut.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("dimanche tard en heure de Kinshasa reste dans SA semaine, pas la suivante", () => {
    // Dimanche 20/09/2026 23h50 Kinshasa = 22h50 UTC (toujours dimanche à Kinshasa).
    const { debut, fin } = bornesSemaineKinshasa(new Date("2026-09-20T22:50:00Z"));
    expect(debut.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("lundi tôt en heure de Kinshasa (juste après minuit UTC+1) est déjà dans la nouvelle semaine", () => {
    // Lundi 21/09/2026 00h30 Kinshasa = dimanche 20/09 23h30 UTC.
    const { debut, fin } = bornesSemaineKinshasa(new Date("2026-09-20T23:30:00Z"));
    expect(debut.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });
});

describe("resumeSemaineCourante — le compteur exclut les autres semaines", () => {
  it("ne compte que les scans de la semaine contenant `maintenant`", async () => {
    // Semaine du 14 au 20/09/2026 : 3 scans, 1 à vérifier.
    await pointageAvecScan("2026-09-14", "AU_RESTAURANT"); // lundi
    await pointageAvecScan("2026-09-16", "A_VERIFIER"); // mercredi
    await pointageAvecScan("2026-09-20", "AU_RESTAURANT"); // dimanche (borne haute incluse)

    // Semaine précédente (7 au 13/09) et semaine suivante (21 au 27/09) : ne doivent PAS compter.
    await pointageAvecScan("2026-09-13", "A_VERIFIER"); // dimanche précédent
    await pointageAvecScan("2026-09-21", "A_VERIFIER"); // lundi suivant

    const resume = await resumeSemaineCourante(prisma, new Date("2026-09-16T12:00:00Z"));
    expect(resume).toEqual({ total: 3, aVerifier: 1, pourcent: 33 });
  });

  it("semaine sans aucun scan → 0 sur 0, jamais NaN", async () => {
    const resume = await resumeSemaineCourante(prisma, new Date("2020-01-06T12:00:00Z"));
    expect(resume).toEqual({ total: 0, aVerifier: 0, pourcent: 0 });
  });

  it("compte un scan A_VERIFIER même déjà vérifié — la mesure porte sur le verdict, pas sur le suivi", async () => {
    const employeeId = await nouvelEmploye();
    const jourISO = "2026-06-02"; // mardi
    const date = new Date(`${jourISO}T00:00:00Z`);
    const pointage = await prisma.pointage.create({
      data: { employeeId, date, heureDebut: new Date(`${jourISO}T07:00:00Z`), source: "QR" },
    });
    const admin = await prisma.user.create({ data: { email: "admin.suivi@test.pef", nom: "Direction", role: "ADMIN" } });
    await prisma.scanPointage.create({
      data: {
        pointageId: pointage.id, employeeId, moment: "ARRIVEE", instant: pointage.heureDebut,
        verdict: "A_VERIFIER", motif: "LOIN", distanceM: 3000,
        verifieParId: admin.id, verifieLe: new Date(),
      },
    });
    const resume = await resumeSemaineCourante(prisma, new Date("2026-06-02T12:00:00Z"));
    expect(resume).toEqual({ total: 1, aVerifier: 1, pourcent: 100 });
  });
});
