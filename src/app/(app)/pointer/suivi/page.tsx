import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { exigerPageRH } from "@/lib/garde-page";

// Ancienne adresse du suivi, gardée pour les favoris : le suivi est maintenant l'écran « Pointages » (/pointer).
// Page de simple renvoi — aucun lien de l'application n'y mène plus.
export default async function SuiviPointagesRenvoi({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await exigerPageRH();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const sp = await searchParams;
  redirect(/^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? `/pointer?date=${sp.date}` : "/pointer");
}
