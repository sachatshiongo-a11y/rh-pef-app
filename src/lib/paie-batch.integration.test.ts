import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// Test d'INTÉGRATION — le VRAI moteur de paie (calculerLignesPaie, paie-batch.ts), 0 test avant ce
// lot. On vérifie l'ASSEMBLAGE des données (présences/heures/transport/primes/acompte → entrées du
// moteur pur) en comparant le résultat à `calculerPaieBrigade`/`calculerPaieBackoffice` (payroll.ts,
// déjà testés unitairement) appelés avec les MÊMES entrées, reconstruites INDÉPENDAMMENT ici à partir
// des données seedées (pas copiées depuis paie-batch.ts). Les paramètres légaux sont lus depuis la
// base seedée via `chargerParametresPaie()` — aucun barème recopié en dur dans les assertions.
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
const { chargerParametresPaie } = await import("./config");
const { calculerPaieBrigade, calculerPaieBackoffice } = await import("./payroll");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let brigadeId: string;
let backofficeId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 7 } });

  // BRIGADE — paie aux heures : 10 jours "P" travaillés (2 semaines de 5 jours × 8h = 40h/sem,
  // sous le seuil hebdo contractuel 48h → AUCUNE heure supp.), 2 jours "O" (repos payé, sans
  // heures), transport journalier exonéré, une prime et un acompte approuvé.
  const brigade = await prisma.employee.create({
    data: {
      matricule: "PB01-PEF", nom: "Brigade Test", sexe: "M", etatCivil: "Célibataire",
      poste: "Cuisinier", secteur: "Cuisine", categorie: "BRIGADE",
      salaireMensuel: 260, heuresParJour: 8, heuresHebdomadaires: 48,
      transportJourCDF: 2300, // 1 $/jour de présence (au taux de change seedé 2300)
      dateEmbauche: new Date("2024-01-01"), contrat: "CDI", enfants: 0,
    },
  });
  brigadeId = brigade.id;

  const joursP = [
    "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
    "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
  ];
  await prisma.attendance.createMany({ data: joursP.map((d) => ({ employeeId: brigadeId, date: new Date(d), code: "P" as const })) });
  await prisma.overtimeEntry.createMany({ data: joursP.map((d) => ({ employeeId: brigadeId, date: new Date(d), heuresTravaillees: 8 })) });
  const joursO = ["2026-07-11", "2026-07-18"];
  await prisma.attendance.createMany({ data: joursO.map((d) => ({ employeeId: brigadeId, date: new Date(d), code: "O" as const })) });

  await prisma.prime.create({ data: { employeeId: brigadeId, nom: "Prime rendement", montantUSD: 15, mois: 7, annee: 2026 } });
  await prisma.acompteSalaire.create({ data: { employeeId: brigadeId, montantUSD: 20, mois: 7, annee: 2026, statut: "APPROUVE" } });

  // BACKOFFICE — salaire fixe + transport mensuel forfaitaire (pas de calcul aux heures).
  const backoffice = await prisma.employee.create({
    data: {
      matricule: "PO01-PEF", nom: "Backoffice Test", sexe: "F", etatCivil: "Célibataire",
      poste: "RH", secteur: "Administration", categorie: "BACKOFFICE",
      salaireMensuel: 300, transportMoisUSD: 25, dateEmbauche: new Date("2024-01-01"), contrat: "CDI", enfants: 0,
    },
  });
  backofficeId = backoffice.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("calculerLignesPaie — moteur réel de la paie (#3)", () => {
  it("BRIGADE : base = taux horaire × heures normales + journalier × jours payés non travaillés ; transport/prime/acompte assemblés", async () => {
    const parametres = await chargerParametresPaie();
    const { lignes } = await calculerLignesPaie(7, 2026);
    const ligne = lignes.find((l) => l.employee.id === brigadeId);
    expect(ligne).toBeTruthy();
    if (!ligne) return;

    // Faits connus du seed : 10 j P × 8h = 80h normales, aucune HS (40h/sem < 48h contrat) ;
    // 2 j O = jours payés non travaillés ; salaireHoraire par défaut = 260 / (48 × 52/12) = 1,25 $/h.
    expect(ligne.data.heuresTravaillees).toBeCloseTo(80, 6);
    expect(ligne.data.heuresSupp30).toBe(0);
    expect(ligne.data.heuresSupp60).toBe(0);
    expect(ligne.data.joursPayesNonTravailles).toBe(2);
    expect(ligne.data.transportUSD).toBeCloseTo(10, 6); // 10 j P × (2300 ÷ 2300) $
    expect(ligne.data.primesUSD).toBeCloseTo(15, 6);
    expect(ligne.data.acompteUSD).toBeCloseTo(20, 6);

    // Comparaison au moteur pur (déjà testé unitairement, payroll.test.ts) avec les MÊMES entrées,
    // reconstruites indépendamment ici — verrouille l'ASSEMBLAGE fait par paie-batch.ts.
    const attendu = calculerPaieBrigade(
      {
        salaireJournalier: 1.25 * 8,
        salaireHoraire: 1.25,
        heuresNormales: 80,
        joursPayesNonTravailles: 2,
        joursPayes2_3: 0,
        hsValorisee: 0,
        transportMoisUSD: 10,
        enfants: 0,
        primesUSD: 15,
        acompteUSD: 20,
      },
      parametres
    );
    expect(ligne.data.salBrutUSD).toBeCloseTo(attendu.salBrutUSD, 6);
    expect(ligne.data.cnssSalarieUSD).toBeCloseTo(attendu.cnssSalarieUSD, 6);
    expect(ligne.data.iprCalculeUSD).toBeCloseTo(attendu.iprCalculeUSD, 6);
    expect(ligne.data.salNetUSD).toBeCloseTo(attendu.salNetUSD, 6);

    // Transport EXONÉRÉ : l'assiette CNSS/IPR/INPP/ONEM est le brut MOINS le transport (10 $),
    // jamais le brut entier.
    const baseCotisableAttendue = ligne.data.salBrutUSD - ligne.data.transportUSD;
    expect(ligne.data.cnssSalarieUSD).toBeCloseTo(baseCotisableAttendue * parametres.cnssSalarie, 6);
  });

  it("BACKOFFICE : salaire fixe + transport mensuel exonéré, aucune rémunération aux heures", async () => {
    const parametres = await chargerParametresPaie();
    const { lignes } = await calculerLignesPaie(7, 2026);
    const ligne = lignes.find((l) => l.employee.id === backofficeId);
    expect(ligne).toBeTruthy();
    if (!ligne) return;

    expect(ligne.data.remuneration100).toBe(0); // pas de rémunération "aux heures" en back-office
    expect(ligne.data.transportUSD).toBeCloseTo(25, 6);

    const attendu = calculerPaieBackoffice({ salaireBaseUSD: 300, transportUSD: 25, enfants: 0 }, parametres);
    expect(ligne.data.salBrutUSD).toBeCloseTo(attendu.salBrutUSD, 6);
    expect(ligne.data.cnssSalarieUSD).toBeCloseTo(attendu.cnssSalarieUSD, 6);
    // Transport hors assiette CNSS : cotisable = 300 (pas 325).
    expect(ligne.data.cnssSalarieUSD).toBeCloseTo(300 * parametres.cnssSalarie, 6);
    expect(ligne.data.salNetUSD).toBeCloseTo(attendu.salNetUSD, 6);
  });
});
