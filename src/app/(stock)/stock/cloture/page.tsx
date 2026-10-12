import { notFound } from "next/navigation";
import { exigerPageStock } from "@/lib/garde-page";
import { ClotureStockSection } from "@/components/stock/cloture-stock-section";

// Clôture du mois du Stock (plan d'ergonomie, V8) : comme la paie se clôture dans Paie et l'exploitation dans
// Exploitation. Elle vivait dans Paramètres (lot 7) ; mêmes droits qu'avant : la Direction seule (la page
// Paramètres était réservée à l'ADMIN, et les actions revérifient ADMIN + module Stock).
export default async function ClotureStockPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const user = await exigerPageStock();
  if (user.role !== "ADMIN") notFound(); // Direction uniquement (comme Imports)
  const sp = await searchParams;
  return (
    <div className="w-full space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Clôture du mois</h1>
      {sp.erreur && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{sp.erreur}</div>}
      <ClotureStockSection />
    </div>
  );
}
