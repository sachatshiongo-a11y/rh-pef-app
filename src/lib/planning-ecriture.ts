import "server-only";

// SEUL chemin d'écriture du planning (spec 2026-09-23 §6, décision Direction 3) : depuis que la paie
// de la brigade suit les heures PLANIFIÉES, un créneau est une pièce de paie. Chaque création,
// modification ou suppression est donc (1) refusée si la ligne de paie du salarié pour ce mois est
// VALIDÉE ou PAYÉE, (2) journalisée (qui, quand, avant, après) dans JournalAudit.
import { Prisma } from "@prisma/client";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { dureeShift } from "@/lib/duree-shift";
import { MOIS_FR } from "@/lib/dates-fr";

/** `shiftId: null` = effacer le créneau de ce jour. */
export type OperationCreneau = { employeeId: string; date: Date; shiftId: string | null };

export type Verrou = { employeeId: string; nom: string; mois: number; annee: number };

export class PlanningVerrouilleError extends Error {
  constructor(public readonly verrous: Verrou[]) {
    super(
      `Planning verrouillé : paie validée ou payée pour ${verrous.map((v) => `${v.nom} (${MOIS_FR[v.mois - 1]} ${v.annee})`).join(", ")}. ` +
        "Rouvrir la ligne de paie avant de modifier ce planning.",
    );
    this.name = "PlanningVerrouilleError";
  }
}

/**
 * Refus de changer les heures d'un shift qui a servi à une paie validée ou payée : « Ce shift a
 * servi à une paie validée (septembre 2026 : Martine Mutombo, Rachel Lunda) : créez un nouveau shift
 * plutôt que de changer ses heures. » — mois dans l'ordre, salariés par ordre alphabétique.
 */
export class ShiftVerrouilleError extends Error {
  constructor(public readonly verrous: Verrou[]) {
    const parMois = new Map<string, { mois: number; annee: number; noms: string[] }>();
    for (const v of [...verrous].sort((a, b) => a.annee - b.annee || a.mois - b.mois || a.nom.localeCompare(b.nom, "fr"))) {
      const k = `${v.annee}-${v.mois}`;
      const m = parMois.get(k) ?? parMois.set(k, { mois: v.mois, annee: v.annee, noms: [] }).get(k)!;
      if (!m.noms.includes(v.nom)) m.noms.push(v.nom);
    }
    const detail = [...parMois.values()].map((m) => `${MOIS_FR[m.mois - 1]} ${m.annee} : ${m.noms.join(", ")}`).join(" ; ");
    super(`Ce shift a servi à une paie validée (${detail}) : créez un nouveau shift plutôt que de changer ses heures.`);
    this.name = "ShiftVerrouilleError";
  }
}

/** Message affiché quand Postgres a dû annuler l'écriture pour sortir d'un interblocage. */
export const MESSAGE_INTERBLOCAGE = "La paie est en cours de validation : réessayez dans un instant.";

/** Message affiché quand une écriture concurrente a posé le même (salarié, jour) entre la lecture
 *  et l'écriture (violation de l'unicité `employeeId_date`) : rien n'a été écrit. */
export const MESSAGE_PLANNING_CHANGE = "Le planning a changé pendant l'enregistrement : réessayez.";

/**
 * Cherche un code d'erreur dans les seuls champs qui le portent, selon le chemin (requête brute,
 * requête du client, adaptateur `pg`) : `e.code`, `e.originalCode`, puis `meta`, `cause`,
 * `driverAdapterError` (profondeur bornée, protégé des cycles). Jamais le texte du message.
 */
function porteUnCode(e: unknown, codes: ReadonlySet<string>): boolean {
  const vus = new Set<unknown>();
  const fouiller = (x: unknown, profondeur: number): boolean => {
    if (x === null || typeof x !== "object" || profondeur > 6 || vus.has(x)) return false;
    vus.add(x);
    const o = x as Record<string, unknown>;
    if (codes.has(o.code as string) || codes.has(o.originalCode as string)) return true;
    return ["meta", "cause", "driverAdapterError"].some((k) => fouiller(o[k], profondeur + 1));
  };
  return fouiller(e, 0);
}

/**
 * Vrai si `e` est un interblocage Postgres (40P01) ou le conflit de transaction que Prisma en tire
 * (P2034). Selon le chemin (requête brute, requête du client, adaptateur `pg`), le code est porté
 * par `e.code`, `e.meta.code` ou `e.meta.driverAdapterError.cause.originalCode` : on fouille ces
 * seuls champs, sans jamais lire le texte du message.
 */
