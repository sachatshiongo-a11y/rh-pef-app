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
  type: "POINTAGE_UNIQUE" | "DUREE_ABERRANTE" | "NON_APPARIE" | "LIGNE_ILLISIBLE" | "APRES_SORTIE";
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

// ── Lecture des dates du rapport (audit RH 2026-10-10) ─────────────────────────────────────────
// Le rapport d'IVMS-4200 exporté au Congo écrit les dates à la française (JJ/MM/AAAA). La lecture
// « devinée » du tableur les prenait pour des dates américaines : « 05/10/2026 » devenait le 10 mai,
// et « 13/10/2026 » (pas de 13e mois) était perdu SANS UN MOT. Désormais : lecture EXPLICITE de
// JJ/MM/AAAA (séparateurs / . -) et de AAAA-MM-JJ (ou AAAA/MM/JJ), avec l'heure HH:MM[:SS] ; une
// cellule de date du tableur (numéro de série Excel) est lue telle quelle, sans fuseau. Toute ligne
// illisible est SIGNALÉE (numéro de ligne, valeur), jamais devinée ni ignorée en silence.
//
// Repère des heures : l'heure MURALE est portée en UTC (`Date.UTC(…)`), comme `isoJour` et
// `ajusterHeuresJour` l'attendent.

/** Origine des numéros de série Excel (calendrier 1900, bogue du 29/02/1900 compris). */
const ORIGINE_EXCEL = Date.UTC(1899, 11, 30);

function composer(a: number, mo: number, j: number, h = 0, mi = 0, se = 0): Date | null {
  if (mo < 1 || mo > 12 || j < 1 || j > 31 || h > 23 || mi > 59 || se > 59) return null;
  const d = new Date(Date.UTC(a, mo - 1, j, h, mi, se));
  // 31/02 ou 31/04 : le calendrier refuse, on ne glisse pas au mois suivant.
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null;
  return d;
}

const RE_JJMMAAAA = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]+(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?$/;
const RE_AAAAMMJJ = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?)?$/;

/** Lit une date (avec ou sans heure) : `{ date, avecHeure }`, ou null si illisible. */
function lireDate(v: unknown): { date: Date; avecHeure: boolean } | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Une Date venue du tableur a été construite à l'heure LOCALE du serveur : on en relit les
    // composantes locales, arrondies à la seconde.
    const t = new Date(v.getTime() + 500);
    const d = composer(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds());
    return d ? { date: d, avecHeure: true } : null;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 1) return null;
    const ms = Math.round((v * 86_400_000) / 1000) * 1000; // arrondi à la seconde
    return { date: new Date(ORIGINE_EXCEL + ms), avecHeure: v % 1 !== 0 };
  }
  const t = String(v ?? "").trim();
  if (!t) return null;
  let m = RE_JJMMAAAA.exec(t);
  if (m) {
    const d = composer(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
    return d ? { date: d, avecHeure: m[4] !== undefined } : null;
  }
  m = RE_AAAAMMJJ.exec(t);
  if (m) {
    const d = composer(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
    return d ? { date: d, avecHeure: m[4] !== undefined } : null;
  }
  return null;
}

/** Horodatage complet (date ET heure) ; null si illisible ou sans heure. */
export function lireHorodatage(v: unknown): Date | null {
  const r = lireDate(v);
  return r && r.avecHeure ? r.date : null;
}

/** Jour seul, « AAAA-MM-JJ » ; null si illisible. */
export function lireJourSeul(v: unknown): string | null {
  const r = lireDate(v);
  return r ? isoJour(r.date) : null;
}

/** Heure seule (« 08:05 », « 8h05 », « 17:30:12 », fraction de jour du tableur, ou Date) en
 *  millisecondes depuis minuit ; null si illisible. */
export function lireHeureSeule(v: unknown): number | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const t = new Date(v.getTime() + 500);
    return ((t.getHours() * 60 + t.getMinutes()) * 60 + t.getSeconds()) * 1000;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return null;
    const f = v % 1;
    return Math.round((f * 86_400_000) / 1000) * 1000;
  }
  const m = /^(\d{1,2})[:h](\d{2})(?::(\d{2}))?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]), se = Number(m[3] ?? 0);
  if (h > 23 || mi > 59 || se > 59) return null;
  return ((h * 60 + mi) * 60 + se) * 1000;
}

