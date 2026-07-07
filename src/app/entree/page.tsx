import { redirect } from "next/navigation";
import { verifySession, espacesAutorises, accueilEspace } from "@/lib/auth";

// Résolveur d'entrée après connexion : oriente chaque compte vers SON espace.
// - un seul accès  → on entre directement dans cet espace ;
// - deux accès (Direction) → écran de choix d'espace.
export default async function EntreePage() {
  const user = await verifySession();
  const espaces = espacesAutorises(user.role);

  if (espaces.length === 0) redirect("/login"); // aucun accès (ne devrait pas arriver)
  if (espaces.length === 1) redirect(accueilEspace(espaces[0]));
  redirect("/choix-espace");
}
