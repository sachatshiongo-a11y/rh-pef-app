"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { dureeShift } from "./creneaux";
import { genererPlanning, type RaisonNonCouverture, type CauseDepassement } from "@/lib/planning-auto";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { notifierSalarie, compteSalarieDe, supprimerNotificationsPour } from "@/lib/notifications";
import { finaliserEchangeSiComplet } from "@/lib/echange-creneau";
import { ecrireCreneaux, messageErreurPlanning, verrousPlanning, type OperationCreneau } from "@/lib/planning-ecriture";
import { MOIS_FR, MOIS_FR_COURT } from "@/lib/dates-fr";
import type { Prisma } from "@prisma/client";

/** Délai des transactions d'écriture du planning en lot ou par génération (une requête `update`
 *  par créneau modifié : un mois entier régénéré peut en compter plusieurs centaines). */
const DELAI_ECRITURE_PLANNING = 60_000;

/**
 * Écrit des créneaux par le SEUL chemin autorisé (verrou de paie + journal d'audit), dans une
 * transaction interactive. Renvoie `{ erreur }` au lieu de lever quand le planning est verrouillé
 * ou qu'un interblocage avec une validation de paie a annulé l'écriture : l'écran l'affiche (Next
 * masque le message des erreurs levées en production).
 */
async function ecrireOuRefuser(userId: string, operations: OperationCreneau[], opts: { genereAuto?: boolean } = {}): Promise<{ erreur?: string }> {
  try {
    await prisma.$transaction((tx) => ecrireCreneaux(tx, userId, operations, opts), { timeout: DELAI_ECRITURE_PLANNING });
    return {};
  } catch (e) {
    const erreur = messageErreurPlanning(e);
    if (erreur) return { erreur };
    throw e;
  }
}

/** Enregistre / efface le shift d'un employé pour un jour. shiftId vide = effacer. */
export async function saisirCreneau(employeeId: string, dateIso: string, shiftId: string): Promise<{ erreur?: string }> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  // Date stockée en UTC minuit du bon jour (évite le décalage de fuseau). Une modif manuelle retire
  // le marqueur ✨ (genereAuto: false), même quand le shift ressaisi est le même.
  const date = new Date(dateIso + "T00:00:00Z");
  const r = await ecrireOuRefuser(user.id, [{ employeeId, date, shiftId: shiftId || null }]);
  revalidatePath("/planning");
  return r;
}

/** Enregistre / efface le shift du MODÈLE d'un employé pour un jour (0=dim…6=sam) et une couche
 *  de semaine (0=chaque semaine, 1=semaine A, 2=semaine B). */
export async function saisirModele(employeeId: string, jour: number, shiftId: string, semaine = 0) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  if (jour < 0 || jour > 6 || semaine < 0 || semaine > 2) return;
  if (!shiftId) {
    await prisma.planningModele.deleteMany({ where: { employeeId, jour, semaine } });
  } else {
    await prisma.planningModele.upsert({
      where: { employeeId_jour_semaine: { employeeId, jour, semaine } },
      update: { shiftId },
      create: { employeeId, jour, semaine, shiftId },
    });
  }
  revalidatePath("/planning");
}

/** Résumé renvoyé au formulaire de génération. Reprend le rapport du moteur, enrichi des noms
 *  lisibles (le moteur ne connaît que des identifiants). */
