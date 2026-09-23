// Référence d'heures du mois et base de paie BRIGADE — module PUR (ni base, ni `server-only`).
// Spec : docs/superpowers/specs/2026-09-23-paie-heures-planifiees-design.md (+ annexe note Nagi).
import { calculerHeuresSupp, type CodePresence, type HeuresSuppResultat, type ParametresPaie } from "@/lib/payroll";
import { lundiDe } from "@/lib/dates-fr";

/** 52 semaines ÷ 12 mois : référence CONTRAT (ancienne règle, repli). */
export const SEMAINES_PAR_MOIS = 52 / 12;

export type SourceReference = "PLANNING" | "CONTRAT" | "CONTRAT_REPLI";

export type CodeAvertissementPaie =
  | "REPLI_CONTRAT"
  | "TAUX_ROLE_IGNORE"
  | "TAUX_MOIS_SUPERIEUR_HS"
  | "SAISIE_ANTICIPEE"
  | "PRESENCE_SANS_CRENEAU"
  | "PRESENCE_SANS_HEURES"
  | "PLANNING_MODIFIE_APRES_HEURES"
  | "CDD_ECHU_POURSUIVI"
  | "CONGE_SANS_SOLDE_RECODE";

export type AvertissementPaie = { code: CodeAvertissementPaie; message: string };

/** Un jour du mois pour un salarié. Toutes les dates sont des dates PURES (minuit UTC). */
export type JourReference = {
  date: Date;
  /** Durée du créneau de TRAVAIL du jour (`dureeShift`) ; 0 si aucun créneau ou créneau système. */
  heuresPlanifiees: number;
  /** Un créneau existe ce jour-là, système compris (Repos/Congé/Férié) — sert à la complétude. */
  aUnCreneau: boolean;
  /** Durée prévue par le modèle ce jour-là (couche A/B puis « chaque semaine ») ; 0 si le modèle
   *  ne prévoit rien ce jour ; `null` si le salarié n'a AUCUN modèle. */
  heuresModele: number | null;
  code: CodePresence | null;
  /** Heures saisies (`OvertimeEntry`) ; 0 si aucune. */
  heuresFaites: number;
  /** `Shift.tauxHoraireUSD` du créneau du jour, `null` sinon. */
  tauxRole: number | null;
};

export type EntreesReference = {
  annee: number;
  mois: number; // 1..12
  /** Exactement un élément par jour du mois, dans l'ordre. */
  jours: JourReference[];
  /** Jours des semaines À CHEVAL qui tombent HORS du mois : du lundi de la première semaine à la
   *  veille du 1er, et du lendemain du dernier jour au dimanche de la dernière semaine (au plus 6
   *  avant, 6 après), même forme que `jours`. Servent au SEUL plafond hebdomadaire : la semaine
   *  civile entière (lun → sam, les deux mois confondus) fixe le plafond, que le mois partage avec
   *  l'autre mois au prorata des heures dues de chacun. Un jour absent, ou sans code ni créneau,
   *  vaut 0 (repos inconnu, pas un jour dû). Rendu par `chargerJoursMois` (`joursHorsMois`). */
  joursHorsMois: JourReference[];
  salaireMensuel: number;
  /** Valeur BRUTE de la fiche (`Employee.heuresHebdomadaires`) : seuil des HS, comme aujourd'hui. */
  heuresHebdomadaires: number;
  heuresParJour: number;
  dateEmbauche: Date;
  /** Fin du contrat en cours ; absente ou `null` = pas de fin connue (CDI). Date PURE (minuit UTC)
   *  OBLIGATOIREMENT : une heure locale (ex. 23:00 UTC la veille) ferait replier à tort. */
  dateFinContrat?: Date | null;
  /** Fériés "AAAA-MM-JJ" du mois ET des jours de `joursHorsMois` (même plage : lundi de la première
   *  semaine → dimanche de la dernière). Rendu par `chargerJoursMois` (`joursFeries`). */
  joursFeries: Set<string>;
  /** Dates pures "AAAA-MM-JJ" couvertes par un congé APPROUVÉ de type non payé, FÉRIÉS COMPRIS, sur
   *  la même plage que `joursFeries` (rempli par l'appelant). La liste FAIT FOI pour tous ses jours :
   *  un jour de la liste NON travaillé (heures faites ≤ 0) est traité comme S (dans R, jamais payé),
   *  quel que soit son code ; un jour travaillé est payé comme travaillé. `poserCodesConge` saute les
   *  fériés (un férié du congé arrive sans code), et un S peut être effacé à la main ou manquer au
   *  rattrapage : sans la liste, ces jours seraient payés. Un code autre que S (ou aucun code sur un
   *  jour ouvrable) déclenche `CONGE_SANS_SOLDE_RECODE`. */
  joursCongeSansSolde: string[];
  /** Décompte d'aujourd'hui (max(codes C, congés approuvés)) — sert au seul affichage en mode contrat. */
  joursCongePris: number;
  /** AAAAMM à partir duquel la règle s'applique ; `null` = jamais (ancienne règle partout). */
  referencePlanningDepuis: number | null;
  params: ParametresPaie;
};

