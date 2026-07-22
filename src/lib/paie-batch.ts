import "server-only";

import { prisma } from "@/lib/prisma";
import { chargerParametresPaie } from "@/lib/config";
import { calculerEcheancePret } from "@/lib/prets";
import {
  calculerHeuresSupp,
  calculerJoursOuvrables,
  calculerPaieBackoffice,
  calculerPaieBrigade,
  calculerPaieStage,
  resumerPresences,
  type CodePresence,
} from "@/lib/payroll";
import type { Employee } from "@prisma/client";

// Conversion PRÉCISE heures/semaine → heures/mois : 52 semaines ÷ 12 mois = 4,3333 (aucune estimation).
const SEMAINES_PAR_MOIS = 52 / 12;

/** Champs numériques d'une PayrollLine produits par le calcul (hors payrollRunId/employeeId). */
export type DonneesLignePaie = {
  joursPayes100: number;
  joursPayes2_3: number;
  joursNonPayes: number;
  nombreAbsences: number;
  remuneration100: number;
  joursPayesNonTravailles: number;
  remunerationJoursPayesUSD: number;
  remuneration2_3: number;
  hsValorisee: number;
  heuresTravaillees: number;
  heuresContractuelles: number;
  heuresSupp30: number;
  heuresSupp60: number;
  heuresSupp100: number;
  joursCongePris: number;
  indemniteCongesUSD: number;
  fraisMedicauxUSD: number;
  transportUSD: number;
  primesUSD: number;
  acompteUSD: number;
  retenuePretUSD: number;
  salBrutUSD: number;
  cnssSalarieUSD: number;
  netImposableUSD: number;
  iprCalculeUSD: number;
  allocFamilialeUSD: number;
  salNetUSD: number;
  salNetCDF: number;
  cnssPatronalUSD: number;
  inppUSD: number;
  onemUSD: number;
  coutEmployeurUSD: number;
  coutEmployeurCDF: number;
};

/** Une ligne de paie calculée (sans écriture en base) : les champs d'une PayrollLine + l'employé. */
export type LigneCalculee = {
  employee: Employee;
  data: DonneesLignePaie;
};

export type ResultatBatch = {
  lignes: LigneCalculee[];
};

/**
 * Calcule EN MÉMOIRE la paie de TOUS les employés actifs pour le mois donné, à partir des
 * données courantes (présences, HS, primes, acomptes, congés, planning multi-rôles). Aucune
 * écriture en base : sert à la fois à la persistance (`calculerPaieDuMois`) et à l'aperçu temps
 * réel de la page Paie. Reprend à l'identique la logique de paie (§8, transport B3, Option A,
 * Lot D). L'appelant décide de figer/écrire et de sauter les lignes déjà validées/payées.
 */
