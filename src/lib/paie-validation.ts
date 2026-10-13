import "server-only";

// Valider une ligne de paie REVÉRIFIE son montant (revue finale du 2026-09-24, point 1). Depuis que
// la paie de la brigade suit les heures PLANIFIÉES, le planning est une pièce de paie : une ligne
// calculée au chargement de /paie peut ne plus correspondre au planning quand on clique « Valider »
// (créneau ajouté entre-temps, heures saisies, écran « À valider » resté ouvert). Figer ce qui est en
// base validerait alors un montant faux sans que rien ne le signale.
//
// Dans la transaction qui valide, avant toute écriture :
//   1. verrou de la PayrollRun du mois (FOR SHARE, FOR UPDATE pour la clôture qui la modifie), puis
//      des lignes (FOR UPDATE) — même ordre que l'écriture du planning (run, puis lignes) et que le
//      recalcul (paie-refresh.ts) : une écriture du planning en cours fait attendre la validation, et
//      inversement ;
//   2. recalcul par le VRAI calcul (`calculerLignesPaie`), UNE fois par mois concerné, jamais une fois
//      par ligne, dans la transaction ;
//   3. comparaison au centime près avec la ligne enregistrée. Un seul écart refuse TOUTE la
//      transaction avec un message lisible. La ligne n'est jamais réécrite en silence : l'outil
//      signale, la Direction recharge et relit avant de valider.
import { Prisma } from "@prisma/client";
import { calculerLignesPaie, type DonneesLignePaie } from "@/lib/paie-batch";
import { estAttenteVerrouTropLongue, estInterblocage } from "@/lib/planning-ecriture";
import { ecartJeton, jetonDeLigneLue, SELECTION_JETON } from "@/lib/paie-jeton";
import { netNonValidable, usdSigne } from "@/lib/paie-avertissements-mois";
import { ErreurMetier } from "@/lib/erreur-metier";

/**
 * Compare les jetons FOURNIS aux lignes lues : null si tout concorde ; sinon « TAUX » quand seul le
 * taux de change diffère (mêmes dollars, autres francs), « MONTANTS » dès qu'un montant diffère.
 */
function verifierJetons(
  lignes: { id: string; salNetUSD: unknown; salBrutUSD: unknown; netImposableUSD: unknown; tauxChangeFige?: unknown; payrollRun: { tauxChangeUtilise: unknown } }[],
  jetons: Record<string, string | undefined> | undefined,
): "TAUX" | "MONTANTS" | null {
  let taux = false;
  for (const l of lignes) {
    const affiche = jetons?.[l.id];
    if (affiche === undefined) continue;
    const e = ecartJeton(affiche, jetonDeLigneLue(l));
    if (e === "MONTANTS") return "MONTANTS";
    if (e === "TAUX") taux = true;
  }
  return taux ? "TAUX" : null;
}

/** Délai des transactions de validation (une ligne, un lot, la clôture) : recalcul du mois compris. */
export const DELAI_VALIDATION_PAIE = 120_000;

/** Attente maximale d'un verrou (ligne ou run tenus par une écriture du planning ou un recalcul) :
 *  au-delà, Postgres abandonne (55P03) et l'écran affiche `MESSAGE_VALIDATION_OCCUPEE`. Toujours
 *  bien en deçà du délai de la transaction, pour ne jamais finir sur une transaction expirée. */
export const ATTENTE_VERROU_VALIDATION = "20s";

export const MESSAGE_VALIDATION_OCCUPEE =
  "Le planning ou la paie est en cours de modification : réessayez la validation dans un instant.";

/** Mêmes dollars, autres francs : le taux de change de la paie a changé depuis l'affichage. */
export const MESSAGE_TAUX_CHANGE =
  "Les montants en francs ont changé (taux de change modifié depuis l'affichage) : rechargez la page.";

/** Approuver sans les montants affichés (jeton obligatoire pour approuver et payer, 2026-10-01). */
export const MESSAGE_VALIDATION_SANS_JETON =
  "Les montants affichés n'ont pas été transmis : rechargez la page Paie avant d'approuver.";

