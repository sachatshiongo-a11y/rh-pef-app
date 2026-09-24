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

  // Interprétation des salaires saisis sur la fiche employé (Employee.salaireMensuel) — 2026-07-22.
  // false (défaut) = valeur saisie interprétée comme un BRUT (comportement historique, inchangé).
  // true = valeur saisie interprétée comme un NET cible ; le moteur reconstitue le brut de base via
  // `reconstituerBrutDepuisNet` avant tout calcul de cotisations/impôt (voir calculerPaieBrigade /
  // calculerPaieBackoffice). Optionnel (et non `?? false` en dur ici) pour que les paramètres de
  // test existants (littéraux `ParametresPaie` dans payroll.test.ts / payroll-reference.test.ts, non
  // mis à jour ici — le testeur s'en charge) restent valides sans le champ ; `undefined` se comporte
  // comme `false` partout où le flag est consulté.
  salairesSaisisEnNet?: boolean;
  // Mois (AAAAMM) à partir duquel la brigade est payée sur les heures PLANIFIÉES du mois
  // (spec 2026-09-23-paie-heures-planifiees, src/lib/paie-reference.ts). null/undefined = jamais.
  referencePlanningDepuis?: number | null;
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

/**
 * ARGENT AU CENTIME, À LA SOURCE (2026-09-24). Chaque montant d'argent du moteur est arrondi au
 * centime AU MOMENT où il est produit, et les totaux (brut, base cotisable, net, coût employeur)
 * sont des SOMMES de montants déjà arrondis. La base stocke chaque montant à 2 décimales : avant
 * cette règle, elle arrondissait séparément des nombres calculés sans arrondi, et le bulletin ne
 * s'additionnait plus (Deladri, septembre 2026 : base 174,88 $, « brut imposable » 174,89 $).
 *
 * Demi-centime arrondi en s'éloignant de zéro, comme `numeric(12,2)` de Postgres. Le passage par
 * `toPrecision(15)` neutralise le bruit binaire (1,005 × 100 = 100,49999999999999 en flottant).
 */
export function auCentime(x: number): number {
  const centimes = Math.round(Number((Math.abs(x) * 100).toPrecision(15)));
  return centimes === 0 ? 0 : (Math.sign(x) * centimes) / 100;
}

/** Montant en centimes ENTIERS — pour comparer deux montants sans bruit flottant. */
const enCentimes = (x: number): number => Math.round(auCentime(x) * 100);

/**
 * CNSS salariale et IPR d'une base cotisable (hors transport), au centime. UNE seule
 * implémentation, partagée par `finaliserLignePaie` et par la reconstitution net→brut : le brut
 * cherché par `reconstituerBrutDepuisNet` est donc calculé avec EXACTEMENT les arrondis du bulletin.
 */
function retenuesSalariales(
  baseCotisableUSD: number,
  params: ParametresPaie,
  personnesACharge: number
): { assietteCnssUSD: number; cnssSalarieUSD: number; baseImposableUSD: number; iprCalculeUSD: number } {
  const taux = params.tauxChangeCDF;
  // Assiette CNSS, éventuellement plafonnée (plafond exprimé en CDF)
  const plafondUSD = params.plafondCnssMensuelCDF === null ? null : params.plafondCnssMensuelCDF / taux;
  const assietteCnssUSD = plafondUSD === null ? baseCotisableUSD : Math.min(baseCotisableUSD, plafondUSD);
  const cnssSalarieUSD = auCentime(assietteCnssUSD * params.cnssSalarie);
  // Base imposable IPR selon le choix configuré (1 = brut ; 2/3 = brut − CNSS) — hors transport.
  const baseImposableUSD =
    params.iprBase === 1 ? baseCotisableUSD : auCentime(baseCotisableUSD - cnssSalarieUSD);
  // IPR calculé en CDF (barème DGI), converti en USD PUIS arrondi au centime.
  const iprCalculeUSD = auCentime(calculerIprDGI(baseImposableUSD * taux, params, personnesACharge) / taux);
  return { assietteCnssUSD, cnssSalarieUSD, baseImposableUSD, iprCalculeUSD };
}

