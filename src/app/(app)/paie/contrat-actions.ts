"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { chargerReglesContrats, verifierProlongationCdd, verifierProlongationEssai } from "@/lib/regles-contrats";
import { genererContratPdf } from "@/lib/pdf/contrat-buffer";
import { televerserFichier } from "@/lib/storage";
import type { TypeContrat } from "@prisma/client";
import { actionLisible } from "@/lib/action-lisible";
import { classerContrats, type Classement } from "@/lib/contrats-classement";
import { notifierContratASigner, etatSignatureContrat, notifierSiContratARevoir } from "@/lib/contrats-notification";

function revalider(employeeId: string) {
  revalidatePath("/paie");
  revalidatePath("/employes");
  revalidatePath(`/employes/${employeeId}`);
}

/** Page de retour des erreurs : champ caché `retour` du formulaire (fiche employé ou /paie). */
const retourDe = (formData: FormData) => String(formData.get("retour") ?? "").trim() || "/paie";

const dateFr = (d: Date) => new Date(d).toLocaleDateString("fr-FR");

/**
 * Transforme un contrat (ex. CDD → CDI) en CONSERVANT L'HISTORIQUE : l'ancien contrat passe au
 * statut TRANSFORMÉ (il reste lisible sur la fiche, avec ses dates et son salaire d'époque) et
 * un nouveau contrat est créé dans la foulée. La fiche employé (type affiché) est synchronisée.
 */
export async function transformerContrat(id: string, formData: FormData) {
  await formulaireLisible(retourDe(formData), async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);
    const type = String(formData.get("type")) as TypeContrat;
    const dateFinStr = String(formData.get("dateFin") ?? "").trim();
    const dateDebutStr = String(formData.get("dateDebut") ?? "").trim();

    const contrat = await prisma.contrat.findUnique({ where: { id } });
    if (!contrat) return;
    if (contrat.statut !== "ACTIF") throw new Error("Seul un contrat actif peut être transformé.");
    if (type === contrat.type) throw new Error(`Ce contrat est déjà un ${type}.`);
    if (type !== "CDI" && !dateFinStr) throw new Error(`Un ${type} doit avoir une date de fin.`);

    const debut = dateDebutStr ? new Date(dateDebutStr) : new Date();
    const nouveau = await prisma.$transaction(async (tx) => {
      await tx.contrat.update({ where: { id }, data: { statut: "TRANSFORME" } });
      const cree = await tx.contrat.create({
        data: {
          employeeId: contrat.employeeId,
          type,
          dateDebut: debut,
          dateFin: type === "CDI" ? null : new Date(dateFinStr),
          finPeriodeEssai: null, // la période d'essai est soldée par la transformation
          heuresHebdo: contrat.heuresHebdo,
          salaireMensuel: contrat.salaireMensuel,
          devise: contrat.devise,
          poste: contrat.poste,
        },
      });
      // La fiche employé affiche le type du contrat courant.
      await tx.employee.update({ where: { id: contrat.employeeId }, data: { contrat: type } });
      await journaliser(tx, {
        entite: "Contrat",
        entiteId: contrat.employeeId,
        champ: "transformation",
        ancienneValeur: `${contrat.type} du ${dateFr(contrat.dateDebut)}`,
        nouvelleValeur: `${type} à partir du ${dateFr(debut)}`,
        userId: user.id,
      });
      return cree;
    });
    await notifierContratASigner(nouveau.id);
    revalider(contrat.employeeId);
  });
}

/**
 * Correction DIRECTE des conditions actuelles (contrat actif) : type, poste, dates, essai, salaire,
 * heures, devise. Contrairement à `transformerContrat`, ne crée PAS d'historique — c'est une
 * rectification (utile en phase de test / saisie erronée). Synchronise la fiche employé. Admin/Manager.
 */
