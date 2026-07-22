// Moteur de calcul de paie — RDC (Pâtes en Folie).
// Toutes les fonctions sont pures : aucune I/O, uniquement des nombres en entrée/sortie.
// AUCUNE valeur légale n'est codée en dur : tout provient de ParametresPaie, chargé depuis
// la table ParametreLegal (versionnée par exercice fiscal, modifiable uniquement par l'ADMIN).

export type IprTrancheCDF = {
  ordre: number;
  plafondAnnuelCDF: number | null; // null = tranche finale ("au-delà")
  taux: number;
};

/** Ensemble complet des paramètres nécessaires au calcul d'une paie. */
export type ParametresPaie = {
  tauxChangeCDF: number;

  // CNSS (décret 18/041) — retenue salariale + branches patronales
  cnssSalarie: number;
  cnssPatronalPensions: number;
  cnssPatronalRisques: number;
  cnssPatronalFamille: number;
  plafondCnssMensuelCDF: number | null; // null = pas de plafond appliqué

  // IPR (barème DGI, en CDF)
  iprTranchesAnnuellesCDF: IprTrancheCDF[];
  iprPlancherMensuelCDF: number;
  iprPlafondTaux: number; // IPR ≤ plafondTaux × base imposable
  iprReductionFamilleTaux: number; // réduction par personne à charge (À VALIDER)
  iprReductionFamilleMax: number; // nombre max de personnes à charge
  iprBase: number; // 1 = brut ; 2 = brut − CNSS salariale ; 3 = brut − CNSS − frais pro (réservé, se comporte comme 2 tant que le forfait n'est pas défini)

  // Charges patronales complémentaires (À VALIDER)
  inppTaux: number;
  onemTaux: number;

  // Heures supplémentaires (règles employeur, configurables)
  hsSeuilHebdoH: number;
  hsMajTranche1: number;
  hsMajTranche2: number;
  hsMajDimancheFerie: number;

  // Règles internes
  allocFamilialeParEnfantUSD: number;
  joursOuvrablesMois: number;
  droitsCongesAnnuel: number;
};

/**
 * IPR — barème DGI progressif par tranches marginales (montants CDF).
 * Ordre d'application (À VALIDER par un comptable) :
 * barème marginal → réduction pour charges de famille → plafond (≤ plafondTaux × base)
 * → plancher mensuel (uniquement si la base est positive).
 */
export function calculerIprDGI(
  baseImposableMensuelleCDF: number,
  params: ParametresPaie,
  personnesACharge: number
): number {
  if (baseImposableMensuelleCDF <= 0) return 0;

  const tranches = [...params.iprTranchesAnnuellesCDF].sort((a, b) => a.ordre - b.ordre);
  let impot = 0;
  let plancherPrecedent = 0;

  for (const tranche of tranches) {
    const plafondMensuel =
      tranche.plafondAnnuelCDF === null ? null : tranche.plafondAnnuelCDF / 12;
    const montantDansTranche =
      plafondMensuel === null
        ? Math.max(0, baseImposableMensuelleCDF - plancherPrecedent)
        : Math.max(0, Math.min(baseImposableMensuelleCDF, plafondMensuel) - plancherPrecedent);

    impot += montantDansTranche * tranche.taux;

    if (plafondMensuel === null) break;
    plancherPrecedent = plafondMensuel;
  }

  // Réduction pour charges de famille (taux × nb personnes, plafonné) — À VALIDER
  const personnes = Math.min(Math.max(0, personnesACharge), params.iprReductionFamilleMax);
  impot = impot * (1 - params.iprReductionFamilleTaux * personnes);

  // Plafond : l'IPR ne peut excéder plafondTaux × base imposable
  impot = Math.min(impot, baseImposableMensuelleCDF * params.iprPlafondTaux);

  // Plancher mensuel
  impot = Math.max(impot, params.iprPlancherMensuelCDF);

  return impot;
}