export const MESSAGE_LIGNE_RECALCULEE =
  "La paie a été recalculée depuis l'affichage de cette page : rechargez la page Paie avant d'approuver.";

/** Salarié qui n'est plus calculé (fiche désactivée, passé en intérim) mais dont la ligne rouverte
 *  reste (le recalcul ne supprime jamais une ligne qui a un historique) : dire comment en sortir. */
export function messageNonCalcules(noms: string[]): string {
  return `${noms.join(", ")} ${noms.length > 1 ? "ne sont" : "n'est"} plus dans le calcul de la paie (fiche désactivée, passage en intérim, ou embauche postérieure au mois) : sa ligne ne peut pas être approuvée. Rechargez la page Paie ; si la ligne reste (déjà validée puis rouverte, elle garde son historique), elle est « hors calcul » : elle ne compte nulle part et la clôture la laisse de côté — pour la payer, réactivez la fiche le temps d'approuver la paie du mois en cours (une paie d'un mois passé déjà clôturé ne bouge plus).`;
}

/** Clôture demandée par la RH alors que la Direction n'a pas tout validé (décision du 2026-10-01). */
export function messageAttenteDirection(n: number): string {
  return `${n} bulletin${n > 1 ? "s attendent" : " attend"} encore la validation de la Direction : la RH ne clôture qu'une paie entièrement validée.`;
}

/** Refus de validation : net à payer négatif, ou nul parce que les retenues absorbent tout
 *  (`netNonValidable`, paie-avertissements-mois.ts). */
export function messageNetNonPositif(lignes: { nom: string; net: number; acompte: number; pret: number }[]): string {
  const detail = lignes.map((l) => `${l.nom} (total versé ${usdSigne(l.net)} ; acompte ${usdSigne(l.acompte)}, échéance de prêt ${usdSigne(l.pret)})`).join(", ");
  return `Total versé (net à payer) négatif ou nul : ${detail}. Réduisez l'acompte ou décidez du report de l'échéance de prêt avant d'approuver — le logiciel ne plafonne rien de lui-même.`;
}

/** Au-delà, le message résume (« et N autres ») : les premiers nommés sont les causes (ordre de
 *  `DECISIONS_CHAMPS`), les suivants en découlent. */
const CHAMPS_NOMMES_MAX = 6;

/** Au-delà de ce nombre de salariés, seuls les premiers gardent le détail de leurs champs : les autres sont
 *  nommés seuls. Une clôture dont les 56 bulletins ont bougé (taux de change changé) donnait un message de
 *  6 à 10 Ko, renvoyé dans l'ADRESSE de la page (`/paie?erreur=…`) : au-delà des limites des serveurs. */
const SALARIES_DETAILLES_MAX = 8;

/** Refus « la paie a changé » : chaque salarié avec les champs qui ont bougé depuis l'affichage. */
export function messagePaieChangee(changees: { nom: string; champs: readonly string[] }[]): string {
  const detail = changees.slice(0, SALARIES_DETAILLES_MAX).map(({ nom, champs }) => {
    const libelles = champs.map((c) => LIBELLES_CHAMPS_COMPARES[c] ?? c);
    const reste = libelles.length - CHAMPS_NOMMES_MAX;
    const noms = reste > 0 ? `${libelles.slice(0, CHAMPS_NOMMES_MAX).join(", ")} et ${reste} autre${reste > 1 ? "s" : ""}` : libelles.join(", ");
    return `${nom} (${noms})`;
  });
  const autres = changees.slice(SALARIES_DETAILLES_MAX).map(({ nom }) => nom);
  const suite = autres.length > 0 ? `, ainsi que de ${autres.length} autre${autres.length > 1 ? "s" : ""} salarié${autres.length > 1 ? "s" : ""} (${autres.join(", ")})` : "";
  return `La paie de ${detail.join(", ")}${suite} a changé depuis son calcul : rechargez la page Paie avant d'approuver.`;
}

/** Refus d'une validation : message destiné à l'écran, renvoyé comme une valeur par les actions. */
export class ValidationPaieRefuseeError extends ErreurMetier {
  constructor(message: string) {
    super(message);
    this.name = "ValidationPaieRefuseeError";
  }
}

