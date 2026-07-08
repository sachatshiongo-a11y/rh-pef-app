import { CatalogueView, type CatalogueSP } from "../_view";

export default function CatalogueNourriturePage({ searchParams }: { searchParams: Promise<CatalogueSP> }) {
  return <CatalogueView domaine="NOURRITURE" searchParams={searchParams} />;
}
