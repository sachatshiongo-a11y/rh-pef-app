import { redirect } from "next/navigation";
import { exigerPageRH } from "@/lib/garde-page";

/** L'onglet Heures supp. a été fusionné dans « Présences & heures ». On y redirige les anciens
 * liens. Les actions (saisirHeures…) et l'export Excel de ce dossier restent utilisés. */
export default async function HeuresSuppPage() {
  await exigerPageRH();
  redirect("/presences");
}
