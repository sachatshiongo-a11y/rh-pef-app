"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { chargerReglesContrats, verifierProlongationCdd, verifierProlongationEssai } from "@/lib/regles-contrats";
import type { TypeContrat } from "@prisma/client";

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
    await prisma.$transaction(async (tx) => {
      await tx.contrat.update({ where: { id }, data: { statut: "TRANSFORME" } });
      await tx.contrat.create({
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
    });
    revalider(contrat.employeeId);
  });
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

    await prisma.contrat.update({ where: { id }, data: { finPeriodeEssai: nouvelleFinEssai } });
    await journaliser(prisma, {
      entite: "Contrat",
      entiteId: contrat.employeeId,
      champ: "prolongation période d'essai",
      ancienneValeur: contrat.finPeriodeEssai ? dateFr(contrat.finPeriodeEssai) : "—",
      nouvelleValeur: dateFr(nouvelleFinEssai),
      userId: user.id,
    });
    revalider(contrat.employeeId);
  });
}
