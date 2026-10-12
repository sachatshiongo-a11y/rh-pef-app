import "server-only";

import type { Prisma } from "@prisma/client";
import { chargerDroitsCongesAnnuel } from "@/lib/config";
import { ancienneteEnMois, congeDeductibleDuSolde } from "@/lib/payroll";
import { compterJoursOuvrables } from "@/lib/jours-ouvrables";
import { typeSansConges } from "@/lib/regles-contrats";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

/**
 * LE SOLDE DE CONGÉ DE L'ESPACE SALARIÉ — UNE SEULE SOURCE (lot 6, 2026-09-28).
 *
 * Avant, l'Accueil et « Mes congés » le calculaient chacun de leur côté, et pas de la même façon :
 * - l'ancienneté : l'Accueil comptait les mois RÉVOLUS (`ancienneteEnMois`, règle de la paie),
 *   « Mes congés » comptait le mois entamé → un salarié embauché le 20 voyait, jusqu'au 19 du mois
 *   suivant, 1,5 jour de plus sur « Mes congés » que sur l'Accueil ;
 * - les types décomptés : « Mes congés » ne connaissait que les types ACTIFS → un congé approuvé
 *   d'un type retiré depuis cessait d'entamer le solde sur cet écran-là seulement ;
 * - les demandes lues : « Mes congés » partait des 60 dernières, l'Accueil de toutes.
 * Deux écrans, deux chiffres : le salarié ne pouvait pas savoir lequel croire. Les deux lisent
 * désormais ceci, qui applique la règle de l'Accueil (celle de la fiche RH et du PDF de demande).
 */
export type SoldeConge = {
  /** Année civile du solde (celle d'aujourd'hui à Kinshasa). */
  annee: number;
  /** DROITS DE L'ANNÉE : report de l'année précédente + acquis de l'année, plafonnés aux droits
   *  annuels (paramètre légal `droits_conges_annuel`, 18 j). C'est le « Acquis » des écrans. */
  acquis: number;
  /** Acquis de l'année civile seule : 1,5 j par mois RÉVOLU d'ancienneté achevé dans l'année. */
  acquisAnnee: number;
  /** Reliquat de l'année précédente reporté (décision Direction 2026-10-12). Négatif = congé pris
   *  par anticipation l'an dernier, repris sur cette année. */
  report: number;
  /** Vrai si report + acquis de l'année dépassaient le plafond : la part au-delà est perdue. */
  plafonne: boolean;
  /** Jours pris DANS l'année civile (1er janvier → 31 décembre), des seuls types qui entament le
   *  solde, PLUS les « C » posés directement sur la grille sans demande approuvée (`cSansDemande`).
   *  Un congé à cheval sur deux années est réparti au prorata de ses jours ouvrables de chaque année. */
  pris: number;
  /** « C » de la grille (dans l'année civile, jours ouvrables) qu'aucune demande approuvée ne
   *  couvre : payés comme congé par la paie, donc décomptés — et signalés à l'écran. */
  cSansDemande: number;
  /** acquis (droits de l'année) − pris, au dixième. */
  solde: number;
  /** Noms des types actifs qui entament le solde — pour le dire au salarié. */
  typesDeduits: string[];
};

const auDixieme = (x: number) => Math.round(x * 10) / 10;
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

/**
 * LE SOLDE EN ANNÉE CIVILE — décisions de la Direction du 2026-10-12 (1 et 2). PUR, testable tel quel.
 *
 * - Période de référence = l'ANNÉE CIVILE, pour les jours acquis COMME pour les jours pris (avant :
 *   acquis depuis l'embauche, pris depuis le 1er janvier — le solde remontait chaque 1er janvier).
 * - Acquis de l'année Y = droits annuels / 12 par mois RÉVOLU d'ancienneté achevé dans Y (règle du
 *   2026-07-07 inchangée : un mois entamé ne compte pas). Calculé par différence d'ancienneté
 *   cumulée, donc aucun mois n'est perdu ni compté deux fois au passage d'une année à l'autre.
 * - Le RELIQUAT d'une année est REPORTÉ sur la suivante. Plafond : report + acquis de l'année ≤
 *   droits annuels (18 j) — on ne dispose jamais de plus de 18 jours de droits sur une année.
 *   Un reliquat négatif (congé pris par anticipation) est reporté lui aussi : il se reprend.
 * - Salarié sans congés (stage, intérim) : rien d'acquis, ce qui est pris se décompte quand même.
 *
 * `prisParAnnee` et `cSansDemandeParAnnee` : jours déjà répartis par année civile (voir
 * `repartirCongeParAnnee`, `compterCSansDemande`). Les années postérieures à aujourd'hui sont ignorées.
 */