/** Entrées de `calculerPaieBrigade` produites par la référence. En mode PLANNING, l'unité des
 *  « jours » est l'HEURE : `salaireJournalier` vaut le taux horaire du mois et
 *  `joursPayesNonTravailles` / `joursPayes2_3` des heures — le produit reste exact. */
export type EntreesMoteurBrigade = {
  salaireHoraire: number;
  salaireJournalier: number;
  heuresNormales: number;
  joursPayesNonTravailles: number;
  joursPayes2_3: number;
  hsValorisee: number;
};

export type ResultatReference = {
  source: SourceReference;
  motif: string | null;
  /** R (mode PLANNING) ou heures/sem × 52/12 arrondi au centième (modes contrat). */
  heuresReference: number;
  /** t = S / R en mode PLANNING ; taux de l'ancienne règle sinon. */
  tauxMois: number;
  /** t0 = S / (H × 52/12). */
  tauxContrat: number;
  hs: HeuresSuppResultat;
  moteur: EntreesMoteurBrigade;
  affichage: {
    /** Nombre de JOURS payés non travaillés (colonne Int `joursPayesNonTravailles`). */
    joursPayesNonTravailles: number;
    /** Heures correspondantes (nouvelle colonne `heuresPayeesNonTravaillees`). */
    heuresPayeesNonTravaillees: number;
    /** Montant NET de ces jours, avant facteur de reconstitution ρ. */
    montantJoursPayesNet: number;
    /** Indemnité de congé NETTE, avant ρ. */
    indemniteCongesNet: number;
  };
  avertissements: AvertissementPaie[];
};

const PAYES_100: ReadonlySet<string> = new Set(["C", "A", "O", "F"]);
/** Codes qui « couvrent » une semaine sans créneau : leurs heures dues entrent dans R (payées ou
 *  non). S y est (ses heures entrent dans R sans rien à la base) ; N non : sur un jour non planifié,
 *  il est sans effet, donc une semaine en N sans créneau ne peut pas fixer R → repli. */
const CODES_SEMAINE_COUVERTE: ReadonlySet<string> = new Set(["C", "A", "M", "O", "F", "S"]);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const jjmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const virgule = (n: number, dec: number) => n.toFixed(dec).replace(".", ",");

