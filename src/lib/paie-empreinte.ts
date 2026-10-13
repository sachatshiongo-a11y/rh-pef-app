import "server-only";
import { lundiDe } from "@/lib/dates-fr";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * EMPREINTE DES SOURCES DE LA PAIE : de quoi savoir, en UNE requête légère, si recalculer les
 * bulletins du mois donnerait autre chose que ce qui est déjà en base.
 *
 * Pourquoi : `rafraichirPaieAffichee` recalculait toute la paie non figée à CHAQUE ouverture de
 * « Paie » et d'« À valider » (DELETE + INSERT de ~56 bulletins, 0,5 s de processeur sur Render
 * gratuit), même quand rien n'avait bougé depuis le calcul précédent.
 *
 * Principe : au moment du calcul on enregistre sur la PayrollRun une empreinte de TOUT ce que le
 * moteur lit, plus une empreinte des lignes écrites. À l'ouverture, on recalcule l'empreinte : si elle
 * est identique (et que la garde temporelle n'est pas échue), le recalcul produirait exactement les
 * mêmes lignes — on ne le fait pas.
 *
 * POURQUOI UN HACHAGE DU CONTENU et non `count + max(updatedAt)` : la plupart des tables sources
 * n'ont PAS d'`updatedAt` (Prime, AcompteSalaire, LeaveRequest, FraisMedical, Contrat, PretPersonnel,
 * RetenuePret, AvantageNature, PlanningModele, TypeConge, JourFerie, ParametreLegal côté
 * Employee…), et un montant d'acompte modifié, un congé ou un prêt corrigé ne changent ni le nombre
 * de lignes ni aucune date. Une suppression suivie d'un ajout laisse aussi le `count` inchangé. Le
 * hachage de la LIGNE ENTIÈRE (somme des hachages 64 bits, calculée par Postgres : rien ne transite
 * vers l'application) attrape toute modification de n'importe quelle colonne, tout ajout, toute
 * suppression, y compris faite à la main en SQL.
 *
 * SÛR PAR DÉFAUT : toutes les colonnes d'une table source sont hachées. Seules des exclusions
 * NOMMÉES et justifiées (`ignorer`) en sortent ; une colonne ajoutée plus tard est donc comptée sans
 * rien faire. Un test statique (`paie-empreinte.test.ts`) vérifie que chaque table lue par le moteur
 * figure ici.
 *
 * ORDRE (point essentiel) : l'empreinte des SOURCES est prise AVANT que le moteur ne lise quoi que ce
 * soit, jamais après. Une écriture qui se glisse entre les deux rend l'empreinte enregistrée plus
 * ancienne que les données lues : au pire un recalcul de trop à l'ouverture suivante. Prise après,
 * elle déclarerait « à jour » un calcul fait sur des données déjà périmées, durablement.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Version de la formule : la changer invalide toutes les empreintes enregistrées (un recalcul). */
export const VERSION_EMPREINTE = "v1";

/**
 * GARDE TEMPORELLE : au-delà de cette durée depuis le dernier calcul, on recalcule de toute façon.
 * Elle borne la péremption si une source échappait un jour à l'empreinte (ce que le test statique
 * et le test de propriété cherchent à empêcher), ou si le calcul se mettait à dépendre de l'horloge.
 * Dix minutes : assez court pour qu'une erreur ne dure pas, assez long pour qu'une session de
 * validation (rechargements successifs de la page) ne recalcule qu'une fois.
 */
export const GARDE_RECALCUL_MS = 10 * 60_000;

type SourceEmpreinte = {
  /** Modèle Prisma (accesseur du client, en lowerCamel) tel que lu par le moteur. */
  modele: string;
  /** Nom de la table dans le schéma `public`. */
  table: string;
  /** Condition SQL (alias `s`), SUPERSET de ce que le moteur lit : trop large = un recalcul de trop, jamais un oubli. */
  filtre: string;
  /** Colonnes exclues du hachage, avec la raison. Rien d'autre n'est exclu. */
  ignorer?: { colonne: string; raison: string }[];
  /** Pourquoi cette table compte. */
  lu: string;
};

// Paramètres communs ($1…$8) : voir `parametres()`.
//  $1 début du mois, $2 fin du mois, $3 début de la plage (lundi de la 1re semaine), $4 fin de la plage
//  (dimanche de la dernière), $5 mois, $6 année, $7 identifiant de la run, $8 statuts figés.
const DANS_LA_PLAGE = `s."date" >= $3::date AND s."date" <= $4::date`;

/**
 * TOUTES les sources du moteur de paie (`calculerLignesPaie`, `chargerJoursMois`,
 * `chargerParametresPaie`, `estCalculeEnPaie`…). Une table lue par le moteur et absente d'ici fait
 * échouer `paie-empreinte.test.ts`.
 */
export const SOURCES_PAIE: SourceEmpreinte[] = [
  {
    modele: "config", table: "Config", filtre: `s."id" = 'singleton'`,
    lu: "taux de change (paramètres de paie) ; mois et année courants (la run suivie est celle du mois courant)",
    ignorer: [
      { colonne: "pointageLatitude", raison: "pointage QR : étranger à la paie" },
      { colonne: "pointageLongitude", raison: "pointage QR : étranger à la paie" },
      { colonne: "pointageRayonM", raison: "pointage QR : étranger à la paie" },
      { colonne: "pointageCode", raison: "pointage QR : étranger à la paie" },
      { colonne: "espaceEmployeActif", raison: "interrupteur de l'espace salarié : étranger à la paie" },
      { colonne: "updatedAt", raison: "horodatage : le contenu des autres colonnes est haché" },
    ],
  },
  { modele: "exerciceFiscal", table: "ExerciceFiscal", filtre: `s."actif"`, lu: "exercice fiscal ACTIF (paramètres légaux, barème IPR)" },
  { modele: "parametreLegal", table: "ParametreLegal", filtre: `s."exerciceId" IN (SELECT "id" FROM "public"."ExerciceFiscal" WHERE "actif")`, lu: "CNSS, IPR, INPP, ONEM, HS, allocations, jours ouvrables, droits de congé, date d'effet de la paie planifiée, salaires saisis en net" },
  { modele: "trancheIprCDF", table: "TrancheIprCDF", filtre: `s."exerciceId" IN (SELECT "id" FROM "public"."ExerciceFiscal" WHERE "actif")`, lu: "barème IPR" },
  {
    modele: "employee", table: "Employee", filtre: `s."actif"`,
    lu: "fiche des salariés calculés : catégorie, salaire, heures, transport, enfants, frais médicaux saisis, embauche, régime",
    ignorer: [
      { colonne: "photoUrl", raison: "photo : étrangère à la paie (et potentiellement volumineuse)" },
      { colonne: "updatedAt", raison: "horodatage : tout changement de colonne lue est de toute façon haché ; sans cette exclusion, changer la photo ou un téléphone recalculerait la paie" },
    ],
  },
  { modele: "jourFerie", table: "JourFerie", filtre: DANS_LA_PLAGE, lu: "fériés de la plage élargie aux semaines civiles entières" },
  { modele: "attendance", table: "Attendance", filtre: DANS_LA_PLAGE, lu: "codes de présence, maladie justifiée, dates de saisie (avertissements) — plage élargie" },
  { modele: "overtimeEntry", table: "OvertimeEntry", filtre: DANS_LA_PLAGE, lu: "heures faites (heures supp., paie brigade sur heures planifiées) — plage élargie" },
  { modele: "planningCreneau", table: "PlanningCreneau", filtre: DANS_LA_PLAGE, lu: "créneaux planifiés (heures de référence) — plage élargie" },
  { modele: "planningModele", table: "PlanningModele", filtre: "TRUE", lu: "modèle de planning hebdomadaire (repli quand il n'y a pas de créneau)" },
  { modele: "shift", table: "Shift", filtre: "TRUE", lu: "durée, système, taux horaire de rôle des shifts des créneaux et du modèle" },
  { modele: "prime", table: "Prime", filtre: `s."mois" = $5::int AND s."annee" = $6::int`, lu: "primes du mois" },
  { modele: "acompteSalaire", table: "AcompteSalaire", filtre: `s."mois" = $5::int AND s."annee" = $6::int AND s."statut" = 'APPROUVE'`, lu: "acomptes approuvés du mois" },
  { modele: "leaveRequest", table: "LeaveRequest", filtre: `s."statut" = 'APPROUVE' AND s."dateDebut" <= $4::date AND s."dateFin" >= $3::date`, lu: "congés approuvés qui touchent la plage (jours de congé pris, congé sans solde)" },
  { modele: "typeConge", table: "TypeConge", filtre: "TRUE", lu: "taux du type de congé (sans solde = taux 0)" },
  { modele: "fraisMedical", table: "FraisMedical", filtre: `s."mois" = $5::int AND s."annee" = $6::int`, lu: "frais médicaux du mois" },
  { modele: "avantageNature", table: "AvantageNature", filtre: `s."mois" = $5::int AND s."annee" = $6::int`, lu: "avantages en nature du mois (recopiés sur le bulletin)" },
  {
    modele: "contrat", table: "Contrat",
    filtre: `s."statut" = 'ACTIF' OR (s."dateDebut" <= $2::date AND (s."dateFin" IS NULL OR s."dateFin" >= $1::date))`,
    lu: "régime de paie (contrat ACTIF le plus récent), fin de contrat qui couvre le mois",
  },
  { modele: "pretPersonnel", table: "PretPersonnel", filtre: `s."statut" = 'EN_COURS'`, lu: "prêts en cours (échéance du mois)" },
  { modele: "retenuePret", table: "RetenuePret", filtre: `s."pretId" IN (SELECT "id" FROM "public"."PretPersonnel" WHERE "statut" = 'EN_COURS')`, lu: "retenues déjà faites des prêts en cours (solde avant le mois)" },
];

/** Expression SQL du hachage 64 bits d'une ligne (alias `s`), colonnes exclues retirées. */
function hachageLigne(s: SourceEmpreinte): string {
  if (!s.ignorer?.length) return `hashtextextended(s::text, 0)`;
  const colonnes = s.ignorer.map((i) => `'${i.colonne}'`).join(", ");
  return `hashtextextended((to_jsonb(s) - ARRAY[${colonnes}]::text[])::text, 0)`;
}

/** Sous-requête « nombre de lignes : somme des hachages » d'une table source. */
function agregat(s: SourceEmpreinte): string {
  return `(SELECT count(*)::text || ':' || coalesce(sum(${hachageLigne(s)}), 0)::text FROM "public"."${s.table}" s WHERE ${s.filtre})`;
}

/**
 * Bloc SQL des SOURCES. Joint aussi le taux de change enregistré sur la run (réécrit à chaque calcul
 * et lu par le jeton de validation), le mois suivi, et la version du code déployé : un déploiement qui
 * change une règle de calcul invalide les bulletins déjà calculés.
 */
const SQL_SOURCES = `md5(concat_ws('|',
  '${VERSION_EMPREINTE}', $5::int::text, $6::int::text, $9::text,
  (SELECT "tauxChangeUtilise"::text FROM "public"."PayrollRun" WHERE "id" = $7::text),
  ${SOURCES_PAIE.map((s) => `'${s.table}', ${agregat(s)}`).join(",\n  ")}
))`;

/**
 * Bloc SQL des LIGNES de la run. Une ligne figée (validée, payée) n'est jamais recalculée : seuls son
 * identifiant et son état comptent (rouvrir une ligne, la supprimer ou en créer change l'empreinte).
 * Une ligne NON figée est hachée en entier : toute modification faite ailleurs que par le calcul
 * (retouche manuelle, historique réécrit) fait recalculer, comme avant.
 */
const SQL_LIGNES = `(SELECT count(*)::text || ':' || coalesce(sum(hashtextextended(
    CASE WHEN l."statutPaiement"::text = ANY($8::text[])
         THEN concat_ws('|', l."id", l."employeeId", l."statutPaiement"::text)
         ELSE to_jsonb(l)::text END, 0)), 0)::text
  FROM "public"."PayrollLine" l WHERE l."payrollRunId" = $7::text)`;

export type EmpreinteMois = { sources: string; lignes: string };
type Cible = { mois: number; annee: number; runId: string; statutsFiges: string[] };

function parametres(c: Cible) {
  const debut = new Date(Date.UTC(c.annee, c.mois - 1, 1));
  const fin = new Date(Date.UTC(c.annee, c.mois, 0));
  // Même plage que `chargerJoursMois` : semaines civiles entières, lundi → dimanche.
  const debutPlage = lundiDe(debut);
  const finPlage = new Date(lundiDe(fin).getTime() + 6 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [iso(debut), iso(fin), iso(debutPlage), iso(finPlage), c.mois, c.annee, c.runId, c.statutsFiges, process.env.RENDER_GIT_COMMIT ?? "dev"] as const;
}

/**
 * Exécute une requête d'empreinte en ne transmettant QUE les paramètres qu'elle référence
 * (Postgres refuse un paramètre fourni mais jamais utilisé : type indéterminable).
 */
async function lancer<T>(db: Db, sql: string, c: Cible): Promise<T> {
  const tous = parametres(c);
  const utilises = [...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const renumerotee = sql.replace(/\$(\d+)/g, (_, n) => `$${utilises.indexOf(Number(n)) + 1}`);
  const [r] = await db.$queryRawUnsafe<T[]>(renumerotee, ...utilises.map((n) => tous[n - 1]));
  return r;
}

/** Empreinte des seules SOURCES (à prendre AVANT toute lecture du moteur). */
export async function empreinteSources(db: Db, c: Cible): Promise<string> {
  return (await lancer<{ v: string }>(db, `SELECT ${SQL_SOURCES} AS v`, c)).v;
}

/** Empreinte des seules LIGNES de la run (à prendre APRÈS les écritures du calcul). */
export async function empreinteLignes(db: Db, c: Cible): Promise<string> {
  return (await lancer<{ v: string }>(db, `SELECT ${SQL_LIGNES} AS v`, c)).v;
}

/** Les deux empreintes en UNE requête (ouverture d'un écran). */
export async function empreinteDuMois(db: Db, c: Cible): Promise<EmpreinteMois> {
  return lancer<EmpreinteMois>(db, `SELECT ${SQL_SOURCES} AS sources, ${SQL_LIGNES} AS lignes`, c);
}

/** Texte enregistré sur la run. */
export const texteEmpreinte = (e: EmpreinteMois) => `${VERSION_EMPREINTE}:${e.sources}:${e.lignes}`;

/**
 * La paie enregistrée est-elle encore celle que donnerait un recalcul ? Oui seulement si une empreinte
 * a été enregistrée, qu'elle est IDENTIQUE à l'empreinte courante, et que le dernier calcul date de
 * moins de `GARDE_RECALCUL_MS`. Un calcul daté du futur (horloges désaccordées) est traité comme échu.
 */
export function paieAJour(
  run: { empreinteCalcul: string | null; calculeLe: Date | null },
  courante: EmpreinteMois,
  maintenantMs: number,
): boolean {
  if (!run.empreinteCalcul || !run.calculeLe) return false;
  if (run.empreinteCalcul !== texteEmpreinte(courante)) return false;
  return garderRecente(run.calculeLe, maintenantMs);
}

/** La garde temporelle seule : dernier calcul daté d'aujourd'hui (pas du futur) et plus récent que `GARDE_RECALCUL_MS`. */
export function garderRecente(calculeLe: Date | null, maintenantMs: number): boolean {
  if (!calculeLe) return false;
  const age = maintenantMs - calculeLe.getTime();
  return age >= 0 && age < GARDE_RECALCUL_MS;
}