export function calculerSoldeAnneeCivile(p: {
  dateEmbauche: Date;
  /** Jour civil de Kinshasa (date pure, minuit UTC). */
  aujourdhui: Date;
  droitsAnnuels: number;
  sansConges: boolean;
  prisParAnnee: Map<number, number>;
  cSansDemandeParAnnee?: Map<number, number>;
}): Omit<SoldeConge, "typesDeduits"> {
  const annee = p.aujourdhui.getUTCFullYear();
  const embauche = new Date(p.dateEmbauche);
  const parMois = p.droitsAnnuels / 12;
  const cumul = (d: Date) => (p.sansConges ? 0 : ancienneteEnMois(embauche, d));
  const prisDe = (y: number) => (p.prisParAnnee.get(y) ?? 0) + (p.cSansDemandeParAnnee?.get(y) ?? 0);
  let report = 0;
  let resultat: Omit<SoldeConge, "typesDeduits"> | null = null;
  // De l'année d'embauche à l'année en cours (embauche future : la boucle ne tourne que sur l'année).
  for (let y = Math.min(embauche.getUTCFullYear(), annee); y <= annee; y++) {
    const debut = new Date(Date.UTC(y, 0, 1));
    const finAnnee = new Date(Date.UTC(y + 1, 0, 1));
    const fin = y === annee ? p.aujourdhui : finAnnee;
    const acquisAnnee = auDixieme(parMois * Math.max(0, cumul(fin) - cumul(debut)));
    const brut = auDixieme(report + acquisAnnee);
    const droits = Math.min(p.droitsAnnuels, brut);
    const pris = auDixieme(prisDe(y));
    if (y === annee) {
      resultat = {
        annee,
        acquis: droits,
        acquisAnnee,
        report,
        plafonne: brut > p.droitsAnnuels,
        pris,
        cSansDemande: p.cSansDemandeParAnnee?.get(y) ?? 0,
        solde: auDixieme(droits - pris),
      };
    }
    report = auDixieme(droits - pris);
  }
  return resultat!;
}

/**
 * Répartit un congé APPROUVÉ entre les années civiles qu'il couvre, au prorata de ses jours
 * ouvrables (lundi → samedi, hors fériés) dans chacune. Le nombre de jours SAISI fait foi pour le
 * total ; la dernière année reçoit l'arrondi (au dixième). Un congé sans aucun jour ouvrable
 * compte entièrement dans l'année de son début. PURE.
 */