export type EntreesPaieBrigade = {
  salaireJournalier: number;
  salaireHoraire: number;
  heuresNormales: number; // heures payées au taux normal (heures travaillées − hs30 − hs60 − hs100)
  joursPayesNonTravailles: number; // O/A/C/F sans heures travaillées : payés à la journée (100%)
  joursPayes2_3: number; // M (maladie) : payés 2/3 à la journée
  hsValorisee: number; // primes d'heures supp (prime seule), depuis calculerHeuresSupp()
  transportMoisUSD: number;
  enfants: number;
  fraisMedicauxUSD?: number;
  primesUSD?: number; // primes du mois (gain imposable)
  acompteUSD?: number; // acompte approuvé, déduit du net
  retenuePretUSD?: number; // échéance de prêt du personnel
};

export type LignePaie = {
  remuneration100: number;
  remuneration2_3: number;
  salBrutUSD: number;
  cnssSalarieUSD: number;
  netImposableUSD: number; // base imposable IPR effectivement utilisée
  iprCalculeUSD: number;
  allocFamilialeUSD: number;
  fraisMedicauxUSD: number;
  primesUSD: number; // primes du mois (gain imposable, incluses dans le brut)
  acompteUSD: number; // acompte approuvé, déduit du net
  retenuePretUSD: number; // échéance de prêt du personnel, déduite du net
  salNetUSD: number;
  salNetCDF: number;
  cnssPatronalUSD: number;
  inppUSD: number;
  onemUSD: number;
  coutEmployeurUSD: number;
  coutEmployeurCDF: number;
};

export function calculerPaieBrigade(
  entrees: EntreesPaieBrigade,
  params: ParametresPaie
): LignePaie {
  // Base = heures NORMALES au taux horaire (les heures supp/dimanche/férié sont payées à part,
  // en totalité, dans hsValorisee) + jours payés NON travaillés (absences justifiées / congés /
  // fériés non travaillés) valorisés à la journée (100%).
  const remuneration100 =
    entrees.salaireHoraire * entrees.heuresNormales +
    entrees.salaireJournalier * entrees.joursPayesNonTravailles;
  const remuneration2_3 = entrees.salaireJournalier * entrees.joursPayes2_3 * (2 / 3);
  const primesUSD = entrees.primesUSD ?? 0;

  const salBrutUSD =
    remuneration100 + remuneration2_3 + entrees.hsValorisee + entrees.transportMoisUSD + primesUSD;

  return finaliserLignePaie(
    {
      remuneration100,
      remuneration2_3,
      salBrutUSD,
      enfants: entrees.enfants,
      fraisMedicauxUSD: entrees.fraisMedicauxUSD ?? 0,
      primesUSD,
      acompteUSD: entrees.acompteUSD ?? 0,
      retenuePretUSD: entrees.retenuePretUSD ?? 0,
      transportUSD: entrees.transportMoisUSD,
    },
    params
  );
}

export type EntreesPaieBackoffice = {
  salaireBaseUSD: number;
  transportUSD: number;
  enfants: number;
  fraisMedicauxUSD?: number;
  primesUSD?: number;
  acompteUSD?: number;
  retenuePretUSD?: number;
};

export function calculerPaieBackoffice(
  entrees: EntreesPaieBackoffice,
  params: ParametresPaie
): LignePaie {
  const primesUSD = entrees.primesUSD ?? 0;
  const salBrutUSD = entrees.salaireBaseUSD + entrees.transportUSD + primesUSD;

  return finaliserLignePaie(
    {
      remuneration100: 0,
      remuneration2_3: 0,
      salBrutUSD,
      enfants: entrees.enfants,
      fraisMedicauxUSD: entrees.fraisMedicauxUSD ?? 0,
      primesUSD,
      acompteUSD: entrees.acompteUSD ?? 0,
      retenuePretUSD: entrees.retenuePretUSD ?? 0,
      transportUSD: entrees.transportUSD,
    },
    params
  );
}

