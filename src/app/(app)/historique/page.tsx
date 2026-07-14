import { redirect } from "next/navigation";

/** L'historique de paie a été fusionné dans « Paie » (onglet Historique). On y redirige les
 * anciens liens en transportant les filtres. Le détail /historique/[id] reste servi ici. */
export default async function HistoriquePage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string; mois?: string; statut?: string }>;
}) {
  const sp = await searchParams;
  const p = new URLSearchParams({ vue: "historique" });
  for (const k of ["annee", "mois", "statut"] as const) {
    if (sp[k]) p.set(k, sp[k]!);
  }
  redirect(`/paie?${p}`);
}
