import { redirect } from "next/navigation";
import { exigerPageStock } from "@/lib/garde-page";

// Ancienne adresse de la clôture mensuelle du stock (seul contenu de cette page avant l'« onglet Paramètres
// unique » du 2026-07-20, puis rubrique de /parametres au lot 7). Depuis le plan d'ergonomie (V8) la clôture est
// une entrée du menu Stock : cette route y renvoie, pour les favoris et les liens écrits. Le menu Stock ouvre,
// lui, les Paramètres généraux directement (/parametres). Réservée à la Direction : /stock/cloture refuse les autres.
export default async function StockParametresRedirect() {
  await exigerPageStock();
  redirect("/stock/cloture");
}
