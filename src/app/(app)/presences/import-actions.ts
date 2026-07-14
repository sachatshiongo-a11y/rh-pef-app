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

// Import IVMS-4200 en DEUX temps (comme les imports du module Stock) :
//  1. analyserPointageIVMS : lit le fichier, calcule les heures ajustées et renvoie un APERÇU
//     complet (rien n'est écrit) — chaque jour est marqué OK / CONGE / PAIE_FIGEE ;
//  2. appliquerPointageIVMS : écrit UNIQUEMENT la sélection de l'utilisateur (cases cochées,
//     période choisie), en revalidant les garde-fous côté serveur.

export type LigneImport = {
  employeeId: string;
  nom: string;
  matricule: string;
  date: string; // YYYY-MM-DD
  heures: number; // heures ajustées (pause, bornes du shift)
  code: "P" | "F"; // présence, ou férié travaillé
  statut: "OK" | "CONGE" | "PAIE_FIGEE"; // CONGE : congé approuvé prioritaire · PAIE_FIGEE : mois validé
};

export type AnalysePointage = {
  ok: boolean;
  message: string;
  lignes: LigneImport[];
  anomalies: AnomaliePointage[];
  dateMin?: string;
  dateMax?: string;
};

export type ResultatImport = {
  ok: boolean;
  message: string;
  nbAppliques?: number;
  nbIgnores?: number;
};

/** Lecture + détection souple des colonnes du rapport (Excel/CSV). */
function parserFichier(buf: Buffer): { ok: true; pointages: PointageBrut[] } | { ok: false; message: string } {
  let lignes: Record<string, unknown>[];
  try {
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    lignes = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  } catch {
    return { ok: false, message: "Impossible de lire le fichier (format Excel/CSV attendu)." };
  }
  if (lignes.length === 0) return { ok: false, message: "Le fichier ne contient aucune ligne." };

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
  return { ok: true, pointages };
}

/** Mois « figés » : ceux dont la paie est VALIDÉE (aucune écriture possible). */
async function moisFiges(): Promise<Set<string>> {
  const runs = await prisma.payrollRun.findMany({ where: { statut: "VALIDE" }, select: { mois: true, annee: true } });
  return new Set(runs.map((r) => `${r.annee}-${r.mois}`));
}
const cleMois = (iso: string) => `${Number(iso.slice(0, 4))}-${Number(iso.slice(5, 7))}`;

/** Étape 1 — analyse le rapport et renvoie l'aperçu complet, sans rien écrire. */
export async function analyserPointageIVMS(
  _prev: AnalysePointage | null,
  formData: FormData
): Promise<AnalysePointage> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const fichier = formData.get("fichier") as File | null;
  if (!fichier || fichier.size === 0) {
    return { ok: false, message: "Aucun fichier fourni.", lignes: [], anomalies: [] };
  }

  const parse = parserFichier(Buffer.from(await fichier.arrayBuffer()));
  if (!parse.ok) return { ok: false, message: parse.message, lignes: [], anomalies: [] };

  const resultat = calculerHeuresDepuisPointages(parse.pointages, { methode: "PREMIERE_DERNIERE" });

  const employees = await prisma.employee.findMany({
    where: { actif: true },
    select: { id: true, matricule: true, nom: true, idExterneIVMS: true },
  });
  const correspondance = new Map<string, string>();
  for (const e of employees) {
    if (e.idExterneIVMS) correspondance.set(e.idExterneIVMS, e.id);
    correspondance.set(e.matricule, e.id); // repli sur le matricule
  }
  const parId = new Map(employees.map((e) => [e.id, e]));

  const { apparies, anomalies } = apparierPointages(resultat, correspondance);
  if (apparies.length === 0) {
    return { ok: true, message: "Aucun jour exploitable dans ce fichier.", lignes: [], anomalies };
  }

  const dates = apparies.map((j) => j.date).sort();
  const dateMin = dates[0];
  const dateMax = dates[dates.length - 1];
  const debut = new Date(dateMin + "T00:00:00Z");
  const fin = new Date(dateMax + "T00:00:00Z");

  const [creneaux, feries, conges, figes] = await Promise.all([
    prisma.planningCreneau.findMany({
      where: { date: { gte: debut, lte: fin } },
      select: { employeeId: true, date: true, shift: { select: { heureDebut: true, heureFin: true } } },
    }),
    prisma.jourFerie.findMany({ where: { date: { gte: debut, lte: fin } }, select: { date: true } }),
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: fin }, dateFin: { gte: debut } },
      select: { employeeId: true, dateDebut: true, dateFin: true },
    }),
    moisFiges(),
  ]);
  const shiftParJour = new Map<string, { heureDebut: string | null; heureFin: string | null }>();
  for (const c of creneaux) shiftParJour.set(`${c.employeeId}_${new Date(c.date).toISOString().slice(0, 10)}`, c.shift);
  const feriesSet = new Set(feries.map((f) => new Date(f.date).toISOString().slice(0, 10)));
  const estEnConge = (employeeId: string, iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return conges.some((c) => c.employeeId === employeeId && d >= new Date(c.dateDebut) && d <= new Date(c.dateFin));
  };

  const lignes: LigneImport[] = apparies
    .map((jour) => {
      const emp = parId.get(jour.employeeId)!;
      const shift = shiftParJour.get(`${jour.employeeId}_${jour.date}`);
      const heures = ajusterHeuresJour({
        premier: jour.premier,
        dernier: jour.dernier,
        shiftDebut: shift?.heureDebut,
        shiftFin: shift?.heureFin,
      });
      const statut: LigneImport["statut"] = figes.has(cleMois(jour.date))
        ? "PAIE_FIGEE"
        : estEnConge(jour.employeeId, jour.date)
          ? "CONGE"
          : "OK";
      return {
        employeeId: jour.employeeId,
        nom: emp.nom,
        matricule: emp.matricule,
        date: jour.date,
        heures,
        code: (feriesSet.has(jour.date) ? "F" : "P") as "P" | "F",
        statut,
      };
    })
    .sort((a, b) => (a.date === b.date ? a.nom.localeCompare(b.nom) : a.date.localeCompare(b.date)));

  const nbOk = lignes.filter((l) => l.statut === "OK").length;
  return {
    ok: true,
    message: `${lignes.length} jour(s) détecté(s) du ${dateMin} au ${dateMax} — ${nbOk} importable(s), ${anomalies.length} anomalie(s). Rien n'a encore été importé : choisissez la période et les lignes, puis importez.`,
    lignes,
    anomalies,
    dateMin,
    dateMax,
  };
}

