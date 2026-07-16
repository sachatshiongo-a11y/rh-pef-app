import { redirect } from "next/navigation";
import { verifySession, espacesAutorises, accueilEspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Résolveur d'entrée après connexion : oriente chaque compte vers SON espace.
// - un salarié (rôle EMPLOYE) → son espace self-service (mot de passe à changer si temporaire) ;
// - un seul accès  → on entre directement dans cet espace ;
// - deux accès (Direction) → écran de choix d'espace.
export default async function EntreePage() {
  const user = await verifySession();

  if (user.role === "EMPLOYE") {
    const compte = await prisma.user.findUnique({ where: { id: user.id }, select: { motDePasseTemporaire: true } });
    redirect(compte?.motDePasseTemporaire ? "/espace/mot-de-passe" : "/espace");
  }

  const espaces = espacesAutorises(user.role);
  if (espaces.length === 0) redirect("/login"); // aucun accès (ne devrait pas arriver)
  if (espaces.length === 1) redirect(accueilEspace(espaces[0]));
  redirect("/choix-espace");
}