export function estInterblocage(e: unknown): boolean {
  return porteUnCode(e, new Set(["40P01", "P2034"]));
}

/**
 * Vrai si `e` est une attente de verrou abandonnée (`lock_timeout`, 55P03) ou une transaction Prisma
 * expirée pendant l'attente (P2028) : une validation de paie et une écriture du planning se sont
 * attendues trop longtemps. Mêmes champs que `estInterblocage`, jamais le texte du message.
 */
export function estAttenteVerrouTropLongue(e: unknown): boolean {
  return porteUnCode(e, new Set(["55P03", "P2028"]));
}

/** Vrai si `e` est une violation d'unicité : P2002 (client Prisma) ou 23505 (Postgres). Dans une
 *  écriture du planning, la seule unicité en jeu est (salarié, jour) : une course sur la même paire. */
export function estConflitUnicite(e: unknown): boolean {
  return porteUnCode(e, new Set(["P2002", "23505"]));
}

/**
 * Message lisible pour les refus attendus d'une écriture du planning (planning verrouillé,
 * interblocage avec une validation de paie, course sur un même (salarié, jour)), `null` pour toute
 * autre erreur (à relancer). Les actions le RENVOIENT comme une valeur : Next masque le message
 * des erreurs levées en production.
 */
export function messageErreurPlanning(e: unknown): string | null {
  if (e instanceof PlanningVerrouilleError || e instanceof ShiftVerrouilleError) return e.message;
  if (estInterblocage(e)) return MESSAGE_INTERBLOCAGE;
  if (estConflitUnicite(e)) return MESSAGE_PLANNING_CHANGE;
  return null;
}

/**
 * Compte rendu d'une génération pour les (salarié, mois) figés, ou `undefined` s'il n'y en a pas :
 * « Paie validée ou payée : Martine Mutombo (septembre 2026) — ses créneaux de ce mois n'ont pas
 * été touchés ». Chaque salarié est nommé avec CHACUN de ses mois figés : ses autres jours de la
 * période, eux, ont été planifiés.
 */
export function messageMoisFiges(verrous: Verrou[]): string | undefined {
  if (verrous.length === 0) return undefined;
  const tries = [...verrous].sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.annee - b.annee || a.mois - b.mois);
  const parSalarie = new Map<string, { nom: string; mois: string[] }>();
  for (const v of tries) {
    const s = parSalarie.get(v.employeeId) ?? { nom: v.nom, mois: [] };
    const libelle = `${MOIS_FR[v.mois - 1]} ${v.annee}`;
    if (!s.mois.includes(libelle)) s.mois.push(libelle);
    parSalarie.set(v.employeeId, s);
  }
  const salaries = [...parSalarie.values()];
  const plusieursMois = new Set(tries.map((v) => `${v.annee}-${v.mois}`)).size > 1;
  return `Paie validée ou payée : ${salaries.map((s) => `${s.nom} (${s.mois.join(", ")})`).join(", ")} — ` +
    `${salaries.length > 1 ? "leurs" : "ses"} créneaux de ${plusieursMois ? "ces mois" : "ce mois"} n'ont pas été touchés`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const cle = (employeeId: string, d: Date) => `${employeeId}|${iso(d)}`;
const JOUR_MS = 86_400_000;
const STATUTS_VERROUILLANTS = new Set(["VALIDE", "PAYE"]);

/**
 * Erreurs de PROGRAMMATION de l'appelant, levées avant toute lecture ou écriture : une date qui
 * n'est pas à minuit UTC (le verrou lit le mois en UTC, une heure locale de Kinshasa le 1er à 00:00
 * tomberait le mois précédent) ; deux opérations sur le même (salarié, jour), dont l'une serait
 * sinon perdue sans que personne ne le sache.
 */
function controlerOperations(operations: OperationCreneau[]): void {
  const vus = new Set<string>();
  for (const o of operations) {
    const t = o.date.getTime();
    if (Number.isNaN(t) || t % JOUR_MS !== 0) {
      const lue = Number.isNaN(t) ? "date invalide" : o.date.toISOString();
      throw new Error(`ecrireCreneaux : date non normalisée pour ${o.employeeId} (${lue}) : attendu minuit UTC`);
    }
    const k = cle(o.employeeId, o.date);
    if (vus.has(k)) throw new Error(`ecrireCreneaux : opération en double pour ${k}`);
    vus.add(k);
  }
}