export async function modifierContrat(id: string, formData: FormData) {
  await formulaireLisible(retourDe(formData), async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const contrat = await prisma.contrat.findUnique({ where: { id } });
    if (!contrat) return;
    if (contrat.statut !== "ACTIF") throw new Error("Seul le contrat actif peut être corrigé.");

    const type = String(formData.get("type") ?? contrat.type) as TypeContrat;
    const poste = String(formData.get("poste") ?? "").trim();
    const dateDebutStr = String(formData.get("dateDebut") ?? "").trim();
    const dateFinStr = String(formData.get("dateFin") ?? "").trim();
    const finEssaiStr = String(formData.get("finPeriodeEssai") ?? "").trim();
    const salaireStr = String(formData.get("salaireMensuel") ?? "").trim().replace(",", ".");
    const heuresStr = String(formData.get("heuresHebdo") ?? "").trim().replace(",", ".");
    const devise = (String(formData.get("devise") ?? contrat.devise).trim() || "USD").toUpperCase();
    const agence = String(formData.get("agence") ?? "").trim() || null;
    const coutJourStr = String(formData.get("coutJourUSD") ?? "").trim().replace(",", ".");

    if (!poste) throw new Error("Le poste est obligatoire.");
    if (!dateDebutStr) throw new Error("La date de début est obligatoire.");
    if (type !== "CDI" && !dateFinStr) throw new Error(`Un ${type} doit avoir une date de fin.`);
    const salaire = Number(salaireStr);
    if (!Number.isFinite(salaire) || salaire < 0) throw new Error("Salaire mensuel invalide.");
    const heures = heuresStr ? Number(heuresStr) : Number(contrat.heuresHebdo);
    if (!Number.isFinite(heures) || heures <= 0) throw new Error("Heures par semaine invalides.");
    const coutJour = coutJourStr ? Number(coutJourStr) : null;

    // État de signature AVANT la correction : le salarié n'est prévenu que si un contrat SIGNÉ
    // repasse « à resigner » (spec 2026-09-28, §3.3).
    const etatAvant = await etatSignatureContrat(id);
    await prisma.$transaction(async (tx) => {
      await tx.contrat.update({
        where: { id },
        data: {
          type,
          poste,
          dateDebut: new Date(dateDebutStr),
          dateFin: type === "CDI" ? null : new Date(dateFinStr),
          finPeriodeEssai: finEssaiStr ? new Date(finEssaiStr) : null,
          salaireMensuel: salaire,
          heuresHebdo: heures,
          devise,
          agence: type === "INTERIM" ? agence : null,
          coutJourUSD: type === "INTERIM" ? coutJour : null,
          // Les conditions changent : un exemplaire déjà figé ne reflète plus le contrat.
          pdfAccepteObsolete: contrat.pdfAccepteUrl ? true : undefined,
        },
      });
      // La fiche employé reflète le contrat courant (type, poste, salaire).
      await tx.employee.update({ where: { id: contrat.employeeId }, data: { contrat: type, poste, salaireMensuel: salaire } });
      await journaliser(tx, {
        entite: "Contrat",
        entiteId: contrat.employeeId,
        champ: "correction des conditions",
        ancienneValeur: `${contrat.type} · ${contrat.poste} · ${contrat.salaireMensuel} ${contrat.devise}`,
        nouvelleValeur: `${type} · ${poste} · ${salaire} ${devise}`,
        userId: user.id,
      });
    });
    await notifierSiContratARevoir(id, etatAvant);
    revalider(contrat.employeeId);
  });
}

/**
 * Fige l'exemplaire PDF du contrat — c'est lui qui FAIT FOI ensuite (plus de régénération).
 * Normalement déclenché par la signature du salarié, qui vaut acceptation (`lib/signer-document.ts`) ;
 * cette action permet à la Direction de le figer elle-même (un figeage qui a échoué, ou un contrat
 * que personne n'a encore signé).
 * Un contrat déjà figé ne peut être remplacé que par un Admin.
 */
