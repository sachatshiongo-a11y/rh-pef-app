// Prêts au personnel — logique de retenue mensuelle. Fonction PURE (aucune I/O, uniquement des
// nombres en entrée/sortie), même convention que src/lib/payroll.ts.

export type RetenuePretLigne = { mois: number; annee: number; montantUSD: number };

export type EcheancePret = {
  /** Montant à retenir CE mois (0 si le prêt était déjà soldé avant ce mois). */
  echeanceUSD: number;
  /** Solde restant dû AVANT la retenue de ce mois (exclut la retenue déjà enregistrée pour ce
   *  mois précis, afin qu'un recalcul du même mois reste idempotent). */
  soldeAvantUSD: number;
};

/**
 * Échéance de prêt du mois : min(retenue mensuelle contractuelle, solde restant dû avant ce mois).
 * Extrait de 3 implémentations dupliquées (paie-batch.ts, bulletin-live.ts, paie/actions.ts) —
 * REFACTOR PUR, résultat numérique strictement identique à l'ancien code dans les 3 endroits.
 */
export function calculerEcheancePret(
  montantUSD: number,
  retenueMensuelleUSD: number,
  retenues: RetenuePretLigne[],
  mois: number,
  annee: number
): EcheancePret {
  const dejaRembourseHorsMois = retenues
    .filter((r) => !(r.mois === mois && r.annee === annee))
    .reduce((s, r) => s + r.montantUSD, 0);
  const soldeAvantUSD = montantUSD - dejaRembourseHorsMois;
  const echeanceUSD = soldeAvantUSD > 0 ? Math.min(retenueMensuelleUSD, soldeAvantUSD) : 0;
  return { echeanceUSD, soldeAvantUSD };
}

// ─────────────────────────────────────────────────────────────────────────────
// Échéancier — une PROJECTION, jamais une décision.
//
// `calculerEcheancePret` ci-dessus reste SEUL à décider de ce qui est retenu chaque mois. Ce qui
// suit ne fait que dérouler la même règle vers l'avant pour l'afficher : durée, tableau
// d'amortissement, mois de solde annoncé. Rien n'est écrit en base depuis ici et aucune paie ne
// consulte ces fonctions — c'est ce qui rend l'ajout sans risque sur les prêts déjà en cours.
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const cle = (mois: number, annee: number) => annee * 12 + mois;
const moisSuivant = (mois: number, annee: number) =>
  mois === 12 ? { mois: 1, annee: annee + 1 } : { mois: mois + 1, annee };

export type LigneEcheancier = {
  rang: number; // 1, 2, 3… dans l'ordre chronologique
  mois: number;
  annee: number;
  montantUSD: number;
  soldeApresUSD: number;
  /** true = retenue réellement enregistrée sur une paie ; false = prévision. */
  reglee: boolean;
};

export type Echeancier = {
  echeances: LigneEcheancier[];
  rembourseUSD: number;
  soldeUSD: number;
  /** Nombre total d'échéances, réglées + prévues — la « durée » du prêt. */
  dureeMois: number;
  /** Mois de la DERNIÈRE échéance : quand le prêt est (ou sera) soldé. null s'il n'y a rien. */
  moisSolde: { mois: number; annee: number } | null;
  /** true si cette dernière échéance est encore une prévision. */
  soldePrevisionnel: boolean;
};

/** Garde-fou : une retenue absurde ne doit pas produire une boucle sans fin (50 ans d'échéances). */
const MAX_ECHEANCES_PROJETEES = 600;

/**
 * Déroule l'échéancier d'un prêt : d'abord les retenues DÉJÀ appliquées (des faits), puis la
 * projection des suivantes selon la règle du moteur — min(retenue mensuelle, solde restant).
 *
 * La projection démarre à la période de paie EN COURS, ou au mois suivant la dernière retenue si
 * celle-ci est déjà à la période courante (paie du mois déjà calculée). Un trou dans les retenues
 * n'est jamais « rattrapé » : on projette à partir de maintenant, pas du mois manqué — c'est ce
 * que la paie fera réellement.
 *
 * `actif` à false (prêt annulé ou soldé) : on montre l'historique, sans aucune prévision.
 */
export function construireEcheancier(entrees: {
  montantUSD: number;
  retenueMensuelleUSD: number;
  retenues: RetenuePretLigne[];
  periodeCourante: { mois: number; annee: number };
  actif: boolean;
}): Echeancier {
  const { montantUSD, retenueMensuelleUSD, periodeCourante, actif } = entrees;

  const passees = [...entrees.retenues].sort((a, b) => cle(a.mois, a.annee) - cle(b.mois, b.annee));

  const echeances: LigneEcheancier[] = [];
  let restant = montantUSD;
  let rang = 0;

  for (const r of passees) {
    restant = round2(restant - r.montantUSD);
    echeances.push({
      rang: ++rang,
      mois: r.mois,
      annee: r.annee,
      montantUSD: r.montantUSD,
      soldeApresUSD: Math.max(0, restant),
      reglee: true,
    });
  }

  const rembourseUSD = round2(passees.reduce((s, r) => s + r.montantUSD, 0));
  const soldeUSD = Math.max(0, round2(montantUSD - rembourseUSD));

  // Projection — seulement si le prêt court encore ET que la retenue peut réellement l'amortir.
  if (actif && soldeUSD > 0 && retenueMensuelleUSD > 0) {
    const derniere = passees.at(-1);
    let curseur =
      derniere && cle(derniere.mois, derniere.annee) >= cle(periodeCourante.mois, periodeCourante.annee)
        ? moisSuivant(derniere.mois, derniere.annee)
        : periodeCourante;

    let projete = soldeUSD;
    let gardeFou = 0;
    while (projete > 0 && gardeFou++ < MAX_ECHEANCES_PROJETEES) {
      const montant = round2(Math.min(retenueMensuelleUSD, projete));
      projete = round2(projete - montant);
      echeances.push({
        rang: ++rang,
        mois: curseur.mois,
        annee: curseur.annee,
        montantUSD: montant,
        soldeApresUSD: Math.max(0, projete),
        reglee: false,
      });
      curseur = moisSuivant(curseur.mois, curseur.annee);
    }
  }

  const derniereLigne = echeances.at(-1);
  return {
    echeances,
    rembourseUSD,
    soldeUSD,
    dureeMois: echeances.length,
    moisSolde: derniereLigne ? { mois: derniereLigne.mois, annee: derniereLigne.annee } : null,
    soldePrevisionnel: derniereLigne ? !derniereLigne.reglee : false,
  };
}

/**
 * Retenue mensuelle correspondant à une durée voulue — assistance à la SAISIE uniquement
 * (« 300 $ sur 6 mois » → 50 $/mois). Le montant obtenu reste modifiable : c'est lui qui est
 * enregistré et qui pilote la paie, jamais la durée, qui n'est pas stockée.
 */
export function retenuePourDuree(montantUSD: number, dureeMois: number): number {
  if (!Number.isFinite(montantUSD) || montantUSD <= 0) return 0;
  if (!Number.isFinite(dureeMois) || dureeMois <= 0) return 0;
  // Arrondi SUPÉRIEUR au centime : à 300 $ sur 7 mois, 42,85 $ laisserait traîner une 8ᵉ échéance
  // de 0,05 $. On préfère 42,86 $ et une dernière échéance plus courte, plafonnée par le moteur.
  return Math.ceil((montantUSD / dureeMois) * 100) / 100;
}
