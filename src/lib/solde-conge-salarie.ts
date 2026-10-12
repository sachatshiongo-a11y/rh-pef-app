import "server-only";

import type { Prisma } from "@prisma/client";
import { chargerDroitsCongesAnnuel } from "@/lib/config";
import { ancienneteEnMois, congeDeductibleDuSolde } from "@/lib/payroll";
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
  /** DROITS DE L'ANNÉE : report de l'année précédente + acquis de l'année − jours perdus au
   *  plafond, soit solde + pris. C'est le « Droits » des écrans. */
  acquis: number;
  /** Acquis de l'année civile seule : 1,5 j par mois RÉVOLU d'ancienneté achevé dans l'année. */
  acquisAnnee: number;
  /** Reliquat de l'année précédente reporté (décision Direction 2026-10-12). Négatif = congé pris
   *  par anticipation l'an dernier, repris sur cette année. */
  report: number;
  /** Vrai si, cette année, une acquisition a été perdue parce que le solde atteignait le plafond. */
  plafonne: boolean;
  /** Jours acquis cette année et perdus au plafond (le solde ne dépasse jamais les droits annuels). */
  perdu: number;
  /** Jours pris DANS l'année civile (1er janvier → 31 décembre), des seuls types qui entament le
   *  solde, PLUS les « C » posés directement sur la grille sans demande approuvée (`cSansDemande`).
   *  Un congé à cheval sur deux années est réparti au prorata de ses jours ouvrables de chaque année. */
  pris: number;
  /** « C » de la grille (dans l'année civile, jours ouvrables) qu'aucune demande approuvée ne
   *  couvre : payés comme congé par la paie, donc décomptés — et signalés à l'écran. */
  cSansDemande: number;
  /** acquis (droits de l'année) − pris, au dixième ; jamais au-dessus des droits annuels. */
  solde: number;
  /** Noms des types actifs qui entament le solde — pour le dire au salarié. */
  typesDeduits: string[];
};

const auDixieme = (x: number) => Math.round(x * 10) / 10;
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

/**
 * LE SOLDE EN ANNÉE CIVILE — décisions de la Direction du 2026-10-12. PUR, testable tel quel.
 *
 * - Période de référence = l'ANNÉE CIVILE, pour les jours acquis COMME pour les jours pris (avant :
 *   acquis depuis l'embauche, pris depuis le 1er janvier — le solde remontait chaque 1er janvier).
 * - Acquisition : droits annuels / 12 à chaque mois RÉVOLU d'ancienneté (règle du 2026-07-07 : un
 *   mois entamé ne compte pas), crédités le jour où le mois s'achève.
 * - Le RELIQUAT d'une année est REPORTÉ sur la suivante, négatif compris (congé pris par
 *   anticipation, repris ensuite).
 * - PLAFOND (Sacha, 2026-10-12) : le SOLDE ne dépasse JAMAIS les droits annuels (18 j), à aucun
 *   instant. Une acquisition qui le ferait dépasser est perdue pour la part au-delà, le jour même.
 *   Un salarié qui prend ses 18 j reportés en janvier réacquiert ensuite 1,5 j par mois (13,5 j en
 *   octobre) : ce n'est PAS « report + acquis de l'année ≤ 18 ».
 * - Salarié sans congés (stage, intérim) : rien d'acquis, ce qui est pris se décompte quand même.
 *
 * Le compte se rejoue jour par jour depuis l'embauche : acquisitions jusqu'à aujourd'hui, jours pris
 * jusqu'au 31 décembre de l'année en cours (un congé approuvé à venir cette année est déjà déduit ;
 * celui d'une année suivante attend son année). Le même jour, l'acquisition passe avant le congé.
 */