export type EntreesPaieStage = {
  indemniteUSD: number; // indemnité de stage forfaitaire (salaireMensuel de la fiche)
  transportUSD: number;
  fraisMedicauxUSD?: number;
  primesUSD?: number;
  acompteUSD?: number;
  retenuePretUSD?: number;
};

/**
 * Bulletin d'un STAGIAIRE : indemnité forfaitaire + transport, SANS cotisations (CNSS/INPP/ONEM),
 * SANS impôt (IPR) ni allocations familiales — défaut prudent À VALIDER par un juriste (le régime
 * fiscal des indemnités de stage n'est pas celui d'un salaire). Pas d'heures supp. ni de congés.
 */
export function calculerPaieStage(entrees: EntreesPaieStage, params: ParametresPaie): LignePaie {
  const primesUSD = entrees.primesUSD ?? 0;
  const acompteUSD = entrees.acompteUSD ?? 0;
  const retenuePretUSD = entrees.retenuePretUSD ?? 0;
  const fraisMedicauxUSD = entrees.fraisMedicauxUSD ?? 0;
  const salBrutUSD = entrees.indemniteUSD + entrees.transportUSD + primesUSD;
  const salNetUSD = salBrutUSD + fraisMedicauxUSD - acompteUSD - retenuePretUSD;
  return {
    remuneration100: entrees.indemniteUSD,
    remuneration2_3: 0,
    salBrutUSD,
    cnssSalarieUSD: 0,
    netImposableUSD: 0,
    iprCalculeUSD: 0,
    allocFamilialeUSD: 0,
    fraisMedicauxUSD,
    primesUSD,
    acompteUSD,
    retenuePretUSD,
    salNetUSD,
    salNetCDF: salNetUSD * params.tauxChangeCDF,
    cnssPatronalUSD: 0,
    inppUSD: 0,
    onemUSD: 0,
    coutEmployeurUSD: salBrutUSD,
    coutEmployeurCDF: salBrutUSD * params.tauxChangeCDF,
  };
}

