import { CatalogueView, type CatalogueSP } from "./_view";

export default function CataloguePage({ searchParams }: { searchParams: Promise<CatalogueSP> }) {
  return <CatalogueView searchParams={searchParams} />;
}
