"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { calculerDeclarationsMois } from "@/lib/declarations";
import type { StatutDeclaration, TypeTaxe } from "@prisma/client";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { actionLisible } from "@/lib/action-lisible";
import { messageLisible } from "@/lib/erreur-metier";

/** Écrit le marquage d'UNE taxe sur un bordereau déjà calculé. Jette une erreur lisible en cas de refus. */
async function appliquerMarquage(
  user: { id: string },
  bordereau: NonNullable<Awaited<ReturnType<typeof calculerDeclarationsMois>>>,
  type: TypeTaxe,
  mois: number,
  annee: number,
  statut: StatutDeclaration,
) {
  if (statut !== "DECLARE" && statut !== "PAYE") throw new Error(`Statut inconnu : ${statut}`);
  const ligne = bordereau.lignes.find((l) => l.type === type);
  if (!ligne) throw new Error(`Taxe inconnue : ${type}`);

  await prisma.$transaction(async (tx) => {
    const existant = await tx.declarationTaxe.findUnique({ where: { type_mois_annee: { type, mois, annee } } });
    // Jamais de retour en arrière : une taxe payée ne redevient pas « déclarée ».
    if (existant?.statut === "PAYE") throw new Error("Cette déclaration est déjà marquée payée.");
    // Le provisoire n'empêche que le PREMIER marquage (celui qui fige le montant). Une taxe déjà
    // déclarée garde son montant figé : enregistrer son paiement reste possible même si un bulletin
    // a été rouvert depuis.
    const premierMarquage = !existant || existant.statut === "A_DECLARER";
    if (premierMarquage && bordereau.provisoire) {
      throw new Error(
        `Déclaration impossible : ${bordereau.nbNonValides} bulletin(s) sur ${bordereau.nbBulletins} ne sont pas encore validés — les montants peuvent encore changer. Validez la paie du mois d'abord.`,
      );
    }
    await tx.declarationTaxe.upsert({
      where: { type_mois_annee: { type, mois, annee } },
      // Le montant est figé au PREMIER marquage (déclaré) ; un passage à « payé » ne le change pas.
      // Une ligne encore « à déclarer » (suivi créé sans marquage) prend le montant du jour.
      update: {
        statut,
        marqueParId: user.id,
        dateMarquage: new Date(),
        ...(!existant || existant.statut === "A_DECLARER" ? { montantUSD: ligne.recalculUSD, montantCDF: ligne.recalculCDF } : {}),
      },
      create: {
        type,
        mois,
        annee,
        montantUSD: ligne.recalculUSD,
        montantCDF: ligne.recalculCDF,
        echeance: ligne.echeance,
        statut,
        marqueParId: user.id,
        dateMarquage: new Date(),
      },
    });
    await journaliser(tx, {
      entite: "DeclarationTaxe",
      entiteId: `${type}-${annee}-${mois}`,
      champ: "statut",
      nouvelleValeur: statut,
      userId: user.id,
    });
  });
}

/**
 * Marque une déclaration comme DÉCLARÉE ou PAYÉE (directeur uniquement).
 * Les montants sont figés au moment du marquage pour l'historique, et c'est ce montant figé que
 * l'écran et le PDF affichent ensuite (le recalcul qui différerait est signalé, voir `declarations.ts`).
 *
 * REFUSÉ tant qu'il reste des bulletins du mois ni validés ni payés (audit paie du 2026-10-10) : on
 * ne déclare pas, et on ne fige pas, un montant que la validation peut encore changer.
 */
export async function marquerDeclaration(
  type: TypeTaxe,
  mois: number,
  annee: number,
  statut: StatutDeclaration
) {
  await formulaireLisible("/declarations", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const bordereau = await calculerDeclarationsMois(mois, annee);
    if (!bordereau) throw new Error("Aucune paie calculée pour ce mois.");
    await appliquerMarquage(user, bordereau, type, mois, annee, statut);

    revalidatePath("/declarations");
    revalidatePath("/accueil");
  });
}

export type RapportMarquageLot = { traitees: number; echecs: string[] };

/**
 * Marque PLUSIEURS organismes d'un coup (Direction) : chacun suit les règles du marquage individuel ;
 * le refus de l'un (déjà payé, paie non validée) est NOMMÉ et n'arrête pas les autres. Le bordereau est
 * calculé une seule fois. L'écran lit le rapport (jamais de redirection `?erreur=`).
 */
export const marquerDeclarationsEnLot = actionLisible(async (
  types: TypeTaxe[],
  mois: number,
  annee: number,
  statut: StatutDeclaration,
): Promise<RapportMarquageLot> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const uniques = [...new Set(types)];
  if (uniques.length === 0) return { traitees: 0, echecs: [] };
  const bordereau = await calculerDeclarationsMois(mois, annee);
  if (!bordereau) throw new Error("Aucune paie calculée pour ce mois.");
  let traitees = 0;
  const echecs: string[] = [];
  for (const type of uniques) {
    const nom = bordereau.lignes.find((l) => l.type === type)?.libelle ?? type;
    try {
      await appliquerMarquage(user, bordereau, type, mois, annee, statut);
      traitees++;
    } catch (e) {
      echecs.push(`${nom} : ${messageLisible(e, "declarations marquerDeclarationsEnLot")}`);
    }
  }
  revalidatePath("/declarations");
  revalidatePath("/accueil");
  return { traitees, echecs };
});

/** Variante appelable depuis un <form> (server component) : lit les champs du FormData. */
export async function marquerDeclarationForm(formData: FormData): Promise<void> {
  const type = formData.get("type") as TypeTaxe;
  const mois = Number(formData.get("mois"));
  const annee = Number(formData.get("annee"));
  const statut = formData.get("statut") as StatutDeclaration;
  await marquerDeclaration(type, mois, annee, statut);
}