export type LectureRapport =
  | { ok: true; pointages: PointageBrut[]; illisibles: AnomaliePointage[] }
  | { ok: false; message: string };

/**
 * Lignes d'un rapport (tableur ou CSV, première ligne = en-têtes, valeurs BRUTES : texte non
 * interprété, dates en numéro de série) → pointages bruts + lignes illisibles signalées. Colonnes
 * reconnues souplement : un identifiant, puis une date/heure, ou une date et une heure séparées.
 */
export function extrairePointagesRapport(lignes: Record<string, unknown>[]): LectureRapport {
  if (lignes.length === 0) return { ok: false, message: "Le fichier ne contient aucune ligne." };
  const cles = Object.keys(lignes[0]);
  const colId = cles.find((c) => /id|matricule|badge|employ/i.test(c));
  const colDateHeure = cles.find((c) => /date.?heure|horodat|time|pointage|event/i.test(c) && !/^time$/i.test(c));
  const colDate = cles.find((c) => /^date$|jour/i.test(c));
  const colHeure = cles.find((c) => /^heure$|^time$/i.test(c));
  if (!colId || (!colDateHeure && !(colDate && colHeure))) {
    return {
      ok: false,
      message: "Colonnes non reconnues. Le rapport doit contenir une colonne d'identifiant et une colonne date/heure (ou date + heure séparées).",
    };
  }

  const pointages: PointageBrut[] = [];
  const illisibles: AnomaliePointage[] = [];
  lignes.forEach((l, i) => {
    const numero = i + 2; // ligne 1 = en-têtes
    const idExterne = String(l[colId] ?? "").trim();
    const brutDate = colDateHeure ? l[colDateHeure] : `${String(l[colDate!] ?? "")} ${String(l[colHeure!] ?? "")}`.trim();
    const vide = (x: unknown) => x === undefined || x === null || String(x).trim() === "";
    // Ligne entièrement vide (fin de tableau) : rien à signaler.
    if (!idExterne && (colDateHeure ? vide(l[colDateHeure]) : vide(l[colDate!]) && vide(l[colHeure!]))) return;
    const texte = (x: unknown) => (typeof x === "number" ? `n° de série ${x}` : String(x ?? "").trim() || "(vide)");
    if (!idExterne) {
      illisibles.push({ idExterne: "—", date: "", type: "LIGNE_ILLISIBLE", detail: `Ligne ${numero} : identifiant vide (date « ${texte(colDateHeure ? l[colDateHeure] : brutDate)} ») — ligne ignorée` });
      return;
    }
    let dh: Date | null = null;
    if (colDateHeure) {
      dh = lireHorodatage(l[colDateHeure]);
    } else {
      const jour = lireJourSeul(l[colDate!]);
      const heure = lireHeureSeule(l[colHeure!]);
      dh = jour !== null && heure !== null ? new Date(new Date(`${jour}T00:00:00.000Z`).getTime() + heure) : null;
    }
    if (!dh) {
      const valeur = colDateHeure ? texte(l[colDateHeure]) : `${texte(l[colDate!])} ${texte(l[colHeure!])}`;
      illisibles.push({
        idExterne,
        date: "",
        type: "LIGNE_ILLISIBLE",
        detail: `Ligne ${numero} : date/heure « ${valeur} » illisible (attendu JJ/MM/AAAA HH:MM ou AAAA-MM-JJ HH:MM) — ligne ignorée`,
      });
      return;
    }
    pointages.push({ idExterne, dateHeure: dh });
  });
  return { ok: true, pointages, illisibles };
}
