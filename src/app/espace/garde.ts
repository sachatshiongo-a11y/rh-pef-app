import "server-only";
import { redirect } from "next/navigation";
import { verifySession, estSalarie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { doitChangerSonMotDePasse, type CompteMotDePasse } from "@/lib/mot-de-passe-temporaire";

export type Salarie = {
  userId: string;
  employeeId: string;
  nom: string; // nom complet (le modèle Employee ne sépare pas prénom/nom)
  prenom: string; // premier mot du nom, pour les salutations
};

/**
 * Le mot de passe temporaire se change AVANT tout accès : même chemin pour l'espace salarié,
 * l'entrée et l'espace Stock. N'y envoie que si la page de changement accueillera le compte
 * (sinon elle le renverrait vers /entree : boucle).
 */
export function exigerMotDePassePersonnel(c: CompteMotDePasse): void {
  if (doitChangerSonMotDePasse(c)) redirect("/espace/mot-de-passe");
}

/**
 * Garde des pages de l'espace salarié : exige la feature active + le rôle EMPLOYE + une fiche
 * liée, et force le changement du mot de passe temporaire avant tout accès. Renvoie l'employé.
 */
export async function chargerSalarie(): Promise<Salarie> {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user)) redirect("/entree");

  const compte = await prisma.user.findUnique({
    where: { id: user.id },
    select: { motDePasseTemporaire: true, employe: { select: { id: true, nom: true } } },
  });
  exigerMotDePassePersonnel({
    role: user.role,
    employeeId: user.employeeId,
    motDePasseTemporaire: compte?.motDePasseTemporaire ?? false,
    espaceOuvert: true, // vérifié ci-dessus
  });
  if (!compte?.employe) redirect("/entree");

  return { userId: user.id, employeeId: compte.employe.id, nom: compte.employe.nom, prenom: compte.employe.nom.split(" ")[0] };
}
