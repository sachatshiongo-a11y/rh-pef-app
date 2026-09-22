import "server-only";

import { Prisma } from "@prisma/client";
import type { CibleSignature, ModeSignature } from "@prisma/client";
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
 * obsolète existe déjà (un document déjà signé et à jour ne se re-signe pas en silence). Une
 * signature obsolète peut être remplacée (la Direction a corrigé le document, le salarié re-signe
 * la version à jour).
 *
 * L'invariant « une seule signature non obsolète par document » est tenu par la BASE, pas par une
 * lecture applicative : un `findUnique` suivi d'un `upsert` séparé laisse une fenêtre entre lecture
 * et écriture (double-clic, renvoi réseau) où deux appels concurrents peuvent tous les deux lire
 * « pas de signature valide » et le second écraserait alors une signature qui vient d'être posée.
 * Deux écritures conditionnelles à la place :
 *  1. `updateMany` filtré sur `obsolete: true` — ne touche RIEN si la ligne n'est plus obsolète
 *     (un concurrent l'a déjà remplacée entre-temps) : la condition est réévaluée par Postgres au
 *     moment de l'écriture, pas au moment d'une lecture qui peut être périmée.
 *  2. Sinon `create` — et c'est la contrainte d'unicité `[cible, cibleId]` de la base qui tranche
 *     entre deux créations concurrentes : le perdant reçoit `P2002`, traduit en refus métier.
 */
/**
 * Décode le tracé envoyé par le navigateur. NE JAMAIS faire confiance au client : ce n'est pas
 * parce que le composant `CadreSignature` n'exporte que du PNG qu'un appel direct de l'action
 * (contournant l'UI) ne pourrait pas envoyer autre chose — un SVG (vecteur, peut contenir du
 * script), un autre format d'image, ou n'importe quel blob en base64. On vérifie l'en-tête PNG
 * OCTET PAR OCTET, jamais la déclaration `data:image/...` seule (un attaquant la falsifie
 * trivialement).
 */
export function decoderTrace(dataUrl: string): Buffer {
  const prefixe = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefixe)) throw new Error("Signature illisible.");
  const buf = Buffer.from(dataUrl.slice(prefixe.length), "base64");
  // En-tête PNG : 89 50 4E 47 0D 0A 1A 0A
  const enTete = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 100 || !buf.subarray(0, 8).equals(enTete)) throw new Error("Signature illisible.");
  if (buf.length > 400_000) throw new Error("Signature trop lourde.");
  return buf;
}

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

  // Contrôle immédiat : donne un message rapide dans le cas NON concurrent (l'écrasante majorité
  // des appels). Ce n'est PAS ce sur quoi repose l'invariant — voir les deux écritures ci-dessous.
  const existante = await client.signatureElectronique.findUnique({
    where: { cible_cibleId: { cible: params.cible, cibleId: params.cibleId } },
  });
  if (existante && !existante.obsolete) {
    throw new Error("Ce document est déjà signé.");
  }

  const donnees = JSON.parse(canonique(instantane)) as Prisma.InputJsonValue;
  const empreinte = empreinteDe(instantane);
  const champs = {
    employeeId: params.employeeId,
    traceUrl: params.traceUrl,
    mode: params.mode,
    presenteParId: params.presenteParId,
    donnees,
    empreinte,
    signeLe: new Date(),
    obsolete: false,
  };

  // 1. Remplacement atomique d'une signature obsolète.
  const remplacees = await client.signatureElectronique.updateMany({
    where: { cible: params.cible, cibleId: params.cibleId, obsolete: true },
    data: champs,
  });
  if (remplacees.count === 1) {
    return;
  }

  // 2. Aucune ligne obsolète à remplacer : soit il n'existait aucune signature, soit elle existe
  // et n'est PAS obsolète — dans les deux cas on tente une création, et c'est la contrainte
  // d'unicité de la base qui décide.
  try {
    await client.signatureElectronique.create({
      data: { cible: params.cible, cibleId: params.cibleId, ...champs },
    });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      throw new Error("Ce document est déjà signé.");
    }
    throw erreur;
  }
}
