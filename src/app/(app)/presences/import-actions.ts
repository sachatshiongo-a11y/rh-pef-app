"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import {
  calculerHeuresDepuisPointages,
  apparierPointages,
  ajusterHeuresJour,
  type PointageBrut,
  type AnomaliePointage,
} from "@/lib/pointage";

export type ResultatImport = {
  ok: boolean;
  message: string;
  nbLignes?: number;
  nbAppliques?: number;
  nbIgnoresConge?: number;
  anomalies?: AnomaliePointage[];
};

/**
 * Importe un rapport de pointage IVMS-4200 (Excel/CSV).
 * Colonnes attendues (détection souple par en-tête) : un identifiant (ID/matricule),
 * une date+heure d'événement. Chaque ligne = un pointage (entrée ou sortie).
 * Règles respectées :
 *  — anomalies signalées, jamais appliquées en silence ;
 *  — un jour couvert par un congé VALIDÉ n'est pas écrasé par le pointage (congé prioritaire) ;
 *  — les jours déjà figés par une paie validée/payée ne sont pas modifiés.
 */
export async function importerPointageIVMS(
  _prev: ResultatImport | null,
  formData: FormData
): Promise<ResultatImport> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const fichier = formData.get("fichier") as File | null;
  if (!fichier || fichier.size === 0) {
    return { ok: false, message: "Aucun fichier fourni." };
  }

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const mois = config.moisCourant;
  const annee = config.anneeCourante;

  // Lecture du classeur
  let lignes: Record<string, unknown>[];
  try {
    const buf = Buffer.from(await fichier.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    lignes = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  } catch {
    return { ok: false, message: "Impossible de lire le fichier (format Excel/CSV attendu)." };
  }

  if (lignes.length === 0) {
    return { ok: false, message: "Le fichier ne contient aucune ligne." };
  }

  // Détection souple des colonnes par mot-clé dans l'en-tête
  const cles = Object.keys(lignes[0]);
  const colId = cles.find((c) => /id|matricule|badge|employ/i.test(c));
  const colDateHeure = cles.find((c) => /date.?heure|horodat|time|pointage|event/i.test(c));
  const colDate = cles.find((c) => /^date$|jour/i.test(c));
  const colHeure = cles.find((c) => /^heure$|^time$/i.test(c));

  if (!colId || (!colDateHeure && !(colDate && colHeure))) {
    return {
      ok: false,
      message:
        "Colonnes non reconnues. Le rapport doit contenir une colonne d'identifiant et une colonne date/heure (ou date + heure séparées).",
    };
  }

  const pointages: PointageBrut[] = [];
  for (const l of lignes) {
    const idExterne = String(l[colId] ?? "").trim();
    if (!idExterne) continue;

    let dh: Date | null = null;
    if (colDateHeure) {
      const v = l[colDateHeure];
      dh = v instanceof Date ? v : new Date(String(v));
    } else if (colDate && colHeure) {
      const dv = l[colDate];
      const jour = dv instanceof Date ? dv.toISOString().slice(0, 10) : String(dv);
      dh = new Date(`${jour}T${String(l[colHeure]).trim()}`);
    }
    if (dh && !Number.isNaN(dh.getTime())) {
      pointages.push({ idExterne, dateHeure: dh });
    }
  }

  const resultat = calculerHeuresDepuisPointages(pointages, { methode: "PREMIERE_DERNIERE" });

  // Correspondance ID IVMS → employeeId (via idExterneIVMS, sinon matricule en repli)
  const employees = await prisma.employee.findMany({
    where: { actif: true },
    select: { id: true, matricule: true, idExterneIVMS: true },
  });
  const correspondance = new Map<string, string>();
  for (const e of employees) {
    if (e.idExterneIVMS) correspondance.set(e.idExterneIVMS, e.id);
    correspondance.set(e.matricule, e.id); // repli sur le matricule
  }

  const { apparies, anomalies } = apparierPointages(resultat, correspondance);

  // Garde : jours couverts par un congé VALIDÉ (APPROUVE) — le congé prime sur le pointage.
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const congesApprouves = await prisma.leaveRequest.findMany({
    where: { statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } },
    select: { employeeId: true, dateDebut: true, dateFin: true },
  });

  // Shift normal planifié par (employé, jour) → bornes horaires pour ajuster les heures
  // (pause déjeuner, pas d'heures avant le début du shift, heures supp seulement 1 h après la fin).
  const creneaux = await prisma.planningCreneau.findMany({
    where: { date: { gte: debutMois, lte: finMois } },
    select: { employeeId: true, date: true, shift: { select: { heureDebut: true, heureFin: true } } },
  });
  const shiftParJour = new Map<string, { heureDebut: string | null; heureFin: string | null }>();
  for (const c of creneaux)
    shiftParJour.set(`${c.employeeId}_${new Date(c.date).toISOString().slice(0, 10)}`, c.shift);
  const estEnConge = (employeeId: string, isoDate: string) => {
    const d = new Date(isoDate + "T00:00:00Z");
    return congesApprouves.some(
      (c) =>
        c.employeeId === employeeId &&
        d >= new Date(c.dateDebut) &&
        d <= new Date(c.dateFin)
    );
  };

  let nbAppliques = 0;
  let nbIgnoresConge = 0;

  for (const jour of apparies) {
    // On n'importe que les jours du mois courant en cours de traitement
    const dObj = new Date(jour.date + "T00:00:00Z");
    if (dObj < debutMois || dObj > finMois) continue;

    if (estEnConge(jour.employeeId, jour.date)) {
      nbIgnoresConge++;
      continue;
    }

    // Ajuste selon le shift normal du jour (pause 30 min, pas d'heures avant le début du shift,
    // heures supp seulement 1 h après la fin). Sans shift planifié : on retire juste la pause.
    const shift = shiftParJour.get(`${jour.employeeId}_${jour.date}`);
    const heures = ajusterHeuresJour({
      premier: jour.premier,
      dernier: jour.dernier,
      shiftDebut: shift?.heureDebut,
      shiftFin: shift?.heureFin,
    });

    // Heures travaillées → OvertimeEntry ; présence P → Attendance (sauf si déjà saisie autrement)
    await prisma.overtimeEntry.upsert({
      where: { employeeId_date: { employeeId: jour.employeeId, date: dObj } },
      update: { heuresTravaillees: heures },
      create: { employeeId: jour.employeeId, date: dObj, heuresTravaillees: heures },
    });
    const presenceExistante = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: jour.employeeId, date: dObj } },
    });
    if (!presenceExistante) {
      await prisma.attendance.create({
        data: { employeeId: jour.employeeId, date: dObj, code: "P" },
      });
    }
    nbAppliques++;
  }

  await prisma.importPointage.create({
    data: {
      source: "IVMS_RAPPORT",
      nomFichier: fichier.name,
      mois,
      annee,
      nbLignes: pointages.length,
      nbAppliques,
      anomalies: anomalies.length > 0 ? JSON.parse(JSON.stringify(anomalies)) : undefined,
      importeParId: user.id,
    },
  });
  await journaliser(prisma, {
    entite: "ImportPointage",
    entiteId: `${annee}-${mois}`,
    champ: "import",
    nouvelleValeur: `${nbAppliques} jours appliqués (${fichier.name})`,
    userId: user.id,
  });

  revalidatePath("/presences");
  revalidatePath("/heures-supp");

  return {
    ok: true,
    message: `Import terminé : ${nbAppliques} jour(s) appliqué(s), ${nbIgnoresConge} ignoré(s) pour congé, ${anomalies.length} anomalie(s).`,
    nbLignes: pointages.length,
    nbAppliques,
    nbIgnoresConge,
    anomalies,
  };
}
