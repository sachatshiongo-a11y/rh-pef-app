import type { NiveauAlerte } from "@/lib/stock";
import { libelleArticle, rechercheContenance } from "@/lib/libelle-article";

// FILTRE DE L'INVENTAIRE (recherche, alerte, « À compléter », hausse de prix) — UNE seule définition pour
// l'écran (tableau client) ET pour ses exports Excel / PDF / page imprimable (2026-10-08) : un export doit sortir
// exactement l'ensemble filtré affiché — tout, jamais la page — et non « tout le domaine » parce qu'il ne
// connaissait pas le filtre. Le domaine (pilules d'en-tête) se règle à part : `?domaine=`.

export type ManqueKey = "" | "prix" | "fournisseur" | "seuil" | "unite" | "negatif";
export const MANQUES: readonly ManqueKey[] = ["prix", "fournisseur", "seuil", "unite", "negatif"];
export const ALERTES_FILTRE: readonly NiveauAlerte[] = ["URGENT", "APPRO", "OK"];

export type FiltreInventaire = { q: string; alerte: "" | NiveauAlerte; manque: ManqueKey; hausse: boolean };
export const FILTRE_INVENTAIRE_VIDE: FiltreInventaire = { q: "", alerte: "", manque: "", hausse: false };

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lit le filtre dans des paramètres d'URL (`q`, `alerte`, `manque`, `hausse=1`) ; toute valeur inconnue est ignorée. */
export function lireFiltreInventaire(get: (cle: string) => string | null | undefined): FiltreInventaire {
  const alerte = get("alerte");
  const manque = get("manque");
  return {
    q: (get("q") ?? "").trim(),
    alerte: ALERTES_FILTRE.includes(alerte as NiveauAlerte) ? (alerte as NiveauAlerte) : "",
    manque: MANQUES.includes(manque as ManqueKey) ? (manque as ManqueKey) : "",
    hausse: get("hausse") === "1",
  };
}

/** Les paramètres d'URL du filtre (seulement ceux qui filtrent) — pour l'adresse de l'écran et les liens d'export. */
export function paramsFiltreInventaire(f: FiltreInventaire): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.alerte) p.set("alerte", f.alerte);
  if (f.manque) p.set("manque", f.manque);
  if (f.hausse) p.set("hausse", "1");
  return p;
}

/** Ce qu'il faut savoir d'un article pour le filtrer (l'écran et les exports le construisent de la même façon). */
export type ArticleFiltrable = {
  designation: string;
  /** Contenance enregistrée : la recherche lit aussi le libellé affiché (« Bacardi 1 l ») et ses écritures compactes. */
  contenance?: string | null;
  contenanceUnite?: string | null;
  code: string | null;
  niveau: NiveauAlerte | null;
  haussePct?: number | null;
  devisePrix?: "USD" | "CDF";
  prix: string | null;
  prixCDF?: string | null;
  fournisseurId: string | null;
  stockMinimum: string;
  unite: string | null;
  quantite: string;
};

/** Détecte un champ manquant (« À compléter »). */
export const manqueDe = (a: ArticleFiltrable, m: ManqueKey): boolean =>
  m === "prix" ? (a.devisePrix === "CDF" ? !a.prixCDF || Number(a.prixCDF) === 0 : !a.prix || Number(a.prix) === 0) :
  m === "fournisseur" ? !a.fournisseurId :
  m === "seuil" ? !a.stockMinimum || Number(a.stockMinimum) <= 0 :
  m === "unite" ? !a.unite || !a.unite.trim() :
  m === "negatif" ? Number(a.quantite) < 0 : false;

/** L'article fait-il partie de l'ensemble filtré ? (hors domaine, qui se règle par `?domaine=`.) PURE. */
export function articleDansFiltre(a: ArticleFiltrable, f: FiltreInventaire): boolean {
  const nq = norm(f.q.trim());
  return (
    (!f.alerte || a.niveau === f.alerte) &&
    (!f.manque || manqueDe(a, f.manque)) &&
    (!f.hausse || (a.haussePct !== null && a.haussePct !== undefined)) &&
    (!nq || norm(a.designation).includes(nq) || (a.code ?? "").toLowerCase().includes(nq) || correspondContenance(a, nq))
  );
}

/**
 * La recherche par CONTENANCE (2026-10-09) : « bacardi 1l » trouve « Bacardi » enregistré 1 l. Le texte
 * tapé se compare au libellé affiché (`libelleArticle`) ; s'il nomme une contenance, CHAQUE mot doit se
 * retrouver dans le libellé ou dans une écriture compacte de la contenance (« 1l », « 100cl », « 1000ml »).
 */
function correspondContenance(a: ArticleFiltrable, nq: string): boolean {
  const formes = rechercheContenance(a);
  if (formes.length === 0) return false;
  const libelle = norm(libelleArticle(a));
  if (libelle.includes(nq)) return true;
  const foin = [libelle, ...formes].join(" | ");
  // « 1.5l » tapé avec un point : les écritures compactes sont à la virgule (« 1,5l »).
  const mots = nq.replace(/(\d)\.(\d)/g, "$1,$2").split(/\s+/).filter(Boolean);
  // Un mot qui EST une contenance (« 50cl ») se compare entier : « 50cl » n'est pas « 150cl ».
  const jetons = new Set([...formes, ...libelle.split(/[^\p{L}\p{N},]+/u)]);
  return mots.every((m) => (/^\d+(?:,\d+)?(?:ml|cl|l|g|kg)$/.test(m) ? jetons.has(m) : foin.includes(m)));
}