export async function figerContrat(id: string) {
  const user = await verifySession();
  const contrat = await prisma.contrat.findUnique({ where: { id }, select: { employeeId: true, pdfAccepteUrl: true } });
  if (!contrat) return;
  requireRole(user, contrat.pdfAccepteUrl ? ["ADMIN"] : ["ADMIN", "MANAGER"]);

  // ignorerFige : on régénère depuis les données courantes (sinon on recopierait l'ancien exemplaire).
  const pdf = await genererContratPdf(id, { ignorerFige: true });
  if (!pdf) return;
  // Contrat signé dont le tracé n'a pas pu être relu : figer ce PDF sans paraphe le servirait pour
  // toujours comme l'exemplaire signé. On refuse, la Direction réessaiera.
  if (!pdf.figeable) throw new Error("Le tracé de la signature est momentanément illisible : l'exemplaire n'a pas été figé. Réessayez.");
  const url = await televerserFichier(`contrats/${id}.pdf`, pdf.buffer, "application/pdf");
  await prisma.contrat.update({ where: { id }, data: { pdfAccepteUrl: url, pdfAccepteObsolete: false } });
  await journaliser(prisma, {
    entite: "Contrat",
    entiteId: id,
    champ: "figeage",
    nouvelleValeur: contrat.pdfAccepteUrl ? "exemplaire figé remplacé" : "exemplaire figé",
    userId: user.id,
  });
  revalider(contrat.employeeId);
}

/** Rompt un contrat (statut RÉSILIÉ) — sortie de l'employé. */
export async function rompreContrat(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const contrat = await prisma.contrat.findUnique({ where: { id } });
  if (!contrat) return;
  await prisma.contrat.update({ where: { id }, data: { statut: "RESILIE" } });
  await journaliser(prisma, {
    entite: "Contrat",
    entiteId: contrat.employeeId,
    champ: "statut",
    nouvelleValeur: "RESILIE",
    userId: user.id,
  });
  revalider(contrat.employeeId);
}

/**
 * Prolonge un contrat à durée déterminée (CDD, stage, intérim…) : nouvelle date de fin, avec
 * COMPTEUR de renouvellements et GARDE-FOUS légaux pour le CDD (nombre max de prolongations,
 * durée totale max — Paramètres légaux « À VALIDER », modifiables dans les Barèmes).
 */
export async function prolongerContrat(id: string, formData: FormData) {
  await formulaireLisible(retourDe(formData), async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);
    const dateFinStr = String(formData.get("dateFin") ?? "").trim();
    if (!dateFinStr) throw new Error("Nouvelle date de fin requise.");
    const contrat = await prisma.contrat.findUnique({ where: { id } });
    if (!contrat) return;

    const nouvelleFin = new Date(dateFinStr);
    if (contrat.type === "CDD") {
      const regles = await chargerReglesContrats();
      const erreur = verifierProlongationCdd(
        { dateDebut: contrat.dateDebut, dateFin: contrat.dateFin, renouvellements: contrat.renouvellements },
        nouvelleFin,
        regles
      );
      if (erreur) throw new Error(erreur);
    } else if (contrat.dateFin && nouvelleFin <= new Date(contrat.dateFin)) {
      throw new Error("La nouvelle date de fin doit être postérieure à la date de fin actuelle.");
    }

    const etatAvant = await etatSignatureContrat(id);
    await prisma.contrat.update({
      where: { id },
      data: { dateFin: nouvelleFin, renouvellements: { increment: 1 } },
    });
    await journaliser(prisma, {
      entite: "Contrat",
      entiteId: contrat.employeeId,
      champ: "prolongation",
      ancienneValeur: contrat.dateFin ? dateFr(contrat.dateFin) : "—",
      nouvelleValeur: `${dateFr(nouvelleFin)} (renouvellement n° ${contrat.renouvellements + 1})`,
      userId: user.id,
    });
    await notifierSiContratARevoir(id, etatAvant);
    revalider(contrat.employeeId);
  });
}

/**
 * Prolonge la période d'essai d'un contrat, bornée par la durée maximale légale
 * (Paramètre légal « À VALIDER », modifiable dans les Barèmes).
 */
