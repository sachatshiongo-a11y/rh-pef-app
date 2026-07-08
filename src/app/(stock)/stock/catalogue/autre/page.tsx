import { CatalogueView, type CatalogueSP } from "../_view";

export default function CatalogueAutrePage({ searchParams }: { searchParams: Promise<CatalogueSP> }) {
  return <CatalogueView domaine="AUTRE" searchParams={searchParams} />;
}