/**
 * Net de base obtenu à partir d'un brut G candidat, SANS arrondi (fonction continue) : sert
 * seulement à approcher la racine par dichotomie avant la recherche au centime.
 */
function netBaseContinu(G: number, params: ParametresPaie, personnesACharge: number): number {
  const taux = params.tauxChangeCDF;
  const plafondUSD = params.plafondCnssMensuelCDF === null ? null : params.plafondCnssMensuelCDF / taux;
  const assietteCnssUSD = plafondUSD === null ? G : Math.min(G, plafondUSD);
  const cnssSalarieUSD = assietteCnssUSD * params.cnssSalarie;
  const baseImposableUSD = params.iprBase === 1 ? G : G - cnssSalarieUSD;
  const iprUSD = calculerIprDGI(baseImposableUSD * taux, params, personnesACharge) / taux;
  return G - cnssSalarieUSD - iprUSD;
}

/**
 * Net de base d'un brut G, en centimes entiers, avec les arrondis du bulletin (voir
 * `retenuesSalariales`) : G − CNSS − IPR. Sur G seul — transport, primes, allocations, frais
 * médicaux, acompte et prêt s'ajoutent en dehors du salaire de base reconstitué.
 */
function netBaseCentimes(gCentimes: number, params: ParametresPaie, personnesACharge: number): number {
  const G = gCentimes / 100;
  const { cnssSalarieUSD, iprCalculeUSD } = retenuesSalariales(G, params, personnesACharge);
  return gCentimes - enCentimes(cnssSalarieUSD) - enCentimes(iprCalculeUSD);
}

export type ReconstitutionNet = {
  /** Brut de base G, en dollars, TOUJOURS un nombre entier de centimes. */
  brutUSD: number;
  /** Net de base que ce G produit, avec les arrondis du bulletin. */
  netObtenuUSD: number;
  /** true si `netObtenuUSD` est EXACTEMENT le net cible (arrondi au centime). */
  exact: boolean;
};

/**
 * Reconstitue le salaire BRUT de base G, EN CENTIMES, tel que le net de base calculé avec les
 * arrondis du bulletin (G − CNSS(G) − IPR(G), chacun au centime) soit EXACTEMENT le net cible
 * arrondi au centime — inverse le moteur pour les salaires saisis comme des NETS
 * (`params.salairesSaisisEnNet`, voir `calculerPaieBrigade`/`calculerPaieBackoffice`). Périmètre =
 * salaire de base seul ; primes/transport s'ajoutent par-dessus après reconstitution.
 *
 * Méthode : (1) dichotomie sur la fonction continue (sans arrondi) pour approcher la racine ;
 * (2) recherche au centime : on part d'un G dont le net est SOUS la cible et l'on monte d'un
 * centime à la fois jusqu'au premier G dont le net atteint la cible.
 *
 * Pourquoi la cible est atteinte exactement : d'un centime de brut au suivant, la CNSS arrondie
 * monte de 0 ou 1 centime ; si elle monte, la base imposable ne bouge pas et l'IPR non plus ;
 * sinon la base monte d'un centime et l'IPR arrondi de 0 ou 1 centime (taux marginal < 100 %).
 * Le net avance donc par pas de 0 ou 1 centime et ne peut pas sauter la cible. Seules exceptions
 * possibles : la marche du plancher IPR (le net de 0 $ tombe sous zéro dès que la base devient
 * positive) et `iprBase = 1` (CNSS et IPR sur la même base peuvent monter ensemble, pas de −1).
 * Dans ce cas on retient le plus petit G atteint dont le net est ≥ la cible, `exact` vaut false :
 * on ne SOUS-paie jamais.
 *
 * À VALIDER PAR UN COMPTABLE (2026-07-22) : pour les très bas salaires proches du plancher IPR
 * mensuel (`iprPlancherMensuelCDF`, qui s'applique dès que la base imposable est positive, cf.
 * `calculerIprDGI`), la fonction net(G) présente une marche autour du plancher — la recherche
 * retient le plus petit G tel que net(G) ≥ cible, ce qui est le comportement le plus prudent.
 */
