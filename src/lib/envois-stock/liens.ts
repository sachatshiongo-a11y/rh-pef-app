// LIENS DES COURRIELS AUTOMATIQUES DU STOCK (2026-10-12) — module PUR : les adresses que les lignes d'un courriel
// ouvrent, et la façon de les rendre absolues. Chaque rubrique du courriel mène à l'écran qui montre le même chiffre.
//
// Le courriel du matin et le rapport du 1er du mois sont lus HORS de l'application (boîte mail, téléphone) : un lien
// relatif n'y mène nulle part. Le domaine vient de `NEXT_PUBLIC_SITE_URL`, à défaut le domaine de production — la
// même règle que les rappels RH (`app/api/cron/alertes`). Garde-fou : `notifications-liens.garde-fou.test.ts` vérifie
// que CHAQUE adresse ci-dessous vise une page qui existe et qui n'est pas un simple renvoi.

import { lienFicheArticle } from "@/lib/fiche-article";

/** Le domaine public de l'application (sans barre finale). */
export function baseSite(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://gestion.patesenfolie.cd").replace(/\/+$/, "");
}

/** Une adresse de l'application, rendue absolue pour un courriel. */
export const lienAbsolu = (chemin: string): string => `${baseSite()}${chemin}`;

export type DomaineStock = "NOURRITURE" | "BOISSON" | "AUTRE";

export const LIENS = {
  accueil: () => "/stock",
  // Articles
  catalogue: () => "/stock/catalogue",
  article: (id: string) => `/stock/catalogue/${id}`,
  articlePrix: (id: string) => lienFicheArticle(id, "prix"),
  articleFournisseurs: (id: string) => lienFicheArticle(id, "fournisseurs"),
  alertesCatalogue: (niveau: "URGENT" | "APPRO", domaine?: DomaineStock) => `/stock/catalogue?alerte=${niveau}${domaine ? `&domaine=${domaine}` : ""}`,
  stocksNegatifs: () => "/stock/catalogue?manque=negatif",
  hausses: () => "/stock/catalogue?hausse=1",
  // Factures
  facture: (id: string) => `/stock/factures/${id}`,
  facturesADevoir: () => "/stock/factures?statut=du",
  facturesEchues: () => "/stock/factures?statut=ECHUE_NON_REGLEE",
  // Bons de commande
  bon: (id: string) => `/stock/commandes/${id}`,
  bonsValides: () => "/stock/commandes?statut=VALIDE",
  // À valider, fournisseurs
  aValider: () => "/stock/a-valider",
  fournisseur: (id: string) => `/stock/fournisseurs/${id}`,
  fournisseurs: () => "/stock/fournisseurs",
  // Mouvements du mois (clé « AAAA-M » du filtre de l'écran Mouvements), éventuellement un motif
  mouvementsDuMois: (annee: number, mois: number, motif?: "perte" | "livraison") => `/stock/mouvements?mois=${annee}-${mois}${motif ? `&motif=${motif}` : ""}`,
  listeAchat: () => "/stock/entree",
  legumes: () => "/stock/legumes",
  factures: () => "/stock/factures",
  // Écarts ventes / consommation : l'écran se lit une SEMAINE à la fois (`semaine` = un lundi AAAA-MM-JJ)
  ecartsVentes: (lundiISO?: string) => `/stock/journalier?vue=ecarts${lundiISO ? `&semaine=${lundiISO}` : ""}`,
} as const;

/** Un exemple de chaque adresse (pour le garde-fou des liens) : les paramètres sont fictifs, le chemin est réel. */
export function exemplesDeLiens(): string[] {
  return [
    LIENS.accueil(), LIENS.catalogue(), LIENS.article("x"), LIENS.articlePrix("x"), LIENS.articleFournisseurs("x"), LIENS.alertesCatalogue("URGENT", "BOISSON"), LIENS.alertesCatalogue("APPRO"), LIENS.stocksNegatifs(), LIENS.hausses(),
    LIENS.facture("x"), LIENS.facturesADevoir(), LIENS.facturesEchues(), LIENS.bon("x"), LIENS.bonsValides(), LIENS.aValider(), LIENS.fournisseur("x"), LIENS.fournisseurs(),
    LIENS.mouvementsDuMois(2026, 9), LIENS.mouvementsDuMois(2026, 9, "perte"), LIENS.mouvementsDuMois(2026, 9, "livraison"),
    LIENS.listeAchat(), LIENS.legumes(), LIENS.factures(), LIENS.ecartsVentes(), LIENS.ecartsVentes("2026-09-28"),
  ];
}
