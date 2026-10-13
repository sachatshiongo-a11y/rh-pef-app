"use server";

import { messageLisible } from "@/lib/erreur-metier";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { calculerJoursOuvrables } from "@/lib/payroll";
import { ecartJoursSoumis } from "@/lib/jours-ouvrables";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { creerNotification, supprimerNotificationsPour, notifierSalarie, compteSalarieDe } from "@/lib/notifications";
import { poserCodesConge, retirerCodesConge, chargerPreloadConges, noteMoisFige } from "@/lib/conges-presences";
import {
  demandeQuiRecouvre, exigerAucunRecouvrement, exigerRemplacantDisponible, exigerTypeCongeUtilisable, messageRecouvrement, verrouillerCongesSalarie,
} from "@/lib/conges-regles";
import { MAX_SUPPRESSIONS_PAR_LOT, verifierMotifRefus } from "@/lib/conges-liste";
import { reinitialiserCacheAValider } from "@/lib/a-valider-chargeurs";
import { figerSoldesApprobation, INSTANTANE_SOLDE_EFFACE, resumeInstantane } from "@/lib/solde-conge-fige";

/**
 * Délai de la transaction d'approbation EN LOT : une écriture de statut et une d'instantané par
 * demande, plus 4 lectures pour tous les soldes. Le délai par défaut de Prisma (5 s) est court
 * pour un lot d'une trentaine de demandes sur une base distante.
 */
const DELAI_APPROBATION_LOT = 60_000;
/** Délai d'une transaction d'approbation UNITAIRE (statut + instantané d'une seule demande). */
const DELAI_APPROBATION_UNITAIRE = 15_000;

function revaliderConges() {
  revalidatePath("/conges");
  revalidatePath("/presences");
  revalidatePath("/heures-supp");
  revalidatePath("/a-valider");
  revalidatePath("/employes");
  revalidatePath("/", "layout");
  revalidatePath("/accueil");
}

export async function demanderConge(formData: FormData) {
  return formulaireLisible("/conges", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const employeeId = String(formData.get("employeeId"));
    const type = String(formData.get("type"));
    const dateDebut = new Date(String(formData.get("dateDebut")));
    const dateFin = new Date(String(formData.get("dateFin")));
    if (Number.isNaN(dateDebut.getTime()) || Number.isNaN(dateFin.getTime())) throw new Error("Dates requises.");
    if (dateFin < dateDebut) throw new Error("La date de fin doit être après la date de début.");
    // Jours ouvrables : dimanches ET jours fériés exclus du décompte.
    const feries = await prisma.jourFerie.findMany({ where: { date: { gte: dateDebut, lte: dateFin } }, select: { date: true } });
    const nbJours = calculerJoursOuvrables(dateDebut, dateFin, feries.map((f) => f.date));
    if (nbJours <= 0) throw new Error("La période ne contient aucun jour ouvrable (dimanches et fériés exclus).");
    // Le formulaire a affiché un nombre : il doit être celui-ci, sinon on refuse plutôt que d'enregistrer autre chose.
    const ecart = ecartJoursSoumis(formData.get("nbJours"), nbJours);
    if (ecart) throw new Error(ecart);
    const motif = String(formData.get("motif") ?? "").trim() || null;
    const remplacantId = String(formData.get("remplacantId") ?? "").trim() || null;
    // Le type fait foi côté serveur : il existe et il est actif (sinon le nom libre décidait du solde et du taux).
    await exigerTypeCongeUtilisable(prisma, type);
    await exigerRemplacantDisponible(prisma, { remplacantId, employeeId, dateDebut, dateFin });

    // La Direction n'a pas à valider ses propres demandes : approuvée d'office (comme les BC).
    const autoValide = user.role === "ADMIN";
    // Approuvée d'office = approuvée : le solde est figé dans la même transaction que la création.
    // Le recouvrement se contrôle DANS la transaction, sous le verrou du salarié : deux envois
    // simultanés du même congé ne passent plus tous les deux.
    const demande = await prisma.$transaction(async (tx) => {
      await verrouillerCongesSalarie(tx, employeeId);
      await exigerAucunRecouvrement(tx, { employeeId, dateDebut, dateFin });
      const d = await tx.leaveRequest.create({
        data: { employeeId, type, dateDebut, dateFin, nbJours, motif, remplacantId, statut: autoValide ? "APPROUVE" : "EN_ATTENTE", ...(autoValide ? { approuveParId: user.id } : {}) },
      });
      if (autoValide) await figerSoldesApprobation(tx, [d], new Date(), user.id);
      return d;
    }, { timeout: DELAI_APPROBATION_UNITAIRE });
    reinitialiserCacheAValider(); // la pastille « À valider » compte cette demande : relue à neuf, pas dans 20 s

    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    // Notification TOUJOURS émise (choix client : trace visible même en auto-validation).
    if (!autoValide) {
      await creerNotification({
        type: "CONGE",
        message: `Nouvelle demande de congé (${type}) — ${emp?.nom ?? "employé"}, ${nbJours} j.`,
        lien: "/a-valider",
        refId: demande.id,
      });
    } else {
      await journaliser(prisma, { entite: "LeaveRequest", entiteId: demande.id, champ: "statut", nouvelleValeur: "APPROUVE (auto — Direction)", userId: user.id });
      // Synchro grille Présences : les jours ouvrables du congé reçoivent leur code (C ou S) —
      // jamais dans un mois à paie validée (tracé au journal).
      const { figes } = await poserCodesConge(employeeId, dateDebut, dateFin, type);
      if (figes > 0) await journaliser(prisma, { entite: "LeaveRequest", entiteId: demande.id, champ: "presences", nouvelleValeur: noteMoisFige(figes, "posé"), userId: user.id });
      await creerNotification({
        type: "CONGE",
        message: `Congé (${type}) approuvé — ${emp?.nom ?? "employé"}, ${nbJours} j.`,
        lien: "/conges",
        refId: demande.id,
      });
    }

    revalidatePath("/conges");
    revalidatePath("/employes");
    revalidatePath("/", "layout");
  });
}

