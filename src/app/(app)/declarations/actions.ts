"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { calculerDeclarationsMois } from "@/lib/declarations";
import type { StatutDeclaration, TypeTaxe } from "@prisma/client";

/**
 * Marque une déclaration comme DÉCLARÉE ou PAYÉE (directeur uniquement).
 * Les montants sont figés au moment du marquage pour l'historique.
 */
export async function marquerDeclaration(
  type: TypeTaxe,
  mois: number,
  annee: number,
  statut: StatutDeclaration
) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const bordereau = await calculerDeclarationsMois(mois, annee);
  if (!bordereau) throw new Error("Aucune paie calculée pour ce mois.");
  const ligne = bordereau.lignes.find((l) => l.type === type);
  if (!ligne) throw new Error(`Taxe inconnue : ${type}`);

  await prisma.$transaction(async (tx) => {
    await tx.declarationTaxe.upsert({
      where: { type_mois_annee: { type, mois, annee } },
      update: { statut, marqueParId: user.id, dateMarquage: new Date() },
      create: {
        type,
        mois,
        annee,
        montantUSD: ligne.montantUSD,
        montantCDF: ligne.montantCDF,
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

  revalidatePath("/declarations");
  revalidatePath("/dashboard");
}

/** Variante appelable depuis un <form> (server component) : lit les champs du FormData. */
export async function marquerDeclarationForm(formData: FormData): Promise<void> {
  const type = formData.get("type") as TypeTaxe;
  const mois = Number(formData.get("mois"));
  const annee = Number(formData.get("annee"));
  const statut = formData.get("statut") as StatutDeclaration;
  await marquerDeclaration(type, mois, annee, statut);
}
