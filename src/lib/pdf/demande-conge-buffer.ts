import "server-only";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { DemandeCongeDocument } from "@/lib/pdf/demande-conge";
import { ancienneteEnMois, calculerCongesAcquis, congeDeductibleDuSolde } from "@/lib/payroll";
import { chargerParametresPaie } from "@/lib/config";
import { typeSansConges, chargerCompteDansSoldeParType } from "@/lib/regles-contrats";
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
    include: { employee: true, approuvePar: true, remplacant: true },
  });
  if (!demande) return null;

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const annee = config?.anneeCourante ?? new Date().getFullYear();
  const mois = config?.moisCourant ?? new Date().getMonth() + 1;
  const debutAnnee = new Date(Date.UTC(annee, 0, 1));

  const ancienneteMois = ancienneteEnMois(new Date(demande.employee.dateEmbauche), new Date(annee, mois - 1, 1));
  const parametres = await chargerParametresPaie();
  const congesAcquis = typeSansConges(demande.employee.contrat) ? 0 : calculerCongesAcquis(ancienneteMois, parametres.droitsCongesAnnuel);

  const [approuvees, compteParType] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        employeeId: demande.employeeId,
        statut: "APPROUVE",
        dateDebut: { gte: debutAnnee },
      },
    }),
    chargerCompteDansSoldeParType(),
  ]);
  // Seuls les types cochés « compte dans le solde » (Paramètres) entament le solde de congé annuel.
  const congesPris = approuvees
    .filter((l) => congeDeductibleDuSolde(compteParType.get(l.type)))
    .reduce((acc, l) => acc + Number(l.nbJours), 0);
  const soldeConges = Math.round((congesAcquis - congesPris) * 10) / 10;

  const signatureSalarie = await signatureImprimable(prisma, "DEMANDE_CONGE", demande.id);
  const buffer = await renderPdfBuffer(
    DemandeCongeDocument({
      employee: demande.employee,
      demande,
      approuvePar: demande.approuvePar,
      remplacant: demande.remplacant,
      soldeConges,
      signatureSalarie,
    })
  );

  return { buffer, nomFichier: `Demande_${demande.employee.matricule}.pdf`, employeeId: demande.employeeId };
}