/**
 * Seuls les comptes Admin (Directrice, Sacha) peuvent autoriser ou refuser une demande.
 * Statut et solde figé s'écrivent dans la même transaction. L'approbation ne dépend PAS du solde :
 * s'il est illisible, la demande est approuvée sans instantané (voir `figerSoldesApprobation`).
 * Seul un échec de la base elle-même laisse la demande EN ATTENTE ; la raison est alors RENDUE
 * (`erreur`), jamais lancée.
 */
export async function approuverConge(leaveRequestId: string): Promise<{ erreur?: string; avertissement?: string }> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const demande = await prisma.leaveRequest.findUnique({ where: { id: leaveRequestId } });
  if (!demande) return { erreur: "Demande de congé introuvable." };
  // Statut et solde figé dans LA MÊME transaction. L'écriture est conditionnelle : une demande déjà
  // approuvée (double clic, deux onglets) ne l'est pas une seconde fois — son solde figé ne bouge
  // pas, et rien n'est reposé ni renotifié.
  let approuvee: boolean;
  try {
    approuvee = await prisma.$transaction(async (tx) => {
      // Deux demandes qui se recouvrent ne sont jamais approuvées toutes les deux (double décompte).
      await verrouillerCongesSalarie(tx, demande.employeeId);
      const autre = await demandeQuiRecouvre(tx, { employeeId: demande.employeeId, dateDebut: demande.dateDebut, dateFin: demande.dateFin, exclureId: demande.id, statuts: ["APPROUVE"] });
      if (autre) throw new Error(messageRecouvrement(autre));
      const { count } = await tx.leaveRequest.updateMany({
        where: { id: leaveRequestId, statut: { not: "APPROUVE" } },
        data: { statut: "APPROUVE", approuveParId: user.id, motifRefus: null },
      });
      if (count === 0) return false;
      await figerSoldesApprobation(tx, [demande], new Date(), user.id);
      return true;
    }, { timeout: DELAI_APPROBATION_UNITAIRE });
  } catch (e) {
    return { erreur: `Approbation non enregistrée : ${messageLisible(e, "conges approuverConge")}` };
  }
  reinitialiserCacheAValider(); // la demande a quitté « À valider » : la pastille se relit à neuf
  if (!approuvee) {
    // Déjà approuvée : rien à écrire, mais l'écran de celui qui a cliqué doit refléter la base.
    revaliderConges();
    return {};
  }
  // Synchro grille Présences : jours ouvrables du congé → code C/S, heures retirées (jamais un mois figé).
  const { figes } = await poserCodesConge(demande.employeeId, new Date(demande.dateDebut), new Date(demande.dateFin), demande.type);
  await journaliser(prisma, {
    entite: "LeaveRequest",
    entiteId: leaveRequestId,
    champ: "statut",
    nouvelleValeur: "APPROUVE",
    userId: user.id,
  });
  await supprimerNotificationsPour(leaveRequestId);
  await notifierSalarieDecision(demande.employeeId, leaveRequestId, demande.type, new Date(demande.dateDebut), new Date(demande.dateFin), true);

  revaliderConges();
  const note = noteMoisFige(figes, "posé");
  return note ? { avertissement: `Congé approuvé. ${note}` } : {};
}