/**
 * Message lisible pour un refus de validation attendu (montant changé, ligne recalculée, verrou tenu
 * trop longtemps, interblocage, transaction expirée), `null` pour toute autre erreur (à relancer).
 */
export function messageErreurValidation(e: unknown): string | null {
  if (e instanceof ValidationPaieRefuseeError) return e.message;
  if (estAttenteVerrouTropLongue(e) || estInterblocage(e)) return MESSAGE_VALIDATION_OCCUPEE;
  return null;
}

/**
 * CE QUE LA VALIDATION COMPARE (relecture du 2026-10-13). Jusque-là : net, brut, base imposable,
 * heures et source. Restaient hors contrôle la CNSS patronale, l'INPP, l'ONEM, les avantages en
 * nature… — un taux patronal ou un avantage changé entre l'affichage et « Approuver » était figé
 * périmé, puis déclaré (déclarations CNSS/INPP/ONEM, bulletin, livre de paie).
 *
 * Désormais TOUTE colonne que `calculerLignesPaie` écrit sur la ligne est soit comparée, soit
 * exclue avec sa raison. Sont comparés : chaque montant (Decimal), chaque nombre d'heures, et les
 * nombres de jours IMPRIMÉS sur le bulletin (jours payés non travaillés, absences retenues, maladie,
 * prorata). Les compteurs que rien n'imprime ni ne déclare sont exclus : un congé approuvé sans effet
 * sur un montant ne bloque pas une validation (le bulletin imprime la période de congé depuis
 * l'instantané pris à la validation, pas depuis ce compteur).
 *
 * Le type (`Record<keyof DonneesLignePaie, …>`) oblige à trancher pour chaque champ ajouté plus
 * tard, et `paie-validation.test.ts` confronte la liste aux colonnes du modèle Prisma.
 * L'ORDRE est celui du message de refus : d'abord ce qui CAUSE (heures, jours, saisies du mois),
 * puis ce qui en découle (brut, retenues, net, charges patronales) — le premier nommé dit pourquoi.
 */
type DecisionChamp =
  | { compare: "MONTANT"; libelle: string } // Decimal(·, 2) en base : comparé au centime
  | { compare: "EXACT"; libelle: string } // entier imprimé sur le bulletin, ou énumération : égalité stricte
  | { compare: false; raison: string };

const COMPTEUR_NON_IMPRIME = {
  compare: false,
  raison: "compteur sans montant propre, ni imprimé sur le bulletin ni déclaré (au plus une statistique du rapport mensuel) ; les montants qu'il fait varier sont comparés",
} as const;

