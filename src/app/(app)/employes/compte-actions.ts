"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { actionLisible } from "@/lib/action-lisible";
import { espaceEmployeActif, emailInterneMatricule, genererMotDePasseTemporaire } from "@/lib/espace-employe";
import { creerUtilisateurAuth, supprimerUtilisateurAuth, changerMotDePasseAdmin } from "@/lib/securite-connexion";

/**
 * Crée (ou réinitialise) le compte de l'espace salarié d'un employé — Direction uniquement,
 * et seulement si l'espace salarié est activé. Le salarié se connecte avec son MATRICULE et un
 * mot de passe TEMPORAIRE renvoyé une seule fois (à transmettre en main propre) qu'il changera
 * à sa 1re connexion. Aucun mot de passe n'est stocké côté application.
 */
export const creerCompteEmploye = actionLisible(async (employeeId: string): Promise<{ matricule: string; motDePasse: string }> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  if (!(await espaceEmployeActif())) throw new Error("L'espace salarié n'est pas activé (Paramètres).");

  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { id: true, nom: true, matricule: true, actif: true } });
  if (!emp.actif) throw new Error("Cet employé n'est plus actif.");

  const dejaCompte = await prisma.user.findUnique({ where: { employeeId }, select: { id: true } });
  if (dejaCompte) throw new Error("Un compte existe déjà pour ce salarié. Utilisez « Réinitialiser le mot de passe ».");

  const email = emailInterneMatricule(emp.matricule);
  const motDePasse = genererMotDePasseTemporaire();

  // Crée le compte Auth, puis la ligne applicative. En cas d'échec applicatif, on nettoie l'Auth.
  const authId = await creerUtilisateurAuth(email, motDePasse);
  try {
    await prisma.user.create({
      data: { id: authId, email, nom: emp.nom, role: "EMPLOYE", employeeId, motDePasseTemporaire: true },
    });
  } catch (e) {
    await supprimerUtilisateurAuth(authId);
    throw e;
  }

  await journaliser(prisma, { entite: "User", entiteId: authId, champ: "creation", nouvelleValeur: `compte salarié ${emp.matricule}`, userId: user.id });
  revalidatePath(`/employes/${employeeId}`);
  return { matricule: emp.matricule, motDePasse };
});

/** Régénère un mot de passe temporaire pour un compte salarié existant (Direction). */
export const reinitialiserCompteEmploye = actionLisible(async (employeeId: string): Promise<{ matricule: string; motDePasse: string }> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  if (!(await espaceEmployeActif())) throw new Error("L'espace salarié n'est pas activé (Paramètres).");

  const compte = await prisma.user.findUnique({ where: { employeeId }, include: { employe: { select: { matricule: true } } } });
  if (!compte || compte.role !== "EMPLOYE") throw new Error("Aucun compte salarié pour cet employé.");

  const motDePasse = genererMotDePasseTemporaire();
  await changerMotDePasseAdmin(compte.id, motDePasse);
  await prisma.user.update({ where: { id: compte.id }, data: { motDePasseTemporaire: true, actif: true } });

  await journaliser(prisma, { entite: "User", entiteId: compte.id, champ: "reinitialisation", nouvelleValeur: "mot de passe temporaire régénéré", userId: user.id });
  revalidatePath(`/employes/${employeeId}`);
  return { matricule: compte.employe?.matricule ?? "", motDePasse };
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
