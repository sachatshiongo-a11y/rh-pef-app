import { redirect } from "next/navigation";

// Onglet Paramètres UNIQUE (demande user 2026-07-20) : il n'y a plus qu'une page Paramètres, côté
// RH (/parametres), qui inclut désormais la clôture mensuelle du stock. Cette route redirige donc
// vers elle. (Réservée à la Direction : la page /parametres est elle-même gardée ADMIN.)
export default function StockParametresRedirect() {
  redirect("/parametres");
}
