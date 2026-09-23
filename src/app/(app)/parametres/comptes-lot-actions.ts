"use server";

// Paramètres → Espace salarié : créer d'un coup les comptes des salariés actifs qui n'en ont pas,
// et imprimer une fiche de connexion par salarié. Cf. docs/superpowers/specs/2026-09-23-pointage-qr-design.md §3.
//
// Les mots de passe temporaires n'existent QU'UNE FOIS : dans le PDF renvoyé par cette action,
// produit en mémoire. Ils ne sont ni stockés, ni journalisés, ni renvoyés ailleurs — `crees` ne
// porte que le nom et le matricule.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { creerComptesSalaries } from "@/lib/comptes-salaries";
import { genererFichesConnexionPdf } from "@/lib/pdf/fiches-connexion";
import { ORIGINE_AFFICHE } from "@/lib/pointage-origines";

export type ResultatComptesEnLot = {
  /** Les fiches de connexion (PDF en base64) ; null si aucun compte n'a été créé. */
  pdfBase64: string | null;
  crees: { nom: string; matricule: string }[];
  /** Déjà un compte (non modifié), inactif, ou échec de ce compte-là. */
  ignores: { nom: string; raison: string }[];
};

export const creerComptesEnLot = actionLisible(async (employeeIds: string[]): Promise<ResultatComptesEnLot> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  if (!(await espaceEmployeActif())) throw new Error("L'espace salarié n'est pas activé (Paramètres).");
  if (!Array.isArray(employeeIds) || employeeIds.some((id) => typeof id !== "string" || !id))
    throw new Error("Sélection illisible. Rechargez la page et recommencez.");
  if (employeeIds.length === 0) throw new Error("Cochez au moins un salarié.");

  // Un échec n'arrête PAS le lot, et les comptes déjà créés restent : cf. creerComptesSalaries.
  const { crees, ignores } = await creerComptesSalaries(prisma, { employeeIds, auteurId: user.id });
  if (crees.length > 0) revalidatePath("/parametres");
  if (crees.length === 0) return { pdfBase64: null, crees: [], ignores };

  let pdf: Buffer;
  try {
    pdf = await genererFichesConnexionPdf({
      fiches: crees.map((c) => ({ nom: c.nom, matricule: c.matricule, motDePasse: c.motDePasse })),
      urlApplication: ORIGINE_AFFICHE,
    });
  } catch {
    // Les comptes existent, mais leurs mots de passe sont perdus avec ce PDF : le dire, nommer les
    // salariés, indiquer le seul recours (qui ne réécrit aucun autre compte), et ne pas perdre la
    // liste des non-créés que l'écran aurait affichée.
    const nonCrees = ignores.length > 0 ? ` Non créés : ${ignores.map((i) => `${i.nom} (${i.raison})`).join(", ")}.` : "";
    throw new Error(
      `Les comptes de ${crees.map((c) => c.nom).join(", ")} ont été créés, mais les fiches n'ont pas pu être produites : ` +
        `réinitialisez leur mot de passe depuis leur fiche employé.${nonCrees}`,
    );
  }

  return {
    pdfBase64: pdf.toString("base64"),
    crees: crees.map((c) => ({ nom: c.nom, matricule: c.matricule })),
    ignores,
  };
});