export type ResumeGeneration = {
  crees: number;
  trous: { date: string; libelle: string; manque: number; raison: RaisonNonCouverture }[];
  sansShiftPoste: { nom: string; poste: string }[];
  /** Une entrée par (salarié × semaine) : une génération au mois produit normalement plusieurs
   *  entrées pour un même salarié (une par semaine touchée) — voir `personnesEnDepassement` pour le
   *  nombre de PERSONNES distinctes concernées. */
  depassements: { nom: string; semaine: string; heuresPlanifiees: number; heuresContractuelles: number; cause: CauseDepassement }[];
  /** Nombre de salariés DISTINCTS concernés par un dépassement — jamais `depassements.length`, qui
   *  compte des lignes (une par semaine), pas des personnes. */
  personnesEnDepassement: number;
  sousHeures: number;
  /** Refus de l'écriture (interblocage avec une validation de paie) : rien n'a été écrit. */
  erreur?: string;
  /** « N salariés ignorés : paie validée ou payée (noms). » — salariés dont la paie d'un mois de la
   *  période est validée ou payée : aucun de leurs créneaux de la période n'a été touché. */
  salariesIgnores?: string;
  /** Besoins/modèles ignorés car pointant sur un shift désactivé ou supprimé — nom si résolu, sinon identifiant brut. */
  shiftsInconnus: string[];
};

/** Nombre de semaines d'historique lues pour l'équité (rotation des dimanches/fériés et des shifts). */
const SEMAINES_HISTORIQUE = 8;

/**
 * Génère automatiquement le planning sur une période. Ne fait plus que lire, appeler le moteur
 * (`src/lib/planning-auto.ts`, pur et testé) et écrire — toute la logique métier est là-bas.
 */
