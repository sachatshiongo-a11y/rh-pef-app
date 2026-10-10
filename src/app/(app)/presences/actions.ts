"use server";

import { revalidatePath } from "next/cache";
import type { AttendanceCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, type CurrentUser } from "@/lib/auth";
import { joursEnConge, joursDeReposSelonModele } from "@/lib/conges-couverture";
import { refusSuppression, MESSAGE_EFFACER_PRESENCE } from "@/lib/suppression-direction";
import { datesDeSortie, apresSortie } from "@/lib/salaries-sortis";
import {
  chargerContextePresences, codeSansHeures, heuresPreRemplies, messageRetraitAConfirmer, messageRetraitFait, type Entree,
} from "@/lib/presences-lot";

// Un congé (C ou S) ne se pose JAMAIS sur un dimanche ou un jour férié : ces jours ne sont pas
// décomptés des congés (même règle que calculerJoursOuvrables). Garde partagée unitaire/lot.
const estDimancheIso = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
async function feriesDans(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const tri = [...dates].sort();
  const rows = await prisma.jourFerie.findMany({ where: { date: { gte: new Date(`${tri[0]}T00:00:00Z`), lte: new Date(`${tri[tri.length - 1]}T00:00:00Z`) } }, select: { date: true } });
  return new Set(rows.map((r) => new Date(r.date).toISOString().slice(0, 10)));
}
const estConge = (code: string) => code === "C" || code === "S";

/** Délai de la transaction d'un lot : un mois entier (24 salariés × 31 jours) s'écrit d'un bloc. */
const DELAI_LOT = 60_000;

export type ResultatPresence = {
  ignore?: string;
  erreur?: string;
  /** Rien n'a été écrit : des heures SAISIES (pas pré-remplies) seraient retirées. Renvoyer avec
   *  `confirmerRetraitHeures` après accord de l'utilisateur. */
  aConfirmer?: string;
  /** Écrit, avec une suite à connaître (ex. heures pré-remplies retirées). */
  info?: string;
};

/**
 * Écrit UN ENSEMBLE d'entrées déjà filtrées, en une seule transaction (tout ou rien). Le contexte
 * (créneaux, modèles, shifts, heures et codes existants, pointages) a été chargé UNE fois.
 *  - "" : la présence du jour est effacée ;
 *  - P : code posé ; heures pré-remplies (créneau planifié > modèle hebdo > contrat) si aucune ;
 *  - N, A, M, O, C, S (jours sans travail) : code posé, heures du jour retirées.
 * Les codes existants sont MIS À JOUR (date de saisie d'origine conservée : la paie s'en sert),
 * les nouveaux créés en bloc.
 */
async function ecrireEntrees(entrees: Entree[], ctx: Awaited<ReturnType<typeof chargerContextePresences>>): Promise<void> {
  if (entrees.length === 0) return;
  const cle = (e: { employeeId: string; date: string }) => `${e.employeeId}|${e.date}`;
  const aEffacer = entrees.filter((e) => e.code === "");
  const aCreer: { employeeId: string; date: Date; code: AttendanceCode }[] = [];
  const majParCode = new Map<AttendanceCode, string[]>(); // code -> ids d'Attendance à mettre à jour
  const heuresACreer: { employeeId: string; date: Date; heuresTravaillees: number }[] = [];
  const heuresARetirer: { employeeId: string; date: Date }[] = [];
  for (const e of entrees) {
    if (e.code === "") continue;
    const existant = ctx.attendance.get(cle(e));
    if (!existant) aCreer.push({ employeeId: e.employeeId, date: new Date(`${e.date}T00:00:00.000Z`), code: e.code });
    else if (existant.code !== e.code) (majParCode.get(e.code) ?? majParCode.set(e.code, []).get(e.code)!).push(existant.id);
    if (e.code === "P" && !ctx.heures.has(cle(e))) {
      heuresACreer.push({ employeeId: e.employeeId, date: new Date(`${e.date}T00:00:00.000Z`), heuresTravaillees: heuresPreRemplies(ctx, e.employeeId, e.date) });
    }
    if (codeSansHeures(e.code) && ctx.heures.has(cle(e))) heuresARetirer.push({ employeeId: e.employeeId, date: new Date(`${e.date}T00:00:00.000Z`) });
  }
  await prisma.$transaction(async (tx) => {
    if (aEffacer.length > 0) {
      await tx.attendance.deleteMany({ where: { OR: aEffacer.map((e) => ({ employeeId: e.employeeId, date: new Date(`${e.date}T00:00:00.000Z`) })) } });
    }
    for (const [code, ids] of majParCode) await tx.attendance.updateMany({ where: { id: { in: ids } }, data: { code } });
    if (aCreer.length > 0) await tx.attendance.createMany({ data: aCreer, skipDuplicates: true });
    if (heuresACreer.length > 0) await tx.overtimeEntry.createMany({ data: heuresACreer, skipDuplicates: true });
    if (heuresARetirer.length > 0) await tx.overtimeEntry.deleteMany({ where: { OR: heuresARetirer } });
  }, { timeout: DELAI_LOT });
}