export function calculerReferenceMois(e: EntreesReference): ResultatReference {
  const hebdo = e.heuresHebdomadaires || e.heuresParJour * 6;
  const heuresContrat = hebdo * SEMAINES_PAR_MOIS;
  const t0 = e.salaireMensuel / heuresContrat;
  const joursFaits = e.jours
    .filter((j) => j.heuresFaites > 0)
    .map((j) => ({ date: j.date, heuresTravaillees: j.heuresFaites }));

  const debutMois = new Date(Date.UTC(e.annee, e.mois - 1, 1));
  const enVigueur = e.referencePlanningDepuis != null && e.annee * 100 + e.mois >= e.referencePlanningDepuis;
  if (!enVigueur) return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT", null);

  // ── Repli : mois d'embauche ─────────────────────────────────────────────────────────────────
  if (e.dateEmbauche.getTime() > debutMois.getTime()) {
    const d = e.dateEmbauche;
    return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT_REPLI",
      `Embauche le ${jjmm(d)}/${d.getUTCFullYear()} : mois incomplet`);
  }

  // ── Repli : mois de fin de contrat (fin DANS le mois, avant son dernier jour) ─────────────────
  // Une fin antérieure au mois est ignorée : le contrat ne couvre pas ce mois, un motif « fin le
  // 31/08 » sur la paie de septembre tromperait.
  const finMois = new Date(Date.UTC(e.annee, e.mois, 0));
  if (e.dateFinContrat != null && e.dateFinContrat.getTime() >= debutMois.getTime() && e.dateFinContrat.getTime() < finMois.getTime()) {
    const d = e.dateFinContrat;
    return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT_REPLI",
      `Fin de contrat le ${jjmm(d)}/${d.getUTCFullYear()} : mois incomplet`);
  }

  // ── Repli : pas d'horaire hebdomadaire au contrat (seuil des HS inconnu → R indéfinie) ───────
  if (!(e.heuresHebdomadaires > 0)) {
    return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT_REPLI", "Heures hebdomadaires du contrat non renseignées");
  }

  // Congé sans solde : la liste des congés sans solde approuvés FAIT FOI pour tous ses jours (décision
  // du contrôleur, 2026-09-23) ; un code S sans liste aussi. Jamais un jour travaillé.
  const congeSansSolde = new Set(e.joursCongeSansSolde);
  const estSansSolde = (j: JourReference) =>
    j.heuresFaites <= 0 && (j.code === "S" || congeSansSolde.has(iso(j.date)));

  // ── Repli : une semaine sans aucun créneau ──────────────────────────────────────────────────
  const semaines = new Map<string, JourReference[]>();
  for (const j of e.jours) {
    const cle = iso(lundiDe(j.date));
    (semaines.get(cle) ?? semaines.set(cle, []).get(cle)!).push(j);
  }
  const vides: string[] = [];
  for (const [lundi, js] of semaines) {
    if (js.some((j) => j.aUnCreneau)) continue;
    const ouvrables = js.filter((j) => j.date.getUTCDay() !== 0 && !e.joursFeries.has(iso(j.date)));
    const code = (j: JourReference) => (estSansSolde(j) ? "S" : j.code);
    if (ouvrables.every((j) => { const c = code(j); return c != null && CODES_SEMAINE_COUVERTE.has(c); })) continue; // vide = rien à planifier
    vides.push(`semaine du ${jjmm(new Date(lundi + "T00:00:00Z"))} sans créneau`);
  }
  if (vides.length > 0) {
    return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT_REPLI", `Planning incomplet : ${vides.join(", ")}`);
  }

  // ── Référence R ─────────────────────────────────────────────────────────────────────────────
  const hdu = (j: JourReference) =>
    j.heuresPlanifiees > 0 ? j.heuresPlanifiees : j.heuresModele !== null ? j.heuresModele : e.heuresParJour;

  const hsPlan = calculerHeuresSupp({
    jours: e.jours.filter((j) => j.heuresPlanifiees > 0).map((j) => ({ date: j.date, heuresTravaillees: j.heuresPlanifiees })),
    heuresParJourContrat: e.heuresParJour,
    heuresHebdoContrat: e.heuresHebdomadaires,
    salaireHoraire: 1,
    joursFeries: e.joursFeries,
    params: e.params,
  });
  let R = hsPlan.heuresTotalesMois - hsPlan.hs30 - hsPlan.hs60 - hsPlan.hs100;

  // Jours qui puisent au plafond : ni dimanche, ni créneau de travail, ni heures faites, et dus à un
  // titre ou un autre (congé sans solde, férié, C, A, O, F, M).
  const puiseAuPlafond = (j: JourReference) =>
    j.date.getUTCDay() !== 0 && j.heuresPlanifiees <= 0 && j.heuresFaites <= 0 &&
    (estSansSolde(j) || e.joursFeries.has(iso(j.date)) || (j.code != null && (PAYES_100.has(j.code) || j.code === "M")));

  // Plafond hebdomadaire de ces heures dues, sur la SEMAINE CIVILE ENTIÈRE (lun → dim), les deux
  // mois confondus (décision du contrôleur, 2026-09-23) :
  //   C = max(0, H − heures planifiées de travail de la semaine, lun → sam, hors fériés) ;
  //   D_mois / D_hors = Σ hdu des jours qui puisent au plafond, dans le mois / hors du mois ;
  //   part du mois P = C × D_mois / (D_mois + D_hors) (C si D_hors = 0) ;
  //   chaque jour du mois reçoit hdu(j) × min(1, P / D_mois).
  // Sans modèle, hdu retombe sur `heuresParJour` pour chaque jour lun→sam : sans plafond, une semaine
  // S retiendrait 72 h à qui n'en doit que 36. Le prorata (jamais au-delà de hdu) rend l'argent
  // indépendant de l'ordre des codes dans la semaine ; le partage entre les deux mois le rend
  // indépendant de la date où le mois coupe la semaine : les retenues des deux mois, additionnées, ne
  // dépassent jamais C. Neutre pour les jours payés (mêmes heures dans R et dans la base), décisif
  // pour S.
  const debutMoisT = debutMois.getTime();
  const finMoisT = finMois.getTime();
  const horsParSemaine = new Map<string, JourReference[]>();
  for (const j of e.joursHorsMois) {
    if (j.date.getTime() >= debutMoisT && j.date.getTime() <= finMoisT) continue; // jour du mois : déjà dans `jours`
    const cle = iso(lundiDe(j.date));
    (horsParSemaine.get(cle) ?? horsParSemaine.set(cle, []).get(cle)!).push(j);
  }
  const heuresDues = (js: JourReference[]) => js.filter(puiseAuPlafond).reduce((acc, j) => acc + hdu(j), 0);
  const facteurSemaine = new Map<string, number>();
  for (const [lundi, js] of semaines) {
    const hors = horsParSemaine.get(lundi) ?? [];
    const planifiees = [...js, ...hors]
      .filter((j) => j.date.getUTCDay() !== 0 && !e.joursFeries.has(iso(j.date)))
      .reduce((acc, j) => acc + j.heuresPlanifiees, 0);
    const plafond = Math.max(0, e.heuresHebdomadaires - planifiees);
    const dMois = heuresDues(js);
    const dHors = heuresDues(hors);
    const part = dHors > 0 ? (plafond * dMois) / (dMois + dHors) : plafond;
    facteurSemaine.set(lundi, dMois > 0 ? Math.min(1, part / dMois) : 0);
  }
  const hduSansCreneau = (j: JourReference) => hdu(j) * (facteurSemaine.get(iso(lundiDe(j.date))) ?? 0);

  let heuresPayees100 = 0;
  let heuresMaladie = 0;
  let heuresConge = 0;
  let joursPayes = 0;
  let heuresBaseFerieTravaille = 0; // base d'un férié dû travaillé : déjà payée par le forfait
  for (const j of e.jours) {
    if (j.date.getUTCDay() === 0) continue; // dimanche : jamais dans la référence
    const ferie = e.joursFeries.has(iso(j.date));
    // Congé sans solde, AVANT les fériés : le contrat est suspendu, aucun jour n'est dû, même férié.
    // Ses heures dues entrent dans R, rien à la base (sinon t monterait et paierait le congé). Sur un
    // créneau de travail elles sont déjà dans R, sauf un férié (compté en HS dans hsPlan).
    if (estSansSolde(j)) {
      if (j.heuresPlanifiees <= 0) R += hduSansCreneau(j);
      else if (ferie) R += j.heuresPlanifiees;
      continue;
    }
    if (ferie) {
      // Non travaillé sans créneau : puise au plafond comme les autres jours dus.
      const h = puiseAuPlafond(j) ? hduSansCreneau(j) : hdu(j);
      if (h <= 0) continue; // férié tombant un jour de repos : rien à payer au forfait
      R += h;
      heuresPayees100 += h; // chômé et payé, codé F ou non
      if (j.heuresFaites > 0) heuresBaseFerieTravaille += Math.min(j.heuresFaites, h);
      else joursPayes++;
      continue;
    }
    if (j.heuresFaites > 0 || j.code == null) continue;
    const payeCent = PAYES_100.has(j.code);
    if (!payeCent && j.code !== "M") continue;
    const h = j.heuresPlanifiees > 0 ? j.heuresPlanifiees : hduSansCreneau(j);
    if (h <= 0) continue; // jour de repos du modèle, ou semaine déjà à H : ni dû, ni payé
    if (j.heuresPlanifiees <= 0) R += h; // sinon déjà dans les heures planifiées
    if (payeCent) { heuresPayees100 += h; joursPayes++; if (j.code === "C") heuresConge += h; }
    else heuresMaladie += h;
  }

  if (R <= 0) {
    return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT_REPLI", "Aucune heure planifiée ce mois");
  }

  const t = e.salaireMensuel / R;
  const hs = calculerHeuresSupp({
    jours: joursFaits,
    heuresParJourContrat: e.heuresParJour,
    heuresHebdoContrat: e.heuresHebdomadaires,
    salaireHoraire: t0, // décision Direction : HS au taux du CONTRAT
    joursFeries: e.joursFeries,
    params: e.params,
  });

  const avertissements: AvertissementPaie[] = [];
  const joursRole = e.jours.filter((j) => j.tauxRole != null && (j.heuresPlanifiees > 0 || j.heuresFaites > 0));
  if (joursRole.length > 0) {
    avertissements.push({ code: "TAUX_ROLE_IGNORE", message: `Taux de rôle ignoré (paie sur le planning) : ${joursRole.map((j) => jjmm(j.date)).join(", ")}` });
  }
  // Jour de la liste des congés sans solde, non travaillé, sans le code S : traité comme S, signalé.
  // Un férié ou un dimanche sans code est le cas normal (`poserCodesConge` les saute), comme un férié
  // codé F (le code des fériés) : rien à signaler.
  const recodes = new Map<string, Date[]>();
  for (const j of e.jours) {
    if (!congeSansSolde.has(iso(j.date)) || j.heuresFaites > 0 || j.code === "S") continue;
    const ferie = e.joursFeries.has(iso(j.date));
    if (j.code == null && (ferie || j.date.getUTCDay() === 0)) continue;
    if (j.code === "F" && ferie) continue;
    const libelle = j.code == null ? "sans code" : `code ${j.code}`;
    (recodes.get(libelle) ?? recodes.set(libelle, []).get(libelle)!).push(j.date);
  }
  for (const [libelle, dates] of recodes) {
    const quand = dates.length === 1 ? `le ${jjmm(dates[0])}` : `les ${dates.map(jjmm).join(", ")} (${dates.length} j)`;
    avertissements.push({ code: "CONGE_SANS_SOLDE_RECODE", message: `Congé sans solde approuvé mais ${libelle} ${quand} : traité comme sans solde` });
  }
  const seuilHs = t0 * (1 + e.params.hsMajTranche1);
  if (t > seuilHs) {
    avertissements.push({ code: "TAUX_MOIS_SUPERIEUR_HS", message: `Taux du mois ${virgule(t, 4)} $/h au-dessus d'une heure supplémentaire à +${Math.round(e.params.hsMajTranche1 * 100)} % (${virgule(seuilHs, 4)} $/h) : planning très inférieur au contrat` });
  }

  return {
    source: "PLANNING",
    motif: null,
    heuresReference: Math.round(R * 100) / 100,
    tauxMois: t,
    tauxContrat: t0,
    hs,
    moteur: {
      salaireHoraire: t,
      salaireJournalier: t, // unité = l'heure (voir EntreesMoteurBrigade)
      heuresNormales: hs.heuresTotalesMois - hs.hs30 - hs.hs60 - hs.hs100,
      joursPayesNonTravailles: heuresPayees100,
      joursPayes2_3: heuresMaladie,
      hsValorisee: hs.hsValorisee - t0 * heuresBaseFerieTravaille,
    },
    affichage: {
      joursPayesNonTravailles: joursPayes,
      heuresPayeesNonTravaillees: heuresPayees100,
      montantJoursPayesNet: t * heuresPayees100,
      indemniteCongesNet: t * heuresConge,
    },
    avertissements,
  };
}