export async function genererPlanningAuto(
  debutIso: string,
  finIso: string,
  formData: FormData,
): Promise<ResumeGeneration> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const vide: ResumeGeneration = { crees: 0, trous: [], sansShiftPoste: [], depassements: [], personnesEnDepassement: 0, sousHeures: 0, shiftsInconnus: [] };
  const debut = new Date(debutIso + "T00:00:00.000Z");
  const fin = new Date(finIso + "T00:00:00.000Z");
  if (isNaN(debut.getTime()) || isNaN(fin.getTime()) || debut > fin) return vide;

  const ecraser = formData.get("ecraser") === "on";
  const debutHistorique = new Date(debut.getTime() - SEMAINES_HISTORIQUE * 7 * 86_400_000);
  const veilleDebut = new Date(debut.getTime() - 86_400_000);

  const [employes, shiftsRows, feries, existants, historique, modeles, besoins, polyvalences, shiftsPoste, conges] =
    await Promise.all([
      prisma.employee.findMany({
        where: { actif: true },
        select: { id: true, nom: true, poste: true, secteur: true, heuresParJour: true, heuresHebdomadaires: true },
      }),
      prisma.shift.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
      // Fenêtre élargie à l'historique (A6) : l'équité fait tourner les jours pénibles (dimanches ET
      // fériés) sur les 8 semaines d'historique — un férié travaillé avant la période doit compter,
      // sinon la rotation triche sans le savoir. `feriesIso`, dans le moteur, ne filtre que les jours
      // DE la période pour `joursPeriode` ; les dates d'historique n'y jouent aucun rôle, elles ne
      // servent qu'à l'équité (`estPenible` sur `entrees.historique`) — élargir n'a donc aucun effet
      // de bord sur la couverture.
      prisma.jourFerie.findMany({ where: { date: { gte: debutHistorique, lte: fin } } }),
      prisma.planningCreneau.findMany({ where: { date: { gte: debut, lte: fin } }, select: { employeeId: true, date: true, shiftId: true } }),
      prisma.planningCreneau.findMany({ where: { date: { gte: debutHistorique, lte: veilleDebut } }, select: { employeeId: true, date: true, shiftId: true } }),
      formData.get("modeles") === "on" ? prisma.planningModele.findMany() : Promise.resolve([]),
      prisma.besoinShift.findMany(),
      prisma.polyvalencePoste.findMany(),
      prisma.shiftPoste.findMany({ orderBy: { ordre: "asc" } }),
      prisma.leaveRequest.findMany({
        where: { statut: "APPROUVE", dateDebut: { lte: fin }, dateFin: { gte: debut } },
        select: { employeeId: true, dateDebut: true, dateFin: true },
      }),
    ]);

  // Salariés dont la paie d'un mois de la période est VALIDÉE ou PAYÉE : écartés D'AVANCE du moteur
  // (leur planning est une pièce de paie figée), pour qu'un seul salarié verrouillé ne fasse pas
  // échouer la génération de toute l'équipe. Contrôle définitif sous verrou partagé plus bas.
  const moisPeriode: Date[] = [];
  for (let m = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth(), 1)); m <= fin; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    moisPeriode.push(m);
  }
  const verrousAvant = await verrousPlanning(
    prisma,
    employes.flatMap((e) => moisPeriode.map((date) => ({ employeeId: e.id, date, shiftId: null }))),
  );
  const ignores = new Map(verrousAvant.map((v) => [v.employeeId, v.nom]));
  const employesLibres = employes.filter((e) => !ignores.has(e.id));

  const shiftIdParam = String(formData.get("shiftId") ?? "").trim();
  const joursParam = formData.getAll("jours").map(Number).filter((n) => n >= 0 && n <= 6);

  const { creneaux, rapport } = genererPlanning({
    debut,
    fin,
    employes: employesLibres.map((e) => ({
      id: e.id, nom: e.nom, poste: e.poste, secteur: e.secteur,
      heuresParJour: Number(e.heuresParJour), heuresHebdomadaires: Number(e.heuresHebdomadaires),
    })),
    shifts: shiftsRows.map((s) => ({
      id: s.id, nom: s.nom,
      dureeHeures: dureeShift({
        heureDebut: s.heureDebut, heureFin: s.heureFin,
        dureeHeures: s.dureeHeures == null ? null : Number(s.dureeHeures),
      }),
    })),
    besoins: besoins.map((b) => ({ shiftId: b.shiftId, poste: b.poste, jourSemaine: b.jourSemaine, nombreRequis: b.nombreRequis })),
    shiftsPoste: shiftsPoste.map((s) => ({ poste: s.poste, shiftId: s.shiftId, ordre: s.ordre })),
    polyvalences: polyvalences.map((p) => ({ posteSource: p.posteSource, posteCible: p.posteCible })),
    modeles: modeles.map((m) => ({ employeeId: m.employeeId, jour: m.jour, semaine: m.semaine, shiftId: m.shiftId })),
    conges: conges.map((c) => ({ employeeId: c.employeeId, dateDebut: c.dateDebut, dateFin: c.dateFin })),
    feries: feries.map((f) => f.date),
    existants,
    historique,
    options: {
      shiftId: shiftIdParam || undefined,
      jours: joursParam,
      nbParSemaine: Number(formData.get("nbParSemaine") ?? 0) || 0,
      inclureFeries: formData.get("inclureFeries") === "on",
      utiliserModeles: formData.get("modeles") === "on",
      ecraser,
      completer: formData.get("completer") === "on",
      autoriserDepassementHeures: formData.get("depassement") === "on",
    },
  });

  // Mêmes effets qu'avant (« écraser » vidait la période puis recréait ; sinon `skipDuplicates`
  // gardait les créneaux existants), exprimés en OPÉRATIONS pour passer par le verrou et le journal :
  //   - mode normal : on ne pose que sur les jours encore vides (un créneau existant n'est pas touché) ;
  //   - « écraser » : un jour effacé ET reposé = UNE opération (la pose) ; les autres créneaux de la
  //     période deviennent des effacements explicites (`shiftId: null`).
  // Les créneaux existants sont RELUS dans la transaction : l'état lu avant le moteur peut avoir bougé.
  const cleCreneau = (employeeId: string, date: Date) => `${employeeId}|${date.toISOString().slice(0, 10)}`;
  // Au plus une pose par (salarié, jour), la première l'emporte (comme `skipDuplicates` avant).
  const vus = new Set<string>();
  const uniques = creneaux.filter((c) => {
    const k = cleCreneau(c.employeeId, c.date);
    if (vus.has(k)) return false;
    vus.add(k);
    return true;
  });
  let posees = 0;
  try {
    posees = await prisma.$transaction(async (tx) => {
      const actuels = await tx.planningCreneau.findMany({
        where: { date: { gte: debut, lte: fin } },
        select: { employeeId: true, date: true },
      });
      const actuelsCles = new Set(actuels.map((x) => cleCreneau(x.employeeId, x.date)));
      const nouveaux = uniques.filter((c) => ecraser || !actuelsCles.has(cleCreneau(c.employeeId, c.date)));
      const nouveauxCles = new Set(nouveaux.map((c) => cleCreneau(c.employeeId, c.date)));
      const operations: OperationCreneau[] = [
        ...(ecraser
          ? actuels
              .filter((x) => !nouveauxCles.has(cleCreneau(x.employeeId, x.date)))
              .map((x) => ({ employeeId: x.employeeId, date: x.date, shiftId: null }))
          : []),
        ...nouveaux.map((c) => ({ employeeId: c.employeeId, date: c.date, shiftId: c.shiftId })),
      ];
      // Contrôle définitif, sous verrou partagé (FOR SHARE) : attrape les salariés hors moteur
      // (inactifs dont « écraser » effacerait les créneaux) et une validation survenue entre-temps.
      const verrous = await verrousPlanning(tx, operations);
      for (const v of verrous) ignores.set(v.employeeId, v.nom);
      const aEcrire = operations.filter((o) => !ignores.has(o.employeeId));
      await ecrireCreneaux(tx, user.id, aEcrire, { genereAuto: true });
      return aEcrire.filter((o) => o.shiftId !== null).length;
    }, { timeout: DELAI_ECRITURE_PLANNING });
  } catch (e) {
    const erreur = messageErreurPlanning(e);
    if (erreur) return { ...vide, erreur };
    throw e;
  }
  revalidatePath("/planning");
  const nomsIgnores = [...new Set(ignores.values())].sort((a, b) => a.localeCompare(b, "fr"));
  const n = nomsIgnores.length;
  const salariesIgnores = n === 0
    ? undefined
    : `${n} salarié${n > 1 ? "s" : ""} ignoré${n > 1 ? "s" : ""} : paie validée ou payée (${nomsIgnores.join(", ")}).`;

  // Identifiants → noms lisibles, uniquement pour l'affichage.
  const nomEmp = new Map(employes.map((e) => [e.id, e.nom]));
  const nomShift = new Map(shiftsRows.map((s) => [s.id, s.nom]));

  // Shifts ignorés (désactivés/supprimés) : shiftsRows ne contient que les shifts ACTIFS, on
  // résout donc leur nom séparément — au pire on affiche l'identifiant brut.
  let nomShiftInconnu = new Map<string, string>();
  if (rapport.shiftsInconnus.length > 0) {
    const rows = await prisma.shift.findMany({
      where: { id: { in: rapport.shiftsInconnus } },
      select: { id: true, nom: true },
    });
    nomShiftInconnu = new Map(rows.map((s) => [s.id, s.nom]));
  }

  return {
    crees: posees,
    salariesIgnores,
    trous: rapport.trous.map((t) => ({
      date: t.date.toISOString().slice(0, 10),
      libelle: `${t.date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · ${nomShift.get(t.shiftId) ?? "shift"} × ${t.poste}`,
      manque: t.manque,
      raison: t.raison,
    })),
    sansShiftPoste: rapport.sansShiftPoste.map((s) => ({ nom: nomEmp.get(s.employeeId) ?? "—", poste: s.poste })),
    depassements: rapport.depassements.map((x) => ({
      nom: nomEmp.get(x.employeeId) ?? "—",
      // Lundi de la semaine concernée, formaté en français, court — ex. « sem. du 6 juil. » —
      // indispensable dès qu'une génération au mois produit plusieurs entrées pour le même salarié.
      semaine: `sem. du ${x.lundi.getUTCDate()} ${MOIS_FR_COURT[x.lundi.getUTCMonth()]}`,
      heuresPlanifiees: x.heuresPlanifiees,
      heuresContractuelles: x.heuresContractuelles,
      cause: x.cause,
    })),
    personnesEnDepassement: new Set(rapport.depassements.map((x) => x.employeeId)).size,
    sousHeures: rapport.sousHeures.length,
    shiftsInconnus: rapport.shiftsInconnus.map((id) => nomShiftInconnu.get(id) ?? id),
  };
}

