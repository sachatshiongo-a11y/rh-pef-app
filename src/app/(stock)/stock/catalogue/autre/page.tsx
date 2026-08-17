import { redirect } from "next/navigation";

/** Les catalogues par domaine ont fusionné en un seul onglet (pilules de domaine).
 * La redirection transporte les paramètres (recherche, filtre d'alerte…). */
export default async function CatalogueRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const p = new URLSearchParams({ domaine: "AUTRE" });
  for (const [k, v] of Object.entries(sp)) if (v && k !== "domaine") p.set(k, v);
  redirect(`/stock/catalogue?${p}`);
}