const DECISIONS_CHAMPS = {
  sourceReference: { compare: "EXACT", libelle: "source des heures de référence" },
  heuresContractuelles: { compare: "MONTANT", libelle: "heures de référence" },
  heuresTravaillees: { compare: "MONTANT", libelle: "heures travaillées" },
  heuresPayeesNonTravaillees: { compare: "MONTANT", libelle: "heures payées non travaillées" },
  heuresSupp30: { compare: "MONTANT", libelle: "heures supp. à 30 %" },
  heuresSupp60: { compare: "MONTANT", libelle: "heures supp. à 60 %" },
  heuresSupp100: { compare: "MONTANT", libelle: "heures de dimanche et férié" },
  joursPayes100: COMPTEUR_NON_IMPRIME,
  joursPayes2_3: COMPTEUR_NON_IMPRIME,
  joursNonPayes: COMPTEUR_NON_IMPRIME,
  nombreAbsences: COMPTEUR_NON_IMPRIME,
  joursPayesNonTravailles: { compare: "EXACT", libelle: "jours payés non travaillés" },
  joursAbsenceRetenus: { compare: "EXACT", libelle: "jours d'absence retenus" },
  joursMaladieJustifies: { compare: "EXACT", libelle: "jours de maladie justifiés" },
  joursMaladieNonJustifies: { compare: "EXACT", libelle: "jours de maladie non justifiés" },
  joursCongePris: COMPTEUR_NON_IMPRIME,
  prorataJoursTravailles: { compare: "EXACT", libelle: "prorata d'entrée ou de sortie" },
  prorataJoursMois: { compare: "EXACT", libelle: "base du prorata" },
  avantagesNatureUSD: { compare: "MONTANT", libelle: "avantages en nature" },
  transportUSD: { compare: "MONTANT", libelle: "transport" },
  primesUSD: { compare: "MONTANT", libelle: "primes" },
  fraisMedicauxUSD: { compare: "MONTANT", libelle: "frais médicaux" },
  acompteUSD: { compare: "MONTANT", libelle: "acompte" },
  retenuePretUSD: { compare: "MONTANT", libelle: "échéance de prêt" },
  retenueAbsencesUSD: { compare: "MONTANT", libelle: "retenue pour absences" },
  retenueMaladieUSD: { compare: "MONTANT", libelle: "retenue pour maladie" },
  indemniteCongesUSD: { compare: "MONTANT", libelle: "indemnité de congé" },
  remuneration100: { compare: "MONTANT", libelle: "rémunération à 100 %" },
  remunerationJoursPayesUSD: { compare: "MONTANT", libelle: "rémunération des jours payés non travaillés" },
  remunerationMaladieJustifieeUSD: { compare: "MONTANT", libelle: "rémunération de la maladie justifiée" },
  remuneration2_3: { compare: "MONTANT", libelle: "rémunération aux 2/3" },
  hsValorisee: { compare: "MONTANT", libelle: "heures supplémentaires valorisées" },
  salBrutUSD: { compare: "MONTANT", libelle: "salaire brut" },
  cnssSalarieUSD: { compare: "MONTANT", libelle: "CNSS salariale" },
  netImposableUSD: { compare: "MONTANT", libelle: "base imposable" },
  iprCalculeUSD: { compare: "MONTANT", libelle: "IPR" },
  allocFamilialeUSD: { compare: "MONTANT", libelle: "allocations familiales" },
  salNetUSD: { compare: "MONTANT", libelle: "net à payer" },
  salNetCDF: { compare: "MONTANT", libelle: "net en francs" },
  cnssPatronalUSD: { compare: "MONTANT", libelle: "CNSS patronale" },
  inppUSD: { compare: "MONTANT", libelle: "INPP" },
  onemUSD: { compare: "MONTANT", libelle: "ONEM" },
  coutEmployeurUSD: { compare: "MONTANT", libelle: "coût employeur" },
  coutEmployeurCDF: { compare: "MONTANT", libelle: "coût employeur en francs" },
  motifReference: { compare: false, raison: "texte qui explique la source des heures, elle-même comparée ; aucun montant" },
  avertissementsPaie: { compare: false, raison: "avertissements jamais bloquants, sans montant ; un nouvel avertissement sans écart de montant ne change rien de payé ni de déclaré" },
} as const satisfies Record<keyof DonneesLignePaie, DecisionChamp>;

/** Libellé d'un champ comparé, tel que le message de refus le nomme. */
export const LIBELLES_CHAMPS_COMPARES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(DECISIONS_CHAMPS).flatMap(([k, d]) => (d.compare ? [[k, d.libelle]] : [])),
);

type Decisions = typeof DECISIONS_CHAMPS;
type ChampMontant = { [K in keyof Decisions]: Decisions[K] extends { compare: "MONTANT" } ? K : never }[keyof Decisions];
type ChampExact = { [K in keyof Decisions]: Decisions[K] extends { compare: "EXACT" } ? K : never }[keyof Decisions];
export type ChampCompare = ChampMontant | ChampExact;

/** Champs comparés, dans l'ordre du message. */
export const CHAMPS_COMPARES = (Object.keys(DECISIONS_CHAMPS) as (keyof Decisions)[]).filter(
  (k): k is ChampCompare => DECISIONS_CHAMPS[k].compare !== false,
);
/** Champs écartés de la comparaison, avec leur raison (rapport, garde-fou). */
export const CHAMPS_NON_COMPARES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(DECISIONS_CHAMPS).flatMap(([k, d]) => (d.compare === false ? [[k, d.raison]] : [])),
);

