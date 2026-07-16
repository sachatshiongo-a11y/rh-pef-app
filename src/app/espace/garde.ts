import "server-only";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";

export type Salarie = {
  userId: string;
  employeeId: string;
  nom: string; // nom complet (le modèle Employee ne sépare pas prénom/nom)
  prenom: string; // premier mot du nom, pour les salutations
};

/**
 * Garde des pages de l'espace salarié : exige la feature active + le rôle EMPLOYE + une fiche
 * liée, et force le changement du mot de passe temporaire avant tout accès. Renvoie l'employé.
 */
export async function chargerSalarie(): Promise<Salarie> {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || user.role !== "EMPLOYE") redirect("/entree");

  const compte = await prisma.user.findUnique({
    where: { id: user.id },
    select: { motDePasseTemporaire: true, employe: { select: { id: true, nom: true } } },
  });
  if (compte?.motDePasseTemporaire) redirect("/espace/mot-de-passe");
  if (!compte?.employe) redirect("/entree");

  return { userId: user.id, employeeId: compte.employe.id, nom: compte.employe.nom, prenom: compte.employe.nom.split(" ")[0] };
}
