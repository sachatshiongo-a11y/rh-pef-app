import "server-only";

// Assemble, depuis la base, les JOURS du mois dont la paie a besoin (spec 2026-09-23 §5) :
// `JourReference` pour `calculerReferenceMois` (paie-reference.ts) et `JourSaisie` pour
// `detecterAvertissementsSaisie` (paie-avertissements.ts), plus la fin du contrat qui couvre le
// mois (`dateFinContrat`). Appelé par paie-batch.ts ET bulletin-live.ts : un seul assemblage,
// sinon la fiche et la paie divergent. Une seule lecture par table pour tout l'effectif.
import { prisma } from "@/lib/prisma";
import { dureeShift } from "@/lib/duree-shift";
import { pariteSemaine } from "@/lib/dates-fr";
import type { CodePresence } from "@/lib/payroll";
import type { JourReference } from "@/lib/paie-reference";
import type { JourSaisie } from "@/lib/paie-avertissements";

export type JoursEmploye = {
  jours: JourReference[];
  saisie: JourSaisie[];
  /** Fin du contrat qui couvre le mois, date PURE (minuit UTC) ; `null` pour un CDI, une fin
   *  postérieure au mois, ou sans contrat enregistré. À passer tel quel à `calculerReferenceMois`
   *  (`dateFinContrat`) : sans elle, le mois de fin d'un CDD n'est jamais replié sur le contrat. */
  dateFinContrat: Date | null;
};

type ShiftDuree = { heureDebut: string | null; heureFin: string | null; dureeHeures: { toString(): string } | null; systeme: boolean };
/** Heures de TRAVAIL d'un shift : 0 pour un shift système (Repos/Congé/Férié), quoi qu'il porte. */
const heuresTravail = (s: ShiftDuree) =>
  s.systeme ? 0 : dureeShift({ heureDebut: s.heureDebut, heureFin: s.heureFin, dureeHeures: s.dureeHeures == null ? null : Number(s.dureeHeures) });
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
/** Date PURE (minuit UTC) par les composantes UTC : jamais les getters locaux, un minuit de
 *  Kinshasa (UTC+1) tomberait la veille à 23:00 UTC et ferait replier un mois entier à tort. */