function finaliserLignePaie(
  base: {
    remuneration100: number;
    remuneration2_3: number;
    salBrutUSD: number;
    enfants: number;
    fraisMedicauxUSD: number;
    primesUSD?: number;
    acompteUSD?: number;
    retenuePretUSD?: number;
    transportUSD?: number; // indemnité de transport : exonérée d'IPR et non cotisable (CNSS/INPP/ONEM)
  },
  params: ParametresPaie
): LignePaie {
  const primesUSD = base.primesUSD ?? 0;
  const acompteUSD = base.acompteUSD ?? 0;
  const retenuePretUSD = base.retenuePretUSD ?? 0;
  const transportUSD = base.transportUSD ?? 0;
  const taux = params.tauxChangeCDF;

  // L'indemnité de transport représente un remboursement de frais : exonérée d'IPR et NON soumise
  // aux cotisations. On la retire donc de la base cotisable/imposable (elle reste versée au net,
  // comprise dans le salaire brut).
  const baseCotisableUSD = Math.max(0, base.salBrutUSD - transportUSD);

  // Assiette CNSS, éventuellement plafonnée (plafond exprimé en CDF)
  const plafondUSD =
    params.plafondCnssMensuelCDF === null ? null : params.plafondCnssMensuelCDF / taux;
  const assietteCnssUSD =
    plafondUSD === null ? baseCotisableUSD : Math.min(baseCotisableUSD, plafondUSD);

  const cnssSalarieUSD = assietteCnssUSD * params.cnssSalarie;

  // Base imposable IPR selon le choix configuré (1 = brut ; 2/3 = brut − CNSS) — hors transport.
  const baseImposableUSD =
    params.iprBase === 1 ? baseCotisableUSD : baseCotisableUSD - cnssSalarieUSD;

  // IPR calculé en CDF (barème DGI), reconverti en USD pour l'affichage/stockage
  const iprCDF = calculerIprDGI(baseImposableUSD * taux, params, base.enfants);
  const iprCalculeUSD = iprCDF / taux;

  const allocFamilialeUSD = base.enfants * params.allocFamilialeParEnfantUSD;

  // Frais médicaux : remboursement non imposable, ajouté après IPR.
  // Acompte : avance déjà versée → déduite du net (non imposable, ce n'est pas un gain).
  const salNetUSD =
    base.salBrutUSD -
    cnssSalarieUSD -
    iprCalculeUSD +
    allocFamilialeUSD +
    base.fraisMedicauxUSD -
    acompteUSD -
    retenuePretUSD;
  const salNetCDF = salNetUSD * taux;

  // Charges patronales : CNSS (pensions + risques + prestations familiales) + INPP + ONEM
  const cnssPatronalUSD =
    assietteCnssUSD *
    (params.cnssPatronalPensions + params.cnssPatronalRisques + params.cnssPatronalFamille);
  const inppUSD = baseCotisableUSD * params.inppTaux;
  const onemUSD = baseCotisableUSD * params.onemTaux;
  const coutEmployeurUSD = base.salBrutUSD + cnssPatronalUSD + inppUSD + onemUSD;
  const coutEmployeurCDF = coutEmployeurUSD * taux;

  return {
    remuneration100: base.remuneration100,
    remuneration2_3: base.remuneration2_3,
    salBrutUSD: base.salBrutUSD,
    cnssSalarieUSD,
    netImposableUSD: baseImposableUSD,
    iprCalculeUSD,
    allocFamilialeUSD,
    fraisMedicauxUSD: base.fraisMedicauxUSD,
    primesUSD,
    acompteUSD,
    retenuePretUSD,
    salNetUSD,
    salNetCDF,
    cnssPatronalUSD,
    inppUSD,
    onemUSD,
    coutEmployeurUSD,
    coutEmployeurCDF,
  };
}

export type SaisieHeuresJour = {
  date: Date;
  heuresTravaillees: number;
};

export type DetailSemaineHS = {
  semaine: number; // 1 à 5, semaines de 7 jours calendaires du mois (jours 1-7, 8-14, ...)
  heuresTotales: number;
  hs30: number; // heures à la majoration tranche 1
  hs60: number; // heures à la majoration tranche 2
  hs100: number; // heures dimanche/férié
  hsValorisee: number;
};

export type HeuresSuppResultat = {
  heuresTotalesMois: number;
  totalHS: number;
  hs30: number;
  hs60: number;
  hs100: number;
  hsValorisee: number;
  semaines: DetailSemaineHS[];
};

/**
 * Heures supplémentaires (déclenchement = dépassement des heures CONTRACTUELLES hebdomadaires,
 * choix de l'employeur — plus généreux que le seuil légal de 45 h/sem, art. 119) :
 * — Dimanche ou jour férié : TOUTES les heures travaillées comptées (hs100), sans soustraction
 *   du quota journalier ; catégorie isolée, hors tranches 30/60 et hors seuil hebdomadaire. La
 *   valorisation ne compte QUE la prime (× hsMajDimancheFerie), car la journée de base est déjà
 *   payée par le code de présence (P/F = 100%) → total « payé double » (base + prime), pas triple.
 * — Autres jours, par semaine calendaire : les hsSeuilHebdoH premières heures au-delà de
 *   l'horaire hebdo contractuel à hsMajTranche1, le reste à hsMajTranche2.
 */
/**
 * Numéro de la semaine DANS LE MOIS, alignée sur des semaines réelles lundi→dimanche.
 * Semaine 1 = celle qui contient le 1er du mois. (Corrige l'ancien découpage jours 1-7/8-14…
 * qui ne correspondait aux vraies semaines que les mois commençant un lundi.)
 */
export function numeroSemaineDuMois(date: Date): number {
  const premier = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const offsetLundi = (premier.getUTCDay() + 6) % 7; // lundi = 0 … dimanche = 6
  return Math.floor((date.getUTCDate() - 1 + offsetLundi) / 7) + 1;
}

