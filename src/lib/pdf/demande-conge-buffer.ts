import "server-only";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { DemandeCongeDocument } from "@/lib/pdf/demande-conge";
import { chargerSoldeCongeSalarie } from "@/lib/solde-conge-salarie";
import { soldeFigeDe, type SoldeImprime } from "@/lib/solde-conge-imprime";
import { signatureImprimable } from "@/lib/signature";

/**
 * Génère le PDF d'une demande de congé (buffer + nom de fichier) — partagé entre la route
 * Direction (/conges/demande/[id]) et l'espace salarié (/espace/conges/demande/[id]).
 * Renvoie null si la demande n'existe pas.
 *
 * TOUT est ici, y compris la signature du salarié : c'est ce partage qui garantit que le salarié
 * lit EXACTEMENT le document que la Direction imprime — mêmes mentions, même paraphe, même
 * comportement quand le document a bougé depuis la signature. Une seconde variante du document,
 * recopiée côté espace salarié, divergerait au premier changement de l'une des deux.
 *
 * `employeeId` est renvoyé pour que l'appelant vérifie la PROPRIÉTÉ du document — même idiome que
 * `genererBulletinPdf` et `genererContratPdf`.
 */
export async function genererDemandeCongePdf(
  demandeId: string
): Promise<{ buffer: Buffer; nomFichier: string; employeeId: string } | null> {
  const demande = await prisma.leaveRequest.findUnique({
    where: { id: demandeId },
    include: { employee: true, remplacant: true },
  });
  if (!demande) return null;

  // LE SOLDE IMPRIMÉ (décision Direction 2026-09-29, voir `lib/solde-conge-imprime.ts`) :
  //  - demande APPROUVÉE : le solde FIGÉ à l'approbation, daté de l'approbation ;
  //  - sinon (en attente, refusée, ou approuvée avant l'instantané) : le solde du jour, lu à la
  //    SOURCE UNIQUE à l'horloge — le chiffre de « Mes congés » et de la fiche Direction — et daté
  //    de l'ÉDITION, en toutes lettres. Rien n'est reconstitué pour une ancienne approbation.
  // Aucun de ces chiffres n'entre dans l'empreinte de signature (`instantaneDemandeConge` :
  // matricule, type, dates, jours, statut, approbateur) : figer le solde ne fait basculer aucune
  // demande signée « à resigner ». Aucun PDF n'est stocké : le document est rendu à chaque ouverture.
  const maintenant = new Date();
  const solde: SoldeImprime = soldeFigeDe(demande) ?? {
    jours: (await chargerSoldeCongeSalarie(prisma, demande.employeeId, maintenant)).solde,
    au: maintenant,
    origine: "EDITION",
  };

  const signatureSalarie = await signatureImprimable(prisma, "DEMANDE_CONGE", demande.id);
  const buffer = await renderPdfBuffer(
    DemandeCongeDocument({
      employee: demande.employee,
      demande,
      remplacant: demande.remplacant,
      solde,
      signatureSalarie,
    })
  );

  return { buffer, nomFichier: `Demande_${demande.employee.matricule}.pdf`, employeeId: demande.employeeId };
}
