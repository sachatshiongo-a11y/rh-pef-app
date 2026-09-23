import { redirect } from "next/navigation";
import { verifySession, espacesDe, accueilEspace, estSalarie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";

// Résolveur d'entrée après connexion : oriente chaque compte vers SON espace.
// - un compte salarié (EMPLOYE, ou relié à une fiche) : mot de passe à changer si temporaire, d'abord ;
// - un seul accès  → on entre directement dans cet espace ;
// - plusieurs accès (Direction RH+Stock, salarié+stock, magasinier stock+salarié…) → écran de choix.
export default async function EntreePage() {
  const user = await verifySession();

  const espaceActif = await espaceEmployeActif();
  // Un compte EMPLOYE, comme avant ; et, espace salarié ouvert, tout compte RELIÉ à une fiche
  // employé (ex. un compte Stock à identifiant matricule) : « Nouvelle fiche » (Paramètres) peut lui
  // donner un mot de passe temporaire, que sa fiche dit « à changer à la première connexion ».
  // Espace fermé, la page de changement le renverrait ici : on ne l'y envoie pas (pas de boucle).
  if (user.role === "EMPLOYE" || (espaceActif && estSalarie(user))) {
    const compte = await prisma.user.findUnique({ where: { id: user.id }, select: { motDePasseTemporaire: true } });
    if (compte?.motDePasseTemporaire) redirect("/espace/mot-de-passe");
  }

  const espaces = espacesDe(user, espaceActif);
  if (espaces.length === 0) redirect("/login"); // aucun accès (ne devrait pas arriver)
  if (espaces.length === 1) redirect(accueilEspace(espaces[0]));
  redirect("/choix-espace");
}
