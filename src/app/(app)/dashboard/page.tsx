import { redirect } from "next/navigation";
import { exigerPageRH } from "@/lib/garde-page";

// Le tableau de bord a été fusionné avec l'Accueil.
export default async function DashboardPage() {
  await exigerPageRH();
  redirect("/accueil");
}