/**
 * Renumérote séquentiellement (0, 1, 2, …) les shifts d'un poste, dans leur ordre actuel — appelée
 * après un retrait ou un déplacement. L'ordre pilote quel shift la génération auto essaie en
 * premier : il doit rester strictement séquentiel, sans trou ni doublon, jamais dépendant de l'ordre
 * d'insertion en base.
 */
async function renumeroterShiftsPoste(tx: Prisma.TransactionClient, poste: string) {
  const lignes = await tx.shiftPoste.findMany({ where: { poste }, orderBy: { ordre: "asc" } });
  await Promise.all(
    lignes.map((l, i) => (l.ordre === i ? null : tx.shiftPoste.update({ where: { id: l.id }, data: { ordre: i } }))),
  );
}

/** Déclare qu'un poste peut tenir un shift, à la position donnée dans l'ordre de préférence. */
export async function definirShiftPoste(poste: string, shiftId: string, ordre: number) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const p = poste.trim();
  if (!p || !shiftId) return;
  await prisma.shiftPoste.upsert({
    where: { poste_shiftId: { poste: p, shiftId } },
    create: { poste: p, shiftId, ordre },
    update: { ordre },
  });
  revalidatePath("/planning");
}

/** Retire un shift de la liste des shifts acceptables d'un poste, puis renumérote le reste (compact,
 *  sans trou) — sinon deux lignes peuvent finir avec le même `ordre`, et le tri devient dépendant de
 *  l'ordre de retour de la base. */