/** Filtres de la liste des congés, conservés dans l'URL de retour d'une décision. */
export type FiltresListeConges = {
  statut?: string; type?: string; q?: string; quand?: string; mois?: string; du?: string; au?: string; groupe?: string; page?: string; par?: string;
};

/**
 * `approuverConge` pour un `<form action>` (écran Congés). L'erreur revient par la page, dans
 * `?erreurDecision=` (affichée au-dessus de la liste, PAS dans le bloc « Nouvelle demande », qui
 * lit `?erreur=`), et les filtres actifs sont gardés. Le chemin est fixe et seuls les filtres et
 * paramètres de pagination connus, en texte court, sont repris : les arguments liés reviennent du navigateur.
 */
export async function approuverCongeFormulaire(leaveRequestId: string, filtres: FiltresListeConges = {}): Promise<void> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const { erreur, avertissement } = await approuverConge(leaveRequestId);
  if (erreur) redirect(urlRetourConges(filtres, erreur));
  if (avertissement) redirect(urlRetourConges(filtres, avertissement, "noteDecision"));
}

/** `/conges?statut=…&type=…&q=…&quand=…&mois=…&du=…&au=…&groupe=…&page=…&par=…&erreurDecision=…` (tous les filtres de la liste, la page et la taille de page sont gardés) */
function urlRetourConges(filtres: FiltresListeConges, erreur: string, cleMessage: "erreurDecision" | "noteDecision" = "erreurDecision"): string {
  const p = new URLSearchParams();
  for (const cle of ["statut", "type", "q", "quand", "mois", "du", "au", "groupe", "page", "par"] as const) {
    const v = filtres?.[cle];
    if (typeof v === "string" && v !== "") p.set(cle, v.slice(0, 200));
  }
  p.set(cleMessage, erreur);
  return `/conges?${p.toString()}`;
}

/**
 * Refuse UNE demande. Le MOTIF est OBLIGATOIRE (décision Direction 2026-10-09) : sans motif (ou au-delà de
 * 500 caractères) rien n'est écrit et la raison est RENDUE (`erreur`), jamais lancée. Le motif est stocké,
 * porté au journal d'audit, repris dans la notification au salarié et imprimé sur le PDF.
 */
export async function refuserConge(leaveRequestId: string, motifBrut: string): Promise<{ erreur?: string; avertissement?: string }> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const verifie = verifierMotifRefus(motifBrut);
  if ("erreur" in verifie) return { erreur: verifie.erreur };
  const { motif } = verifie;

  const demande = await prisma.leaveRequest.findUnique({ where: { id: leaveRequestId } });
  if (!demande) return { erreur: "Demande de congé introuvable." };
  // Quitter APPROUVÉ efface le solde figé (voir INSTANTANE_SOLDE_EFFACE) : il décrivait une
  // approbation qui n'existe plus. Sa valeur reste au journal d'audit ci-dessous.
  await prisma.leaveRequest.update({
    where: { id: leaveRequestId },
    data: { statut: "REFUSE", approuveParId: user.id, motifRefus: motif, ...INSTANTANE_SOLDE_EFFACE },
  });
  reinitialiserCacheAValider(); // la demande a quitté « À valider » : la pastille se relit à neuf
  // Un congé auparavant approuvé avait posé ses codes sur la grille : on les retire.
  // Jamais dans un mois à paie validée : la paie a payé ces jours tels qu'ils étaient.
  const { figes } = demande.statut === "APPROUVE"
    ? await retirerCodesConge(demande.employeeId, new Date(demande.dateDebut), new Date(demande.dateFin))
    : { figes: 0 };
  await journaliser(prisma, {
    entite: "LeaveRequest",
    entiteId: leaveRequestId,
    champ: "statut",
    nouvelleValeur: "REFUSE",
    userId: user.id,
  });
  await journaliser(prisma, { entite: "LeaveRequest", entiteId: leaveRequestId, champ: "motifRefus", nouvelleValeur: motif, userId: user.id });
  const instantaneEfface = resumeInstantane(demande);
  if (instantaneEfface) {
    await journaliser(prisma, {
      entite: "LeaveRequest",
      entiteId: leaveRequestId,
      champ: "soldeFige",
      ancienneValeur: instantaneEfface,
      nouvelleValeur: null,
      userId: user.id,
    });
  }
  await supprimerNotificationsPour(leaveRequestId);
  await notifierSalarieDecision(demande.employeeId, leaveRequestId, demande.type, new Date(demande.dateDebut), new Date(demande.dateFin), false, motif);

  revaliderConges();
  const note = noteMoisFige(figes, "retiré");
  return note ? { avertissement: `Demande refusée. ${note}` } : {};
}