export function calculerHeuresSupp(entrees: {
  jours: SaisieHeuresJour[];
  heuresParJourContrat: number;
  heuresHebdoContrat: number;
  salaireHoraire: number;
  joursFeries: Set<string>; // dates au format "YYYY-MM-DD"
  params: ParametresPaie;
}): HeuresSuppResultat {
  const { jours, heuresParJourContrat, heuresHebdoContrat, salaireHoraire, joursFeries, params } =
    entrees;

  const parSemaine = new Map<number, { totalNormal: number; hs100: number; heuresTotales: number }>();

  for (const jour of jours) {
    const semaine = numeroSemaineDuMois(jour.date);
    const entree = parSemaine.get(semaine) ?? { totalNormal: 0, hs100: 0, heuresTotales: 0 };
    entree.heuresTotales += jour.heuresTravaillees;

    const iso = jour.date.toISOString().slice(0, 10);
    const estDimanche = jour.date.getUTCDay() === 0;
    const estFerie = joursFeries.has(iso);

    if (estDimanche || estFerie) {
      // Dimanche / jour férié : TOUTES les heures travaillées sont majorées (payées double),
      // sans soustraction du quota journalier. Catégorie à part : elles ne sont pas ventilées
      // dans les tranches 30/60 et n'entrent PAS dans `totalNormal` (donc ne gonflent pas le
      // seuil hebdomadaire qui déclenche 30/60 les autres jours). Décision client 2026-07-03.
      entree.hs100 += jour.heuresTravaillees;
    } else {
      entree.totalNormal += jour.heuresTravaillees;
    }

    parSemaine.set(semaine, entree);
  }

  const semaines: DetailSemaineHS[] = [...parSemaine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([semaine, { totalNormal, hs100, heuresTotales }]) => {
      const excedentSemaine = Math.max(0, totalNormal - heuresHebdoContrat);
      const hs30 = Math.min(params.hsSeuilHebdoH, excedentSemaine);
      const hs60 = Math.max(0, excedentSemaine - params.hsSeuilHebdoH);
      // Valorisation COMPLÈTE des heures supp (décision client 2026-07-06) : la base ne paie que
      // les heures NORMALES ; les heures supp sont donc payées entièrement ici = taux horaire ×
      // (1 + majoration) : 6 premières h/sem → ×1,30 ; au-delà → ×1,60 ; dimanche/férié → ×2.
      // Les taux (0,30 / 0,60 / 1,00) sont modifiables dans les paramètres légaux.
      const hsValorisee =
        salaireHoraire *
        (hs30 * (1 + params.hsMajTranche1) +
          hs60 * (1 + params.hsMajTranche2) +
          hs100 * (1 + params.hsMajDimancheFerie));
      return { semaine, heuresTotales, hs30, hs60, hs100, hsValorisee };
    });

  const heuresTotalesMois = semaines.reduce((acc, s) => acc + s.heuresTotales, 0);
  const hs30 = semaines.reduce((acc, s) => acc + s.hs30, 0);
  const hs60 = semaines.reduce((acc, s) => acc + s.hs60, 0);
  const hs100 = semaines.reduce((acc, s) => acc + s.hs100, 0);
  const hsValorisee = semaines.reduce((acc, s) => acc + s.hsValorisee, 0);
  const totalHS = hs30 + hs60 + hs100;

  return { heuresTotalesMois, totalHS, hs30, hs60, hs100, hsValorisee, semaines };
}

export type CodePresence = "P" | "O" | "M" | "A" | "N" | "C" | "F" | "S";

export type ResumePresence = {
  payes100: number;
  payes2_3: number;
  nonPayes: number;
  totalPresence: number;
};