export function repartirCongeParAnnee(
  c: { dateDebut: Date; dateFin: Date; nbJours: number },
  feriesIso: Set<string>,
): Map<number, number> {
  const debut = new Date(c.dateDebut);
  const fin = new Date(c.dateFin);
  const parts = new Map<number, number>();
  const a0 = debut.getUTCFullYear();
  const a1 = Math.max(a0, fin.getUTCFullYear());
  if (a0 === a1) return parts.set(a0, c.nbJours);
  const ouvrables = new Map<number, number>();
  for (let y = a0; y <= a1; y++) {
    const de = y === a0 ? debut : new Date(Date.UTC(y, 0, 1));
    const a = y === a1 ? fin : new Date(Date.UTC(y, 11, 31));
    ouvrables.set(y, compterJoursOuvrables(de, a, feriesIso));
  }
  const total = [...ouvrables.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return parts.set(a0, c.nbJours);
  let reste = c.nbJours;
  for (let y = a0; y <= a1; y++) {
    const part = y === a1 ? auDixieme(reste) : auDixieme((c.nbJours * ouvrables.get(y)!) / total);
    parts.set(y, part);
    reste -= part;
  }
  return parts;
}

/**
 * « C » POSÉS SANS DEMANDE (audit RH 2026-10-10) : la régularisation d'un congé directement dans la
 * grille Présences est courante en cuisine ; la paie le paie comme congé (code C), le solde doit donc
 * le décompter. Un jour compte s'il porte C, n'est ni dimanche ni férié (jamais décomptés), et
 * qu'AUCUNE demande approuvée (de n'importe quel type) ne le couvre — un C posé par une demande
 * approuvée est déjà décompté par elle (ou exclu du solde par son type) : jamais deux fois. PURE.
 */
export function compterCSansDemande(
  joursC: Date[],
  demandesApprouvees: { dateDebut: Date; dateFin: Date }[],
  feriesIso: Set<string>,
): number {
  const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
  return joursC.filter((j) => {
    const d = new Date(j);
    if (d.getUTCDay() === 0 || feriesIso.has(iso(d))) return false;
    return !demandesApprouvees.some((c) => d >= new Date(c.dateDebut) && d <= new Date(c.dateFin));
  }).length;
}

/**
 * Les soldes de PLUSIEURS salariés, en lot : 7 requêtes quel que soit leur nombre (salariés,
 * droits annuels de l'exercice actif, types, demandes approuvées, « C » de la grille, fériés).
 * Même règle, ligne à ligne, que pour un seul.
 *
 * Année civile (décisions Direction du 2026-10-12) : le report d'une année sur l'autre oblige à lire
 * l'HISTORIQUE depuis l'embauche — toutes les demandes approuvées et tous les « C » de la grille
 * jusqu'au 31 décembre de l'année en cours (les années suivantes ne comptent pas encore).
 *
 * `entameLeSolde` est la règle de décompte (case « compte dans le solde » du type, types retirés
 * compris) : un écran qui compte des jours pris sur une AUTRE période — le calendrier sur l'année
 * affichée — l'emprunte ici plutôt que de la réécrire.
 */
export async function chargerSoldesCongeSalaries(
  db: Prisma.TransactionClient,
  employeeIds: string[],
  maintenant: Date = new Date(),
): Promise<{ soldes: Map<string, SoldeConge>; entameLeSolde: (type: string) => boolean }> {
  // « Maintenant » se lit à Kinshasa : le 1er du mois (ou de l'an) entre 00 h et 01 h, le mois révolu
  // (1,5 j de plus) et l'année des congés avaient encore un jour de retard avec l'horloge UTC.
  const aujourdhui = jourCivilKinshasa(maintenant);
  const finAnnee = new Date(Date.UTC(aujourdhui.getUTCFullYear(), 11, 31));
  const [emps, droitsCongesAnnuel, types, approuvees, joursC, feries] = await Promise.all([
    db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, contrat: true, dateEmbauche: true } }),
    // Les SEULS droits annuels, pas toute la paie : une clé CNSS absente ou un barème IPR vide ne
    // doit ni vider un écran de congé ni bloquer une approbation (2026-09-29).
    chargerDroitsCongesAnnuel(db),
    // TOUS les types (actifs ou non) : un congé approuvé garde son effet si le type est retiré ensuite.
    db.typeConge.findMany({ orderBy: { ordre: "asc" }, select: { nom: true, compteDansSolde: true, actif: true } }),
    // Toutes les demandes approuvées jusqu'à la fin de l'année : celles qui entament le solde sont
    // décomptées, TOUTES (quel que soit leur type) couvrent les « C » de la grille.
    db.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, statut: "APPROUVE", dateDebut: { lte: finAnnee } },
      select: { employeeId: true, type: true, nbJours: true, dateDebut: true, dateFin: true },
    }),
    db.attendance.findMany({
      where: { employeeId: { in: employeeIds }, code: "C", date: { lte: finAnnee } },
      select: { employeeId: true, date: true },
    }),
    db.jourFerie.findMany({ where: { date: { lte: finAnnee } }, select: { date: true } }),
  ]);
  const feriesIso = new Set(feries.map((f) => iso(f.date)));
  const compteDansSolde = new Map(types.map((t) => [t.nom, t.compteDansSolde]));
  const typesDeduits = types.filter((t) => t.actif && t.compteDansSolde).map((t) => t.nom);
  const soldes = new Map<string, SoldeConge>();
  for (const emp of emps) {
    const demandes = approuvees.filter((l) => l.employeeId === emp.id);
    const prisParAnnee = new Map<number, number>();
    for (const l of demandes) {
      if (!congeDeductibleDuSolde(compteDansSolde.get(l.type))) continue;
      for (const [y, j] of repartirCongeParAnnee({ dateDebut: l.dateDebut, dateFin: l.dateFin, nbJours: Number(l.nbJours) }, feriesIso)) {
        prisParAnnee.set(y, (prisParAnnee.get(y) ?? 0) + j);
      }
    }
    const cParAnnee = new Map<number, Date[]>();
    for (const a of joursC) {
      if (a.employeeId !== emp.id) continue;
      const y = new Date(a.date).getUTCFullYear();
      (cParAnnee.get(y) ?? cParAnnee.set(y, []).get(y)!).push(a.date);
    }
    const cSansDemandeParAnnee = new Map<number, number>();
    for (const [y, dates] of cParAnnee) cSansDemandeParAnnee.set(y, compterCSansDemande(dates, demandes, feriesIso));
    const r = calculerSoldeAnneeCivile({
      dateEmbauche: new Date(emp.dateEmbauche),
      aujourdhui,
      droitsAnnuels: droitsCongesAnnuel,
      sansConges: typeSansConges(emp.contrat),
      prisParAnnee,
      cSansDemandeParAnnee,
    });
    soldes.set(emp.id, { ...r, typesDeduits });
  }
  return { soldes, entameLeSolde: (type) => congeDeductibleDuSolde(compteDansSolde.get(type)) };
}

export async function chargerSoldeCongeSalarie(
  db: Prisma.TransactionClient,
  employeeId: string,
  maintenant: Date = new Date(),
): Promise<SoldeConge> {
  const { soldes } = await chargerSoldesCongeSalaries(db, [employeeId], maintenant);
  const solde = soldes.get(employeeId);
  if (!solde) throw new Error(`Salarié introuvable : ${employeeId}`);
  return solde;
}
