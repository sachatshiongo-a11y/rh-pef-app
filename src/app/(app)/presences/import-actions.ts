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
  extrairePointagesRapport,
  type AnomaliePointage,
  type LectureRapport,
} from "@/lib/pointage";
import { datesDeSortie, apresSortie } from "@/lib/salaries-sortis";
import { heuresDansLesBornes, messageHeuresHorsBornes } from "@/lib/heures-bornes";

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
  /** Ce que la grille porte DÉJÀ ce jour-là (heures et code), ou null si rien : l'aperçu montre
   *  « existant → importé », et un jour déjà saisi n'est pas coché par défaut (l'import l'écraserait). */
  existant: { heures: number | null; code: string | null } | null;
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

/** Lecture du rapport (Excel/CSV) en valeurs BRUTES — jamais la lecture « devinée » du tableur, qui
 *  prenait 05/10 pour le 10 mai et perdait le 13/10 — puis lecture explicite des dates
 *  (`extrairePointagesRapport`, pur et testé). */
function parserFichier(buf: Buffer): LectureRapport {
  let lignes: Record<string, unknown>[];
  try {
    const wb = XLSX.read(buf, { type: "buffer", cellDates: false, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    lignes = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  } catch {
    return { ok: false, message: "Impossible de lire le fichier (format Excel/CSV attendu)." };
  }
  return extrairePointagesRapport(lignes);
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

  // Actifs, ET salariés sortis depuis le premier jour du rapport : appariés pour leurs seuls jours
  // actifs (un jour après la sortie est signalé, jamais importé).
  const premierJour = parse.pointages.reduce<string | null>((m, p) => { const j = p.dateHeure.toISOString().slice(0, 10); return m === null || j < m ? j : m; }, null);
  const sortisRecents = premierJour
    ? [...(await datesDeSortie(prisma, (await prisma.employee.findMany({ where: { actif: false }, select: { id: true } })).map((e) => e.id)))]
        .filter(([, sortie]) => sortie >= premierJour)
    : [];
  const sorties = new Map(sortisRecents);
  const employees = await prisma.employee.findMany({
    where: { OR: [{ actif: true }, { id: { in: [...sorties.keys()] } }] },
    select: { id: true, matricule: true, nom: true, idExterneIVMS: true },
  });
  const correspondance = new Map<string, string>();
  // Le matricule d'abord, l'identifiant IVMS ensuite : l'identifiant de la pointeuse l'emporte
  // quand il existe (un ID IVMS égal au matricule d'un autre ne le détourne plus selon l'ordre).
  for (const e of employees) correspondance.set(e.matricule, e.id);
  for (const e of employees) if (e.idExterneIVMS) correspondance.set(e.idExterneIVMS, e.id);
  const parId = new Map(employees.map((e) => [e.id, e]));

  const appariement = apparierPointages(resultat, correspondance);
  const anomalies: AnomaliePointage[] = [...parse.illisibles, ...appariement.anomalies];
  const apparies = appariement.apparies.filter((j) => {
    if (!apresSortie(sorties, j.employeeId, j.date)) return true;
    const sortie = sorties.get(j.employeeId)!;
    anomalies.push({
      idExterne: j.idExterne,
      date: j.date,
      type: "APRES_SORTIE",
      detail: `${parId.get(j.employeeId)?.nom ?? j.idExterne} est sorti(e) le ${sortie.split("-").reverse().join("/")} : jour non importé`,
    });
    return false;
  });
  if (apparies.length === 0) {
    return { ok: true, message: "Aucun jour exploitable dans ce fichier.", lignes: [], anomalies };
  }

  const dates = apparies.map((j) => j.date).sort();
  const dateMin = dates[0];
  const dateMax = dates[dates.length - 1];
  const debut = new Date(dateMin + "T00:00:00Z");
  const fin = new Date(dateMax + "T00:00:00Z");

  const [creneaux, feries, conges, figes, heuresExistantes, codesExistants] = await Promise.all([
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
    prisma.overtimeEntry.findMany({ where: { date: { gte: debut, lte: fin } }, select: { employeeId: true, date: true, heuresTravaillees: true } }),
    prisma.attendance.findMany({ where: { date: { gte: debut, lte: fin } }, select: { employeeId: true, date: true, code: true } }),
  ]);
  const jourIso = (d: Date) => new Date(d).toISOString().slice(0, 10);
  const heuresDuJour = new Map(heuresExistantes.map((h) => [`${h.employeeId}_${jourIso(h.date)}`, Number(h.heuresTravaillees)]));
  const codeDuJour = new Map(codesExistants.map((a) => [`${a.employeeId}_${jourIso(a.date)}`, a.code as string]));
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
        existant: (() => {
          const k = `${jour.employeeId}_${jour.date}`;
          const h = heuresDuJour.get(k);
          const c = codeDuJour.get(k);
          return h === undefined && c === undefined ? null : { heures: h ?? null, code: c ?? null };
        })(),
      };
    })
    .sort((a, b) => (a.date === b.date ? a.nom.localeCompare(b.nom) : a.date.localeCompare(b.date)));

  const nbOk = lignes.filter((l) => l.statut === "OK").length;
  const nbDeja = lignes.filter((l) => l.statut === "OK" && l.existant).length;
  const nbIllisibles = anomalies.filter((a) => a.type === "LIGNE_ILLISIBLE").length;
  const fr = (iso: string) => iso.split("-").reverse().join("/");
  return {
    ok: true,
    message: `${lignes.length} jour(s) détecté(s) du ${fr(dateMin)} au ${fr(dateMax)} — ${nbOk} importable(s)${nbDeja > 0 ? ` dont ${nbDeja} déjà saisi(s) (non cochés : l'import les remplacerait)` : ""}, ${anomalies.length} anomalie(s)${nbIllisibles > 0 ? ` dont ${nbIllisibles} ligne(s) illisible(s)` : ""}. Rien n'a encore été importé : choisissez la période et les lignes, puis importez.`,
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

  // Tout ou rien : une seule ligne illisible ou hors bornes (0–24 h, jamais négatif) refuse le lot
  // ENTIER avant la première écriture — plus de ligne écartée en silence.
  const lignes = selection ?? [];
  const malFormees = lignes.filter((s) => typeof s?.employeeId !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s?.date ?? ""));
  if (malFormees.length > 0) return { ok: false, message: `${malFormees.length} ligne(s) sans salarié ou sans date lisible dans la sélection. Rien n'a été importé.` };
  const horsBornes = lignes.filter((s) => !heuresDansLesBornes(s.heures));
  if (horsBornes.length > 0) return { ok: false, message: messageHeuresHorsBornes(horsBornes) };
  const valides = lignes;
  if (valides.length === 0) return { ok: false, message: "Aucune ligne sélectionnée." };
  if (valides.length > 2000) return { ok: false, message: "Sélection trop volumineuse (max 2000 lignes)." };

  const dates = valides.map((s) => s.date).sort();
  const debut = new Date(dates[0] + "T00:00:00Z");
  const fin = new Date(dates[dates.length - 1] + "T00:00:00Z");

  const [feries, conges, figes, sorties] = await Promise.all([
    prisma.jourFerie.findMany({ where: { date: { gte: debut, lte: fin } }, select: { date: true } }),
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: fin }, dateFin: { gte: debut } },
      select: { employeeId: true, dateDebut: true, dateFin: true },
    }),
    moisFiges(),
    datesDeSortie(prisma, [...new Set(valides.map((s) => s.employeeId))]),
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
    if (figes.has(cleMois(s.date)) || estEnConge(s.employeeId, s.date) || apresSortie(sorties, s.employeeId, s.date)) {
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
    message: `Import terminé : ${nbAppliques} jour(s) appliqué(s)${nbIgnores > 0 ? `, ${nbIgnores} ignoré(s) (congé, paie validée ou après la sortie du salarié)` : ""}.`,
    nbAppliques,
    nbIgnores,
  };
}