/**
 * (salarié, mois) touchés par `operations` dont la ligne de paie est VALIDÉE ou PAYÉE.
 *
 * Les lignes de paie de CHAQUE paire (salarié, mois) sont lues `FOR SHARE`, QUEL QUE SOIT leur
 * statut : une validation concurrente (UPDATE de la ligne) attend donc la fin de la transaction
 * qui écrit le planning, et une validation déjà en cours fait attendre cette lecture, qui voit
 * alors le statut validé. Le statut est filtré APRÈS la lecture : ne verrouiller que les lignes
 * déjà validées laisserait passer la validation d'une ligne encore ouverte. Hors transaction, le
 * verrou tombe à la fin de la requête ; seul un vrai `tx` protège de la course.
 *
 * AVANT les lignes, la `PayrollRun` de chaque mois touché est lue `FOR SHARE` (revue finale du
 * 2026-09-24, point 4) : le recalcul de la paie (paie-refresh.ts) SUPPRIME puis recrée les lignes non
 * figées, un verrou sur elles ne le retient donc pas ; la run, elle, ne disparaît pas, et le recalcul
 * la prend `FOR UPDATE`. Il attend ainsi la fin de l'écriture du planning (et la voit), ou
 * l'inverse. Toujours la run d'abord, puis les lignes, comme la validation et le recalcul : jamais
 * d'interblocage entre eux.
 */
