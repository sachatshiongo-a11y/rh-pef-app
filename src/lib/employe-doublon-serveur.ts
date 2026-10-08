import "server-only";
import { prisma } from "@/lib/prisma";
import { JOURNAL_DOUBLON_ECARTE, pairesEcartees } from "@/lib/employe-doublon";

/**
 * Toutes les fiches employés (actives ET inactives) avec ce qu'il faut pour les rapprocher et les
 * montrer (avatar, poste, statut, date d'entrée). Lu par l'écran (contrôle en direct) et par le
 * serveur (contrôle à l'enregistrement) : même liste, même règle.
 */
export async function chargerFichesIdentite() {
  return prisma.employee.findMany({
    select: { id: true, nom: true, matricule: true, telephone: true, dateNaissance: true, actif: true, poste: true, dateEmbauche: true, photoUrl: true },
    orderBy: { nom: "asc" },
  });
}
export type FicheIdentiteLue = Awaited<ReturnType<typeof chargerFichesIdentite>>[number];

/** Paires déclarées « deux personnes différentes » (journal d'audit), en clés `clePaire`. */
export async function chargerPairesEcartees(): Promise<Set<string>> {
  const entrees = await prisma.journalAudit.findMany({
    where: { entite: "Employee", champ: JOURNAL_DOUBLON_ECARTE },
    select: { entiteId: true, nouvelleValeur: true },
  });
  return pairesEcartees(entrees);
}