/** L'ANCIENNE règle, à l'identique de `paie-batch.ts` avant ce lot (taux de rôle pondérés compris). */
function ancienneRegle(
  e: EntreesReference,
  t0: number,
  heuresContrat: number,
  joursFaits: { date: Date; heuresTravaillees: number }[],
  source: "CONTRAT" | "CONTRAT_REPLI",
  motif: string | null,
): ResultatReference {
  let sommeH = 0;
  let sommeHT = 0;
  for (const j of e.jours) {
    if (j.heuresFaites <= 0) continue;
    sommeH += j.heuresFaites;
    sommeHT += j.heuresFaites * (j.tauxRole ?? t0);
  }
  const salaireHoraire = sommeH > 0 ? sommeHT / sommeH : t0;
  const salaireJournalier = salaireHoraire * e.heuresParJour;
  const hs = calculerHeuresSupp({
    jours: joursFaits,
    heuresParJourContrat: e.heuresParJour,
    heuresHebdoContrat: e.heuresHebdomadaires,
    salaireHoraire: t0,
    joursFeries: e.joursFeries,
    params: e.params,
  });
  let jours = 0;
  let joursMaladie = 0;
  for (const j of e.jours) {
    if (j.heuresFaites > 0 || j.code == null) continue;
    if (PAYES_100.has(j.code)) jours++;
    else if (j.code === "M") joursMaladie++;
  }
  return {
    source,
    motif,
    heuresReference: Math.round(heuresContrat * 100) / 100,
    tauxMois: t0,
    tauxContrat: t0,
    hs,
    moteur: {
      salaireHoraire,
      salaireJournalier,
      heuresNormales: hs.heuresTotalesMois - hs.hs30 - hs.hs60 - hs.hs100,
      joursPayesNonTravailles: jours,
      joursPayes2_3: joursMaladie,
      hsValorisee: hs.hsValorisee,
    },
    affichage: {
      joursPayesNonTravailles: jours,
      heuresPayeesNonTravaillees: jours * e.heuresParJour,
      montantJoursPayesNet: salaireJournalier * jours,
      indemniteCongesNet: e.joursCongePris * salaireJournalier,
    },
    avertissements: source === "CONTRAT_REPLI" && motif ? [{ code: "REPLI_CONTRAT", message: `Référence contrat (repli) — ${motif}` }] : [],
  };
}