/** Ce qu'une requête Prisma doit lire d'une ligne pour la comparer au recalcul. */
const SELECTION_CONTROLE = Object.fromEntries(CHAMPS_COMPARES.map((k) => [k, true])) as { [K in ChampCompare]: true };

/** Valeur calculée telle que la base l'aurait enregistrée (arrondi à 2 décimales, à mi-chemin
 *  loin de zéro, comme `numeric(·, 2)` de Postgres à partir de la même écriture décimale). */
const enBase = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type LigneEnregistree = { [K in ChampMontant]: Prisma.Decimal } & { [K in ChampExact]: DonneesLignePaie[K] };

/** Champs (dans l'ordre du message) où la ligne enregistrée diffère du recalcul : d'au moins un
 *  centime pour un montant ou des heures, d'une unité pour un nombre de jours, ou de source. */
export function champsDifferents(enregistree: LigneEnregistree, recalculee: DonneesLignePaie): ChampCompare[] {
  return CHAMPS_COMPARES.filter((k) =>
    DECISIONS_CHAMPS[k].compare === "MONTANT"
      ? !new Prisma.Decimal(enregistree[k as ChampMontant]).equals(enBase(recalculee[k as ChampMontant]))
      : enregistree[k as ChampExact] !== recalculee[k as ChampExact],
  );
}

/** Vrai si la ligne enregistrée diffère du recalcul d'au moins un centime (ou d'une source). */
export function ligneDiffere(enregistree: LigneEnregistree, recalculee: DonneesLignePaie): boolean {
  return champsDifferents(enregistree, recalculee).length > 0;
}

/** Attente de verrou bornée pour le reste de la transaction (`ATTENTE_VERROU_VALIDATION`). */
async function borneAttenteVerrou(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${ATTENTE_VERROU_VALIDATION}'`);
}

/** Clôture : la run du mois en FOR UPDATE AVANT de lire ses lignes PAS_VALIDE, pour qu'aucun
 *  recalcul (/paie) ne les remplace entre la lecture et la validation. */
export async function verrouillerRunExclusif(tx: Prisma.TransactionClient, runId: string): Promise<void> {
  await borneAttenteVerrou(tx);
  await tx.$queryRaw`SELECT r."id" FROM "public"."PayrollRun" r WHERE r."id" = ${runId} FOR UPDATE`;
}

/**
 * Verrouille puis revérifie, dans `tx`, les lignes `payrollLineIds` qui vont passer de PAS_VALIDE à
 * VALIDE. Lève `ValidationPaieRefuseeError` si une ligne a disparu (recalculée depuis l'affichage)
 * ou si son montant ne correspond plus au recalcul. Renvoie les ids contrôlés : seul ce jeton permet
 * à `appliquerTransitionPaie` de valider une ligne PAS_VALIDE.
 *
 * `verrouRun: "EXCLUSIF"` pour la clôture, qui modifie ensuite la run : la prendre d'emblée en
 * FOR UPDATE évite l'interblocage d'une montée de verrou face à une écriture du planning.
 */
