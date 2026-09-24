"use server";

// Paramètres → Espace salarié : pour les salariés cochés, créer les comptes qui manquent
// (« Créer les comptes ») ou donner un nouveau mot de passe temporaire aux comptes existants
// (« Nouvelle fiche »), et produire UNE FICHE DE CONNEXION PAR SALARIÉ — un PDF à part, à envoyer
// à ce salarié seul (WhatsApp) — plus la planche de toutes les fiches (8 par A4) pour qui imprime.
// Cf. docs/superpowers/specs/2026-09-23-pointage-qr-design.md §3.
//
// Les mots de passe temporaires n'existent QU'UNE FOIS : dans les PDF renvoyés par ces actions,
// produits en mémoire. Ils ne sont ni stockés, ni journalisés, ni renvoyés en clair : chaque ligne
// du résultat ne porte en clair que le nom, le matricule et le téléphone.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { creerComptesSalaries, reinitialiserComptesSalaries, type ResultatLot } from "@/lib/comptes-salaries";
import { genererFichesConnexionPdf, genererFichesIndividuellesPdf } from "@/lib/pdf/fiches-connexion";
import { ORIGINE_AFFICHE } from "@/lib/pointage-origines";

/** La fiche d'UN salarié : son PDF (base64) ne porte que SON mot de passe. */
export type FicheSalarie = {
  employeeId: string;
  nom: string;
  matricule: string;
  telephone: string | null;
  ficheBase64: string;
};

export type ResultatFichesEnLot = {
  /** Une par salarié créé/réinitialisé, dans l'ordre alphabétique. */
  fiches: FicheSalarie[];
  /** Toutes les fiches, 8 par A4, à imprimer et découper ; null si aucune fiche. */
  plancheBase64: string | null;
  /** Non traités : déjà un compte, pas de compte, compte par e-mail, inactif, ou échec de celui-là. */
  ignores: { nom: string; raison: string }[];
};

async function exigerDirection(employeeIds: string[]) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  if (!(await espaceEmployeActif())) throw new Error("L'espace salarié n'est pas activé (Paramètres).");
  if (!Array.isArray(employeeIds) || employeeIds.some((id) => typeof id !== "string" || !id))
    throw new Error("Sélection illisible. Rechargez la page et recommencez.");
  if (employeeIds.length === 0) throw new Error("Cochez au moins un salarié.");
  return user;
}

/**
 * Les fiches d'un lot déjà traité. Si le rendu échoue, les comptes restent créés/réinitialisés
 * mais leurs mots de passe sont perdus avec les PDF : le dire, nommer les salariés, indiquer le
 * recours, et ne pas perdre la liste des non-traités que l'écran aurait affichée.
 */
async function produireFiches(
  lot: ResultatLot,
  recours: (noms: string) => string,
  libelleNonTraites: string,
): Promise<ResultatFichesEnLot> {
  const { crees, ignores } = lot;
  if (crees.length === 0) return { fiches: [], plancheBase64: null, ignores };

  const telephones = new Map(
    (
      await prisma.employee.findMany({ where: { id: { in: crees.map((c) => c.employeeId) } }, select: { id: true, telephone: true } })
    ).map((e) => [e.id, e.telephone?.trim() || null]),
  );
  const contenus = crees.map((c) => ({ nom: c.nom, matricule: c.matricule, motDePasse: c.motDePasse }));

  let individuelles: Buffer[];
  let planche: Buffer;
  try {
    individuelles = await genererFichesIndividuellesPdf({ fiches: contenus, urlApplication: ORIGINE_AFFICHE });
    planche = await genererFichesConnexionPdf({ fiches: contenus, urlApplication: ORIGINE_AFFICHE });
    if (individuelles.length !== crees.length) throw new Error("fiches incomplètes");
  } catch {
    const nonTraites = ignores.length > 0 ? ` ${libelleNonTraites} : ${ignores.map((i) => `${i.nom} (${i.raison})`).join(", ")}.` : "";
    throw new Error(`${recours(crees.map((c) => c.nom).join(", "))}${nonTraites}`);
  }

  return {
    // `individuelles[i]` a été rendue depuis `crees[i]` et depuis lui seul.
    fiches: crees.map((c, i) => ({
      employeeId: c.employeeId,
      nom: c.nom,
      matricule: c.matricule,
      telephone: telephones.get(c.employeeId) ?? null,
      ficheBase64: individuelles[i].toString("base64"),
    })),
    plancheBase64: planche.toString("base64"),
    ignores,
  };
}

/** « Créer les comptes » : les salariés cochés SANS compte. Un compte existant n'est jamais touché. */
export const creerComptesEnLot = actionLisible(async (employeeIds: string[]): Promise<ResultatFichesEnLot> => {
  const user = await exigerDirection(employeeIds);
  // Un échec n'arrête PAS le lot, et les comptes déjà créés restent : cf. creerComptesSalaries.
  const lot = await creerComptesSalaries(prisma, { employeeIds, auteurId: user.id });
  if (lot.crees.length > 0) revalidatePath("/parametres");
  return produireFiches(
    lot,
    (noms) =>
      `Les comptes de ${noms} ont été créés, mais les fiches n'ont pas pu être produites : ` +
      `réinitialisez leur mot de passe depuis leur fiche employé.`,
    "Non créés",
  );
});

/**
 * « Nouvelle fiche » : un NOUVEAU mot de passe temporaire pour les salariés cochés qui ont un
 * compte à identifiant matricule — l'ancien mot de passe cesse aussitôt de fonctionner, et un
 * compte désactivé est réactivé. L'écran le fait confirmer avant d'appeler.
 */
export const nouvellesFichesEnLot = actionLisible(async (employeeIds: string[]): Promise<ResultatFichesEnLot> => {
  const user = await exigerDirection(employeeIds);
  const lot = await reinitialiserComptesSalaries(prisma, { employeeIds, auteurId: user.id });
  if (lot.crees.length > 0) revalidatePath("/parametres");
  return produireFiches(
    lot,
    (noms) =>
      `Les mots de passe de ${noms} ont été réinitialisés, mais les fiches n'ont pas pu être produites : ` +
      `leurs anciens mots de passe ne fonctionnent plus. Relancez « Nouvelle fiche » pour eux.`,
    "Non réinitialisés",
  );
});
