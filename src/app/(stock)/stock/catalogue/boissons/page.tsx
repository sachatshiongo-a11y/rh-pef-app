import { CatalogueView, type CatalogueSP } from "../_view";

export default function CatalogueBoissonsPage({ searchParams }: { searchParams: Promise<CatalogueSP> }) {
  return <CatalogueView domaine="BOISSON" searchParams={searchParams} />;
}