export async function controlerLignesAValider(
  tx: Prisma.TransactionClient,
  payrollLineIds: string[],
  opts: { verrouRun?: "PARTAGE" | "EXCLUSIF"; jetons?: Record<string, string | undefined>; jetonObligatoire?: boolean } = {},
): Promise<Set<string>> {
  const ids = [...new Set(payrollLineIds)];
  if (ids.length === 0) return new Set();
  await borneAttenteVerrou(tx);

  // 1. Verrous : la run du mois d'abord, puis les lignes, chacun dans l'ordre des id.
  const modeRun = opts.verrouRun === "EXCLUSIF" ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
  await tx.$queryRaw`
    SELECT r."id" FROM "public"."PayrollRun" r
    WHERE r."id" IN (SELECT l."payrollRunId" FROM "public"."PayrollLine" l WHERE l."id" IN (${Prisma.join(ids)}))
    ORDER BY r."id"
    ${modeRun}`;
  await tx.$queryRaw`
    SELECT l."id" FROM "public"."PayrollLine" l
    WHERE l."id" IN (${Prisma.join(ids)})
    ORDER BY l."id"
    FOR UPDATE`;

  const lignes = await tx.payrollLine.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      employeeId: true,
      statutPaiement: true,
      ...SELECTION_CONTROLE,
      tauxChangeFige: true,
      employee: { select: { nom: true } },
      payrollRun: { select: { mois: true, annee: true, tauxChangeUtilise: true } },
    },
  });
  // Une ligne demandée qui n'existe plus a été remplacée par un recalcul (/paie : brouillon sans
  // historique) : l'écran qui la montrait est périmé. L'ignorer validerait moins de lignes que prévu.
  if (lignes.length < ids.length) throw new ValidationPaieRefuseeError(MESSAGE_LIGNE_RECALCULEE);
  const aValider = lignes.filter((l) => l.statutPaiement === "PAS_VALIDE");
  // Jeton obligatoire (actions de l'écran, 2026-10-01) : une ligne validée sans les montants
  // affichés n'a pas pu être lue. La clôture, elle, n'en prend pas : elle revérifie tout par le calcul.
  if (opts.jetonObligatoire && aValider.some((l) => !opts.jetons?.[l.id])) throw new ValidationPaieRefuseeError(MESSAGE_VALIDATION_SANS_JETON);
  // Une ligne ROUVERTE garde son identifiant quand le recalcul la met à jour (paie-refresh.ts) : le
  // jeton de l'écran (montants affichés, taux compris) dit alors si elle a changé depuis l'affichage.
  const ecart = verifierJetons(lignes, opts.jetons);
  if (ecart) throw new ValidationPaieRefuseeError(ecart === "TAUX" ? MESSAGE_TAUX_CHANGE : MESSAGE_LIGNE_RECALCULEE);

  // 2. Recalcul : une fois par mois concerné.
  const parMois = new Map<string, typeof aValider>();
  for (const l of aValider) {
    const k = `${l.payrollRun.annee}-${l.payrollRun.mois}`;
    (parMois.get(k) ?? parMois.set(k, []).get(k)!).push(l);
  }
  const changees: { nom: string; champs: ChampCompare[] }[] = [];
  const nonCalcules: string[] = [];
  const netsRefuses: { nom: string; net: number; acompte: number; pret: number }[] = [];
  for (const groupe of parMois.values()) {
    const { mois, annee } = groupe[0].payrollRun;
    const { lignes: recalculees } = await calculerLignesPaie(mois, annee, tx);
    const parSalarie = new Map(recalculees.map((r) => [r.employee.id, r.data]));
    // 3. Comparaison. Un salarié absent du recalcul (fiche désactivée, passé en intérim) ne peut pas
    // être validé : son brouillon disparaîtra au prochain recalcul, sa ligne rouverte restera (avec
    // son historique) — le message dit comment en sortir.
    for (const l of groupe) {
      const r = parSalarie.get(l.employeeId);
      const champs = r ? champsDifferents(l, r) : [];
      if (!r) nonCalcules.push(l.employee.nom);
      else if (champs.length > 0) changees.push({ nom: l.employee.nom, champs });
      else if (netNonValidable(r)) netsRefuses.push({ nom: l.employee.nom, net: r.salNetUSD, acompte: r.acompteUSD, pret: r.retenuePretUSD });
    }
  }
  const trier = (noms: string[]) => [...new Set(noms)].sort((a, b) => a.localeCompare(b, "fr"));
  if (nonCalcules.length > 0) throw new ValidationPaieRefuseeError(messageNonCalcules(trier(nonCalcules)));
  if (changees.length > 0) {
    throw new ValidationPaieRefuseeError(messagePaieChangee([...changees].sort((a, b) => a.nom.localeCompare(b.nom, "fr"))));
  }
  if (netsRefuses.length > 0) {
    throw new ValidationPaieRefuseeError(messageNetNonPositif(netsRefuses.sort((a, b) => a.nom.localeCompare(b.nom, "fr"))));
  }
  return new Set(aValider.map((l) => l.id));
}

