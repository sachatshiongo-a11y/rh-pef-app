import { redirect } from "next/navigation";

/** Les catalogues par domaine ont fusionné en un seul onglet (pilules de domaine). */
export default function CatalogueRedirect() {
  redirect("/stock/catalogue?domaine=AUTRE");
}
