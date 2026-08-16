// Génération automatique du planning — moteur PUR (aucune I/O, aucun import de Prisma ni de
// src/app/), même convention que src/lib/payroll.ts et src/lib/prets.ts.
//
// Extrait de la server action `genererPlanningAuto`, où 320 lignes de logique métier n'étaient ni
// testables sans base, ni corrigeables sans risque.
//
// Toutes les dates sont des dates PURES en UTC : lire avec getUTC*, jamais getDay()/getDate().

import { pariteSemaine } from "@/lib/dates-fr";

export type EmployePlanning = {
  id: string;
  nom: string;
  poste: string;
  secteur: string;
  heuresParJour: number;
  heuresHebdomadaires: number;
};

export type ShiftPlanning = { id: string; nom: string; dureeHeures: number };
export type BesoinPlanning = { shiftId: string; poste: string; jourSemaine: number; nombreRequis: number };
export type ShiftPostePlanning = { poste: string; shiftId: string; ordre: number };
export type PolyvalencePlanning = { posteSource: string; posteCible: string };
export type ModelePlanning = { employeeId: string; jour: number; semaine: number; shiftId: string };
export type CongePlanning = { employeeId: string; dateDebut: Date; dateFin: Date };
export type CreneauPlanning = { employeeId: string; date: Date; shiftId: string };

export type OptionsGeneration = {
  /** Shift imposé par l'utilisateur (prioritaire sur la liste du poste). */
  shiftId?: string;
  /** Jours de semaine autorisés : 0 = dimanche … 6 = samedi. */
  jours: number[];
  /** Nombre de jours/semaine forcé ; 0 = viser les heures hebdomadaires. */
  nbParSemaine: number;
  inclureFeries: boolean;
  utiliserModeles: boolean;
  ecraser: boolean;
  completer: boolean;
  /** Autorise le dépassement du plafond d'heures POUR COUVRIR UN BESOIN. Jamais automatique. */
  autoriserDepassementHeures: boolean;
};

export type EntreesGeneration = {
  debut: Date;
  fin: Date;
  employes: EmployePlanning[];
  shifts: ShiftPlanning[];
  besoins: BesoinPlanning[];
  shiftsPoste: ShiftPostePlanning[];
  polyvalences: PolyvalencePlanning[];
  modeles: ModelePlanning[];
  conges: CongePlanning[];
  feries: Date[];
  /** Créneaux déjà posés SUR la période. */
  existants: CreneauPlanning[];
  /** Créneaux des 8 semaines PRÉCÉDANT la période — équité et jours consécutifs. */
  historique: CreneauPlanning[];
  options: OptionsGeneration;
};

export type RaisonNonCouverture =
  | "AUCUN_TITULAIRE"
  | "EFFECTIF_INSUFFISANT" // des gens étaient libres, ils ont tous été posés, il en manquait encore
  | "TOUS_EN_CONGE"
  | "TOUS_DEJA_PRIS"
  | "TOUS_AU_REPOS"
  | "TOUS_AU_PLAFOND";

export type TrouCouverture = {
  date: Date;
  shiftId: string;
  poste: string;
  manque: number;
  raison: RaisonNonCouverture;
};

export type DepassementHeures = {
  employeeId: string;
  lundi: Date;
  heuresPlanifiees: number;
  heuresContractuelles: number;
};

export type RapportGeneration = {
  crees: number;
  trous: TrouCouverture[];
  sansShiftPoste: { employeeId: string; poste: string }[];
  depassements: DepassementHeures[];
  sousHeures: { employeeId: string; heuresPlanifiees: number; heuresContractuelles: number }[];
};

export type ResultatGeneration = { creneaux: CreneauPlanning[]; rapport: RapportGeneration };

/** Repos hebdomadaire minimum RDC : 24 h consécutives → au moins 1 jour non travaillé par semaine. */
const JOURS_TRAVAILLES_MAX_PAR_SEMAINE = 6;
/** Plafond de jours travaillés d'affilée (fenêtre glissante, à cheval sur les semaines). */
const JOURS_CONSECUTIFS_MAX = 6;

const JOUR_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Lundi (UTC) de la semaine d'une date. */
export function lundiDeUTC(d: Date): Date {
  const dow = d.getUTCDay();
  const l = new Date(d);
  l.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()));
}