/** Notifie le salarié concerné (cloche perso + push) de la décision sur SA demande de congé. */
async function notifierSalarieDecision(employeeId: string, leaveRequestId: string, type: string, dateDebut: Date, dateFin: Date, approuve: boolean, motifRefus?: string) {
  const userId = await compteSalarieDe(employeeId);
  if (!userId) return; // pas de compte salarié → rien à notifier
  const periode = `du ${dateDebut.toLocaleDateString("fr-FR", { timeZone: "UTC" })} au ${dateFin.toLocaleDateString("fr-FR", { timeZone: "UTC" })}`;
  await notifierSalarie(userId, {
    type: "CONGE",
    // Un refus dit POURQUOI : « Votre demande de congé du … au … est refusée : <motif> ».
    message: approuve
      ? `Votre demande de congé (${type}) ${periode} a été approuvée ✅.`
      : `Votre demande de congé ${periode} est refusée : ${motifRefus ?? "—"}`,
    lien: "/espace/conges",
    refId: `${leaveRequestId}:decision`, // refId distinct → non supprimé par supprimerNotificationsPour
  });
}

/**
 * Supprime UNE demande de congé (A2) : la retire de la liste (≠ la refuser, qui la garde en
 * historique avec le statut REFUSE). La suppression est tracée au journal d'audit (qui, quand,
 * quelle demande), même si la demande n'apparaît plus. Réservé à l'Admin.
 */
export async function supprimerConge(leaveRequestId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  await supprimerUneDemande(leaveRequestId, user.id);
  revaliderConges();
}

/** Le corps de la suppression d'UNE demande, commun à l'action unitaire et à l'action groupée (la garde Direction est posée par chacune). */
async function supprimerUneDemande(leaveRequestId: string, userId: string): Promise<{ figes: number }> {
  const demande = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: { employee: { select: { nom: true, matricule: true } } },
  });
  if (!demande) return { figes: 0 };

  const resume = `${demande.type} de ${demande.employee.nom} (${demande.employee.matricule}) du ${new Date(
    demande.dateDebut
  ).toLocaleDateString("fr-FR")} au ${new Date(demande.dateFin).toLocaleDateString("fr-FR")} — statut ${demande.statut}`;

  await supprimerNotificationsPour(leaveRequestId);
  const resultat = await prisma.$transaction(async (tx) => {
    // Les codes de présence partent DANS la transaction de la suppression : un échec de l'une ne laisse
    // jamais une demande approuvée sans ses codes (ni des codes sans demande). Un mois à paie validée
    // garde les siens (ils comptent alors comme « C posés sans demande » dans le solde).
    const { figes } = demande.statut === "APPROUVE"
      ? await retirerCodesConge(demande.employeeId, new Date(demande.dateDebut), new Date(demande.dateFin), tx)
      : { figes: 0 };
    await tx.leaveRequest.delete({ where: { id: leaveRequestId } });
    await journaliser(tx, {
      entite: "LeaveRequest",
      entiteId: leaveRequestId,
      champ: "suppression",
      ancienneValeur: figes > 0 ? `${resume} — ${noteMoisFige(figes, "retiré")}` : resume,
      userId,
    });
    return { figes };
  });
  reinitialiserCacheAValider(); // une demande en attente supprimée sort du compte « À valider »
  return resultat;
}

