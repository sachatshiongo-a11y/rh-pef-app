import { redirect } from "next/navigation";
import { exigerPageStock } from "@/lib/garde-page";

// « Utilisateurs » n'est plus une entrée du menu Stock : c'était le même écran que la rubrique
// « Utilisateurs & accès » de Paramètres (plan d'ergonomie, V3). Les anciens favoris et liens
// arrivent donc sur cette rubrique. La garde Stock reste en première instruction (un compte hors
// Stock est renvoyé avant tout) ; la page /parametres est elle-même réservée à la Direction.
export default async function UtilisateursStockRedirect() {
  await exigerPageStock();
  redirect("/parametres#utilisateurs");
}
