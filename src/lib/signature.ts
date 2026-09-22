import "server-only";

import type { CibleSignature, ModeSignature, Prisma } from "@prisma/client";
import {
  canonique,
  empreinteDe,
  instantaneBulletin,
  instantaneContrat,
  instantaneDemandeConge,
  type Instantane,
} from "@/lib/signature-document";

// LIRE ET ÉCRIRE UNE SIGNATURE — la couche qui relit le document cible, compare son empreinte à
// celle enregistrée à la signature, et écrit une nouvelle signature quand le document est
// signable et pas déjà signé.
//
// Même idiome que `lib/acompte-plafond.ts:127` (`ClientLecture`) : le client Prisma est reçu en
// PARAMÈTRE, jamais importé directement, pour que les tests d'intégration injectent le client du
// Postgres embarqué de `creerBaseTest()`.
type ClientSignature = Prisma.TransactionClient;

/** Ce qu'un écran affiche pour une signature — jamais le tracé PNG lui-même (chargé à part). */
export type SignatureVue = {
  traceUrl: string | null;
  signeLe: Date;
  mode: ModeSignature;
  nomSalarie: string;
  matricule: string;
  nomPresentePar: string | null;
  obsolete: boolean;
};

/**
 * Relit le document désigné et renvoie son instantané canonique — la même donnée que celle qui
 * serait signée aujourd'hui. `null` si le document n'existe plus (jamais une erreur : appelants
 * traitent l'absence comme un cas normal, ex. document supprimé après coup).
 */
export async function instantaneDe(
  client: ClientSignature,
  cible: CibleSignature,
  cibleId: string
): Promise<Instantane | null> {
  switch (cible) {
    case "BULLETIN": {
      const ligne = await client.payrollLine.findUnique({
        where: { id: cibleId },
        include: { payrollRun: true, employee: { select: { matricule: true } } },
      });
      return ligne ? instantaneBulletin(ligne) : null;
    }
    case "CONTRAT": {
      const contrat = await client.contrat.findUnique({
        where: { id: cibleId },
        include: { employee: { select: { matricule: true } } },
      });
      return contrat ? instantaneContrat(contrat) : null;
    }
    case "DEMANDE_CONGE": {
      const demande = await client.leaveRequest.findUnique({
        where: { id: cibleId },
        include: { employee: { select: { matricule: true } } },
      });
      return demande ? instantaneDemandeConge(demande) : null;
    }
  }
}

/**
 * État du document au regard de la signature : chaque cible a sa propre règle métier (bulletin
 * validé/payé, congé approuvé, contrat actif). Renvoie `employeeId` en cas de succès — le seul
 * champ dont `enregistrerSignature` a besoin de la base pour écrire la ligne.
 */
export async function documentSignable(
  client: ClientSignature,
  cible: CibleSignature,
  cibleId: string
): Promise<{ ok: true; employeeId: string } | { ok: false; raison: string }> {
  switch (cible) {
    case "BULLETIN": {
      const ligne = await client.payrollLine.findUnique({
        where: { id: cibleId },
        select: { employeeId: true, statutPaiement: true },
      });
      if (!ligne) return { ok: false, raison: "Bulletin introuvable." };
      if (ligne.statutPaiement !== "VALIDE" && ligne.statutPaiement !== "PAYE") {
        return { ok: false, raison: "Un bulletin doit être validé avant d'être signé." };
      }
      return { ok: true, employeeId: ligne.employeeId };
    }
    case "DEMANDE_CONGE": {
      const demande = await client.leaveRequest.findUnique({
        where: { id: cibleId },
        select: { employeeId: true, statut: true },
      });
      if (!demande) return { ok: false, raison: "Demande de congé introuvable." };
      if (demande.statut !== "APPROUVE") {
        return { ok: false, raison: "Une demande de congé doit être approuvée avant d'être signée." };
      }
      return { ok: true, employeeId: demande.employeeId };
    }
    case "CONTRAT": {
      const contrat = await client.contrat.findUnique({
        where: { id: cibleId },
        select: { employeeId: true, statut: true },
      });
      if (!contrat) return { ok: false, raison: "Contrat introuvable." };
      if (contrat.statut !== "ACTIF") {
        return { ok: false, raison: "Ce contrat n'est plus actif." };
      }
      return { ok: true, employeeId: contrat.employeeId };
    }
  }
}