export async function supprimerShiftPoste(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  await prisma.$transaction(async (tx) => {
    const sp = await tx.shiftPoste.findUnique({ where: { id }, select: { poste: true } });
    if (!sp) return;
    await tx.shiftPoste.delete({ where: { id } });
    await renumeroterShiftsPoste(tx, sp.poste);
  });
  revalidatePath("/planning");
}

/**
 * Déplace un shift d'un cran dans l'ordre de préférence de son poste (monter = essayé plus tôt par
 * la génération auto). Sans effet aux extrémités. Renumérote tout le poste après coup, ce qui
 * corrige au passage d'éventuels doublons d'`ordre` hérités d'avant ce correctif.
 */
export async function deplacerShiftPoste(id: string, direction: "haut" | "bas") {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  await prisma.$transaction(async (tx) => {
    const sp = await tx.shiftPoste.findUnique({ where: { id }, select: { poste: true } });
    if (!sp) return;
    const lignes = await tx.shiftPoste.findMany({ where: { poste: sp.poste }, orderBy: { ordre: "asc" } });
    const idx = lignes.findIndex((l) => l.id === id);
    const cible = direction === "haut" ? idx - 1 : idx + 1;
    if (idx === -1 || cible < 0 || cible >= lignes.length) return; // déjà à une extrémité
    [lignes[idx], lignes[cible]] = [lignes[cible], lignes[idx]];
    await Promise.all(lignes.map((l, i) => tx.shiftPoste.update({ where: { id: l.id }, data: { ordre: i } })));
  });
  revalidatePath("/planning");
}