export function reconstitutionNetAuCentime(
  netCibleUSD: number,
  params: ParametresPaie,
  personnesACharge: number
): ReconstitutionNet {
  const cible = enCentimes(netCibleUSD);
  if (cible <= 0) return { brutUSD: 0, netObtenuUSD: 0, exact: cible === 0 };
  const netCibleArrondi = cible / 100;

  // (1) Approche continue.
  let hi = Math.max(netCibleArrondi, 1);
  while (netBaseContinu(hi, params, personnesACharge) < netCibleArrondi) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 100 && hi - lo >= 1e-6; i++) {
    const mid = (lo + hi) / 2;
    if (netBaseContinu(mid, params, personnesACharge) < netCibleArrondi) lo = mid;
    else hi = mid;
  }

  // (2) Recherche au centime : l'écart entre net arrondi et net continu ne dépasse pas deux
  // centimes, 50 centimes sous la racine suffisent ; la boucle recule encore si besoin.
  let g = Math.max(0, Math.floor(hi * 100) - 50);
  while (g > 0 && netBaseCentimes(g, params, personnesACharge) >= cible) g = Math.max(0, g - 50);
  let net = netBaseCentimes(g, params, personnesACharge);
  while (net < cible) {
    g += 1;
    net = netBaseCentimes(g, params, personnesACharge);
  }
  return { brutUSD: g / 100, netObtenuUSD: net / 100, exact: net === cible };
}

/**
 * Brut de base G (en centimes) d'un net cible — voir `reconstitutionNetAuCentime`. Utilisé par le
 * moteur et par les documents qui affichent le brut d'un salaire contractuel (contrat, attestation,
 * récapitulatif du bulletin).
 */