/** Étape 2 — écrit la sélection (heures → Heures, présence P/F → Présences), garde-fous revérifiés. */
export async function appliquerPointageIVMS(
  selection: { employeeId: string; date: string; heures: number }[]
): Promise<ResultatImport> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const valides = (selection ?? []).filter(
    (s) =>
      typeof s.employeeId === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(s.date ?? "") &&
      typeof s.heures === "number" &&
      s.heures >= 0 &&
      s.heures <= 24
  );
  if (valides.length === 0) return { ok: false, message: "Aucune ligne sélectionnée." };
  if (valides.length > 2000) return { ok: false, message: "Sélection trop volumineuse (max 2000 lignes)." };

  const dates = valides.map((s) => s.date).sort();
  const debut = new Date(dates[0] + "T00:00:00Z");
  const fin = new Date(dates[dates.length - 1] + "T00:00:00Z");

  const [feries, conges, figes] = await Promise.all([
    prisma.jourFerie.findMany({ where: { date: { gte: debut, lte: fin } }, select: { date: true } }),
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: fin }, dateFin: { gte: debut } },
      select: { employeeId: true, dateDebut: true, dateFin: true },
    }),
    moisFiges(),
  ]);
  const feriesSet = new Set(feries.map((f) => new Date(f.date).toISOString().slice(0, 10)));
  const estEnConge = (employeeId: string, iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return conges.some((c) => c.employeeId === employeeId && d >= new Date(c.dateDebut) && d <= new Date(c.dateFin));
  };

  let nbAppliques = 0;
  let nbIgnores = 0;
  for (const s of valides) {
    // Garde-fous revérifiés à l'écriture : paie du mois validée, congé approuvé prioritaire.
    if (figes.has(cleMois(s.date)) || estEnConge(s.employeeId, s.date)) {
      nbIgnores++;
      continue;
    }
    const dObj = new Date(s.date + "T00:00:00Z");
    await prisma.overtimeEntry.upsert({
      where: { employeeId_date: { employeeId: s.employeeId, date: dObj } },
      update: { heuresTravaillees: s.heures },
      create: { employeeId: s.employeeId, date: dObj, heuresTravaillees: s.heures },
    });
    const presence = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: s.employeeId, date: dObj } },
    });
    if (!presence) {
      await prisma.attendance.create({
        data: { employeeId: s.employeeId, date: dObj, code: feriesSet.has(s.date) ? "F" : "P" },
      });
    }
    nbAppliques++;
  }

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  await prisma.importPointage.create({
    data: {
      source: "IVMS_RAPPORT",
      nomFichier: `sélection ${dates[0]} → ${dates[dates.length - 1]}`,
      mois: config.moisCourant,
      annee: config.anneeCourante,
      nbLignes: valides.length,
      nbAppliques,
      importeParId: user.id,
    },
  });
  await journaliser(prisma, {
    entite: "ImportPointage",
    entiteId: `${dates[0]}_${dates[dates.length - 1]}`,
    champ: "import",
    nouvelleValeur: `${nbAppliques} jour(s) appliqué(s) sur ${valides.length} sélectionné(s)`,
    userId: user.id,
  });

  revalidatePath("/presences");
  revalidatePath("/heures-supp");
  revalidatePath("/paie");

  return {
    ok: true,
    message: `Import terminé : ${nbAppliques} jour(s) appliqué(s)${nbIgnores > 0 ? `, ${nbIgnores} ignoré(s) (congé ou paie validée)` : ""}.`,
    nbAppliques,
    nbIgnores,
  };
}