/** Rapport d'un lot : demandes traitées + échecs NOMMÉS (l'échec d'une demande ne bloque pas
 * les autres — les approbations sont des actes indépendants, contrairement au lot de paie). */
export type RapportLotConges = { traitees: number; echecs: string[]; avertissements?: string[] };

/** ACTION GROUPÉE : approuve plusieurs demandes en attente d'un coup. */
export async function approuverCongesEnLot(ids: string[]): Promise<RapportLotConges> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  let n = 0;
  const echecs: string[] = [];
  const [demandes, preload] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { id: { in: ids } }, include: { employee: { select: { nom: true } } } }),
    chargerPreloadConges(),
  ]);
  const demandeParId = new Map(demandes.map((d) => [d.id, d]));
  const candidates = ids.map((id) => demandeParId.get(id)).filter((d): d is NonNullable<typeof d> => d !== undefined && d.statut === "EN_ATTENTE");
  // 1. Statuts ET soldes figés dans UNE transaction : les soldes se lisent en lot (4 requêtes pour
  //    tous les salariés), une fois les statuts écrits, donc chaque demande approuvée comprise. Une
  //    demande approuvée entre-temps par quelqu'un d'autre n'est ni réapprouvée ni refigée. Un
  //    solde illisible n'empêche aucune approbation (instantané vide, voir figerSoldesApprobation).
  let approuvees: typeof candidates;
  const recouvrements: string[] = [];
  try {
    approuvees = await prisma.$transaction(async (tx) => {
      const ok: typeof candidates = [];
      recouvrements.length = 0;
      for (const d of candidates) {
        // Recouvrement avec une demande déjà approuvée — y compris une approuvée plus haut dans ce
        // même lot (la transaction voit ses propres écritures) : nommée, jamais approuvée.
        await verrouillerCongesSalarie(tx, d.employeeId);
        const autre = await demandeQuiRecouvre(tx, { employeeId: d.employeeId, dateDebut: d.dateDebut, dateFin: d.dateFin, exclureId: d.id, statuts: ["APPROUVE"] });
        if (autre) { recouvrements.push(`${d.employee.nom} : ${messageRecouvrement(autre)}`); continue; }
        const { count } = await tx.leaveRequest.updateMany({
          where: { id: d.id, statut: "EN_ATTENTE" },
          data: { statut: "APPROUVE", approuveParId: user.id, motifRefus: null },
        });
        if (count === 1) ok.push(d);
      }
      await figerSoldesApprobation(tx, ok, new Date(), user.id);
      return ok;
    }, { timeout: DELAI_APPROBATION_LOT });
    reinitialiserCacheAValider(); // les demandes approuvées ont quitté « À valider » : la pastille se relit à neuf
  } catch (e) {
    // Rien n'est écrit (transaction annulée) : chaque demande est nommée en échec.
    const raison = messageLisible(e, "conges approuverCongesEnLot");
    revaliderConges();
    return { traitees: 0, echecs: candidates.map((d) => `${d.employee.nom} : approbation non enregistrée (${raison})`) };
  }
  echecs.push(...recouvrements);
  const avertissements: string[] = [];
  // 2. Les suites, demande par demande : l'échec de l'une ne bloque pas les autres.
  for (const d of approuvees) {
    const id = d.id;
    try {
      const { figes } = await poserCodesConge(d.employeeId, new Date(d.dateDebut), new Date(d.dateFin), d.type, preload);
      if (figes > 0) avertissements.push(`${d.employee.nom} : ${noteMoisFige(figes, "posé")}`);
      await journaliser(prisma, {
        entite: "LeaveRequest",
        entiteId: id,
        champ: "statut",
        nouvelleValeur: "APPROUVE",
        userId: user.id,
      });
      await supprimerNotificationsPour(id);
      await notifierSalarieDecision(d.employeeId, id, d.type, new Date(d.dateDebut), new Date(d.dateFin), true);
      n++;
    } catch (e) {
      echecs.push(`${d.employee.nom} : ${messageLisible(e, "conges approuverCongesEnLot (suites)")}`);
    }
  }
  revaliderConges();
  return { traitees: n, echecs, ...(avertissements.length > 0 ? { avertissements } : {}) };
}