export function genererPlanning(entrees: EntreesGeneration): ResultatGeneration {
  const { options } = entrees;
  const joursAutorises = new Set(options.jours.length > 0 ? options.jours : [1, 2, 3, 4, 5, 6]);
  const feriesIso = new Set(entrees.feries.map(iso));
  const dureeParShift = new Map(entrees.shifts.map((s) => [s.id, s.dureeHeures]));

  // Jours de la période effectivement planifiables.
  const joursPeriode: Date[] = [];
  for (let t = entrees.debut.getTime(); t <= entrees.fin.getTime(); t += JOUR_MS) {
    const j = new Date(t);
    if (!joursAutorises.has(j.getUTCDay())) continue;
    if (!options.inclureFeries && feriesIso.has(iso(j))) continue;
    joursPeriode.push(j);
  }

  // Congés : intervalles par employé.
  const congesParEmp = new Map<string, { debut: number; fin: number }[]>();
  for (const c of entrees.conges) {
    const l = congesParEmp.get(c.employeeId) ?? [];
    l.push({ debut: c.dateDebut.getTime(), fin: c.dateFin.getTime() });
    congesParEmp.set(c.employeeId, l);
  }
  const estEnConge = (empId: string, d: Date) =>
    (congesParEmp.get(empId) ?? []).some((iv) => d.getTime() >= iv.debut && d.getTime() <= iv.fin);

  // État courant : ce qui est déjà posé (existants conservés + historique) et ce qu'on ajoute.
  const occupe = new Set<string>(); // `${empId}_${isoJour}`
  const joursSemaine = new Map<string, number>(); // `${empId}_${lundiIso}` → nb de jours travaillés
  const heuresSemaine = new Map<string, number>(); // `${empId}_${lundiIso}` → heures planifiées
  const ajouter = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

  // L'historique alimente `occupe` (jours consécutifs) mais PAS les quotas de la période.
  for (const h of entrees.historique) occupe.add(`${h.employeeId}_${iso(h.date)}`);

  if (!options.ecraser) {
    for (const ex of entrees.existants) {
      const lundi = iso(lundiDeUTC(ex.date));
      occupe.add(`${ex.employeeId}_${iso(ex.date)}`);
      ajouter(joursSemaine, `${ex.employeeId}_${lundi}`, 1);
      ajouter(heuresSemaine, `${ex.employeeId}_${lundi}`, dureeParShift.get(ex.shiftId) ?? 0);
    }
  }

  /** Nombre de jours travaillés d'affilée qui se termineraient en `d` si on y posait un créneau. */
  const serieAvec = (empId: string, d: Date): number => {
    let n = 1;
    for (let t = d.getTime() - JOUR_MS; occupe.has(`${empId}_${iso(new Date(t))}`); t -= JOUR_MS) n++;
    for (let t = d.getTime() + JOUR_MS; occupe.has(`${empId}_${iso(new Date(t))}`); t += JOUR_MS) n++;
    return n;
  };

  /** Contraintes DURES : jamais violées, à aucune étape. */
  const respecteContraintesDures = (empId: string, d: Date): boolean => {
    if (occupe.has(`${empId}_${iso(d)}`)) return false;
    if (estEnConge(empId, d)) return false;
    const lundi = iso(lundiDeUTC(d));
    if ((joursSemaine.get(`${empId}_${lundi}`) ?? 0) >= JOURS_TRAVAILLES_MAX_PAR_SEMAINE) return false;
    if (serieAvec(empId, d) > JOURS_CONSECUTIFS_MAX) return false;
    return true;
  };

  const creneaux: CreneauPlanning[] = [];
  const affecter = (empId: string, d: Date, shiftId: string) => {
    const lundi = iso(lundiDeUTC(d));
    creneaux.push({ employeeId: empId, date: d, shiftId });
    occupe.add(`${empId}_${iso(d)}`);
    ajouter(joursSemaine, `${empId}_${lundi}`, 1);
    ajouter(heuresSemaine, `${empId}_${lundi}`, dureeParShift.get(shiftId) ?? 0);
  };

  // ── Étape 1 : modèles hebdomadaires (affectations fixes, prioritaires) ────────────────────
  if (options.utiliserModeles) {
    const modeleParEmp = new Map<string, Map<string, string>>();
    for (const m of entrees.modeles) {
      const cle = modeleParEmp.get(m.employeeId) ?? new Map<string, string>();
      cle.set(`${m.jour}_${m.semaine}`, m.shiftId);
      modeleParEmp.set(m.employeeId, cle);
    }
    for (const emp of entrees.employes) {
      const mod = modeleParEmp.get(emp.id);
      if (!mod || mod.size === 0) continue;
      for (const d of joursPeriode) {
        const shiftId = mod.get(`${d.getUTCDay()}_${pariteSemaine(d)}`) ?? mod.get(`${d.getUTCDay()}_0`);
        if (!shiftId) continue;
        if (!respecteContraintesDures(emp.id, d)) continue;
        affecter(emp.id, d, shiftId);
      }
    }
  }

  // ── Étape 2 : couverture des besoins ──────────────────────────────────────────────────────
  const trous: TrouCouverture[] = [];
  const empsParPoste = new Map<string, EmployePlanning[]>();
  for (const e of entrees.employes) {
    const l = empsParPoste.get(e.poste) ?? [];
    l.push(e);
    empsParPoste.set(e.poste, l);
  }

  // Couverture déjà acquise : modèles posés + créneaux existants conservés.
  const posteDe = new Map(entrees.employes.map((e) => [e.id, e.poste]));
  const couverture = new Map<string, number>(); // `${isoJour}_${shiftId}_${poste}`
  const compterCouverture = (c: CreneauPlanning) => {
    const p = posteDe.get(c.employeeId);
    if (p) ajouter(couverture, `${iso(c.date)}_${c.shiftId}_${p}`, 1);
  };
  creneaux.forEach(compterCouverture);
  if (!options.ecraser) entrees.existants.forEach(compterCouverture);

  const besoinsParJour = new Map<number, BesoinPlanning[]>();
  for (const b of entrees.besoins) {
    const l = besoinsParJour.get(b.jourSemaine) ?? [];
    l.push(b);
    besoinsParJour.set(b.jourSemaine, l);
  }

  /**
   * Pourquoi le besoin n'est pas couvert. Le diagnostic se fait sur un INSTANTANÉ pris AVANT la
   * boucle d'affectation : sans lui, les candidats qu'on vient tout juste de poser pour ce besoin
   * apparaîtraient « déjà pris », et un simple manque d'effectif serait rapporté comme un blocage.
   * Un lecteur chercherait alors qui bloque, au lieu de voir qu'il manque du monde.
   *
   * `libresAvant` = les candidats qui, avant toute affectation de ce besoin, satisfaisaient les
   * contraintes dures. S'il y en avait — ils ont donc tous été posés — et que le compte n'y est
   * toujours pas, la cause est l'effectif, pas un blocage.
   */
  const diagnostiquer = (
    candidats: EmployePlanning[],
    libresAvant: EmployePlanning[],
    d: Date
  ): RaisonNonCouverture => {
    if (candidats.length === 0) return "AUCUN_TITULAIRE";
    if (libresAvant.length > 0) return "EFFECTIF_INSUFFISANT";
    if (candidats.every((e) => estEnConge(e.id, d))) return "TOUS_EN_CONGE";
    const dispos = candidats.filter((e) => !estEnConge(e.id, d));
    if (dispos.every((e) => occupe.has(`${e.id}_${iso(d)}`))) return "TOUS_DEJA_PRIS";
    return "TOUS_AU_REPOS";
  };

  for (const d of joursPeriode) {
    for (const b of besoinsParJour.get(d.getUTCDay()) ?? []) {
      const cle = `${iso(d)}_${b.shiftId}_${b.poste}`;
      let acquis = couverture.get(cle) ?? 0;
      if (acquis >= b.nombreRequis) continue;

      // Titulaires du poste, puis postes déclarés capables de le couvrir (polyvalence).
      const titulaires = empsParPoste.get(b.poste) ?? [];
      const renforts = entrees.polyvalences
        .filter((p) => p.posteCible === b.poste)
        .flatMap((p) => empsParPoste.get(p.posteSource) ?? []);
      const candidats = [...titulaires, ...renforts];

      // Instantané AVANT toute affectation de ce besoin — sert au diagnostic (voir `diagnostiquer`).
      const libresAvant = candidats.filter((e) => respecteContraintesDures(e.id, d));

      for (const e of candidats) {
        if (acquis >= b.nombreRequis) break;
        if (!respecteContraintesDures(e.id, d)) continue;
        affecter(e.id, d, b.shiftId);
        ajouter(couverture, cle, 1);
        acquis++;
      }

      if (acquis < b.nombreRequis) {
        trous.push({
          date: d,
          shiftId: b.shiftId,
          poste: b.poste,
          manque: b.nombreRequis - acquis,
          raison: diagnostiquer(candidats, libresAvant, d),
        });
      }
    }
  }

  return {
    creneaux,
    rapport: { crees: creneaux.length, trous, sansShiftPoste: [], depassements: [], sousHeures: [] },
  };
}
