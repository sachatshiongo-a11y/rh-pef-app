// ABSENCES DU MOIS d'un salarié payé au MOIS (back-office, stagiaire) et MALADIE de tout le personnel —
// décisions de la Direction du 2026-10-12. Module PUR (ni base, ni `server-only`) : le lot de paie
// (paie-batch.ts) et l'aperçu de la fiche (bulletin-live.ts) l'appellent tous deux, jamais une copie.
//
// Règles :
//  - back-office et stagiaires : chaque jour d'absence injustifiée (N) ou de congé sans solde (S, ou
//    jour couvert par un congé sans solde approuvé) est retenu à 1/26e du salaire mensuel
//    (`joursOuvrablesMois` des paramètres légaux) ;
//  - entrée ou sortie en cours de mois : salaire × jours OUVRABLES (lundi → samedi, hors fériés)
//    travaillables entre la date d'embauche / de fin de contrat et les bornes du mois, / 26 (même base
//    que la retenue d'absence, Sacha 2026-10-12), jamais plus que le salaire. Une période qui couvre
//    TOUS les jours ouvrables du mois (embauche le 2 quand le 1er est un dimanche) n'est pas un prorata ;
//  - maladie, TOUT le personnel : jour M justifié au préalable (certificat) payé 100 %, sinon 2/3.
//    Pour un salaire au mois, le tiers non payé d'un jour M non justifié est retenu (1/26e × 1/3).
// Seuls comptent les jours ouvrables de la période travaillable : un N posé un dimanche, un férié,
// ou après la sortie ne retient rien (il ne serait de toute façon pas payé deux fois).
import type { CodePresence } from "@/lib/payroll";

const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

export type JourAbsence = { date: Date; code: CodePresence | null; maladieJustifiee?: boolean };

export type AbsencesMois = {
  /** Jours N ou S (ou couverts par un congé sans solde approuvé) retenus à 1/26e. */
  joursAbsenceRetenus: number;
  joursMaladieJustifies: number;
  joursMaladieNonJustifies: number;
  /** Mois incomplet (entrée/sortie) : jours ouvrables travaillables / jours ouvrables du mois ; null = mois entier. */
  prorata: { joursTravailles: number; joursMois: number } | null;
  /** Dates des jours retenus, pour l'écran (« le 03/10, le 07/10 »). */
  datesAbsence: string[];
  datesMaladieNonJustifiee: string[];
};

export function absencesDuMois(e: {
  mois: number;
  annee: number;
  jours: JourAbsence[];
  /** Dates "AAAA-MM-JJ" couvertes par un congé sans solde approuvé (plage élargie : filtrée au mois). */
  joursCongeSansSolde: string[];
  joursFeries: Set<string>;
  dateEmbauche: Date;
  /** Fin du contrat DANS le mois (date pure), `null` sinon (`chargerJoursMois`). */
  dateFinContrat: Date | null;
}): AbsencesMois {
  const debutMois = Date.UTC(e.annee, e.mois - 1, 1);
  const finMois = Date.UTC(e.annee, e.mois, 0);
  const embauche = new Date(e.dateEmbauche).getTime();
  const debut = Math.max(debutMois, embauche);
  const fin = e.dateFinContrat && e.dateFinContrat.getTime() < finMois ? e.dateFinContrat.getTime() : finMois;
  const ouvrable = (t: number) => new Date(t).getUTCDay() !== 0 && !e.joursFeries.has(iso(new Date(t)));
  const compterOuvrables = (de: number, a: number) => {
    let n = 0;
    for (let t = de; t <= a; t += 86_400_000) if (ouvrable(t)) n++;
    return n;
  };
  const joursMois = compterOuvrables(debutMois, finMois);
  const joursTravailles = compterOuvrables(debut, fin);
  const incomplet = (debut > debutMois || fin < finMois) && joursTravailles < joursMois;
  const prorata = incomplet ? { joursTravailles, joursMois } : null;

  const sansSolde = new Set(e.joursCongeSansSolde);
  const absence: string[] = [];
  const maladieNon: string[] = [];
  let maladieOui = 0;
  for (const j of e.jours) {
    const t = new Date(j.date).getTime();
    if (t < debut || t > fin || !ouvrable(t)) continue;
    const jour = iso(j.date);
    if (j.code === "N" || j.code === "S" || sansSolde.has(jour)) absence.push(jour);
    else if (j.code === "M") {
      if (j.maladieJustifiee) maladieOui++;
      else maladieNon.push(jour);
    }
  }
  return {
    joursAbsenceRetenus: absence.length,
    joursMaladieJustifies: maladieOui,
    joursMaladieNonJustifies: maladieNon.length,
    prorata,
    datesAbsence: absence.sort(),
    datesMaladieNonJustifiee: maladieNon.sort(),
  };
}

/** Jours M d'un salarié de la BRIGADE (tout jour M sans heures faites), séparés justifiés / non. */
export function maladieBrigade(jours: (JourAbsence & { heuresFaites: number })[]): { justifies: number; nonJustifies: number } {
  const m = jours.filter((j) => j.code === "M" && !(j.heuresFaites > 0));
  const justifies = m.filter((j) => j.maladieJustifiee).length;
  return { justifies, nonJustifies: m.length - justifies };
}
