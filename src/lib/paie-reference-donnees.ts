import "server-only";

// Assemble, depuis la base, les JOURS du mois dont la paie a besoin (spec 2026-09-23 §5) :
// `JourReference` pour `calculerReferenceMois` (paie-reference.ts) et `JourSaisie` pour
// `detecterAvertissementsSaisie` (paie-avertissements.ts), plus la fin du contrat qui couvre le
// mois (`dateFinContrat`, ou `cddEchuLe` si elle est suivie de travail), les jours de congé sans
// solde approuvé (`joursCongeSansSolde`), et, pour les semaines À CHEVAL sur deux mois, les jours hors
// du mois (`joursHorsMois`) et les fériés de toute la plage (`joursFeries`). Appelé par paie-batch.ts ET bulletin-live.ts : un seul assemblage,
// sinon la fiche et la paie divergent. Une seule lecture par table pour tout l'effectif.
import { prisma } from "@/lib/prisma";
import { dureeShift } from "@/lib/duree-shift";
import { lundiDe, pariteSemaine } from "@/lib/dates-fr";
import type { CodePresence } from "@/lib/payroll";
import type { JourReference } from "@/lib/paie-reference";
import type { JourSaisie } from "@/lib/paie-avertissements";

export type JoursEmploye = {
  jours: JourReference[];
  /** Jours des semaines à cheval qui tombent HORS du mois (lundi de la première semaine → veille du
   *  1er ; lendemain du dernier jour → dimanche de la dernière semaine), même forme que `jours`. À
   *  passer tel quel à `calculerReferenceMois` (`joursHorsMois`) : plafond de la semaine entière. */
  joursHorsMois: JourReference[];
  /** Fériés "AAAA-MM-JJ" de la plage ÉLARGIE (lundi de la première semaine → dimanche de la
   *  dernière), le même objet pour tous les salariés. À passer à `calculerReferenceMois`
   *  (`joursFeries`) À LA PLACE des fériés du seul mois : un férié hors du mois compte dans le
   *  plafond de la semaine. Pour `calculerHeuresSupp` et l'ancienne règle, les dates hors du mois
   *  sont sans effet (ils ne lisent que les jours qu'on leur donne). */
  joursFeries: Set<string>;
  saisie: JourSaisie[];
  /** Fin du contrat qui couvre le mois, date PURE (minuit UTC) ; `null` pour un CDI, une fin
   *  postérieure au mois, ou sans contrat enregistré. À passer tel quel à `calculerReferenceMois`
   *  (`dateFinContrat`) : sans elle, le mois de fin d'un CDD n'est jamais replié sur le contrat. */
  dateFinContrat: Date | null;
  /** Fin de contrat IGNORÉE (date PURE) : un CDD échu dans le mois mais suivi, APRÈS sa fin et dans
   *  le mois, d'un créneau de travail, d'une présence P ou d'heures faites. Décision du contrôleur
   *  (2026-09-23, cas Myriam Bumbakini, CDD fini le 01/09 et 25 créneaux ensuite) : un CDD poursuivi
   *  au-delà de son terme vaut CDI de fait, le salarié fait son planning et touche son net. Dans ce
   *  cas `dateFinContrat` vaut `null` ; l'avertissement vient de `avertissementCddEchu`. */
  cddEchuLe: Date | null;
  /** Dates pures "AAAA-MM-JJ" de la plage ÉLARGIE (celle de `joursFeries`) couvertes par un congé
   *  APPROUVÉ de type non payé (tauxPct 0), tous jours civils compris (dimanches, fériés). À passer tel
   *  quel à `calculerReferenceMois` : la liste fait foi pour tous ses jours. */
  joursCongeSansSolde: string[];
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
 * même sans aucune donnée (un salarié sans rien reçoit des jours vides) — plus les jours hors du mois
 * des semaines à cheval. Créneaux, présences, heures, congés et fériés sont lus dans les MÊMES
 * requêtes, bornées du lundi de la première semaine au dimanche de la dernière.
 */
export async function chargerJoursMois(mois: number, annee: number, employeeIds: string[]): Promise<Map<string, JoursEmploye>> {
  const debut = new Date(Date.UTC(annee, mois - 1, 1));
  const fin = new Date(Date.UTC(annee, mois, 0));
  // Plage ÉLARGIE aux semaines civiles entières (lun → dim) : le plafond hebdomadaire se calcule sur
  // la semaine entière, partagée entre les deux mois (paie-reference.ts).
  const debutPlage = lundiDe(debut);
  const finPlage = new Date(lundiDe(fin).getTime() + 6 * 86_400_000);
  const dansPlage = { gte: debutPlage, lte: finPlage };
  const [creneaux, modeles, presences, heures, contrats, conges, typesConge, feries] = await Promise.all([
    prisma.planningCreneau.findMany({
      where: { employeeId: { in: employeeIds }, date: dansPlage },
      select: { employeeId: true, date: true, updatedAt: true, shift: { select: { heureDebut: true, heureFin: true, dureeHeures: true, systeme: true, tauxHoraireUSD: true } } },
    }),
    prisma.planningModele.findMany({ where: { employeeId: { in: employeeIds } }, select: { employeeId: true, jour: true, semaine: true, shiftId: true } }),
    prisma.attendance.findMany({ where: { employeeId: { in: employeeIds }, date: dansPlage }, select: { employeeId: true, date: true, code: true, createdAt: true } }),
    prisma.overtimeEntry.findMany({ where: { employeeId: { in: employeeIds }, date: dansPlage }, select: { employeeId: true, date: true, heuresTravaillees: true, createdAt: true, updatedAt: true } }),
    prisma.contrat.findMany({
      where: { employeeId: { in: employeeIds }, dateDebut: { lte: fin }, OR: [{ dateFin: null }, { dateFin: { gte: debut } }] },
      select: { employeeId: true, dateFin: true },
    }),
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, statut: "APPROUVE", dateDebut: { lte: finPlage }, dateFin: { gte: debutPlage } },
      select: { employeeId: true, type: true, dateDebut: true, dateFin: true },
    }),
    // Lien congé → type par le NOM (pas de clé étrangère), comme `poserCodesConge`.
    prisma.typeConge.findMany({ select: { nom: true, tauxPct: true } }),
    prisma.jourFerie.findMany({ where: { date: dansPlage }, select: { date: true } }),
  ]);
  const joursFeries = new Set(feries.map((f) => iso(f.date)));
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

  // Congé SANS SOLDE = type à `tauxPct === 0` EXACTEMENT (même règle que le code S de
  // `poserCodesConge`). Un type à `tauxPct` null (« Autre », À VALIDER) ou introuvable ne compte PAS :
  // un férié payé à tort se voit sur le bulletin et se corrige, un férié retenu à tort est une
  // retenue silencieuse. Tous les jours civils du congé dans le mois, fériés et dimanches compris :
  // la liste fait foi pour tous ses jours dans `calculerReferenceMois`.
  const tauxParType = new Map(typesConge.map((t) => [t.nom, t.tauxPct]));
  const sansSoldePar = new Map<string, Set<string>>();
  for (const l of conges) {
    if (tauxParType.get(l.type) !== 0) continue;
    const jours = sansSoldePar.get(l.employeeId) ?? sansSoldePar.set(l.employeeId, new Set()).get(l.employeeId)!;
    const de = Math.max(datePure(l.dateDebut).getTime(), debutPlage.getTime());
    const a = Math.min(datePure(l.dateFin).getTime(), finPlage.getTime());
    for (let t = de; t <= a; t += 86_400_000) jours.add(iso(new Date(t)));
  }

  /** Un jour pour un salarié : `JourReference` + les données brutes qui servent à la saisie. */
  const lireJour = (employeeId: string, mods: typeof modeles, date: Date) => {
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
    const ref: JourReference = {
      date,
      heuresPlanifiees,
      aUnCreneau: c != null,
      heuresModele,
      code: (p?.code ?? null) as CodePresence | null,
      heuresFaites,
      tauxRole: c?.shift.tauxHoraireUSD != null ? Number(c.shift.tauxHoraireUSD) : null,
    };
    return { ref, c, p, h };
  };

  const sortie = new Map<string, JoursEmploye>();
  for (const employeeId of employeeIds) {
    const mods = modelesPar.get(employeeId) ?? [];
    const jours: JourReference[] = [];
    const joursHorsMois: JourReference[] = [];
    const saisie: JourSaisie[] = [];
    const joursTravailles: Date[] = []; // créneau de TRAVAIL (non système), présence P ou heures faites
    for (let t = debutPlage.getTime(); t <= finPlage.getTime(); t += 86_400_000) {
      const date = new Date(t);
      const { ref, c, p, h } = lireJour(employeeId, mods, date);
      if (t < debut.getTime() || t > fin.getTime()) { joursHorsMois.push(ref); continue; }
      if ((c != null && !c.shift.systeme) || p?.code === "P" || ref.heuresFaites > 0) joursTravailles.push(date);
      jours.push(ref);
      saisie.push({
        date,
        code: p?.code ?? null,
        codeSaisiLe: p?.createdAt ?? null,
        heuresFaites: ref.heuresFaites,
        heuresSaisiesLe: h?.createdAt ?? null,
        heuresModifieesLe: h?.updatedAt ?? null,
        heuresPlanifiees: ref.heuresPlanifiees,
        creneauModifieLe: c?.updatedAt ?? null,
      });
    }
    // Fin de contrat suivie de travail dans le mois : ignorée (CDD poursuivi = CDI de fait), signalée.
    const finContrat = finDeContrat(contratsPar.get(employeeId) ?? [], fin);
    const poursuivi = finContrat != null && joursTravailles.some((j) => j.getTime() > finContrat.getTime());
    sortie.set(employeeId, {
      jours,
      joursHorsMois,
      joursFeries,
      saisie,
      dateFinContrat: poursuivi ? null : finContrat,
      cddEchuLe: poursuivi ? finContrat : null,
      joursCongeSansSolde: [...(sansSoldePar.get(employeeId) ?? [])].sort(),
    });
  }
  return sortie;
}
