// TABLEAU D'INVENTAIRE DE L'EXCEL DE CLÔTURE — sans accès à la base (données reçues en paramètres) : les colonnes SUIVENT L'ÉCRAN Inventaire (demande de la
// Direction, 13/10/2026), dans le même ordre :
//
//   Code · Désignation · [Stock début de mois] · Stock · Unité · Alerte · Min · Catégorie · Fournisseur · Valeur · Prix · Par carton
//
// Entre le stock de début et le stock de fin viennent, par article, les mouvements du mois — entrées, sorties,
// ajustements de comptage, et (clôture seulement) ce qui est daté APRÈS le mois mais déjà compté dans l'instantané — de
// sorte que « début + entrées − sorties ± ajustements + après = fin » se lit sur chaque ligne. Une valeur inconnue est
// « — » (jamais 0) ; les nombres restent de vrais nombres (virgule décimale à l'affichage par le format Excel).
//
// Tableau TRIABLE (décision de la Direction, 13/10/2026 : « je préfère un tableau triable ») : AUCUNE ligne-titre de
// catégorie (un tri les mélangerait) ; la colonne « Catégorie » reste, et les lignes sont rangées comme à l'écran —
// catégorie (ordre du catalogue, « À classer » en dernier), puis code. L'autofiltre est posé par `classeurInventaire`,
// borné à l'en-tête et aux lignes d'articles.
import { alerteLabel, ligneSansPrix, type LigneInventaire } from "@/lib/cloture-inventaire";
import { libelleArticle } from "@/lib/libelle-article";
import { quantiteInitiale, type StockInitialArticle } from "@/lib/stock-initial-mois";
import { mentionSansPrix } from "@/lib/valeur-stock";
import { FORMAT_MONTANT_EXCEL } from "@/lib/export-excel";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const TIRET = "—";

/** Quantité signée : sens lisible, négatif en rouge ; la cellule reste un nombre. */
export const FORMAT_QUANTITE_SIGNEE = "General;[Red]-General";

export type ParametresTableau = {
  /** Lignes du domaine (déjà triées par code). */
  lignes: LigneInventaire[];
  /** Décomposition du mois d'un article ; null pour tout l'article quand le calcul est indisponible. */
  resultat: (articleId: string) => StockInitialArticle | null;
  /** Mois clôturé : le stock de fin est l'instantané figé (libellé « Stock fin de mois »), sinon « Stock actuel ». */
  fige: boolean;
  /** Une partie du stock de fin est composée de mouvements datés après le mois (colonne « Après le mois »). */
  avecApres: boolean;
  /** Libellé du mois précédent (« septembre 2026 ») quand il est clôturé : colonne d'écart avec cette clôture. */
  cloturePrecedente: string | null;
  /** Rang des catégories (ordre du catalogue) ; une catégorie inconnue passe après, par ordre alphabétique. */
  ordreCategories: Map<string, number>;
  uniteParCarton: (l: LigneInventaire) => number | null;
};

export type TableauInventaire = {
  entete: string[];
  lignes: (string | number)[][];
  colonnes: Record<"debut" | "stock" | "valeur" | "alerte", number>;
  /** Format Excel par colonne (cellules numériques seulement). */
  formats: Record<number, string>;
  /** Colonnes alignées à droite (les « — » texte s'alignent alors sur les nombres). */
  droite: number[];
};

