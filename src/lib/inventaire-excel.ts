// TABLEAU D'INVENTAIRE DE L'EXCEL DE CLÔTURE — sans accès à la base (données reçues en paramètres) : les colonnes SUIVENT L'ÉCRAN Inventaire (demande de la
// Direction, 13/10/2026), dans le même ordre :
//
//   Code · Désignation · Stock · Unité · Alerte · Min · Catégorie · Fournisseur · Valeur · Prix · Par carton
//
// Juste avant le stock viennent, par article, les mouvements du mois : entrées, sorties et ajustements de comptage.
// Les ajustements n'ont pas de sens enregistré (la même quantité absolue que dans la liste des mouvements) : ce
// ne sont ni des entrées ni des sorties. Pas de stock « de début de mois » (retiré le 13/10/2026 : confus).
// Une valeur inconnue est « — » (jamais 0) ; les nombres restent de vrais nombres.
//
// Tableau TRIABLE (décision de la Direction, 13/10/2026 : « je préfère un tableau triable ») : AUCUNE ligne-titre de
// catégorie (un tri les mélangerait) ; la colonne « Catégorie » reste, et les lignes sont rangées comme à l'écran —
// catégorie (ordre du catalogue, « À classer » en dernier), puis code. L'autofiltre est posé par `classeurInventaire`,
// borné à l'en-tête et aux lignes d'articles.
import { alerteLabel, ligneSansPrix, type LigneInventaire } from "@/lib/cloture-inventaire";
import { libelleArticle } from "@/lib/libelle-article";
import { FORMAT_MONTANT_EXCEL } from "@/lib/export-excel";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const TIRET = "—";

/** Mouvements d'UN article dans le mois (quantités du journal ; l'ajustement est une quantité absolue, sans sens). */
export type MouvementsDuMois = { entrees: number; sorties: number; ajustements: number };

export type ParametresTableau = {
  /** Lignes du domaine (déjà triées par code). */
  lignes: LigneInventaire[];
  /** Mouvements du mois de l'article ; rien d'enregistré = zéros (un mois sans mouvement est un vrai 0). */
  mouvements: (articleId: string) => MouvementsDuMois | undefined;
  /** Mois clôturé : le stock est l'instantané figé (libellé « Stock fin de mois »), sinon « Stock actuel ». */
  fige: boolean;
  /** Rang des catégories (ordre du catalogue) ; une catégorie inconnue passe après, par ordre alphabétique. */
  ordreCategories: Map<string, number>;
  uniteParCarton: (l: LigneInventaire) => number | null;
};

export type TableauInventaire = {
  entete: string[];
  lignes: (string | number)[][];
  colonnes: Record<"stock" | "valeur" | "alerte", number>;
  /** Format Excel par colonne (cellules numériques seulement). */
  formats: Record<number, string>;
  /** Colonnes alignées à droite (les « — » texte s'alignent alors sur les nombres). */
  droite: number[];
};

export function tableauInventaire(p: ParametresTableau): TableauInventaire {
  const rang = (c: string) => p.ordreCategories.get(c) ?? Number.MAX_SAFE_INTEGER;
  const triees = [...p.lignes].sort((a, b) => rang(a.categorie) - rang(b.categorie) || (a.categorie || "￿").localeCompare(b.categorie || "￿", "fr")); // tri stable : l'ordre par code est gardé dans une catégorie

  const entete = ["Code", "Désignation", "Entrées du mois", "Sorties du mois", "Ajustements du mois (sens non enregistré)"];
  const iStock = entete.length;
  entete.push(p.fige ? "Stock fin de mois" : "Stock actuel", "Unité", "Alerte", "Min", "Catégorie", "Fournisseur");
  const iValeur = entete.length;
  entete.push("Valeur USD", "Prix U. USD", "Prix saisi en FC", "Taux FC/$ utilisé", "Par carton", "Remarque prix");

  const lignes: (string | number)[][] = [];
  for (const l of triees) {
    const m = p.mouvements(l.articleId) ?? { entrees: 0, sorties: 0, ajustements: 0 };
    const sansPrix = ligneSansPrix(l);
    const carton = p.uniteParCarton(l);
    lignes.push([
      l.code, libelleArticle(l),
      r3(m.entrees), r3(m.sorties), r3(m.ajustements),
      r3(l.quantite), l.unite, alerteLabel(l.quantite, l.stockMinimum, l.seuilUrgent),
      l.stockMinimum > 0 ? r3(l.stockMinimum) : TIRET, // 0 = « sans seuil » : « — » comme à l'écran
      l.categorie || "À classer", l.fournisseur,
      // Sans prix : cellules vides (jamais 0) — le total est partiel de ces articles.
      sansPrix ? "" : r2(l.quantite * l.prixUnitaireUSD),
      sansPrix ? "" : r2(l.prixUnitaireUSD),
      l.prixUnitaireCDF !== undefined ? l.prixUnitaireCDF : "",
      l.prixUnitaireCDF !== undefined && l.tauxChange ? l.tauxChange : "",
      carton !== null && carton > 0 ? carton : TIRET,
      l.prixUnitaireCDF !== undefined && !l.tauxChange ? "prix en FC, taux non défini : non valorisé" : sansPrix ? "sans prix" : "",
    ]);
  }

  const formats: Record<number, string> = { [iValeur]: FORMAT_MONTANT_EXCEL, [iValeur + 1]: FORMAT_MONTANT_EXCEL };
  const droite = [2, 3, 4, iStock, iStock + 3, iValeur, iValeur + 1, iValeur + 2, iValeur + 3, iValeur + 4];
  return { entete, lignes, colonnes: { stock: iStock, valeur: iValeur, alerte: iStock + 2 }, formats, droite };
}
