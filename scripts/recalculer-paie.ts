import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  calculerHeuresSupp,
  calculerJoursOuvrables,
  calculerPaieBackoffice,
  calculerPaieBrigade,
  resumerPresences,
  type CodePresence,
} from "../src/lib/payroll";
import { chargerParametresPaieDirect } from "./_config-direct";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const parametres = await chargerParametresPaieDirect(prisma);
  const mois = config.moisCourant;
  const annee = config.anneeCourante;
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const employees = await prisma.employee.findMany({ where: { actif: true } });
  const joursFeriesDuMois = await prisma.jourFerie.findMany({
    where: { date: { gte: debutMois, lte: finMois } },
  });
  const joursFeries = new Set(
    joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10))
  );

  const run = await prisma.payrollRun.upsert({
    where: { mois_annee: { mois, annee } },
    update: { tauxChangeUtilise: config.tauxChangeCDF },
    create: { mois, annee, tauxChangeUtilise: config.tauxChangeCDF },
  });

  for (const employee of employees) {
    const [attendances, overtimeEntries, primesEmp, acomptesEmp] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId: employee.id, date: { gte: debutMois, lte: finMois } },
      }),
      prisma.overtimeEntry.findMany({
        where: { employeeId: employee.id, date: { gte: debutMois, lte: finMois } },
      }),
      prisma.prime.findMany({ where: { employeeId: employee.id, mois, annee } }),
      prisma.acompteSalaire.findMany({
        where: { employeeId: employee.id, mois, annee, statut: "APPROUVE" },
      }),
    ]);
    const primesUSD = primesEmp.reduce((s, p) => s + Number(p.montantUSD), 0);
    const acompteUSD = acomptesEmp.reduce((s, a) => s + Number(a.montantUSD), 0);

    const codes = attendances.map((a) => a.code as CodePresence);
    const resume = resumerPresences(codes);
    const salaireJournalier = Number(employee.salaireMensuel) / parametres.joursOuvrablesMois;
    const salaireHoraire = salaireJournalier / Number(employee.heuresParJour);
    const fraisMedicauxUSD = Number(employee.fraisMedicauxMoisCourant);

    const hs = calculerHeuresSupp({
      jours: overtimeEntries.map((o) => ({
        date: new Date(o.date),
        heuresTravaillees: Number(o.heuresTravaillees),
      })),
      heuresParJourContrat: Number(employee.heuresParJour),
      heuresHebdoContrat: Number(employee.heuresHebdomadaires),
      salaireHoraire,
      joursFeries,
      params: parametres,
    });

    const congesEmp = await prisma.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        statut: "APPROUVE",
        dateDebut: { lte: finMois },
        dateFin: { gte: debutMois },
      },
    });
    const joursCongeDemandes = congesEmp.reduce((somme, c) => {
      const debut = new Date(c.dateDebut) < debutMois ? debutMois : new Date(c.dateDebut);
      const fin = new Date(c.dateFin) > finMois ? finMois : new Date(c.dateFin);
      return somme + calculerJoursOuvrables(debut, fin);
    }, 0);
    const joursCongePris = Math.max(codes.filter((c) => c === "C").length, joursCongeDemandes);
    const indemniteCongesUSD = joursCongePris * salaireJournalier;
    const nombreAbsences = codes.filter((c) => c === "A" || c === "N" || c === "S").length;
    const heuresContractuelles = Number(employee.heuresParJour) * parametres.joursOuvrablesMois;

    // §8 : partage jours travaillés (payés aux heures) / jours payés non travaillés (à la journée).
    const codeParJour = new Map<string, string>();
    for (const a of attendances) codeParJour.set(new Date(a.date).toISOString().slice(0, 10), a.code);
    const heureParJour = new Map<string, number>();
    for (const o of overtimeEntries)
      heureParJour.set(new Date(o.date).toISOString().slice(0, 10), Number(o.heuresTravaillees));
    let joursPayesNonTravailles = 0;
    let joursMaladie = 0;
    for (const [iso, code] of codeParJour) {
      if ((heureParJour.get(iso) ?? 0) > 0) continue;
      if (code === "O" || code === "A" || code === "C" || code === "F") joursPayesNonTravailles++;
      else if (code === "M") joursMaladie++;
    }
    // Transport (B3) : brigade = journalier × jours P ; backoffice = forfait fixe.
    const joursPresenceP = codes.filter((c) => c === "P").length;
    const transportUSD =
      employee.categorie === "BRIGADE"
        ? (Number(employee.transportJourCDF) * joursPresenceP) / parametres.tauxChangeCDF
        : Number(employee.transportMoisUSD);

    const ligne =
      employee.categorie === "BRIGADE"
        ? calculerPaieBrigade(
            {
              salaireJournalier,
              salaireHoraire,
              heuresNormales: hs.heuresTotalesMois - hs.hs30 - hs.hs60 - hs.hs100,
              joursPayesNonTravailles,
              joursPayes2_3: joursMaladie,
              hsValorisee: hs.hsValorisee,
              transportMoisUSD: transportUSD,
              enfants: employee.enfants,
              fraisMedicauxUSD,
              primesUSD,
              acompteUSD,
            },
            parametres
          )
        : calculerPaieBackoffice(
            {
              salaireBaseUSD: Number(employee.salaireMensuel),
              transportUSD: transportUSD,
              enfants: employee.enfants,
              fraisMedicauxUSD,
              primesUSD,
              acompteUSD,
            },
            parametres
          );

    const donneesLigne = {
      joursPayes100: resume.payes100,
      joursPayes2_3: resume.payes2_3,
      joursNonPayes: resume.nonPayes,
      nombreAbsences,
      remuneration100: ligne.remuneration100,
      remuneration2_3: ligne.remuneration2_3,
      hsValorisee: hs.hsValorisee,
      heuresTravaillees: hs.heuresTotalesMois,
      heuresContractuelles,
      heuresSupp30: hs.hs30,
      heuresSupp60: hs.hs60,
      heuresSupp100: hs.hs100,
      joursCongePris,
      indemniteCongesUSD,
      primesUSD: ligne.primesUSD,
      acompteUSD: ligne.acompteUSD,
      fraisMedicauxUSD,
      transportUSD,
      salBrutUSD: ligne.salBrutUSD,
      cnssSalarieUSD: ligne.cnssSalarieUSD,
      netImposableUSD: ligne.netImposableUSD,
      iprCalculeUSD: ligne.iprCalculeUSD,
      allocFamilialeUSD: ligne.allocFamilialeUSD,
      salNetUSD: ligne.salNetUSD,
      salNetCDF: ligne.salNetCDF,
      cnssPatronalUSD: ligne.cnssPatronalUSD,
      inppUSD: ligne.inppUSD,
      onemUSD: ligne.onemUSD,
      coutEmployeurUSD: ligne.coutEmployeurUSD,
      coutEmployeurCDF: ligne.coutEmployeurCDF,
    };

    await prisma.payrollLine.upsert({
      where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: employee.id } },
      update: donneesLigne,
      create: { payrollRunId: run.id, employeeId: employee.id, ...donneesLigne },
    });
  }

  console.log(`Paie recalculée pour ${employees.length} employé(s) — ${mois}/${annee}.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
