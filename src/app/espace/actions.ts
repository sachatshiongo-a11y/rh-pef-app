"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { changerMotDePasseAdmin } from "@/lib/securite-connexion";
import { peutChangerSonMotDePasse } from "@/lib/mot-de-passe-temporaire";
import { adresseChangementMotDePasse, retourValide } from "@/lib/retour-connexion";
import { journaliser } from "@/lib/audit";
import { calculerJoursOuvrables } from "@/lib/payroll";
import { ecartJoursSoumis } from "@/lib/jours-ouvrables";
import { creerNotification, notifierSalarie, compteSalarieDe, supprimerNotificationsPour } from "@/lib/notifications";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { chargerPlafondAcompte, verifierMontantAcompte } from "@/lib/acompte-plafond";
import { televerserFichierEmploye } from "@/lib/fichiers-employe";
import { finaliserEchangeSiComplet } from "@/lib/echange-creneau";
import { actionLisible } from "@/lib/action-lisible";
import { numeroMoisCourantKinshasa, anneeCouranteKinshasa, jourKinshasa, jourCivilKinshasa } from "@/lib/heure-kinshasa";

/** Garde commune à l'espace salarié : feature active + compte salarié (EMPLOYE/STOCK) + fiche liée. */
async function exigerSalarie(): Promise<{ userId: string; employeeId: string }> {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user)) throw new Error("Accès refusé.");
  if (!user.employeeId) throw new Error("Compte non relié à une fiche employé.");
  return { userId: user.id, employeeId: user.employeeId };
}

/** Marque comme lues MES notifications (cloche salarié) — scopé à mon compte uniquement. */
export async function marquerMesNotificationsLues() {
  const { userId } = await exigerSalarie();
  await prisma.notification.updateMany({ where: { domaine: "SALARIE", destinataireUserId: userId, lu: false }, data: { lu: true } });
  revalidatePath("/espace", "layout");
}

/** Supprime UNE de mes notifications (vérifie qu'elle m'appartient). */
export async function supprimerMaNotification(id: string) {
  const { userId } = await exigerSalarie();
  await prisma.notification.deleteMany({ where: { id, domaine: "SALARIE", destinataireUserId: userId } });
  revalidatePath("/espace", "layout");
}

/** Le salarié définit son nouveau mot de passe (fin du mot de passe temporaire). */
export async function changerMonMotDePasse(formData: FormData) {
  // Le scan de l'affiche qui a amené ici, s'il y en a un : revalidé côté serveur (le champ caché
  // vient du navigateur, donc de n'importe qui — seul `/scan?…` passe). Il survit à une erreur de
  // saisie (la page d'erreur le garde) et sert de destination après un changement réussi.
  const retour = retourValide(formData.get("retour"));
  return formulaireLisible(adresseChangementMotDePasse(retour), async () => {
    const user = await verifySession();
    // Un compte EMPLOYE, comme avant ; tout autre compte seulement pour remplacer le mot de passe
    // TEMPORAIRE d'une fiche (ex. un compte Stock à identifiant matricule) : ce formulaire ne
    // demande pas l'ancien mot de passe. Cf. peutChangerSonMotDePasse.
    const [espaceOuvert, compte] = await Promise.all([
      espaceEmployeActif(),
      prisma.user.findUnique({ where: { id: user.id }, select: { motDePasseTemporaire: true } }),
    ]);
    const regle = { role: user.role, employeeId: user.employeeId, motDePasseTemporaire: compte?.motDePasseTemporaire ?? false, espaceOuvert };
    if (!peutChangerSonMotDePasse(regle)) throw new Error("Accès refusé.");
    const mdp = String(formData.get("motDePasse") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");
    if (mdp.length < 6) throw new Error("Le mot de passe doit faire au moins 6 caractères.");
    if (mdp !== confirmation) throw new Error("Les deux mots de passe ne correspondent pas.");

    await changerMotDePasseAdmin(user.id, mdp);
    // Le drapeau et la trace ensemble. Le journal dit QUI a changé QUOI, jamais le mot de passe.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { motDePasseTemporaire: false } });
      await journaliser(tx, {
        entite: "User",
        entiteId: user.id,
        champ: "motDePasse",
        ancienneValeur: regle.motDePasseTemporaire ? "temporaire" : "personnel",
        nouvelleValeur: "personnel (changé par le salarié)",
        userId: user.id,
      });
    });
    // Retour au scan de l'affiche s'il a amené ici : la page de scan, une fois chargée dans le
    // navigateur, enregistre son pointage (décision de la Direction du 2026-09-29). Sinon — EMPLOYE : son espace, comme avant ; les autres ont
    // plusieurs espaces : le sélecteur les oriente.
    redirect(retour ?? (user.role === "EMPLOYE" ? "/espace" : "/entree"));
  });
}

