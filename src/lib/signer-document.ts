import "server-only";

import { prisma } from "@/lib/prisma";
import { enregistrerSignature, type ParamsSignature } from "@/lib/signature";
import { genererContratPdf } from "@/lib/pdf/contrat-buffer";
import { televerserFichier } from "@/lib/storage";
import { creerNotification } from "@/lib/notifications";

// LE CHEMIN UNIQUE D'UNE SIGNATURE, une fois les gardes passées.
//
// Les deux actions (`app/espace/signature-actions.ts` et `app/(app)/signature-actions.ts`) ont
// chacune LEUR garde — qui a le droit de signer, et dans quel mode — puis appellent cette fonction.
// Tout ce qui suit la garde vit ici : recopié dans deux fichiers, un jour une seule des deux copies
// serait corrigée, et un contrat signé en présentiel n'aurait pas la même valeur qu'un contrat
// signé depuis l'espace.
//
// Pour un CONTRAT, signer vaut acceptation formelle (décision de la Direction, 2026-09-23) :
//  1. `enregistrerSignature` écrit la signature ET `accepteLe` dans une seule transaction ;
//  2. puis on fige l'exemplaire qui fait foi — hors transaction, et sans jamais bloquer
//     l'acceptation s'il échoue (même règle que l'ancien « Lu et approuvé ») ;
//  3. puis on prévient la Direction, SEULEMENT quand le salarié a signé seul depuis son espace.
//
// Pourquoi pas de notification en présentiel : la Direction tenait l'appareil. Lui annoncer par
// cloche, e-mail et push un geste qu'elle vient de recueillir est du bruit — et une cloche qui
// sonne pour rien apprend à ne plus la regarder. La trace, elle, existe : le journal d'audit
// (`journaliser`, mode PRESENTIEL) et la mention imprimée nomment le responsable présent.
export async function signerDocument(params: ParamsSignature): Promise<void> {
  const { signeLe } = await enregistrerSignature(prisma, params);

  if (params.cible === "CONTRAT") {
    await figerExemplaireSigne(params.cibleId);
  }

  if (params.mode === "ESPACE_SALARIE") {
    await prevenirDirection(params, signeLe);
  }
}

/**
 * Fige l'exemplaire du contrat qui FAIT FOI : produit juste après la signature, il porte le tracé,
 * la mention et la date du jour de l'acceptation. `contrat-buffer` le sert ensuite tant que la
 * signature reste à jour, plutôt qu'une régénération que le modèle ou la fiche de poste auraient
 * pu faire bouger depuis.
 *
 * `ignorerFige` : la transaction vient de retirer l'ancien exemplaire, mais on ne s'en remet pas à
 * cet ordre pour ne jamais recopier un PDF sans tracé.
 */
async function figerExemplaireSigne(contratId: string): Promise<void> {
  try {
    const pdf = await genererContratPdf(contratId, { ignorerFige: true });
    if (!pdf) return;
    const url = await televerserFichier(`contrats/${contratId}.pdf`, pdf.buffer, "application/pdf");
    await prisma.contrat.update({ where: { id: contratId }, data: { pdfAccepteUrl: url, pdfAccepteObsolete: false } });
  } catch {
    // Le figeage ne doit jamais bloquer l'acceptation : à défaut, le contrat reste généré à la
    // volée (avec le tracé), et la Direction peut toujours « Figer l'exemplaire » depuis la fiche.
  }
}

async function prevenirDirection(params: ParamsSignature, signeLe: Date): Promise<void> {
  const emp = await prisma.employee.findUnique({ where: { id: params.employeeId }, select: { nom: true } });
  const nom = emp?.nom ?? "Un salarié";

  if (params.cible === "CONTRAT") {
    const contrat = await prisma.contrat.findUnique({ where: { id: params.cibleId }, select: { type: true } });
    await creerNotification({
      type: "AUTRE",
      message: `${nom} a signé son contrat (${contrat?.type ?? "contrat"}).`,
      lien: `/employes/${params.employeeId}?tab=contrats`,
      // L'instant dans la clé : une RE-signature (nouvelle version) est une nouvelle acceptation,
      // pas la répétition de la précédente.
      refId: `contrat:${params.cibleId}:signe:${signeLe.getTime()}`,
    });
    return;
  }

  await creerNotification({
    type: "AUTRE",
    message: `${nom} a signé son document (${params.cible}) depuis son espace.`,
    lien: "/a-valider",
    refId: `signature:${params.cible}:${params.cibleId}`,
  });
}