// ── Payer (VALIDÉ → PAYÉ) ────────────────────────────────────────────────────────────────────────
// Depuis le 2026-10-01 la RH paie ce que la Direction a validé. Une ligne validée ne se recalcule
// pas (STATUTS_FIGES), mais la Direction peut la ROUVRIR, la faire recalculer et la REVALIDER entre
// l'affichage et le clic : même identifiant, autres montants. Le jeton des montants affichés
// (paie-jeton.ts) le trahit — la RH ne paie que les montants validés qu'elle a sous les yeux.

export const MESSAGE_PAIEMENT_PERIME =
  "Un bulletin a changé depuis l'affichage de cette page (rouvert ou revalidé par la Direction) : rechargez la page avant de payer.";

export const MESSAGE_PAIEMENT_SANS_JETON =
  "Les montants affichés n'ont pas été transmis : rechargez la page avant de payer.";

/**
 * Verrouille (FOR UPDATE, dans l'ordre des id) les lignes à payer et renvoie celles qui peuvent
 * l'être : VALIDÉES, et dont le jeton (s'il est fourni) correspond aux montants en base. Un jeton
 * différent refuse TOUT le paiement (ValidationPaieRefuseeError, rien d'écrit). `jetonObligatoire`
 * (la Direction comme la RH depuis le 2026-10-01) : une ligne validée payée sans jeton est refusée —
 * elle n'a pas pu être lue à l'écran. Un taux de change changé depuis l'affichage refuse aussi.
 *
 * Les lignes absentes (brouillon remplacé par un recalcul) ou non validées ne sont PAS payées : en
 * lot, elles sont ignorées comme avant (la machine à états les refuse) ; seul un paiement de ligne
 * validée est contrôlé ici. Seul ce jeu d'ids permet à `appliquerTransitionPaie` de payer.
 */
export async function controlerLignesAPayer(
  tx: Prisma.TransactionClient,
  payrollLineIds: string[],
  opts: { jetons?: Record<string, string | undefined>; jetonObligatoire?: boolean } = {},
): Promise<Set<string>> {
  const ids = [...new Set(payrollLineIds)];
  if (ids.length === 0) return new Set();
  await borneAttenteVerrou(tx);
  // Verrou des lignes : une réouverture concurrente (Direction, qui verrouille aussi ses lignes
  // avant de les lire : verrouillerLignesPaie) attend la fin du paiement, ou l'inverse — jamais une
  // ligne payée ET rouverte par deux transactions qui se croisent.
  await tx.$queryRaw`
    SELECT l."id" FROM "public"."PayrollLine" l
    WHERE l."id" IN (${Prisma.join(ids)})
    ORDER BY l."id"
    FOR UPDATE`;
  const lignes = await tx.payrollLine.findMany({
    where: { id: { in: ids }, statutPaiement: "VALIDE" },
    select: { id: true, ...SELECTION_JETON },
  });
  const jetons = opts.jetons ?? {};
  if (opts.jetonObligatoire && lignes.some((l) => !jetons[l.id])) throw new ValidationPaieRefuseeError(MESSAGE_PAIEMENT_SANS_JETON);
  const ecart = verifierJetons(lignes, jetons);
  if (ecart) throw new ValidationPaieRefuseeError(ecart === "TAUX" ? MESSAGE_TAUX_CHANGE : MESSAGE_PAIEMENT_PERIME);
  return new Set(lignes.map((l) => l.id));
}

/**
 * Verrou (FOR UPDATE, dans l'ordre des id, attente bornée) des lignes d'un retour en arrière
 * (rouvrir) AVANT d'en lire l'état. Relecture du 2026-10-01 : sans lui, une réouverture lisait
 * « Validé » pendant qu'un paiement concurrent (la RH) s'écrivait, attendait la ligne, puis
 * l'écrasait en « Pas validé » — bulletin payé redevenu payable, journal faux.
 */
export async function verrouillerLignesPaie(tx: Prisma.TransactionClient, payrollLineIds: string[]): Promise<void> {
  const ids = [...new Set(payrollLineIds)];
  if (ids.length === 0) return;
  await borneAttenteVerrou(tx);
  await tx.$queryRaw`SELECT l."id" FROM "public"."PayrollLine" l WHERE l."id" IN (${Prisma.join(ids)}) ORDER BY l."id" FOR UPDATE`;
}
