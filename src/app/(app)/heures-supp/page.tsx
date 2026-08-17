import { redirect } from "next/navigation";

/** L'onglet Heures supp. a été fusionné dans « Présences & heures ». On y redirige les anciens
 * liens. Les actions (saisirHeures…) et l'export Excel de ce dossier restent utilisés. */
export default function HeuresSuppPage() {
  redirect("/presences");
}