export async function prolongerEssai(id: string, formData: FormData) {
  await formulaireLisible(retourDe(formData), async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);
    const finEssaiStr = String(formData.get("finPeriodeEssai") ?? "").trim();
    if (!finEssaiStr) throw new Error("Nouvelle fin de période d'essai requise.");
    const contrat = await prisma.contrat.findUnique({ where: { id } });
    if (!contrat) return;

    const nouvelleFinEssai = new Date(finEssaiStr);
    const regles = await chargerReglesContrats();
    const erreur = verifierProlongationEssai(
      { dateDebut: contrat.dateDebut, finPeriodeEssai: contrat.finPeriodeEssai },
      nouvelleFinEssai,
      regles
    );
    if (erreur) throw new Error(erreur);

    const etatAvant = await etatSignatureContrat(id);
    await prisma.contrat.update({ where: { id }, data: { finPeriodeEssai: nouvelleFinEssai } });
    await journaliser(prisma, {
      entite: "Contrat",
      entiteId: contrat.employeeId,
      champ: "prolongation période d'essai",
      ancienneValeur: contrat.finPeriodeEssai ? dateFr(contrat.finPeriodeEssai) : "—",
      nouvelleValeur: dateFr(nouvelleFinEssai),
      userId: user.id,
    });
    await notifierSiContratARevoir(id, etatAvant);
    revalider(contrat.employeeId);
  });
}

export type ResultatExpiration = { traites: number; refus: { id: string; message: string }[] };

/**
 * « Marquer expiré » (spec 2026-09-28, §3.4) — geste de la Direction, à l'unité ou en lot. Un CDD
 * dont la date de fin est passée s'AFFICHE « expiré le … » partout sans que rien ne soit écrit
 * (`classerContrats`) ; c'est ce clic, et lui seul, qui pose `EXPIRE` en base.
 *
 * Tout ou rien PAR LIGNE : un contrat qui n'est pas échu (ou plus actif) est refusé avec son
 * message, les autres passent. Chaque passage est journalisé. L'écriture est conditionnée à
 * `statut: ACTIF` : deux clics simultanés ne journalisent pas deux fois.
 */
export const marquerContratsExpires = actionLisible(async (ids: string[]): Promise<ResultatExpiration> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const contrats = await prisma.contrat.findMany({ where: { id: { in: ids } }, select: { id: true, employeeId: true } });
  const employes = [...new Set(contrats.map((c) => c.employeeId))];
  const fiches = await prisma.contrat.findMany({
    where: { employeeId: { in: employes } },
    select: { id: true, employeeId: true, type: true, statut: true, dateDebut: true, dateFin: true, createdAt: true },
  });
  const maintenant = new Date();
  const classes = new Map<string, Classement>();
  for (const e of employes) {
    for (const [id, c] of classerContrats(fiches.filter((f) => f.employeeId === e), new Map(), maintenant)) classes.set(id, c);
  }

  const r: ResultatExpiration = { traites: 0, refus: [] };
  const touches = new Set<string>();
  for (const id of ids) {
    const f = fiches.find((x) => x.id === id);
    if (!f) { r.refus.push({ id, message: "Contrat introuvable." }); continue; }
    const cl = classes.get(id);
    if (f.statut !== "ACTIF") { r.refus.push({ id, message: `Ce contrat n'est plus actif (${cl?.motif ?? f.statut}).` }); continue; }
    if (!cl?.expireNonMarque) { r.refus.push({ id, message: "Ce contrat n'est pas encore échu : sa date de fin n'est pas passée." }); continue; }
    const fait = await prisma.$transaction(async (tx) => {
      const { count } = await tx.contrat.updateMany({ where: { id, statut: "ACTIF" }, data: { statut: "EXPIRE" } });
      if (count === 1) {
        await journaliser(tx, { entite: "Contrat", entiteId: id, champ: "statut", ancienneValeur: "ACTIF", nouvelleValeur: "EXPIRE", userId: user.id });
      }
      return count === 1;
    });
    if (fait) { r.traites++; touches.add(f.employeeId); }
    else r.refus.push({ id, message: "Ce contrat vient d'être modifié par ailleurs : rechargez la page." });
  }
  revalidatePath("/paie");
  revalidatePath("/documents");
  for (const e of touches) revalidatePath(`/employes/${e}`);
  return r;
});
