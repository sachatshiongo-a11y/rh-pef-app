import type { PrismaClient, Role } from "@prisma/client";
import { estRH, estStock } from "@/lib/espaces";

/**
 * QUI PEUT OUVRIR UN FICHIER DU BUCKET PRIVÉ (`/fichiers/<chemin>`).
 *
 * Jusqu'au 2026-09-28, `app/fichiers/[...chemin]/route.ts` signait une URL pour TOUT compte
 * connecté. Or les chemins se devinent (`documents/<employeeId>-<horodatage>.pdf`,
 * `contrats/<contratId>.pdf`, photos `<employeeId>-<horodatage>.jpg`…) et les identifiants des
 * collègues circulent dans l'espace salarié : un salarié pouvait ouvrir le dossier d'un autre.
 *
 * Le propriétaire se lit dans la BASE, jamais dans le chemin : on cherche la ligne qui référence
 * EXACTEMENT ce lien, et c'est son `employeeId` qui décide.
 *
 *  - RH (même règle que `estRH`, donc que le layout RH) : tout.
 *  - Compte relié à une fiche (salarié, magasinier, Direction salariée…) : SES fichiers —
 *      Employee.photoUrl (sa photo, affichée dans toutes les coquilles),
 *      DocumentEmploye.fichierUrl (« Autres documents » de son espace, certificats envoyés),
 *      Contrat.documentUrl (« pièce jointe » de son espace) et Contrat.pdfAccepteUrl,
 *      FraisMedical.certificatUrl, SignatureElectronique.traceUrl (son propre tracé).
 *    Volontairement EXCLUS, même quand ils le concernent : Attestation.pdfUrl (l'exemplaire figé
 *    d'une attestation se télécharge par `/espace/attestations/[id]`, qui contrôle la propriété et
 *    régénère depuis l'instantané si le stockage flanche — un seul chemin, pas deux), DossierDisciplinaire.documentUrl,
 *    Evaluation.documentUrl et TransitionPaie.preuveUrl (une preuve de virement peut couvrir un
 *    LOT de salaires, donc ceux des collègues). L'espace salarié ne les propose nulle part ; les
 *    ouvrir est une décision de la Direction, pas un effet de bord de cette route.
 *  - Espace Stock (même règle que `estStock`) : les pièces du stock — FactureFournisseur.documentUrl,
 *    BonDeCommande.documentUrl, FicheTechnique.photoUrl.
 *  - Tout le reste — chemin inconnu en base, logo et signature des Paramètres, fiches de poste —
 *    est refusé à qui n'est pas RH.
 */
export type CompteFichier = { role: Role; accesStock?: boolean; employeeId?: string | null };

export async function peutLireFichier(db: PrismaClient, user: CompteFichier, url: string): Promise<boolean> {
  if (estRH(user.role)) return true;

  const verifications: Promise<unknown>[] = [];
  const employeeId = user.employeeId;
  if (employeeId) {
    const sel = { select: { id: true } } as const;
    verifications.push(
      db.employee.findFirst({ where: { id: employeeId, photoUrl: url }, ...sel }),
      db.documentEmploye.findFirst({ where: { employeeId, fichierUrl: url }, ...sel }),
      db.contrat.findFirst({ where: { employeeId, OR: [{ documentUrl: url }, { pdfAccepteUrl: url }] }, ...sel }),
      db.fraisMedical.findFirst({ where: { employeeId, certificatUrl: url }, ...sel }),
      db.signatureElectronique.findFirst({ where: { employeeId, traceUrl: url }, ...sel }),
    );
  }
  if (estStock(user)) {
    const sel = { select: { id: true } } as const;
    verifications.push(
      db.factureFournisseur.findFirst({ where: { documentUrl: url }, ...sel }),
      db.bonDeCommande.findFirst({ where: { documentUrl: url }, ...sel }),
      db.ficheTechnique.findFirst({ where: { photoUrl: url }, ...sel }),
    );
  }
  if (verifications.length === 0) return false;
  const trouves = await Promise.all(verifications);
  return trouves.some((t) => t != null);
}