/**
 * Lit la signature d'un document et détecte l'obsolescence : recalcule l'instantané ACTUEL du
 * document et le compare à l'empreinte enregistrée à la signature. Si elles diffèrent et que la
 * signature n'était pas déjà marquée, PERSISTE `obsolete: true` (jamais l'inverse : une fois
 * marquée obsolète, seule une nouvelle signature — `enregistrerSignature` — repart à zéro).
 *
 * Une empreinte vide (`""`) signale une signature reprise par la migration (ancien clic
 * « Lu et approuvé » sans instantané) : on ne compare rien, elle n'est jamais marquée obsolète.
 */
export async function chargerSignature(
  client: ClientSignature,
  cible: CibleSignature,
  cibleId: string
): Promise<SignatureVue | null> {
  const sig = await client.signatureElectronique.findUnique({
    where: { cible_cibleId: { cible, cibleId } },
    include: {
      employee: { select: { nom: true, matricule: true } },
      presentePar: { select: { nom: true } },
    },
  });
  if (!sig) return null;

  let obsolete = sig.obsolete;
  if (sig.empreinte !== "" && !sig.obsolete) {
    const instantane = await instantaneDe(client, cible, cibleId);
    if (instantane && empreinteDe(instantane) !== sig.empreinte) {
      await client.signatureElectronique.update({
        where: { id: sig.id },
        data: { obsolete: true },
      });
      obsolete = true;
    }
  }

  return {
    traceUrl: sig.traceUrl,
    signeLe: sig.signeLe,
    mode: sig.mode,
    nomSalarie: sig.employee.nom,
    matricule: sig.employee.matricule,
    nomPresentePar: sig.presentePar?.nom ?? null,
    obsolete,
  };
}

/**
 * Écrit une signature : refuse si le document n'est pas signable, refuse si une signature NON
 * obsolète existe déjà (un document déjà signé et à jour ne se re-signe pas en silence). Sinon
 * `upsert` sur `[cible, cibleId]` — une signature obsolète peut être remplacée (la Direction a
 * corrigé le document, le salarié re-signe la version à jour).
 */
export async function enregistrerSignature(
  client: ClientSignature,
  params: {
    cible: CibleSignature;
    cibleId: string;
    employeeId: string;
    traceUrl: string | null;
    mode: ModeSignature;
    presenteParId: string | null;
  }
): Promise<void> {
  const instantane = await instantaneDe(client, params.cible, params.cibleId);
  if (!instantane) {
    throw new Error("Document introuvable.");
  }

  const etat = await documentSignable(client, params.cible, params.cibleId);
  if (!etat.ok) {
    throw new Error(etat.raison);
  }

  const existante = await client.signatureElectronique.findUnique({
    where: { cible_cibleId: { cible: params.cible, cibleId: params.cibleId } },
  });
  if (existante && !existante.obsolete) {
    throw new Error("Ce document est déjà signé.");
  }

  const donnees = JSON.parse(canonique(instantane)) as Prisma.InputJsonValue;
  const empreinte = empreinteDe(instantane);

  await client.signatureElectronique.upsert({
    where: { cible_cibleId: { cible: params.cible, cibleId: params.cibleId } },
    create: {
      cible: params.cible,
      cibleId: params.cibleId,
      employeeId: params.employeeId,
      traceUrl: params.traceUrl,
      mode: params.mode,
      presenteParId: params.presenteParId,
      donnees,
      empreinte,
      signeLe: new Date(),
      obsolete: false,
    },
    update: {
      employeeId: params.employeeId,
      traceUrl: params.traceUrl,
      mode: params.mode,
      presenteParId: params.presenteParId,
      donnees,
      empreinte,
      signeLe: new Date(),
      obsolete: false,
    },
  });
}