export function calculerSoldeAnneeCivile(p: {
  dateEmbauche: Date;
  /** Jour civil de Kinshasa (date pure, minuit UTC). */
  aujourdhui: Date;
  droitsAnnuels: number;
  sansConges: boolean;
  /** Jours pris, jour par jour (voir `repartirCongeParJour`). */
  prisParJour: { date: Date; jours: number }[];
  /** « C » de la grille sans demande approuvée (voir `joursCSansDemande`) : un jour chacun. */
  cSansDemande?: Date[];
}): Omit<SoldeConge, "typesDeduits"> {
  const annee = p.aujourdhui.getUTCFullYear();
  const embauche = new Date(p.dateEmbauche);
  const parMois = p.droitsAnnuels / 12;
  const auCent = (x: number) => Math.round(x * 100) / 100;
  const debutAnnee = Date.UTC(annee, 0, 1);
  const finAnnee = Date.UTC(annee, 11, 31);
  const auj = p.aujourdhui.getTime();
  const pris = new Map<number, number>();
  const ajouter = (t: number, j: number) => { if (t <= finAnnee) pris.set(t, (pris.get(t) ?? 0) + j); };
  for (const x of p.prisParJour) ajouter(new Date(x.date).getTime(), x.jours);
  const cSans = (p.cSansDemande ?? []).filter((d) => new Date(d).getTime() <= finAnnee);
  for (const d of cSans) ajouter(new Date(d).getTime(), 1);

  const premier = Math.min(Date.UTC(embauche.getUTCFullYear(), embauche.getUTCMonth(), embauche.getUTCDate()), ...pris.keys(), debutAnnee);
  let solde = 0;
  let mois = 0;
  let report = 0;
  let acquisAnnee = 0;
  let perdu = 0;
  let prisAnnee = 0;
  for (let t = premier; t <= finAnnee; t += 86_400_000) {
    if (t === debutAnnee) report = auCent(solde);
    if (!p.sansConges && t <= auj) {
      const m = ancienneteEnMois(embauche, new Date(t));
      if (m > mois) {
        const gagne = (m - mois) * parMois;
        mois = m;
        const apres = Math.min(p.droitsAnnuels, solde + gagne);
        if (t >= debutAnnee) { acquisAnnee += gagne; perdu += solde + gagne - apres; }
        solde = auCent(apres);
      }
    }
    const j = pris.get(t);
    if (j) {
      solde = auCent(solde - j);
      if (t >= debutAnnee) prisAnnee += j;
    }
  }
  const prisR = auDixieme(prisAnnee);
  const soldeR = auDixieme(solde);
  return {
    annee,
    acquis: auDixieme(soldeR + prisR),
    acquisAnnee: auDixieme(acquisAnnee),
    report: auDixieme(report),
    plafonne: perdu > 0.001,
    perdu: auDixieme(perdu),
    pris: prisR,
    cSansDemande: cSans.filter((d) => new Date(d).getTime() >= debutAnnee).length,
    solde: soldeR,
  };
}

/**
 * Répartit un congé APPROUVÉ jour par jour sur ses jours ouvrables (lundi → samedi, hors fériés), à
 * parts égales ; le nombre de jours SAISI fait foi pour le total. Un congé sans aucun jour ouvrable
 * compte entièrement le jour de son début. PURE.
 */
export function repartirCongeParJour(
  c: { dateDebut: Date; dateFin: Date; nbJours: number },
  feriesIso: Set<string>,
): { date: Date; jours: number }[] {
  const debut = new Date(c.dateDebut);
  const fin = new Date(c.dateFin);
  const jours: Date[] = [];
  for (let t = debut.getTime(); t <= fin.getTime(); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && !feriesIso.has(iso(d))) jours.push(d);
  }
  if (jours.length === 0) return [{ date: debut, jours: c.nbJours }];
  return jours.map((date) => ({ date, jours: c.nbJours / jours.length }));
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
  return joursCSansDemande(joursC, demandesApprouvees, feriesIso).length;
}

/** Les mêmes jours, datés (le solde les déduit le jour où ils tombent). PURE. */
export function joursCSansDemande(
  joursC: Date[],
  demandesApprouvees: { dateDebut: Date; dateFin: Date }[],
  feriesIso: Set<string>,
): Date[] {
  return joursC.filter((j) => {
    const d = new Date(j);
    if (d.getUTCDay() === 0 || feriesIso.has(iso(d))) return false;
    return !demandesApprouvees.some((c) => d >= new Date(c.dateDebut) && d <= new Date(c.dateFin));
  });
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
    const prisParJour = demandes
      .filter((l) => congeDeductibleDuSolde(compteDansSolde.get(l.type)))
      .flatMap((l) => repartirCongeParJour({ dateDebut: l.dateDebut, dateFin: l.dateFin, nbJours: Number(l.nbJours) }, feriesIso));
    const r = calculerSoldeAnneeCivile({
      dateEmbauche: new Date(emp.dateEmbauche),
      aujourdhui,
      droitsAnnuels: droitsCongesAnnuel,
      sansConges: typeSansConges(emp.contrat),
      prisParJour,
      cSansDemande: joursCSansDemande(joursC.filter((a) => a.employeeId === emp.id).map((a) => a.date), demandes, feriesIso),
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