export function reconstituerBrutDepuisNet(
  netCibleUSD: number,
  params: ParametresPaie,
  personnesACharge: number
): number {
  return reconstitutionNetAuCentime(netCibleUSD, params, personnesACharge).brutUSD;
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

/**
 * Une ligne de paie calculée. Tous les montants d'argent sont des nombres ENTIERS de centimes
 * (voir `auCentime`), et les totaux sont des sommes exactes de ces montants :
 * salBrutUSD = remuneration100 + remuneration2_3 + hsValorisee + transportUSD + primesUSD ;
 * salNetUSD = salBrutUSD − cnssSalarieUSD − iprCalculeUSD + allocFamilialeUSD + fraisMedicauxUSD
 *             − acompteUSD − retenuePretUSD ;
 * coutEmployeurUSD = salBrutUSD + cnssPatronalUSD + inppUSD + onemUSD.
 */
export type LignePaie = {
  remuneration100: number;
  remuneration2_3: number;
  hsValorisee: number; // prime d'heures supplémentaires incluse dans le brut (0 hors brigade)
  transportUSD: number; // indemnité de transport incluse dans le brut (exonérée, non cotisable)
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
  // Facteur de reconstitution brut/net (ρ) appliqué au salaire de base quand les salaires sont
  // saisis en net (1 sinon). Exposé pour que l'appelant (paie-batch) grossisse de façon COHÉRENTE
  // les composantes d'affichage dérivées du taux (jours payés non travaillés, HS, indemnité congés),
  // afin que « base × taux = montant » reste vrai ligne à ligne sur le bulletin.
  facteurReconstitution?: number;
};

export function calculerPaieBrigade(
  entrees: EntreesPaieBrigade,
  params: ParametresPaie
): LignePaie {
  // Base = heures NORMALES au taux horaire (les heures supp/dimanche/férié sont payées à part,
  // en totalité, dans hsValorisee) + jours payés NON travaillés (absences justifiées / congés /
  // fériés non travaillés) valorisés à la journée (100%).
  // Ces montants sont calculés en amont (paie-batch.ts/bulletin-live.ts) à partir de
  // `employee.salaireMensuel` — donc au NET si `params.salairesSaisisEnNet` est actif (2026-07-22).
  const remuneration100Net =
    entrees.salaireHoraire * entrees.heuresNormales +
    entrees.salaireJournalier * entrees.joursPayesNonTravailles;
  const remuneration2_3Net = entrees.salaireJournalier * entrees.joursPayes2_3 * (2 / 3);

  // Reconstitution du brut de base (2026-07-22) : les salaires saisis sur la fiche employé sont des
  // NETS cibles (take-home) ; on reconstitue ici le brut de base G tel que
  // G − CNSS_salariale(G) − IPR(baseImposable(G)) = netBaseCible, PUIS on recompose remuneration100/
  // remuneration2_3 et la prime d'heures supp. à partir de G (au lieu des composantes nettes), afin
  // que `finaliserLignePaie` reçoive le VRAI brut et calcule les cotisations/impôt dessus (jamais sur
  // le net). Périmètre = salaire de base seul (remuneration100 + remuneration2_3) ; transport et
  // primes NE sont PAS grossis, ils s'ajoutent tels quels par-dessus (gains déjà exprimés en clair,
  // hors périmètre de l'inversion). Interrupteur d'INTERPRÉTATION de la donnée d'entrée — appliqué
  // une seule fois par appel, jamais cumulatif (G n'est jamais réinjecté dans un nouvel appel : il
  // est toujours recalculé depuis les montants nets fournis par l'appelant, eux-mêmes dérivés de la
  // valeur stockée en base, inchangée).
  const netBaseCible = remuneration100Net + remuneration2_3Net;
  // Salaires saisis en net : G est cherché EN CENTIMES (le net de base tombe juste au centime), puis
  // réparti entre remuneration100 et remuneration2_3 sur G lui-même — r100 = arrondi(G × part),
  // r2_3 = G − r100 — pour que leur somme soit EXACTEMENT G. Flag inactif : chaque part est
  // simplement arrondie au centime.
  let remuneration100: number;
  let remuneration2_3: number;
  let rho = 1;
  if (params.salairesSaisisEnNet && netBaseCible > 0) {
    const brutBase = reconstituerBrutDepuisNet(netBaseCible, params, entrees.enfants);
    remuneration100 = auCentime(brutBase * (remuneration100Net / netBaseCible));
    remuneration2_3 = auCentime(brutBase - remuneration100);
    // Ratio brut/net appliqué à la prime d'heures supplémentaires (décision client 2026-07-22) : la
    // prime HS est valorisée au taux brut reconstitué, par approximation LINÉAIRE (même ratio que
    // le salaire de base). À cause de la progressivité de l'IPR, le net HS réellement perçu n'est
    // pas garanti être EXACTEMENT celui visé — à valider par un comptable.
    rho = brutBase / netBaseCible;
  } else {
    remuneration100 = auCentime(remuneration100Net);
    remuneration2_3 = auCentime(remuneration2_3Net);
  }
  const hsValorisee = auCentime(entrees.hsValorisee * rho);
  const transportUSD = auCentime(entrees.transportMoisUSD);
  const primesUSD = auCentime(entrees.primesUSD ?? 0);

  const salBrutUSD = auCentime(remuneration100 + remuneration2_3 + hsValorisee + transportUSD + primesUSD);

  return {
    ...finaliserLignePaie(
      {
        remuneration100,
        remuneration2_3,
        hsValorisee,
        salBrutUSD,
        enfants: entrees.enfants,
        fraisMedicauxUSD: entrees.fraisMedicauxUSD ?? 0,
        primesUSD,
        acompteUSD: entrees.acompteUSD ?? 0,
        retenuePretUSD: entrees.retenuePretUSD ?? 0,
        transportUSD,
      },
      params
    ),
    facteurReconstitution: rho,
  };
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
  const primesUSD = auCentime(entrees.primesUSD ?? 0);
  const transportUSD = auCentime(entrees.transportUSD);
  // Reconstitution du brut de base (2026-07-22) — même principe que calculerPaieBrigade : le
  // salaire mensuel saisi est interprété comme un NET cible si `params.salairesSaisisEnNet`, et le
  // brut de base est reconstitué avant d'ajouter transport/primes (hors périmètre de l'inversion).
  // Pas d'heures supplémentaires en back-office (EntreesPaieBackoffice n'en porte pas) : rien d'autre
  // à grossir ici.
  const salaireBaseUSD = params.salairesSaisisEnNet
    ? reconstituerBrutDepuisNet(entrees.salaireBaseUSD, params, entrees.enfants)
    : auCentime(entrees.salaireBaseUSD);
  const salBrutUSD = auCentime(salaireBaseUSD + transportUSD + primesUSD);

  // Le salaire de base est porté par `remuneration100` (2026-09-24) : avant, le back-office
  // stockait 0 et le bulletin imprimait « Salaire de base 0,00 $ » au-dessus d'un brut imposable
  // positif — des lignes qui ne s'additionnaient pas.
  return finaliserLignePaie(
    {
      remuneration100: salaireBaseUSD,
      remuneration2_3: 0,
      hsValorisee: 0,
      salBrutUSD,
      enfants: entrees.enfants,
      fraisMedicauxUSD: entrees.fraisMedicauxUSD ?? 0,
      primesUSD,
      acompteUSD: entrees.acompteUSD ?? 0,
      retenuePretUSD: entrees.retenuePretUSD ?? 0,
      transportUSD,
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
  const indemniteUSD = auCentime(entrees.indemniteUSD);
  const transportUSD = auCentime(entrees.transportUSD);
  const primesUSD = auCentime(entrees.primesUSD ?? 0);
  const acompteUSD = auCentime(entrees.acompteUSD ?? 0);
  const retenuePretUSD = auCentime(entrees.retenuePretUSD ?? 0);
  const fraisMedicauxUSD = auCentime(entrees.fraisMedicauxUSD ?? 0);
  const salBrutUSD = auCentime(indemniteUSD + transportUSD + primesUSD);
  const salNetUSD = auCentime(salBrutUSD + fraisMedicauxUSD - acompteUSD - retenuePretUSD);
  return {
    remuneration100: indemniteUSD,
    remuneration2_3: 0,
    hsValorisee: 0,
    transportUSD,
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
    salNetCDF: auCentime(salNetUSD * params.tauxChangeCDF),
    cnssPatronalUSD: 0,
    inppUSD: 0,
    onemUSD: 0,
    coutEmployeurUSD: salBrutUSD,
    coutEmployeurCDF: auCentime(salBrutUSD * params.tauxChangeCDF),
  };
}

/**
 * Retenues, net et charges d'une ligne dont les GAINS sont déjà arrondis au centime et dont
 * `salBrutUSD` est leur somme. Chaque montant produit ici est arrondi au centime ; le net et le coût
 * employeur sont des sommes de montants arrondis (voir `LignePaie`).
 */
function finaliserLignePaie(
  base: {
    remuneration100: number;
    remuneration2_3: number;
    hsValorisee: number;
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
  const primesUSD = auCentime(base.primesUSD ?? 0);
  const acompteUSD = auCentime(base.acompteUSD ?? 0);
  const retenuePretUSD = auCentime(base.retenuePretUSD ?? 0);
  const transportUSD = auCentime(base.transportUSD ?? 0);
  const fraisMedicauxUSD = auCentime(base.fraisMedicauxUSD);
  const salBrutUSD = auCentime(base.salBrutUSD);
  const taux = params.tauxChangeCDF;

  // L'indemnité de transport représente un remboursement de frais : exonérée d'IPR et NON soumise
  // aux cotisations. On la retire donc de la base cotisable/imposable (elle reste versée au net,
  // comprise dans le salaire brut).
  const baseCotisableUSD = Math.max(0, auCentime(salBrutUSD - transportUSD));

  const { assietteCnssUSD, cnssSalarieUSD, baseImposableUSD, iprCalculeUSD } = retenuesSalariales(
    baseCotisableUSD,
    params,
    base.enfants
  );

  const allocFamilialeUSD = auCentime(base.enfants * params.allocFamilialeParEnfantUSD);

  // Frais médicaux : remboursement non imposable, ajouté après IPR.
  // Acompte : avance déjà versée → déduite du net (non imposable, ce n'est pas un gain).
  const salNetUSD = auCentime(
    salBrutUSD -
      cnssSalarieUSD -
      iprCalculeUSD +
      allocFamilialeUSD +
      fraisMedicauxUSD -
      acompteUSD -
      retenuePretUSD
  );
  const salNetCDF = auCentime(salNetUSD * taux);

  // Charges patronales : CNSS (pensions + risques + prestations familiales) + INPP + ONEM
  const cnssPatronalUSD = auCentime(
    assietteCnssUSD *
      (params.cnssPatronalPensions + params.cnssPatronalRisques + params.cnssPatronalFamille)
  );
  const inppUSD = auCentime(baseCotisableUSD * params.inppTaux);
  const onemUSD = auCentime(baseCotisableUSD * params.onemTaux);
  const coutEmployeurUSD = auCentime(salBrutUSD + cnssPatronalUSD + inppUSD + onemUSD);
  const coutEmployeurCDF = auCentime(coutEmployeurUSD * taux);

  return {
    remuneration100: auCentime(base.remuneration100),
    remuneration2_3: auCentime(base.remuneration2_3),
    hsValorisee: auCentime(base.hsValorisee),
    transportUSD,
    salBrutUSD,
    cnssSalarieUSD,
    netImposableUSD: baseImposableUSD,
    iprCalculeUSD,
    allocFamilialeUSD,
    fraisMedicauxUSD,
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
 * Ancienneté en MOIS RÉVOLUS entre une date d'embauche et une date de référence — compare aussi
 * le JOUR du mois (pas seulement année/mois) : un mois n'est compté que s'il est effectivement
 * terminé. Ex. embauche le 15 mars, référence le 1er avril → 0 mois révolu (pas encore le 15 avril).
 * Sans cette correction, un employé était crédité d'un mois ~4 semaines trop tôt (jusqu'à son
 * anniversaire mensuel), ce qui gonflait à tort les congés acquis via `calculerCongesAcquis`
 * (ex. 12 mois → 18 j de congés alors qu'il en manquait encore quelques jours). Toujours ≥ 0.
 * Helper UNIQUE (remplace 4 implémentations dupliquées et incorrectes) — fiche employé, espace
 * salarié, PDF de demande de congé, calendrier des absences.
 */
export function ancienneteEnMois(dateEmbauche: Date, dateRef: Date): number {
  let mois =
    (dateRef.getFullYear() - dateEmbauche.getFullYear()) * 12 +
    (dateRef.getMonth() - dateEmbauche.getMonth());
  if (dateRef.getDate() < dateEmbauche.getDate()) mois -= 1;
  return Math.max(0, mois);
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

/**
 * Un congé de ce type se déduit-il du solde de congé annuel ? C'est la case `compteDansSolde` du
 * `TypeConge` qui le dit (Paramètres → Types de congé), et rien d'autre — plus de reconnaissance
 * par mots-clés sur le nom, plus de règle « taux à 0 % ». `undefined` = type absent de la table
 * (`LeaveRequest.type` est du texte libre) → ne compte pas.
 */
export function congeDeductibleDuSolde(compteDansSolde: boolean | undefined): boolean {
  return compteDansSolde === true;
}

/**
 * Jours ouvrables entre deux dates — déplacé dans `@/lib/jours-ouvrables` le 2026-09-22 (le module
 * porte aussi le sens inverse, jours → date de fin, pour le formulaire de congé). Réexporté ici
 * pour ses appelants historiques (paie, contrats).
 */
export { compterJoursOuvrables as calculerJoursOuvrables } from "@/lib/jours-ouvrables";
