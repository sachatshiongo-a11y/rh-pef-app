// Adaptateur de pointage — couche découplant la SOURCE (rapport IVMS-4200, API, saisie manuelle)
// du CALCUL. Fonctions pures et testables : elles transforment des pointages bruts en heures
// journalières par employé, en signalant les anomalies sans jamais les appliquer silencieusement.

/** Un événement de pointage brut, tel qu'extrait d'un rapport IVMS-4200. */
export type PointageBrut = {
  idExterne: string; // matricule/ID dans IVMS-4200
  dateHeure: Date; // horodatage de l'événement
};

export type MethodeCalcul = "PREMIERE_DERNIERE" | "PAIRES";

export type AnomaliePointage = {
  idExterne: string;
  date: string; // YYYY-MM-DD
  type: "POINTAGE_UNIQUE" | "DUREE_ABERRANTE" | "NON_APPARIE";
  detail: string;
};

export type ResultatJour = {
  idExterne: string;
  date: string; // YYYY-MM-DD
  heures: number; // heures travaillées calculées
  premier: Date;
  dernier: Date;
};

export type ResultatPointage = {
  jours: ResultatJour[];
  anomalies: AnomaliePointage[];
};

function isoJour(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Calcule les heures travaillées par employé et par jour à partir des pointages bruts.
 * — PREMIERE_DERNIERE : durée = dernière sortie − première entrée du jour.
 * — PAIRES : somme des durées entre entrées/sorties successives (2 par 2).
 * Anomalies détectées (jamais appliquées en silence) :
 *   POINTAGE_UNIQUE (un seul pointage dans la journée), DUREE_ABERRANTE (> dureeMaxH).
 */
export function calculerHeuresDepuisPointages(
  pointages: PointageBrut[],
  options: { methode?: MethodeCalcul; dureeMaxH?: number } = {}
): ResultatPointage {
  const methode = options.methode ?? "PREMIERE_DERNIERE";
  const dureeMaxH = options.dureeMaxH ?? 16;

  // Regroupe par (idExterne, jour)
  const groupes = new Map<string, PointageBrut[]>();
  for (const p of pointages) {
    const cle = `${p.idExterne}|${isoJour(p.dateHeure)}`;
    (groupes.get(cle) ?? groupes.set(cle, []).get(cle)!).push(p);
  }

  const jours: ResultatJour[] = [];
  const anomalies: AnomaliePointage[] = [];

  for (const [cle, evenements] of groupes) {
    const [idExterne, date] = cle.split("|");
    const tries = [...evenements].sort((a, b) => a.dateHeure.getTime() - b.dateHeure.getTime());

    if (tries.length === 1) {
      anomalies.push({
        idExterne,
        date,
        type: "POINTAGE_UNIQUE",
        detail: `Un seul pointage à ${tries[0].dateHeure.toISOString().slice(11, 16)} — impossible de calculer la durée`,
      });
      continue;
    }

    let heures: number;
    if (methode === "PAIRES") {
      let total = 0;
      for (let i = 0; i + 1 < tries.length; i += 2) {
        total += (tries[i + 1].dateHeure.getTime() - tries[i].dateHeure.getTime()) / 3_600_000;
      }
      heures = total;
    } else {
      const premier = tries[0].dateHeure;
      const dernier = tries[tries.length - 1].dateHeure;
      heures = (dernier.getTime() - premier.getTime()) / 3_600_000;
    }

    heures = Math.round(heures * 100) / 100;

    if (heures > dureeMaxH) {
      anomalies.push({
        idExterne,
        date,
        type: "DUREE_ABERRANTE",
        detail: `Durée calculée ${heures} h supérieure au maximum ${dureeMaxH} h`,
      });
      continue; // on n'applique pas une durée manifestement erronée
    }

    jours.push({
      idExterne,
      date,
      heures,
      premier: tries[0].dateHeure,
      dernier: tries[tries.length - 1].dateHeure,
    });
  }

  jours.sort((a, b) => (a.date === b.date ? a.idExterne.localeCompare(b.idExterne) : a.date.localeCompare(b.date)));
  return { jours, anomalies };
}

/**
 * Ajuste les heures d'un jour selon le shift normal de l'employé et une pause déjeuner.
 * Règles (décision client 2026-07) :
 *  — Pause : `pauseMinutes` (30 min par défaut) TOUJOURS déduites — droit à la pause déjeuner.
 *  — Jamais avant le début du shift : l'arrivée en avance ne compte pas (début = max(pointage, shift)).
 *  — Heures supp seulement à partir de `graceMinutes` (60 min) APRÈS la fin du shift : la 1re heure
 *    après la fin est une tolérance non comptée ; au-delà, seul l'excédent après fin+1h est crédité.
 *  — Sans shift renseigné (heureDebut/heureFin absents ou fin ≤ début) : on retire seulement la pause.
 * Renvoie les heures payables (≥ 0, arrondies au centième).
 */
export function ajusterHeuresJour(opts: {
  premier: Date;
  dernier: Date;
  shiftDebut?: string | null; // "HH:MM" (heure murale)
  shiftFin?: string | null; // "HH:MM"
  pauseMinutes?: number;
  graceMinutes?: number;
}): number {
  const pauseH = (opts.pauseMinutes ?? 30) / 60;
  const graceMs = (opts.graceMinutes ?? 60) * 60_000;
  let inMs = opts.premier.getTime();
  let outMs = opts.dernier.getTime();

  // Construit les bornes du shift dans le MÊME repère (heure murale = UTC ici, cf. isoJour).
  const hhmm = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return Date.UTC(opts.premier.getUTCFullYear(), opts.premier.getUTCMonth(), opts.premier.getUTCDate(), h, m);
  };
  const debutMs = opts.shiftDebut ? hhmm(opts.shiftDebut) : null;
  const finMs = opts.shiftFin ? hhmm(opts.shiftFin) : null;

  if (debutMs !== null && finMs !== null && finMs > debutMs) {
    inMs = Math.max(inMs, debutMs); // jamais avant le début du shift
    if (outMs <= finMs) {
      // parti à l'heure ou en avance : on garde le pointage réel
    } else if (outMs <= finMs + graceMs) {
      outMs = finMs; // dans la tolérance : la 1re heure après la fin n'est pas comptée
    } else {
      outMs = outMs - graceMs; // heures supp au-delà de fin+1h : on retire l'heure de tolérance
    }
  }

  const heures = (outMs - inMs) / 3_600_000 - pauseH;
  return Math.max(0, Math.round(heures * 100) / 100);
}

/**
 * Apparie les résultats de pointage aux employés via idExterneIVMS.
 * Retourne les jours appariés (avec employeeId) et signale les ID non trouvés.
 */
export function apparierPointages(
  resultat: ResultatPointage,
  correspondance: Map<string, string> // idExterne -> employeeId
): {
  apparies: (ResultatJour & { employeeId: string })[];
  anomalies: AnomaliePointage[];
} {
  const apparies: (ResultatJour & { employeeId: string })[] = [];
  const anomalies = [...resultat.anomalies];
  const idsNonApparies = new Set<string>();

  for (const jour of resultat.jours) {
    const employeeId = correspondance.get(jour.idExterne);
    if (!employeeId) {
      if (!idsNonApparies.has(jour.idExterne)) {
        idsNonApparies.add(jour.idExterne);
        anomalies.push({
          idExterne: jour.idExterne,
          date: jour.date,
          type: "NON_APPARIE",
          detail: `Aucun employé avec l'ID IVMS « ${jour.idExterne} »`,
        });
      }
      continue;
    }
    apparies.push({ ...jour, employeeId });
  }

  return { apparies, anomalies };
}