/** Le salarié dépose SA propre demande de congé (toujours EN_ATTENTE de validation Direction). */
export async function demanderMonConge(formData: FormData) {
  return formulaireLisible("/espace/conges", async () => {
    const { userId, employeeId } = await exigerSalarie();
    const type = String(formData.get("type") ?? "").trim();
    const dateDebut = new Date(String(formData.get("dateDebut") ?? ""));
    const dateFin = new Date(String(formData.get("dateFin") ?? ""));
    const motif = String(formData.get("motif") ?? "").trim() || null;
    if (!type || Number.isNaN(dateDebut.getTime()) || Number.isNaN(dateFin.getTime())) throw new Error("Type et dates requis.");
    if (dateFin < dateDebut) throw new Error("La date de fin doit être après la date de début.");

    const feries = await prisma.jourFerie.findMany({ where: { date: { gte: dateDebut, lte: dateFin } }, select: { date: true } });
    const nbJours = calculerJoursOuvrables(dateDebut, dateFin, feries.map((f) => f.date));
    if (nbJours <= 0) throw new Error("La période ne contient aucun jour ouvrable (dimanches et fériés exclus).");
    const ecart = ecartJoursSoumis(formData.get("nbJours"), nbJours);
    if (ecart) throw new Error(ecart);

    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    const demande = await prisma.leaveRequest.create({
      data: { employeeId, type, dateDebut, dateFin, nbJours, motif, statut: "EN_ATTENTE" },
    });
    await creerNotification({
      type: "CONGE",
      message: `Demande de congé (${type}) — ${emp?.nom ?? "salarié"}, ${nbJours} j.`,
      lien: "/a-valider",
      refId: demande.id,
    });

    revalidatePath("/espace/conges");
    revalidatePath("/a-valider");
    revalidatePath("/conges");
    revalidatePath("/", "layout");
    // Marqueur de succès (le formulaire relit ce paramètre).
    redirect("/espace/conges?envoye=1");
  });
}

/** Le salarié demande un acompte sur salaire (EN_ATTENTE ; notifie la Direction). */
export async function demanderMonAcompte(formData: FormData) {
  return formulaireLisible("/espace/paie", async () => {
    const { employeeId } = await exigerSalarie();
    const montantUSD = Number(String(formData.get("montantUSD") ?? "").replace(",", "."));
    if (!Number.isFinite(montantUSD) || montantUSD <= 0) throw new Error("Indiquez un montant d'acompte valide (en $).");
    const motif = String(formData.get("motif") ?? "").trim() || null;

    const config = await prisma.config.findUnique({ where: { id: "singleton" }, select: { moisCourant: true, anneeCourante: true } });
    const mois = config?.moisCourant ?? numeroMoisCourantKinshasa();
    const annee = config?.anneeCourante ?? anneeCouranteKinshasa();

    // Même plafond que côté Direction : le salarié ne peut pas demander plus que son salaire net
    // du mois précédent (à défaut, son salaire de fiche), cumul de ses demandes du mois compris.
    const plafond = await chargerPlafondAcompte(prisma, { employeeId, mois, annee });
    const verdict = verifierMontantAcompte(montantUSD, plafond);
    if (!verdict.ok) throw new Error(verdict.message);

    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    const acompte = await prisma.acompteSalaire.create({
      data: { employeeId, montantUSD, mois, annee, motif, statut: "EN_ATTENTE" },
    });
    await creerNotification({
      type: "ACOMPTE",
      message: `Demande d'acompte — ${emp?.nom ?? "salarié"}, ${montantUSD.toFixed(2)} $.`,
      lien: "/a-valider",
      refId: acompte.id,
    });

    revalidatePath("/espace/paie");
    revalidatePath("/a-valider");
    revalidatePath("/", "layout");
    redirect("/espace/paie?acompte=1");
  });
}