/** Affecte (ou efface) un shift en LOT : plusieurs employés × plusieurs jours en un aller-retour. */
export async function saisirCreneauxEnLot(
  entrees: { employeeId: string; dateIso: string; shiftId: string }[]
): Promise<{ erreur?: string }> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  // Saisie manuelle groupée → retire le marqueur ✨ ; tout ou rien si un salarié est verrouillé.
  const r = await ecrireOuRefuser(
    user.id,
    entrees.map((e) => ({ employeeId: e.employeeId, date: new Date(e.dateIso + "T00:00:00Z"), shiftId: e.shiftId || null })),
  );
  revalidatePath("/planning");
  return r;
}

function lireHeure(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, "0") : null;
}

function lireNombre(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Ajoute un nouveau shift configurable. */
export async function creerShift(formData: FormData) {
  await formulaireLisible("/planning", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const nom = String(formData.get("nom") ?? "").trim();
    if (!nom) throw new Error("Le nom du shift est requis.");
    const couleur = String(formData.get("couleur") ?? "indigo");
    const dernier = await prisma.shift.findFirst({ orderBy: { ordre: "desc" } });

    await prisma.shift.create({
      data: {
        nom,
        heureDebut: lireHeure(formData.get("heureDebut")),
        heureFin: lireHeure(formData.get("heureFin")),
        couleur,
        dureeHeures: lireNombre(formData.get("dureeHeures")),
        tauxHoraireUSD: lireNombre(formData.get("tauxHoraireUSD")),
        ordre: (dernier?.ordre ?? 0) + 1,
      },
    });
    revalidatePath("/planning");

  });
}

/** Modifie un shift existant (nom, heures, couleur). */
export async function modifierShift(formData: FormData) {
  await formulaireLisible("/planning", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const id = String(formData.get("id"));
    const nom = String(formData.get("nom") ?? "").trim();
    if (!nom) throw new Error("Le nom du shift est requis.");

    await prisma.shift.update({
      where: { id },
      data: {
        nom,
        heureDebut: lireHeure(formData.get("heureDebut")),
        heureFin: lireHeure(formData.get("heureFin")),
        couleur: String(formData.get("couleur") ?? "indigo"),
        dureeHeures: lireNombre(formData.get("dureeHeures")),
        tauxHoraireUSD: lireNombre(formData.get("tauxHoraireUSD")),
      },
    });
    revalidatePath("/planning");

  });
}

/**
 * Supprime un shift. Les shifts « système » (Repos/Congé/Férié) ne sont pas supprimables.
 * S'il est utilisé dans un planning, on le désactive (actif=false) pour préserver l'historique
 * plutôt que de le supprimer.
 */
export async function supprimerShift(id: string) {
  await formulaireLisible("/planning", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const shift = await prisma.shift.findUnique({ where: { id }, include: { _count: { select: { creneaux: true } } } });
    if (!shift) return;
    if (shift.systeme) throw new Error("Ce shift système ne peut pas être supprimé.");

    if (shift._count.creneaux > 0) {
      await prisma.shift.update({ where: { id }, data: { actif: false } });
    } else {
      await prisma.shift.delete({ where: { id } });
    }
    revalidatePath("/planning");

  });
}

/** Réactive un shift désactivé. */
export async function reactiverShift(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  await prisma.shift.update({ where: { id }, data: { actif: true } });
  revalidatePath("/planning");
}

/**
 * Définit l'effectif requis pour un shift × poste × jour de la semaine (0=dim…6=sam).
 * nombreRequis ≤ 0 efface le besoin. Pilote la génération auto « couverture d'abord ».
 */
export async function definirBesoin(shiftId: string, posteBrut: string, jourSemaine: number, nombreRequis: number) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const poste = posteBrut.trim(); // espaces fantômes = besoins jamais matchés
  if (!shiftId || !poste || jourSemaine < 0 || jourSemaine > 6) return;
  const n = Math.round(Number(nombreRequis) || 0);
  if (n <= 0) {
    await prisma.besoinShift.deleteMany({ where: { shiftId, poste, jourSemaine } });
  } else {
    await prisma.besoinShift.upsert({
      where: { shiftId_poste_jourSemaine: { shiftId, poste, jourSemaine } },
      update: { nombreRequis: n },
      create: { shiftId, poste, jourSemaine, nombreRequis: n },
    });
  }
  revalidatePath("/planning");
}