export function tableauInventaire(p: ParametresTableau): TableauInventaire {
  const rang = (c: string) => p.ordreCategories.get(c) ?? Number.MAX_SAFE_INTEGER;
  const triees = [...p.lignes].sort((a, b) => rang(a.categorie) - rang(b.categorie) || (a.categorie || "￿").localeCompare(b.categorie || "￿", "fr")); // tri stable : l'ordre par code est gardé dans une catégorie

  const entete = ["Code", "Désignation", "Stock début de mois", "Entrées du mois", "Sorties du mois", "Ajustements du mois (comptage)"];
  if (p.avecApres) entete.push("Après le mois (déjà dans le stock figé)");
  const iStock = entete.length;
  entete.push(p.fige ? "Stock fin de mois" : "Stock actuel", "Unité", "Alerte", "Min", "Catégorie", "Fournisseur");
  const iValeur = entete.length;
  entete.push("Valeur USD", "Prix U. USD", "Prix saisi en FC", "Taux FC/$ utilisé", "Par carton", "Remarque prix");
  const iEcart = p.cloturePrecedente ? entete.length : -1;
  if (p.cloturePrecedente) entete.push(`Écart avec la clôture de ${p.cloturePrecedente}`);

  const lignes: (string | number)[][] = [];
  for (const l of triees) {
    const r = p.resultat(l.articleId);
    const debut = r ? quantiteInitiale(r.initial) : null;
    const sansPrix = ligneSansPrix(l);
    const carton = p.uniteParCarton(l);
    const ligne: (string | number)[] = [
      l.code, libelleArticle(l),
      debut ?? TIRET,
      r ? r3(r.entrees) : TIRET,
      r ? r3(r.sorties) : TIRET,
      r && r.ajustements !== null ? r3(r.ajustements) : TIRET,
    ];
    if (p.avecApres) ligne.push(r && r.apres !== null ? r3(r.apres) : TIRET);
    ligne.push(
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
    );
    if (iEcart >= 0) {
      // Comparable : le chiffre signé (0 = la clôture retombe juste) ; sinon « — ».
      ligne.push(r !== null && r.referenceCloture !== null ? (r.ecartCloture ? r3(r.ecartCloture.ecart) : 0) : TIRET);
    }
    lignes.push(ligne);
  }

  const formats: Record<number, string> = { 5: FORMAT_QUANTITE_SIGNEE, [iValeur]: FORMAT_MONTANT_EXCEL, [iValeur + 1]: FORMAT_MONTANT_EXCEL };
  if (p.avecApres) formats[6] = FORMAT_QUANTITE_SIGNEE;
  if (iEcart >= 0) formats[iEcart] = FORMAT_QUANTITE_SIGNEE;
  const droite = [2, 3, 4, 5, ...(p.avecApres ? [6] : []), iStock, iStock + 3, iValeur, iValeur + 1, iValeur + 2, iValeur + 3, iValeur + 4, ...(iEcart >= 0 ? [iEcart] : [])];
  return { entete, lignes, colonnes: { debut: 2, stock: iStock, valeur: iValeur, alerte: iStock + 2 }, formats, droite };
}

// ── Indicateurs du début de mois ───────────────────────────────────────────────────────

export type ValeurDebutMois = {
  montantUSD: number;
  /** Articles qui avaient du stock au 1er mais pas de prix : leur valeur est inconnue, pas 0. */
  nbSansPrix: number;
  /** Articles dont le stock au 1er n'est pas calculable. */
  nbInconnus: number;
  /** Articles créés après le 1er : pas de stock au 1er (valeur nulle, sans rien d'inconnu). */
  nbAbsents: number;
  nbEcartsCloture: number;
  /** Aucun article n'a pu être valorisé alors que des valeurs manquent : le total serait un 0 trompeur. */
  indeterminee: boolean;
};

/**
 * Valeur du stock au 1er du mois, AU PRIX DE RÉFÉRENCE de l'instantané ou du jour (le prix d'alors n'est pas
 * conservé) : somme des seuls articles dont le stock initial ET le prix sont connus ; le reste est compté à part.
 */
export function valeurDebutMois(lignes: readonly LigneInventaire[], resultat: (articleId: string) => StockInitialArticle | null): ValeurDebutMois {
  let montantUSD = 0, nbSansPrix = 0, nbInconnus = 0, nbAbsents = 0, nbEcartsCloture = 0, nbValorises = 0;
  for (const l of lignes) {
    const r = resultat(l.articleId);
    if (!r || r.initial.etat === "inconnu") { nbInconnus++; continue; }
    if (r.ecartCloture) nbEcartsCloture++;
    if (r.initial.etat === "absent") { nbAbsents++; continue; }
    const q = r.initial.quantite;
    if (q === 0) continue;
    if (!(l.prixUnitaireUSD > 0)) { nbSansPrix++; continue; }
    montantUSD += q * l.prixUnitaireUSD;
    nbValorises++;
  }
  return { montantUSD: r2(montantUSD), nbSansPrix, nbInconnus, nbAbsents, nbEcartsCloture, indeterminee: nbValorises === 0 && nbSansPrix + nbInconnus > 0 };
}

/** Texte du KPI : « 1 234,50 $ (partiel : 3 sans prix, 2 stock initial non calculable) » ou « — (…) » ; jamais un 0 pour un inconnu. */
export function texteValeurDebutMois(v: ValeurDebutMois, usd: (n: number) => string): string {
  const manques = [mentionSansPrix(v.nbSansPrix).replace(/^partiel : /, ""), v.nbInconnus > 0 ? `${v.nbInconnus} stock initial non calculable` : ""].filter(Boolean);
  const detail = manques.length ? ` (partiel : ${manques.join(", ")})` : "";
  return v.indeterminee ? `${TIRET}${detail.replace("partiel", "non calculable")}` : `${usd(v.montantUSD)}${detail}`;
}
