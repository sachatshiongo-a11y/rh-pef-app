import { redirect } from "next/navigation";

// Le tableau de bord a été fusionné avec l'Accueil.
export default function DashboardPage() {
  redirect("/accueil");
}