/** Le salarié demande à changer son shift sur un jour donné (EN_ATTENTE ; notifie la Direction). */
export async function demanderChangementShift(formData: FormData) {
  return formulaireLisible("/espace/echanges", async () => {
    const { employeeId } = await exigerSalarie();
    const dateIso = String(formData.get("date") ?? "").trim();
    const shiftDemandeId = String(formData.get("shiftDemandeId") ?? "").trim();
    const motif = String(formData.get("motif") ?? "").trim() || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !shiftDemandeId) throw new Error("Choisissez un jour et un shift souhaité.");
    const date = new Date(dateIso + "T00:00:00.000Z");

    // Le shift souhaité doit exister et être actif ; le créneau actuel est lu du planning.
    const [shift, creneau, dejaEnAttente] = await Promise.all([
      prisma.shift.findFirst({ where: { id: shiftDemandeId, actif: true }, select: { id: true, nom: true } }),
      prisma.planningCreneau.findUnique({ where: { employeeId_date: { employeeId, date } }, select: { shiftId: true } }),
      prisma.demandeChangementShift.findFirst({ where: { employeeId, date, statut: "EN_ATTENTE" }, select: { id: true } }),
    ]);
    if (!shift) throw new Error("Shift souhaité introuvable.");
    if (dejaEnAttente) throw new Error("Vous avez déjà une demande en attente pour ce jour.");
    if (creneau?.shiftId === shiftDemandeId) throw new Error("C'est déjà votre shift ce jour-là.");

    const dem = await prisma.demandeChangementShift.create({
      data: { employeeId, date, shiftActuelId: creneau?.shiftId ?? null, shiftDemandeId, motif },
    });
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    await creerNotification({
      type: "AUTRE",
      message: `Demande de changement de shift — ${emp?.nom ?? "salarié"}, ${date.toLocaleDateString("fr-FR", { timeZone: "UTC" })} → ${shift.nom}.`,
      lien: "/a-valider",
      refId: dem.id,
    });

    revalidatePath("/espace/echanges");
    revalidatePath("/a-valider");
    revalidatePath("/", "layout");
    redirect("/espace/echanges?echange=1");
  });
}

/**
 * Le salarié annule sa demande de changement de shift simple (tant qu'elle est en attente).
 * Les boutons de l'écran « Échanger un shift » reçoivent l'échec comme une VALEUR ({ erreur }) et
 * l'affichent : avant, un clic sur une demande déjà traitée ne faisait rien, sans un mot.
 */
export const annulerChangement = actionLisible(async (id: string): Promise<void> => {
  const { employeeId } = await exigerSalarie();
  const d = await prisma.demandeChangementShift.findUnique({ where: { id }, select: { employeeId: true, statut: true } });
  if (!d || d.employeeId !== employeeId) throw new Error("Demande introuvable.");
  if (d.statut !== "EN_ATTENTE") throw new Error("La Direction a déjà répondu à cette demande : elle ne peut plus être annulée.");
  await prisma.demandeChangementShift.delete({ where: { id } });
  await supprimerNotificationsPour(id);
  revalidatePath("/espace/echanges");
  revalidatePath("/a-valider");
  revalidatePath("/", "layout");
});