/** Vrai si l'une des cases à VIDER porte déjà un code enregistré : les vider serait une suppression. */
async function videUnePresenceSaisie(entrees: { employeeId: string; date: string; code: AttendanceCode | "" }[]): Promise<boolean> {
  const aVider = entrees.filter((e) => e.code === "");
  if (aVider.length === 0) return false;
  const n = await prisma.attendance.count({ where: { OR: aVider.map((e) => ({ employeeId: e.employeeId, date: new Date(e.date) })) } });
  return n > 0;
}

function revaliderPresences() {
  revalidatePath("/presences");
  revalidatePath("/heures-supp");
  revalidatePath("/employes");
  revalidatePath("/conges"); // un « C » posé à la main entame le solde
  revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
}

/**
 * Saisie d'UNE case. Un jour sans travail (N, A, M, O, C, S) ne garde pas d'heures : les heures
 * PRÉ-REMPLIES (celles que le logiciel aurait mises lui-même) sont retirées et c'est dit ; des heures
 * SAISIES (autre valeur, ou venant d'un pointage) demandent d'abord une confirmation.
 */
export async function saisirPresence(
  employeeId: string,
  date: string,
  code: AttendanceCode | "",
  options: { confirmerRetraitHeures?: boolean } = {},
): Promise<ResultatPresence> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  // Vider un code déjà saisi efface le pointage du jour : réservé à la Direction (règle de Sacha,
  // 2026-10-01). Remplacer le code reste ouvert au responsable.
  if (code === "" && (await videUnePresenceSaisie([{ employeeId, date, code }]))) {
    const refus = refusSuppression(user, MESSAGE_EFFACER_PRESENCE);
    if (refus) return refus;
  }

  if (code !== "" && estConge(code)) {
    const feries = await feriesDans([date]);
    if (estDimancheIso(date) || feries.has(date)) {
      return { ignore: "Un congé (C/S) ne se pose pas sur un dimanche ou un jour férié — ces jours ne sont pas décomptés des congés." };
    }
  }
  const sorties = await datesDeSortie(prisma, [employeeId]);
  if (apresSortie(sorties, employeeId, date)) {
    return { ignore: `Salarié sorti le ${sorties.get(employeeId)!.split("-").reverse().join("/")} : ce jour n'est plus dans son contrat.` };
  }

  const entree: Entree = { employeeId, date, code };
  const ctx = await chargerContextePresences([entree]);
  const retrait = ctx.retraitHeures([entree]);
  if (retrait.saisies.length > 0 && !options.confirmerRetraitHeures) {
    return { aConfirmer: messageRetraitAConfirmer(retrait.saisies, code) };
  }
  await ecrireEntrees([entree], ctx);

  revaliderPresences();
  const info = messageRetraitFait(retrait);
  return info ? { info } : {};
}