export async function verrousPlanning(tx: Prisma.TransactionClient, operations: OperationCreneau[]): Promise<Verrou[]> {
  if (operations.length === 0) return [];
  const moisTouches = [...new Set(operations.map((o) => `${o.date.getUTCFullYear()}|${o.date.getUTCMonth() + 1}`))].map((m) => {
    const [annee, mois] = m.split("|");
    return Prisma.sql`(${Number(annee)}::int, ${Number(mois)}::int)`;
  });
  await tx.$queryRaw`
    SELECT r."id" FROM "public"."PayrollRun" r
    WHERE (r."annee", r."mois") IN (VALUES ${Prisma.join(moisTouches)})
    ORDER BY r."id"
    FOR SHARE`;
  const paires = [...new Set(operations.map((o) => `${o.employeeId}|${o.date.getUTCFullYear()}|${o.date.getUTCMonth() + 1}`))].map((p) => {
    const [employeeId, annee, mois] = p.split("|");
    return Prisma.sql`(${employeeId}, ${Number(annee)}::int, ${Number(mois)}::int)`;
  });
  // ORDER BY l."id" : les verrous sont toujours pris dans le même ordre (pas d'interblocage entre
  // deux écritures de planning qui se recouvrent).
  const lignes = await tx.$queryRaw<{ employeeId: string; nom: string; mois: number; annee: number; statutPaiement: string }[]>`
    SELECT l."employeeId", e."nom", r."mois", r."annee", l."statutPaiement"::text AS "statutPaiement"
    FROM "public"."PayrollLine" l
    JOIN "public"."PayrollRun" r ON r."id" = l."payrollRunId"
    JOIN "public"."Employee" e ON e."id" = l."employeeId"
    WHERE (l."employeeId", r."annee", r."mois") IN (VALUES ${Prisma.join(paires)})
    ORDER BY l."id"
    FOR SHARE OF l`;
  return lignes
    .filter((l) => STATUTS_VERROUILLANTS.has(l.statutPaiement))
    .map((l) => ({ employeeId: l.employeeId, nom: l.nom, mois: Number(l.mois), annee: Number(l.annee) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.annee - b.annee || a.mois - b.mois);
}

/**
 * Applique `operations` au planning dans la transaction `tx` : contrôle des opérations (dates à
 * minuit UTC, au plus une par (salarié, jour)), puis verrou (rien n'est écrit si un seul
 * (salarié, mois) est verrouillé, même hors transaction), puis écriture, puis une entrée de
 * journal par créneau RÉELLEMENT changé. Renvoie le nombre de créneaux changés (le seul retrait du
 * marqueur ✨ ne compte pas : le shift, donc la paie, ne change pas).
 */
export async function ecrireCreneaux(
  tx: Prisma.TransactionClient,
  userId: string,
  operations: OperationCreneau[],
  opts: { genereAuto?: boolean } = {},
): Promise<number> {
  controlerOperations(operations);
  const verrous = await verrousPlanning(tx, operations);
  if (verrous.length > 0) throw new PlanningVerrouilleError(verrous);

  const existants = operations.length === 0 ? [] : await tx.planningCreneau.findMany({
    where: { OR: operations.map((o) => ({ employeeId: o.employeeId, date: o.date })) },
    select: { employeeId: true, date: true, shiftId: true, genereAuto: true },
  });
  const avant = new Map(existants.map((e) => [cle(e.employeeId, e.date), e.shiftId]));
  const marques = new Set(existants.filter((e) => e.genereAuto).map((e) => cle(e.employeeId, e.date)));
  const genereAuto = opts.genereAuto ?? false;

  const aDemarquer: OperationCreneau[] = [];
  const aEffacer: OperationCreneau[] = [];
  const aCreer: OperationCreneau[] = [];
  const aModifier: OperationCreneau[] = [];
  const journal: EntreeJournal[] = [];
  for (const o of operations) {
    const k = cle(o.employeeId, o.date);
    const ancien = avant.get(k) ?? null;
    if (ancien === o.shiftId) {
      // Même shift ressaisi À LA MAIN sur un créneau ✨ généré : il devient une décision humaine, on
      // retire le marqueur. Ce n'est pas un changement de planning : pas d'entrée de journal.
      if (ancien !== null && !genereAuto && marques.has(k)) aDemarquer.push(o);
      continue;
    }
    if (o.shiftId === null) aEffacer.push(o);
    else if (ancien === null) aCreer.push(o);
    else aModifier.push(o);
    journal.push({ entite: "PlanningCreneau", entiteId: k, champ: "shiftId", ancienneValeur: ancien, nouvelleValeur: o.shiftId, userId });
  }

  if (aEffacer.length > 0) {
    await tx.planningCreneau.deleteMany({ where: { OR: aEffacer.map((o) => ({ employeeId: o.employeeId, date: o.date })) } });
  }
  if (aCreer.length > 0) {
    await tx.planningCreneau.createMany({ data: aCreer.map((o) => ({ employeeId: o.employeeId, date: o.date, shiftId: o.shiftId!, genereAuto })) });
  }
  for (const o of aModifier) {
    await tx.planningCreneau.update({
      where: { employeeId_date: { employeeId: o.employeeId, date: o.date } },
      data: { shiftId: o.shiftId!, genereAuto },
    });
  }
  if (aDemarquer.length > 0) {
    await tx.planningCreneau.updateMany({
      where: { OR: aDemarquer.map((o) => ({ employeeId: o.employeeId, date: o.date })) },
      data: { genereAuto: false },
    });
  }
  await journaliserPlusieurs(tx, journal);
  return journal.length;
}

// ─── Shifts et modèle : ce que la paie relit à chaque calcul ────────────────────────────────────────
// `chargerJoursMois` (paie-reference-donnees.ts) relit les HEURES du shift de chaque créneau à chaque
// calcul, et le modèle hebdomadaire pour les jours dus sans créneau : les changer change la paie
// comme un créneau. Revue finale du 2026-09-24, point 2.

/** Heures d'un shift au sens de la paie : ce qui entre dans `dureeShift` et le drapeau système. */
export type HeuresShift = { heureDebut: string | null; heureFin: string | null; dureeHeures: number | null; systeme: boolean };

/** (salarié, mois) VALIDÉS ou PAYÉS où ce shift porte au moins un créneau — lignes lues FOR SHARE,
 *  comme pour un créneau (`verrousPlanning`) : une validation concurrente attend la fin de l'écriture. */
export async function verrousShift(tx: Prisma.TransactionClient, shiftId: string): Promise<Verrou[]> {
  const creneaux = await tx.planningCreneau.findMany({ where: { shiftId }, select: { employeeId: true, date: true } });
  const vus = new Set<string>();
  const operations: OperationCreneau[] = [];
  for (const c of creneaux) {
    const k = `${c.employeeId}|${c.date.getUTCFullYear()}|${c.date.getUTCMonth()}`;
    if (vus.has(k)) continue;
    vus.add(k);
    operations.push({ employeeId: c.employeeId, date: c.date, shiftId: null });
  }
  return verrousPlanning(tx, operations);
}

const libelleDuree = (h: HeuresShift) => {
  const duree = dureeShift({ heureDebut: h.heureDebut, heureFin: h.heureFin, dureeHeures: h.dureeHeures });
  return `${duree} h`;
};

/**
 * Modifie un shift. Le nom et la couleur (et le taux de rôle, ignoré par la paie) restent libres et
 * non journalisés. Changer ses HEURES (`heureDebut`, `heureFin`, `dureeHeures`, `systeme`) est refusé
 * (`ShiftVerrouilleError`) s'il porte un créneau dans un (salarié, mois) dont la paie est VALIDÉE ou
 * PAYÉE, et journalisé sinon : une entrée par champ changé, avant → après, plus la durée payée.
 */
export async function modifierShiftEnBase(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  donnees: { nom: string; couleur: string; tauxHoraireUSD: number | null; heureDebut: string | null; heureFin: string | null; dureeHeures: number | null },
): Promise<void> {
  // Verrou de la ligne du shift : deux modifications concurrentes ne journalisent pas le même « avant ».
  await tx.$queryRaw`SELECT "id" FROM "public"."Shift" WHERE "id" = ${id} FOR UPDATE`;
  const actuel = await tx.shift.findUniqueOrThrow({ where: { id } });
  const avant: HeuresShift = {
    heureDebut: actuel.heureDebut,
    heureFin: actuel.heureFin,
    dureeHeures: actuel.dureeHeures == null ? null : Number(actuel.dureeHeures),
    systeme: actuel.systeme,
  };
  // `systeme` n'est pas modifiable par l'écran : il est gardé tel quel.
  const apres: HeuresShift = { heureDebut: donnees.heureDebut, heureFin: donnees.heureFin, dureeHeures: donnees.dureeHeures, systeme: actuel.systeme };
  const champs = (["heureDebut", "heureFin", "dureeHeures", "systeme"] as const).filter((k) => avant[k] !== apres[k]);

  if (champs.length > 0) {
    const verrous = await verrousShift(tx, id);
    if (verrous.length > 0) throw new ShiftVerrouilleError(verrous);
    const journal: EntreeJournal[] = champs.map((champ) => ({
      entite: "Shift", entiteId: id, champ,
      ancienneValeur: avant[champ] == null ? null : String(avant[champ]),
      nouvelleValeur: apres[champ] == null ? null : String(apres[champ]),
      userId,
    }));
    if (libelleDuree(avant) !== libelleDuree(apres)) {
      journal.push({ entite: "Shift", entiteId: id, champ: "duree", ancienneValeur: libelleDuree(avant), nouvelleValeur: libelleDuree(apres), userId });
    }
    await journaliserPlusieurs(tx, journal);
  }

  await tx.shift.update({
    where: { id },
    data: {
      nom: donnees.nom,
      couleur: donnees.couleur,
      tauxHoraireUSD: donnees.tauxHoraireUSD,
      heureDebut: apres.heureDebut,
      heureFin: apres.heureFin,
      dureeHeures: apres.dureeHeures,
    },
  });
}

/**
 * Enregistre (ou efface, `shiftId: null`) le shift du MODÈLE d'un salarié pour un jour (0=dim…6=sam)
 * et une couche (0=chaque semaine, 1=A, 2=B), et le journalise (entité `PlanningModele`, id
 * « salarié|jour|couche », avant → après). Pas de verrou : le modèle n'est pas daté et ne sert qu'aux
 * jours dus sans créneau. Renvoie vrai si le modèle a changé.
 */
export async function ecrireModele(
  tx: Prisma.TransactionClient,
  userId: string,
  m: { employeeId: string; jour: number; semaine: number; shiftId: string | null },
): Promise<boolean> {
  const cleModele = { employeeId: m.employeeId, jour: m.jour, semaine: m.semaine };
  const existant = await tx.planningModele.findUnique({ where: { employeeId_jour_semaine: cleModele }, select: { shiftId: true } });
  const ancien = existant?.shiftId ?? null;
  if (ancien === m.shiftId) return false;
  if (m.shiftId === null) {
    await tx.planningModele.deleteMany({ where: cleModele });
  } else {
    await tx.planningModele.upsert({
      where: { employeeId_jour_semaine: cleModele },
      update: { shiftId: m.shiftId },
      create: { ...cleModele, shiftId: m.shiftId },
    });
  }
  await journaliserPlusieurs(tx, [{
    entite: "PlanningModele",
    entiteId: `${m.employeeId}|${m.jour}|${m.semaine}`,
    champ: "shiftId",
    ancienneValeur: ancien,
    nouvelleValeur: m.shiftId,
    userId,
  }]);
  return true;
}
