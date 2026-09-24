"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, invaliderProfil } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { actionLisible } from "@/lib/action-lisible";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { creerCompteSalarie, reinitialiserCompteSalarie } from "@/lib/comptes-salaries";

/**
 * Crée le compte de l'espace salarié d'un employé — Direction uniquement,
 * et seulement si l'espace salarié est activé. Le salarié se connecte avec son MATRICULE et un
 * mot de passe TEMPORAIRE renvoyé une seule fois (à transmettre en main propre) qu'il changera
 * à sa 1re connexion. Aucun mot de passe n'est stocké côté application.
 * La création elle-même est `creerCompteSalarie` — le même chemin que la création en lot.
 */
export const creerCompteEmploye = actionLisible(async (employeeId: string): Promise<{ matricule: string; motDePasse: string }> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  if (!(await espaceEmployeActif())) throw new Error("L'espace salarié n'est pas activé (Paramètres).");

  const { matricule, motDePasse } = await creerCompteSalarie(prisma, { employeeId, auteurId: user.id });
  revalidatePath(`/employes/${employeeId}`);
  return { matricule, motDePasse };
});

/**
 * Régénère un mot de passe temporaire pour un compte salarié existant (Direction). La
 * réinitialisation elle-même est `reinitialiserCompteSalarie` — le même chemin que « Nouvelle
 * fiche » (Paramètres → Espace salarié). Cet écran ne gère que les comptes au rôle EMPLOYE
 * (c'est ce que la fiche employé affiche comme « compte salarié ») ; un compte STOCK à identifiant
 * matricule se réinitialise depuis Paramètres.
 */
export const reinitialiserCompteEmploye = actionLisible(async (employeeId: string): Promise<{ matricule: string; motDePasse: string }> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  if (!(await espaceEmployeActif())) throw new Error("L'espace salarié n'est pas activé (Paramètres).");

  const compte = await prisma.user.findUnique({ where: { employeeId }, select: { role: true } });
  if (!compte || compte.role !== "EMPLOYE") throw new Error("Aucun compte salarié pour cet employé.");

  const { matricule, motDePasse } = await reinitialiserCompteSalarie(prisma, { employeeId, auteurId: user.id });
  revalidatePath(`/employes/${employeeId}`);
  return { matricule, motDePasse };
});

/** Accorde / retire au salarié l'accès à l'espace Stock (cumul de rôles) — Direction. */
export const definirAccesStock = actionLisible(async (employeeId: string, actif: boolean): Promise<void> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const compte = await prisma.user.findUnique({ where: { employeeId }, select: { id: true, role: true } });
  if (!compte || compte.role !== "EMPLOYE") throw new Error("Aucun compte salarié pour cet employé.");
  await prisma.user.update({ where: { id: compte.id }, data: { accesStock: actif } });
  invaliderProfil(compte.id); // le nouvel accès prend effet à la prochaine navigation
  await journaliser(prisma, { entite: "User", entiteId: compte.id, champ: "accesStock", nouvelleValeur: actif ? "accordé" : "retiré", userId: user.id });
  revalidatePath(`/employes/${employeeId}`);
});

/** Désactive le compte salarié (le salarié ne peut plus se connecter ; réactivable par reset). */
export const desactiverCompteEmploye = actionLisible(async (employeeId: string): Promise<void> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const compte = await prisma.user.findUnique({ where: { employeeId }, select: { id: true, role: true } });
  if (!compte || compte.role !== "EMPLOYE") throw new Error("Aucun compte salarié pour cet employé.");
  await prisma.user.update({ where: { id: compte.id }, data: { actif: false } });
  await journaliser(prisma, { entite: "User", entiteId: compte.id, champ: "desactivation", nouvelleValeur: "compte salarié désactivé", userId: user.id });
  revalidatePath(`/employes/${employeeId}`);
});