export type ResultatLotPresences = {
  ignores: { employeeId: string; date: string }[];
  erreur?: string;
  aConfirmer?: string;
  /** Compte rendu EXACT du lot (écrites, ignorées par raison, heures retirées). */
  message?: string;
};

/** Saisie en lot (collage / actions groupées), TOUT OU RIEN : une seule transaction pour tout le
 *  lot ; le contexte (créneaux, modèles, shifts, heures existantes) est chargé une fois. Sont
 *  ignorés et renvoyés à l'appelant, raison par raison :
 *  - « P » sur un jour couvert par un congé APPROUVÉ ;
 *  - « P » sur un jour de REPOS selon le planning ou le modèle hebdo (ex. le samedi d'Aimée — la
 *    saisie unitaire reste libre pour un travail exceptionnel) ;
 *  - « C »/« S » sur un dimanche ou un jour férié (jamais décomptés des congés) ;
 *  - tout jour APRÈS la sortie d'un salarié parti dans le mois. */
export async function saisirPresencesEnLot(
  entrees: { employeeId: string; date: string; code: AttendanceCode | "" }[],
  options: { confirmerRetraitHeures?: boolean } = {},
): Promise<ResultatLotPresences> {
  const user: CurrentUser = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  // Même règle qu'en saisie unitaire, TOUT OU RIEN : un lot qui viderait un code déjà saisi est
  // refusé en entier, sans rien écrire (pas de lot à moitié appliqué).
  if (await videUnePresenceSaisie(entrees)) {
    const refus = refusSuppression(user, MESSAGE_EFFACER_PRESENCE);
    if (refus) return { ignores: [], ...refus };
  }

  const [enConge, feries, repos, sorties] = await Promise.all([
    joursEnConge(entrees),
    feriesDans(entrees.map((e) => e.date)),
    joursDeReposSelonModele(entrees),
    datesDeSortie(prisma, [...new Set(entrees.map((e) => e.employeeId))]),
  ]);
  const ignores: { employeeId: string; date: string }[] = [];
  const raisons = { conge: 0, repos: 0, dimancheFerie: 0, sortie: 0 };
  const retenues: Entree[] = [];
  for (const { employeeId, date, code } of entrees) {
    const k = `${employeeId}|${date}`;
    if (apresSortie(sorties, employeeId, date)) { ignores.push({ employeeId, date }); raisons.sortie++; continue; }
    if (code === "P" && enConge.has(k)) { ignores.push({ employeeId, date }); raisons.conge++; continue; }
    if (code === "P" && repos.has(k)) { ignores.push({ employeeId, date }); raisons.repos++; continue; }
    if (code !== "" && estConge(code) && (estDimancheIso(date) || feries.has(date))) { ignores.push({ employeeId, date }); raisons.dimancheFerie++; continue; }
    retenues.push({ employeeId, date, code });
  }

  const ctx = await chargerContextePresences(retenues);
  const retrait = ctx.retraitHeures(retenues);
  if (retrait.saisies.length > 0 && !options.confirmerRetraitHeures) {
    // Rien n'est écrit : la question porte sur tout le lot.
    return { ignores: [], aConfirmer: messageRetraitAConfirmer(retrait.saisies) };
  }
  await ecrireEntrees(retenues, ctx);

  revaliderPresences();
  const morceaux = [`${retenues.length} case(s) enregistrée(s)`];
  if (ignores.length > 0) {
    const detail = [
      raisons.conge > 0 ? `${raisons.conge} congé approuvé` : "",
      raisons.repos > 0 ? `${raisons.repos} jour de repos (planning ou modèle)` : "",
      raisons.dimancheFerie > 0 ? `${raisons.dimancheFerie} congé sur dimanche/férié` : "",
      raisons.sortie > 0 ? `${raisons.sortie} après la sortie du salarié` : "",
    ].filter(Boolean).join(", ");
    morceaux.push(`${ignores.length} ignorée(s) : ${detail}`);
  }
  const info = messageRetraitFait(retrait);
  if (info) morceaux.push(info);
  return { ignores, message: `${morceaux.join(" ; ")}.` };
}