/** Déclare qu'un poste peut en couvrir un autre au planning (ex. « Chef » couvre « Commis cuisine »). */
export async function definirPolyvalence(posteSource: string, posteCible: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const src = posteSource.trim(), cible = posteCible.trim();
  if (!src || !cible || src === cible) return;
  await prisma.polyvalencePoste.upsert({
    where: { posteSource_posteCible: { posteSource: src, posteCible: cible } },
    update: {},
    create: { posteSource: src, posteCible: cible },
  });
  revalidatePath("/planning");
}

export async function supprimerPolyvalence(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  await prisma.polyvalencePoste.delete({ where: { id } });
  revalidatePath("/planning");
}

/** Publie une semaine de planning (visible par les salariés dans leur espace). `lundiIso` = lundi UTC. */
export async function publierSemaine(lundiIso: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const lundi = new Date(lundiIso + "T00:00:00Z");
  const dejaPubliee = await prisma.semainePubliee.findUnique({ where: { lundi }, select: { id: true } });
  await prisma.semainePubliee.upsert({
    where: { lundi },
    update: { publieeParId: user.id },
    create: { lundi, publieeParId: user.id },
  });

  // À la PREMIÈRE publication de cette semaine, notifier les salariés qui y ont des créneaux
  // (cloche perso + push). On ne re-notifie pas une re-publication (évite le spam).
  if (!dejaPubliee) {
    const dim = new Date(lundi); dim.setUTCDate(dim.getUTCDate() + 6);
    const creneaux = await prisma.planningCreneau.findMany({
      where: { date: { gte: lundi, lte: dim } },
      select: { employeeId: true },
      distinct: ["employeeId"],
    });
    if (creneaux.length > 0) {
      const comptes = await prisma.user.findMany({
        where: { role: { in: ["EMPLOYE", "STOCK"] }, actif: true, employeeId: { in: creneaux.map((c) => c.employeeId) } },
        select: { id: true },
      });
      const label = `${lundi.getUTCDate()} ${MOIS_FR[lundi.getUTCMonth()]}`;
      await Promise.all(comptes.map((c) => notifierSalarie(c.id, {
        type: "PLANNING",
        message: `Votre planning de la semaine du ${label} est publié.`,
        lien: "/espace/planning",
        refId: `planning:${lundiIso}`,
      })));
    }
  }

  revalidatePath("/planning");
  revalidatePath("/espace/planning");
  revalidatePath("/espace");
}

/** Retire une semaine de la publication (les salariés ne la voient plus). */
export async function depublierSemaine(lundiIso: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const lundi = new Date(lundiIso + "T00:00:00Z");
  await prisma.semainePubliee.deleteMany({ where: { lundi } });
  revalidatePath("/planning");
  revalidatePath("/espace/planning");
  revalidatePath("/espace");
}

/** Direction : approuve une demande de changement de shift → met à jour le planning + notifie le salarié. */
export async function approuverChangementShift(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const dem = await prisma.demandeChangementShift.findUnique({ where: { id } });
  if (!dem || dem.statut !== "EN_ATTENTE") return;

  // Transaction INTERACTIVE : le créneau et l'approbation passent ensemble, ou rien (jamais une
  // demande « approuvée » sans son créneau). `dem.date` vient d'une colonne @db.Date : minuit UTC.
  try {
    await prisma.$transaction(async (tx) => {
      await ecrireCreneaux(tx, user.id, [{ employeeId: dem.employeeId, date: dem.date, shiftId: dem.shiftDemandeId }]);
      await tx.demandeChangementShift.update({ where: { id }, data: { statut: "APPROUVE", decideParId: user.id } });
    });
  } catch (e) {
    const erreur = messageErreurPlanning(e);
    if (erreur) redirect(`/a-valider?erreur=${encodeURIComponent(erreur)}`);
    throw e;
  }

  const [shift, userId] = await Promise.all([
    prisma.shift.findUnique({ where: { id: dem.shiftDemandeId }, select: { nom: true } }),
    compteSalarieDe(dem.employeeId),
  ]);
  if (userId) await notifierSalarie(userId, {
    type: "PLANNING",
    message: `Votre changement de shift du ${dem.date.toLocaleDateString("fr-FR", { timeZone: "UTC" })} (${shift?.nom ?? ""}) a été approuvé ✅.`,
    lien: "/espace/planning",
    refId: `${id}:decision`,
  });
  await supprimerNotificationsPour(id);
  revalidatePath("/planning");
  revalidatePath("/a-valider");
  revalidatePath("/espace/planning");
  revalidatePath("/", "layout");
}