/** Le salarié propose un ÉCHANGE de créneau avec un collègue (double validation collègue + Direction). */
export async function demanderEchange(formData: FormData) {
  return formulaireLisible("/espace/echanges", async () => {
    const { employeeId } = await exigerSalarie();
    const dateIso = String(formData.get("date") ?? "").trim(); // mon créneau (jour cédé)
    const cible = String(formData.get("cible") ?? "").trim();   // "collegueId__dateIso" (créneau visé)
    const motif = String(formData.get("motif") ?? "").trim() || null;
    const [collegueId, collegueDateIso] = cible.split("__");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !collegueId || !/^\d{4}-\d{2}-\d{2}$/.test(collegueDateIso ?? ""))
      throw new Error("Choisissez votre créneau et le créneau à échanger.");
    if (collegueId === employeeId) throw new Error("Choisissez le créneau d'un collègue.");
    const maDate = new Date(dateIso + "T00:00:00.000Z");
    const saDate = new Date(collegueDateIso + "T00:00:00.000Z");

    const [monCreneau, sonCreneau, dejaEnAttente] = await Promise.all([
      prisma.planningCreneau.findUnique({ where: { employeeId_date: { employeeId, date: maDate } }, select: { shiftId: true } }),
      prisma.planningCreneau.findUnique({ where: { employeeId_date: { employeeId: collegueId, date: saDate } }, select: { shiftId: true } }),
      prisma.echangeCreneau.findFirst({ where: { demandeurId: employeeId, demandeurDate: maDate, statut: "EN_ATTENTE" }, select: { id: true } }),
    ]);
    if (!monCreneau) throw new Error("Vous n'avez pas de service publié ce jour-là.");
    if (!sonCreneau) throw new Error("Ce collègue n'a plus ce service.");
    if (dejaEnAttente) throw new Error("Vous avez déjà une demande d'échange en attente pour ce jour.");

    const [moi, collegue] = await Promise.all([
      prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true, poste: true } }),
      prisma.employee.findUnique({ where: { id: collegueId }, select: { nom: true, poste: true } }),
    ]);
    // Le collègue doit pouvoir COUVRIR mon poste (même poste ou polyvalence posteSource→posteCible).
    if (moi && collegue && collegue.poste !== moi.poste) {
      const couvre = await prisma.polyvalencePoste.findFirst({ where: { posteSource: collegue.poste, posteCible: moi.poste }, select: { id: true } });
      if (!couvre) throw new Error("Ce collègue n'a pas un poste pouvant couvrir le vôtre.");
    }
    const ech = await prisma.echangeCreneau.create({
      data: {
        demandeurId: employeeId, demandeurDate: maDate, demandeurShiftId: monCreneau.shiftId,
        collegueId, collegueDate: saDate, collegueShiftId: sonCreneau.shiftId, motif,
      },
    });

    // Notifier le COLLÈGUE (cloche + push) et la Direction (inbox À valider).
    const uCollegue = await compteSalarieDe(collegueId);
    if (uCollegue) await notifierSalarie(uCollegue, {
      type: "PLANNING",
      message: `${moi?.nom ?? "Un collègue"} vous propose un échange de shift (${maDate.toLocaleDateString("fr-FR", { timeZone: "UTC" })}). À accepter ou refuser.`,
      lien: "/espace/echanges",
      refId: ech.id,
    });
    await creerNotification({
      type: "AUTRE",
      message: `Échange de shift proposé — ${moi?.nom ?? "salarié"} ↔ ${collegue?.nom ?? "collègue"}.`,
      lien: "/a-valider",
      refId: ech.id,
    });

    revalidatePath("/espace/echanges");
    revalidatePath("/a-valider");
    revalidatePath("/", "layout");
    redirect("/espace/echanges?propose=1");
  });
}

/**
 * Le COLLÈGUE concerné accepte ou refuse l'échange. Accepter peut finaliser (si Direction OK).
 * Renvoie ce qu'il faut dire au collègue quand l'échange ne peut pas se faire tout de suite.
 */