/** ACTION GROUPÉE : refuse plusieurs demandes en attente d'un coup. */
export async function refuserCongesEnLot(ids: string[], motifBrut: string): Promise<RapportLotConges> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  // Un MÊME motif (obligatoire) pour toute la sélection ; sans motif, rien n'est refusé.
  const verifie = verifierMotifRefus(motifBrut);
  if ("erreur" in verifie) return { traitees: 0, echecs: [verifie.erreur] };
  const { motif } = verifie;
  let n = 0;
  const echecs: string[] = [];
  const demandes = await prisma.leaveRequest.findMany({ where: { id: { in: ids } }, include: { employee: { select: { nom: true } } } });
  const demandeParId = new Map(demandes.map((d) => [d.id, d]));
  for (const id of ids) {
    const d = demandeParId.get(id);
    if (!d || d.statut !== "EN_ATTENTE") continue;
    try {
      await prisma.leaveRequest.update({
        where: { id },
        // Seules des demandes EN ATTENTE passent ici (aucun instantané) ; l'effacement est posé
        // quand même : quitter APPROUVÉ ou refuser n'a jamais à laisser un solde figé derrière.
        data: { statut: "REFUSE", approuveParId: user.id, motifRefus: motif, ...INSTANTANE_SOLDE_EFFACE },
      });
      await journaliser(prisma, {
        entite: "LeaveRequest",
        entiteId: id,
        champ: "statut",
        nouvelleValeur: "REFUSE",
        userId: user.id,
      });
      await journaliser(prisma, { entite: "LeaveRequest", entiteId: id, champ: "motifRefus", nouvelleValeur: motif, userId: user.id });
      await supprimerNotificationsPour(id);
      await notifierSalarieDecision(d.employeeId, id, d.type, new Date(d.dateDebut), new Date(d.dateFin), false, motif);
      n++;
    } catch (e) {
      echecs.push(`${d.employee.nom} : ${messageLisible(e, "conges refuserCongesEnLot")}`);
    }
  }
  reinitialiserCacheAValider(); // les demandes refusées ont quitté « À valider » : la pastille se relit à neuf
  revaliderConges();
  return { traitees: n, echecs };
}

/**
 * ACTION GROUPÉE : supprime plusieurs demandes (écran Congés, barre d'actions). Réservée à la Direction,
 * comme l'unitaire — c'est la MÊME suppression (`supprimerUneDemande` : codes de présence retirés, journal
 * d'audit par demande), répétée demande par demande : l'échec de l'une est nommé et ne bloque pas les autres.
 */
export async function supprimerCongesEnLot(ids: string[]): Promise<RapportLotConges> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  // Plafond serveur (l'écran le fait respecter aussi) : une suppression n'est jamais tronquée en silence, elle est refusée en bloc.
  const distincts = [...new Set(ids)];
  if (distincts.length > MAX_SUPPRESSIONS_PAR_LOT) {
    return { traitees: 0, echecs: [`Suppression refusée : ${distincts.length} demandes sélectionnées, ${MAX_SUPPRESSIONS_PAR_LOT} au plus par lot. Rien n'a été supprimé.`] };
  }
  let n = 0;
  const echecs: string[] = [];
  const demandes = await prisma.leaveRequest.findMany({ where: { id: { in: ids } }, include: { employee: { select: { nom: true } } } });
  const demandeParId = new Map(demandes.map((d) => [d.id, d]));
  const avertissements: string[] = [];
  for (const id of [...new Set(ids)]) {
    const d = demandeParId.get(id);
    if (!d) continue; // déjà supprimée (autre onglet) : rien à faire
    try {
      const { figes } = await supprimerUneDemande(id, user.id);
      if (figes > 0) avertissements.push(`${d.employee.nom} : ${noteMoisFige(figes, "retiré")}`);
      n++;
    } catch (e) {
      echecs.push(`${d.employee.nom} : ${messageLisible(e, "conges supprimerCongesEnLot")}`);
    }
  }
  revaliderConges();
  return { traitees: n, echecs, ...(avertissements.length > 0 ? { avertissements } : {}) };
}