export async function calculerLignesPaie(mois: number, annee: number): Promise<ResultatBatch> {
  const parametres = await chargerParametresPaie();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  // BUG CONNU documenté le 2026-07-22 (Tier 2, #4 — NON corrigé, montants impactés) : `overtimeEntries`
  // est filtré STRICTEMENT par mois calendaire. `calculerHeuresSupp` (payroll.ts) regroupe pourtant les
  // heures par VRAIES semaines lundi→dimanche (`numeroSemaineDuMois`, déjà correct EN INTRA-mois). Une
  // semaine à cheval sur deux mois est donc scindée : le seuil hebdomadaire contractuel qui déclenche
  // les heures supp. (30 %/60 %) repart de zéro de CHAQUE côté de la coupure → sous-évaluation possible
  // des heures supp. sur ces semaines-charnières (ex. semaine du 27 juin au 3 juillet : les heures du
  // 27-30 juin ne « comptent » pas pour le seuil de la semaine côté juillet, et inversement).
  // Piste de correction recommandée (NON implémentée ici — risquée sans tests dédiés) : élargir la
  // fenêtre de chargement de `overtimeEntries`/`attendances` aux semaines complètes qui chevauchent le
  // mois (du lundi de la semaine du 1er au dimanche de la semaine du dernier jour — cf. `lundiDe` dans
  // `src/lib/dates-fr.ts`), puis faire évoluer `calculerHeuresSupp` pour qu'il attribue les heures supp.
  // JOUR PAR JOUR (cumul chronologique dans la semaine) au lieu d'un agrégat hebdomadaire, afin de ne
  // compter dans `heuresTotalesMois`/`hs30`/`hs60`/`hsValorisee` QUE les jours du mois en cours (les
  // jours « hors mois » ne servant qu'à positionner correctement le seuil, sans être payés deux fois —
  // ils sont déjà couverts par le mois voisin, y compris s'il est déjà VALIDE/PAYE et donc figé). C'est
  // un changement de signature/algorithme du moteur central (`calculerHeuresSupp`), couvert par
  // `payroll.test.ts` et `payroll-reference.test.ts` : à faire dans un lot dédié avec de nouveaux tests
  // de semaines-charnières, plutôt qu'un correctif partiel ici.
  const [employees, joursFeriesDuMois, attendances, overtimeEntries, primesDuMois, acomptesDuMois, congesDuMois, fraisMedDuMois, contratsActifs, pretsEnCours] =
    await Promise.all([
      prisma.employee.findMany({ where: { actif: true } }),
      prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.overtimeEntry.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.prime.findMany({ where: { mois, annee } }),
      prisma.acompteSalaire.findMany({ where: { mois, annee, statut: "APPROUVE" } }),
      prisma.leaveRequest.findMany({ where: { statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } } }),
      prisma.fraisMedical.findMany({ where: { mois, annee } }),
      prisma.contrat.findMany({ where: { statut: "ACTIF" }, orderBy: { dateDebut: "asc" }, select: { employeeId: true, type: true } }),
      prisma.pretPersonnel.findMany({ where: { statut: "EN_COURS" }, include: { retenues: true } }),
    ]);

  // Échéance de prêt du mois par employé : min(retenue mensuelle, solde AVANT ce mois). On exclut
  // la retenue du mois courant du solde → le recalcul de la paie du mois est idempotent.
  const pretParEmp = new Map<string, number>();
  for (const p of pretsEnCours) {
    const { echeanceUSD } = calculerEcheancePret(
      Number(p.montantUSD),
      Number(p.retenueMensuelleUSD),
      p.retenues.map((r) => ({ mois: r.mois, annee: r.annee, montantUSD: Number(r.montantUSD) })),
      mois,
      annee
    );
    if (echeanceUSD > 0) pretParEmp.set(p.employeeId, (pretParEmp.get(p.employeeId) ?? 0) + echeanceUSD);
  }

  // Régime de paie par employé : type du contrat ACTIF le plus récent, sinon le type de la fiche.
  const typeContratParEmp = new Map<string, string>();
  for (const c of contratsActifs) typeContratParEmp.set(c.employeeId, c.type);

  const fraisMedParEmp = new Map<string, number>();
  for (const f of fraisMedDuMois) fraisMedParEmp.set(f.employeeId, (fraisMedParEmp.get(f.employeeId) ?? 0) + Number(f.montantUSD));

  const joursCongeParEmp = new Map<string, number>();
  for (const c of congesDuMois) {
    const debut = new Date(c.dateDebut) < debutMois ? debutMois : new Date(c.dateDebut);
    const fin = new Date(c.dateFin) > finMois ? finMois : new Date(c.dateFin);
    joursCongeParEmp.set(c.employeeId, (joursCongeParEmp.get(c.employeeId) ?? 0) + calculerJoursOuvrables(debut, fin, joursFeriesDuMois.map((f) => f.date)));
  }

  const primesParEmp = new Map<string, number>();
  for (const p of primesDuMois) primesParEmp.set(p.employeeId, (primesParEmp.get(p.employeeId) ?? 0) + Number(p.montantUSD));
  const acomptesParEmp = new Map<string, number>();
  for (const a of acomptesDuMois) acomptesParEmp.set(a.employeeId, (acomptesParEmp.get(a.employeeId) ?? 0) + Number(a.montantUSD));

  const joursFeries = new Set(joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10)));

  const codesParEmp = new Map<string, CodePresence[]>();
  const codeParJour = new Map<string, Map<string, string>>();
  for (const a of attendances) {
    (codesParEmp.get(a.employeeId) ?? codesParEmp.set(a.employeeId, []).get(a.employeeId)!).push(a.code as CodePresence);
    const iso = new Date(a.date).toISOString().slice(0, 10);
    (codeParJour.get(a.employeeId) ?? codeParJour.set(a.employeeId, new Map()).get(a.employeeId)!).set(iso, a.code);
  }
  const heuresParEmp = new Map<string, { date: Date; heuresTravaillees: number }[]>();
  const heureParJour = new Map<string, Map<string, number>>();
  for (const o of overtimeEntries) {
    (heuresParEmp.get(o.employeeId) ?? heuresParEmp.set(o.employeeId, []).get(o.employeeId)!).push({ date: new Date(o.date), heuresTravaillees: Number(o.heuresTravaillees) });
    const iso = new Date(o.date).toISOString().slice(0, 10);
    (heureParJour.get(o.employeeId) ?? heureParJour.set(o.employeeId, new Map()).get(o.employeeId)!).set(iso, Number(o.heuresTravaillees));
  }

  // Option A — paie multi-rôles : taux horaire du rôle de chaque jour (planning).
  const [creneauxMois, shiftsAvecTaux] = await Promise.all([
    prisma.planningCreneau.findMany({ where: { date: { gte: debutMois, lte: finMois } }, select: { employeeId: true, date: true, shiftId: true } }),
    prisma.shift.findMany({ select: { id: true, tauxHoraireUSD: true } }),
  ]);
  const tauxParShift = new Map<string, number>();
  for (const s of shiftsAvecTaux) if (s.tauxHoraireUSD != null) tauxParShift.set(s.id, Number(s.tauxHoraireUSD));
  const tauxRoleParJour = new Map<string, Map<string, number>>();
  for (const c of creneauxMois) {
    const t = tauxParShift.get(c.shiftId);
    if (t == null) continue;
    const iso = new Date(c.date).toISOString().slice(0, 10);
    (tauxRoleParJour.get(c.employeeId) ?? tauxRoleParJour.set(c.employeeId, new Map()).get(c.employeeId)!).set(iso, t);
  }

  const lignes: LigneCalculee[] = [];

  for (const employee of employees) {
    const typeContrat = typeContratParEmp.get(employee.id) ?? employee.contrat;
    // INTERIMAIRE : salarié de l'AGENCE (qui l'emploie et le paie) — aucun bulletin ici.
    if (typeContrat === "INTERIM") continue;

    const codes = codesParEmp.get(employee.id) ?? [];
    const resume = resumerPresences(codes);
    const heuresHebdo = Number(employee.heuresHebdomadaires) || Number(employee.heuresParJour) * 6;
    const heuresMoisContrat = heuresHebdo * SEMAINES_PAR_MOIS;
    const tauxDefaut = Number(employee.salaireMensuel) / heuresMoisContrat;
    const rolesEmp = tauxRoleParJour.get(employee.id);
    const heuresEmp = heureParJour.get(employee.id) ?? new Map<string, number>();
    let sommeH = 0;
    let sommeHT = 0;
    for (const [iso, h] of heuresEmp) {
      if (h <= 0) continue;
      sommeH += h;
      sommeHT += h * (rolesEmp?.get(iso) ?? tauxDefaut);
    }
    const salaireHoraire = sommeH > 0 ? sommeHT / sommeH : tauxDefaut;
    const salaireJournalier = salaireHoraire * Number(employee.heuresParJour);
    // Frais médicaux : solde « saisie manuelle du mois » (employee.fraisMedicauxMoisCourant) +
    // entrées durables de la table FraisMedical (avec certificat) pour ce mois. La saisie manuelle
    // n'est remise à zéro qu'au moment où la ligne est VALIDÉE (voir appliquerTransitionPaie dans
    // paie/actions.ts) — jamais ici, qui sert aussi à un simple aperçu/rafraîchissement de brouillon
    // (bug corrigé le 2026-07-22 : le montant disparaissait silencieusement avant validation).
    const fraisMedicauxUSD = Number(employee.fraisMedicauxMoisCourant) + (fraisMedParEmp.get(employee.id) ?? 0);

    const hs = calculerHeuresSupp({
      jours: heuresParEmp.get(employee.id) ?? [],
      heuresParJourContrat: Number(employee.heuresParJour),
      heuresHebdoContrat: Number(employee.heuresHebdomadaires),
      // Majorations HS sur le taux PAR DÉFAUT (inchangées) ; seule la base multi-rôles varie
      // (Option A, ci-dessus). DÉCISION (à faire confirmer par le client, 2026-07-22) : la PRIME
      // d'heures supp. est donc valorisée sur le taux horaire CONTRACTUEL par défaut de l'employé,
      // pas sur le taux pondéré du rôle réellement tenu le jour concerné — cohérent avec « prime
      // calculée sur la base contractuelle », mais à valider explicitement pour un employé
      // multi-rôles qui ferait ses heures supp. sur un rôle mieux (ou moins bien) rémunéré que son
      // rôle par défaut. Même décision documentée dans bulletin-live.ts.
      salaireHoraire: tauxDefaut,
      joursFeries,
      params: parametres,
    });

    const estStage = typeContrat === "STAGE";
    const joursCongePris = estStage ? 0 : Math.max(codes.filter((c) => c === "C").length, joursCongeParEmp.get(employee.id) ?? 0);
    const indemniteCongesUSD = joursCongePris * salaireJournalier;
    const nombreAbsences = codes.filter((c) => c === "A" || c === "N" || c === "S").length;
    const heuresContractuelles = Math.round(heuresMoisContrat * 100) / 100;

    const joursPresenceP = codes.filter((c) => c === "P").length;
    const transportUSD =
      employee.categorie === "BRIGADE"
        ? (Number(employee.transportJourCDF) * joursPresenceP) / parametres.tauxChangeCDF
        : Number(employee.transportMoisUSD);

    const codesJours = codeParJour.get(employee.id) ?? new Map<string, string>();
    const heuresJours = heureParJour.get(employee.id) ?? new Map<string, number>();
    let joursPayesNonTravailles = 0;
    let joursMaladie = 0;
    for (const [iso, code] of codesJours) {
      if ((heuresJours.get(iso) ?? 0) > 0) continue;
      if (code === "O" || code === "A" || code === "C" || code === "F") joursPayesNonTravailles++;
      else if (code === "M") joursMaladie++;
    }

    const primesUSD = primesParEmp.get(employee.id) ?? 0;
    const acompteUSD = acomptesParEmp.get(employee.id) ?? 0;
    const retenuePretUSD = pretParEmp.get(employee.id) ?? 0;

    const ligne =
      typeContrat === "STAGE"
        ? calculerPaieStage(
            { indemniteUSD: Number(employee.salaireMensuel), transportUSD, fraisMedicauxUSD, primesUSD, acompteUSD, retenuePretUSD },
            parametres
          )
        : employee.categorie === "BRIGADE"
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
              retenuePretUSD,
            },
            parametres
          )
        : calculerPaieBackoffice(
            { salaireBaseUSD: Number(employee.salaireMensuel), transportUSD, enfants: employee.enfants, fraisMedicauxUSD, primesUSD, acompteUSD, retenuePretUSD },
            parametres
          );

    lignes.push({
      employee,
      data: {
        joursPayes100: resume.payes100,
        joursPayes2_3: resume.payes2_3,
        joursNonPayes: resume.nonPayes,
        nombreAbsences,
        remuneration100: ligne.remuneration100,
        // Part « jours payés non travaillés » de la rémunération 100 % (brigade uniquement :
        // back-office = salaire fixe, stage = indemnité forfaitaire).
        joursPayesNonTravailles:
          estStage || employee.categorie !== "BRIGADE" ? 0 : joursPayesNonTravailles,
        remunerationJoursPayesUSD:
          estStage || employee.categorie !== "BRIGADE"
            ? 0
            : Math.round(salaireJournalier * joursPayesNonTravailles * 100) / 100,
        remuneration2_3: ligne.remuneration2_3,
        hsValorisee: estStage ? 0 : hs.hsValorisee,
        heuresTravaillees: hs.heuresTotalesMois,
        heuresContractuelles,
        heuresSupp30: estStage ? 0 : hs.hs30,
        heuresSupp60: estStage ? 0 : hs.hs60,
        heuresSupp100: estStage ? 0 : hs.hs100,
        joursCongePris,
        indemniteCongesUSD,
        fraisMedicauxUSD,
        transportUSD,
        primesUSD: ligne.primesUSD,
        acompteUSD: ligne.acompteUSD,
        retenuePretUSD: ligne.retenuePretUSD,
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
      },
    });
  }

  return { lignes };
}