export const repondreEchange = actionLisible(async (id: string, accepte: boolean): Promise<{ info: string } | void> => {
  const { userId, employeeId } = await exigerSalarie();
  const e = await prisma.echangeCreneau.findUnique({ where: { id } });
  if (!e || e.collegueId !== employeeId) throw new Error("Proposition introuvable.");
  if (e.statut !== "EN_ATTENTE") throw new Error("Cette proposition n'est plus en attente (annulée ou déjà traitée).");

  if (!accepte) {
    await prisma.echangeCreneau.update({ where: { id }, data: { reponseCollegue: "REFUSE", statut: "REFUSE" } });
    await supprimerNotificationsPour(id);
    const uA = await compteSalarieDe(e.demandeurId);
    if (uA) await notifierSalarie(uA, { type: "PLANNING", message: "Votre proposition d'échange de shift a été refusée par le collègue.", lien: "/espace/echanges", refId: `${id}:rep` });
  } else {
    await prisma.echangeCreneau.update({ where: { id }, data: { reponseCollegue: "ACCEPTE" } });
    const { fait, erreur } = await finaliserEchangeSiComplet(id, userId);
    if (erreur) {
      // Planning verrouillé (paie validée) : l'échange reste en attente, la Direction est prévenue.
      await creerNotification({ type: "AUTRE", message: `Échange de shift accepté mais bloqué : ${erreur}`, lien: "/a-valider", refId: id });
      revalidatePath("/espace/echanges");
      revalidatePath("/a-valider");
      revalidatePath("/", "layout");
      return { info: "Votre accord est enregistré, mais le planning de ce jour est verrouillé : la Direction est prévenue et décidera." };
    } else if (!fait) {
      // En attente de la Direction : on la relance.
      const noms = await prisma.employee.findMany({ where: { id: { in: [e.demandeurId, e.collegueId] } }, select: { nom: true } });
      await creerNotification({ type: "AUTRE", message: `Échange de shift accepté par le collègue — ${noms.map((n) => n.nom).join(" ↔ ")}. À valider.`, lien: "/a-valider", refId: id });
    }
  }
  revalidatePath("/espace/echanges");
  revalidatePath("/a-valider");
  revalidatePath("/", "layout");
});

/** Le DEMANDEUR annule sa proposition tant qu'elle est en attente. */
export const annulerEchange = actionLisible(async (id: string): Promise<void> => {
  const { employeeId } = await exigerSalarie();
  const e = await prisma.echangeCreneau.findUnique({ where: { id } });
  if (!e || e.demandeurId !== employeeId) throw new Error("Proposition introuvable.");
  if (e.statut !== "EN_ATTENTE") throw new Error("Cette proposition est déjà traitée : elle ne peut plus être annulée.");
  await prisma.echangeCreneau.update({ where: { id }, data: { statut: "ANNULE" } });
  await supprimerNotificationsPour(id);
  const uB = await compteSalarieDe(e.collegueId);
  if (uB) await notifierSalarie(uB, { type: "PLANNING", message: "Une proposition d'échange de shift a été annulée.", lien: "/espace/echanges", refId: `${id}:ann` });
  revalidatePath("/espace/echanges");
  revalidatePath("/a-valider");
  revalidatePath("/", "layout");
});

/** Le salarié envoie un certificat médical (justificatif) → document rattaché à sa fiche + notif Direction. */
export async function envoyerMonCertificat(formData: FormData) {
  return formulaireLisible("/espace/documents", async () => {
    const { userId, employeeId } = await exigerSalarie();
    const fichier = formData.get("certificat");
    if (!(fichier instanceof File) || fichier.size === 0) throw new Error("Choisissez un fichier (PDF ou image).");
    const note = String(formData.get("note") ?? "").trim();

    const fichierUrl = await televerserFichierEmploye(employeeId, fichier, "certificats");
    await prisma.documentEmploye.create({
      data: {
        employeeId,
        type: "CERTIFICAT_MEDICAL",
        nom: note || `Certificat médical du ${jourKinshasa(new Date())}`,
        fichierUrl,
        dateEmission: jourCivilKinshasa(new Date()),
      },
    });
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    await creerNotification({
      type: "AUTRE",
      message: `Certificat médical reçu — ${emp?.nom ?? "salarié"}.`,
      lien: `/employes/${employeeId}?tab=dossier`,
      refId: `certif:${userId}:${Date.now()}`,
    });

    revalidatePath("/espace/documents");
    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/", "layout");
    redirect("/espace/documents?certif=1");
  });
}
