import { exigerPageRH } from "@/lib/garde-page";
import { PageAValider } from "./page-a-valider";

// « À valider » dans la coquille de l'espace RH : la page unique, tous espaces confondus (`page-a-valider.tsx`).
// Adresse historique : des notifications déjà envoyées y mènent, et la RH y trouve toujours ses demandes.
export default async function AValiderPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const user = await exigerPageRH();
  // Refus renvoyé par une approbation (planning verrouillé par une paie validée ou payée).
  const { erreur } = await searchParams;
  return PageAValider({ user, erreur, courant: "rh" });
}
