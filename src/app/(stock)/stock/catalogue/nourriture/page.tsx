import { redirect } from "next/navigation";
import { exigerPageStock } from "@/lib/garde-page";

/** Les catalogues par domaine ont fusionné en un seul onglet (pilules de domaine).
 * La redirection transporte les paramètres (recherche, filtre d'alerte…). */
export default async function CatalogueRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigerPageStock();
  const sp = await searchParams;
  const p = new URLSearchParams({ domaine: "NOURRITURE" });
  for (const [k, v] of Object.entries(sp)) if (v && k !== "domaine") p.set(k, v);
  redirect(`/stock/catalogue?${p}`);
}
