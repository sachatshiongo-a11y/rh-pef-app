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