/**
 * Comptage des codes du mois pour un employé.
 * P/O/A/C/F = payé 100% (A = absence justifiée, payée intégralement).
 * M = payé 2/3 (maladie). N/S = non payé (absence injustifiée / congé sans solde).
 */
export function resumerPresences(codes: CodePresence[]): ResumePresence {
  const compte = (c: CodePresence) => codes.filter((x) => x === c).length;

  const p = compte("P");
  const o = compte("O");
  const m = compte("M");
  const a = compte("A");
  const n = compte("N");
  const c = compte("C");
  const f = compte("F");
  const s = compte("S");

  return {
    payes100: p + o + a + c + f,
    payes2_3: m,
    nonPayes: n + s,
    totalPresence: p + o + m + a + c + f,
  };
}

/**
 * Congés acquis : droits annuels complets dès 12 mois d'ancienneté.
 * En-dessous d'un an de service, prorata classique (ancienneté en mois × droits annuels / 12).
 */
export function calculerCongesAcquis(
  ancienneteMois: number,
  droitsCongesAnnuel: number
): number {
  if (ancienneteMois >= 12) return droitsCongesAnnuel;
  return Math.round(ancienneteMois * (droitsCongesAnnuel / 12) * 10) / 10;
}

/**
 * Taux légal de la prime d'ancienneté (RDC), en pourcentage du salaire de base :
 * 0 % avant 3 ans, puis +1 % par année d'ancienneté accomplie, plafonné à 25 %.
 * Barème indicatif — À FAIRE VALIDER par un comptable/juriste (les conventions collectives
 * sectorielles peuvent prévoir des taux plus élevés).
 */
export function tauxPrimeAnciennete(anneesAnciennete: number): number {
  const annees = Math.floor(anneesAnciennete);
  if (annees < 3) return 0;
  return Math.min(25, annees);
}

// Types de congés qui NE sont PAS déduits du solde de congés annuels (congés spéciaux/protégés) :
// maternité/paternité, arrivée d'un enfant (naissance), maladie, maladie professionnelle, accident.
// Reconnaissance par MOTS-CLÉS (insensible à la casse) sur le nom du TypeConge. Non-déductibles quel
// que soit `tauxPct` (ce sont des congés légaux protégés, payés ou non, jamais décomptés du solde).
const MOTS_CONGES_NON_DEDUCTIBLES = ["matern", "patern", "naiss", "enfant", "maladie", "accident"];

/**
 * Un congé de ce type doit-il être décompté du solde de congés annuels payés ?
 * Règle : déductible SSI le congé est PAYÉ (`tauxPct` du `TypeConge` ≠ 0) ET n'est pas un congé
 * légal spécial déjà exclu par mots-clés (maternité/paternité/naissance/maladie/accident, qui
 * restent non-déductibles quel que soit leur taux). Un congé sans solde (`tauxPct === 0`, ex.
 * « Congé sans solde ») n'entame donc jamais le solde de congés payés acquis.
 * `tauxPct` non fourni ou `null` (type « À VALIDER ») → traité comme payé par défaut, comportement
 * inchangé pour ne pas pénaliser les types non encore paramétrés par un comptable.
 */
export function congeDeductibleDuSolde(type: string, tauxPct?: number | null): boolean {
  const t = type.toLowerCase();
  if (MOTS_CONGES_NON_DEDUCTIBLES.some((mot) => t.includes(mot))) return false;
  if (tauxPct === 0) return false;
  return true;
}

/** Nombre de jours ouvrables (hors dimanche) entre deux dates, bornes incluses. */
/** Jours ouvrables entre deux dates : dimanches exclus, et jours fériés exclus si fournis. */
export function calculerJoursOuvrables(debut: Date, fin: Date, joursFeries: Iterable<Date | string> = []): number {
  const feries = new Set([...joursFeries].map((d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10)));
  let count = 0;
  const cur = new Date(debut);
  while (cur <= fin) {
    if (cur.getUTCDay() !== 0 && !feries.has(cur.toISOString().slice(0, 10))) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}
