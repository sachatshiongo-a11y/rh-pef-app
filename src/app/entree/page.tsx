import { redirect } from "next/navigation";
import { verifySession, espacesDe, accueilEspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";

// Résolveur d'entrée après connexion : oriente chaque compte vers SON espace.
// - un compte salarié (EMPLOYE) : mot de passe à changer si temporaire, d'abord ;
// - un seul accès  → on entre directement dans cet espace ;
// - plusieurs accès (Direction RH+Stock, salarié+stock, magasinier stock+salarié…) → écran de choix.
export default async function EntreePage() {
  const user = await verifySession();

  if (user.role === "EMPLOYE") {
    const compte = await prisma.user.findUnique({ where: { id: user.id }, select: { motDePasseTemporaire: true } });
    if (compte?.motDePasseTemporaire) redirect("/espace/mot-de-passe");
  }

  const espaces = espacesDe(user, await espaceEmployeActif());
  if (espaces.length === 0) redirect("/login"); // aucun accès (ne devrait pas arriver)
  if (espaces.length === 1) redirect(accueilEspace(espaces[0]));
  redirect("/choix-espace");
}