/** Direction : refuse une demande de changement de shift → notifie le salarié. */
export async function refuserChangementShift(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const dem = await prisma.demandeChangementShift.findUnique({ where: { id } });
  if (!dem || dem.statut !== "EN_ATTENTE") return;
  await prisma.demandeChangementShift.update({ where: { id }, data: { statut: "REFUSE", decideParId: user.id } });

  const userId = await compteSalarieDe(dem.employeeId);
  if (userId) await notifierSalarie(userId, {
    type: "PLANNING",
    message: `Votre demande de changement de shift du ${dem.date.toLocaleDateString("fr-FR", { timeZone: "UTC" })} a été refusée.`,
    lien: "/espace/planning",
    refId: `${id}:decision`,
  });
  await supprimerNotificationsPour(id);
  revalidatePath("/a-valider");
  revalidatePath("/espace/planning");
  revalidatePath("/", "layout");
}

/** Direction : approuve un échange de créneau. Le swap n'a lieu que si le collègue a aussi accepté. */
export async function approuverEchange(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const e = await prisma.echangeCreneau.findUnique({ where: { id } });
  if (!e || e.statut !== "EN_ATTENTE") return;
  await prisma.echangeCreneau.update({ where: { id }, data: { reponseDirection: "APPROUVE" } });
  const { fait, erreur } = await finaliserEchangeSiComplet(id, user.id);
  if (erreur) redirect(`/a-valider?erreur=${encodeURIComponent(erreur)}`);
  if (!fait) {
    // En attente du collègue : le prévenir qu'il ne manque que sa réponse.
    const uB = await compteSalarieDe(e.collegueId);
    if (uB) await notifierSalarie(uB, { type: "PLANNING", message: "La Direction a approuvé un échange de shift vous concernant — votre accord est attendu.", lien: "/espace/echanges", refId: `${id}:dir` });
  }
  revalidatePath("/a-valider");
  revalidatePath("/espace/echanges");
  revalidatePath("/planning");
  revalidatePath("/", "layout");
}

/** Direction : refuse un échange de créneau → clôt la demande et prévient les deux salariés. */
export async function refuserEchange(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const e = await prisma.echangeCreneau.findUnique({ where: { id } });
  if (!e || e.statut !== "EN_ATTENTE") return;
  await prisma.echangeCreneau.update({ where: { id }, data: { reponseDirection: "REFUSE", statut: "REFUSE" } });
  await supprimerNotificationsPour(id);
  const [uA, uB] = await Promise.all([compteSalarieDe(e.demandeurId), compteSalarieDe(e.collegueId)]);
  const msg = "Un échange de shift a été refusé par la Direction.";
  if (uA) await notifierSalarie(uA, { type: "PLANNING", message: msg, lien: "/espace/echanges", refId: `${id}:dir` });
  if (uB) await notifierSalarie(uB, { type: "PLANNING", message: msg, lien: "/espace/echanges", refId: `${id}:dir` });
  revalidatePath("/a-valider");
  revalidatePath("/espace/echanges");
  revalidatePath("/", "layout");
}
