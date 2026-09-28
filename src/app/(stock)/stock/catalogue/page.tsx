import { CatalogueView, type CatalogueSP } from "./_view";
import { exigerPageStock } from "@/lib/garde-page";

export default async function CataloguePage({ searchParams }: { searchParams: Promise<CatalogueSP> }) {
  await exigerPageStock();
  return <CatalogueView searchParams={searchParams} />;
}