const datePure = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Fin de l'emploi pendant le mois, d'après les contrats qui le COUVRENT (début ≤ fin du mois, fin
 * absente ou ≥ début du mois), quel que soit leur statut : une fin dépassée ne passe jamais toute
 * seule à EXPIRÉ, et un CDD transformé en CDI (ou suivi d'un nouveau CDD) dans le mois ne met pas
 * fin à l'emploi. Le plus tardif l'emporte : un contrat sans fin → `null` ; une fin après le
 * dernier jour du mois → `null` (le contrat couvre tout le mois).
 */
function finDeContrat(contrats: { dateFin: Date | null }[], finMois: Date): Date | null {
  if (contrats.length === 0 || contrats.some((c) => c.dateFin == null)) return null;
  const derniere = datePure(new Date(Math.max(...contrats.map((c) => c.dateFin!.getTime()))));
  return derniere.getTime() > finMois.getTime() ? null : derniere;
}

/**
 * Jours du mois `mois`/`annee` pour chaque salarié demandé — TOUS les jours du mois, un par jour,
 * même sans aucune donnée (un salarié sans rien reçoit des jours vides).
 */
export async function chargerJoursMois(mois: number, annee: number, employeeIds: string[]): Promise<Map<string, JoursEmploye>> {
  const debut = new Date(Date.UTC(annee, mois - 1, 1));
  const fin = new Date(Date.UTC(annee, mois, 0));
  const dansMois = { gte: debut, lte: fin };
  const [creneaux, modeles, presences, heures, contrats] = await Promise.all([
    prisma.planningCreneau.findMany({
      where: { employeeId: { in: employeeIds }, date: dansMois },
      select: { employeeId: true, date: true, updatedAt: true, shift: { select: { heureDebut: true, heureFin: true, dureeHeures: true, systeme: true, tauxHoraireUSD: true } } },
    }),
    prisma.planningModele.findMany({ where: { employeeId: { in: employeeIds } }, select: { employeeId: true, jour: true, semaine: true, shiftId: true } }),
    prisma.attendance.findMany({ where: { employeeId: { in: employeeIds }, date: dansMois }, select: { employeeId: true, date: true, code: true, createdAt: true } }),
    prisma.overtimeEntry.findMany({ where: { employeeId: { in: employeeIds }, date: dansMois }, select: { employeeId: true, date: true, heuresTravaillees: true, createdAt: true, updatedAt: true } }),
    prisma.contrat.findMany({
      where: { employeeId: { in: employeeIds }, dateDebut: { lte: fin }, OR: [{ dateFin: null }, { dateFin: { gte: debut } }] },
      select: { employeeId: true, dateFin: true },
    }),
  ]);
  // `PlanningModele.shiftId` n'a pas de relation Prisma : on lit ses shifts à part.
  const shiftsModele = new Map(
    (await prisma.shift.findMany({
      where: { id: { in: [...new Set(modeles.map((m) => m.shiftId))] } },
      select: { id: true, heureDebut: true, heureFin: true, dureeHeures: true, systeme: true },
    })).map((s) => [s.id, s]),
  );

  const cle = (employeeId: string, d: Date) => `${employeeId}|${iso(d)}`;
  const creneauPar = new Map(creneaux.map((c) => [cle(c.employeeId, c.date), c]));
  const presencePar = new Map(presences.map((p) => [cle(p.employeeId, p.date), p]));
  const heuresPar = new Map(heures.map((h) => [cle(h.employeeId, h.date), h]));
  const modelesPar = new Map<string, typeof modeles>();
  for (const m of modeles) (modelesPar.get(m.employeeId) ?? modelesPar.set(m.employeeId, []).get(m.employeeId)!).push(m);
  const contratsPar = new Map<string, typeof contrats>();
  for (const c of contrats) (contratsPar.get(c.employeeId) ?? contratsPar.set(c.employeeId, []).get(c.employeeId)!).push(c);

  const nbJours = fin.getUTCDate();
  const sortie = new Map<string, JoursEmploye>();
  for (const employeeId of employeeIds) {
    const mods = modelesPar.get(employeeId) ?? [];
    const jours: JourReference[] = [];
    const saisie: JourSaisie[] = [];
    for (let n = 1; n <= nbJours; n++) {
      const date = new Date(Date.UTC(annee, mois - 1, n));
      const c = creneauPar.get(cle(employeeId, date));
      const p = presencePar.get(cle(employeeId, date));
      const h = heuresPar.get(cle(employeeId, date));
      const heuresPlanifiees = c ? heuresTravail(c.shift) : 0;
      const heuresFaites = h ? Number(h.heuresTravaillees) : 0;
      // Modèle du jour : couche de la parité (semaine A/B) puis couche 0 « chaque semaine » — même
      // ordre que le pré-remplissage des heures (presences/actions.ts).
      let heuresModele: number | null = null;
      if (mods.length > 0) {
        const jour = date.getUTCDay();
        const m = mods.find((x) => x.jour === jour && x.semaine === pariteSemaine(date)) ?? mods.find((x) => x.jour === jour && x.semaine === 0);
        const s = m ? shiftsModele.get(m.shiftId) : undefined;
        heuresModele = s ? heuresTravail(s) : 0;
      }
      jours.push({
        date,
        heuresPlanifiees,
        aUnCreneau: c != null,
        heuresModele,
        code: (p?.code ?? null) as CodePresence | null,
        heuresFaites,
        tauxRole: c?.shift.tauxHoraireUSD != null ? Number(c.shift.tauxHoraireUSD) : null,
      });
      saisie.push({
        date,
        code: p?.code ?? null,
        codeSaisiLe: p?.createdAt ?? null,
        heuresFaites,
        heuresSaisiesLe: h?.createdAt ?? null,
        heuresModifieesLe: h?.updatedAt ?? null,
        heuresPlanifiees,
        creneauModifieLe: c?.updatedAt ?? null,
      });
    }
    sortie.set(employeeId, { jours, saisie, dateFinContrat: finDeContrat(contratsPar.get(employeeId) ?? [], fin) });
  }
  return sortie;
}
