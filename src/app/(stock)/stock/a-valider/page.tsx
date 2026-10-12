import { exigerPageStock } from "@/lib/garde-page";
import { PageAValider } from "@/app/(app)/a-valider/page-a-valider";

// « À valider » dans la coquille de l'espace Stock : la MÊME page que dans les espaces RH et Exploitation, tous espaces
// confondus (`(app)/a-valider/page-a-valider.tsx`). Adresse historique : des notifications déjà envoyées y mènent.
// Elle garde le menu, la barre du bas et la flèche de retour du Stock.
export default async function AValiderStockPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const user = await exigerPageStock();
  const { erreur } = await searchParams;
  return PageAValider({ user, erreur, courant: "stock" });
}
