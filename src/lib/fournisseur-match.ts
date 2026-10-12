// Rapprochement flou de noms de fournisseurs : « Kathy » ↔ « Maison Kathy »,
// « ETS.SENEVE » ↔ « ETS SENEVE », « STE IMEXCO » ↔ « IMEXCO »…
// Utilisé à la lecture d'un PDF de facture pour rattacher au bon fournisseur.

import { sansAccents as strip } from "./texte";
// Formes juridiques / mots génériques ignorés dans la comparaison par jetons.
const STOP = new Set(["ets", "ste", "sarl", "sa", "sprl", "srl", "cie", "co", "company", "societe", "sc", "sas", "group", "groupe", "etablissement", "etablissements", "the", "de", "des", "du", "la", "le", "les"]);
// Mots trop génériques pour, à eux seuls, indiquer la même enseigne (exclus du « jeton distinctif partagé »).
const GENERIQUE = new Set(["services", "service", "business", "center", "centre", "trading", "import", "imports", "export", "exports", "commerce", "commercial", "general", "generale", "international", "distribution", "holding", "enterprise", "entreprise", "shop", "store", "market", "alimentation", "agro", "food", "foods", "sarl"]);

const jetons = (s: string) => strip(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const cle = (s: string) => jetons(s).join("");

/** Distance d'édition (Levenshtein) entre deux chaînes — aussi utilisée par le rapprochement des fiches employés (employe-doublon). */
export function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const proche = (a: string, b: string) => a === b || (Math.max(a.length, b.length) >= 4 && lev(a, b) <= 1);

/** Similarité 0..1 entre deux raisons sociales. */
export function similariteNom(a: string, b: string): number {
  const ka = cle(a), kb = cle(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const ta = jetons(a).filter((w) => !STOP.has(w));
  const tb = jetons(b).filter((w) => !STOP.has(w));
  if (ta.length && tb.length) {
    const [court, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    // Tous les jetons significatifs du plus court présents (ou quasi) dans le plus long ⇒ forte proximité.
    if (court.every((w) => long.some((x) => proche(w, x)))) return 0.9;
    const inter = court.filter((w) => long.some((x) => proche(w, x))).length;
    const jac = inter / new Set([...ta, ...tb]).size;
    let score = jac > 0 ? Math.min(0.85, 0.55 + jac * 0.4) : 0;
    // Jeton distinctif partagé (≥ 4 lettres, ex. « KATHY ») : signal fort de même enseigne
    // → « Maman Kathy » ↔ « Maison Kathy ».
    if (court.some((w) => w.length >= 4 && !GENERIQUE.has(w) && long.some((x) => proche(w, x)))) score = Math.max(score, 0.8);
    if (score > 0) return score;
  }
  return 1 - lev(ka, kb) / Math.max(ka.length, kb.length);
}

export type CandidatFournisseur = { id: string; nom: string };

/** Meilleur fournisseur au-dessus du seuil, sinon null. */
export function meilleurFournisseur(nom: string, liste: CandidatFournisseur[], seuil = 0.7): (CandidatFournisseur & { score: number }) | null {
  let best: (CandidatFournisseur & { score: number }) | null = null;
  for (const f of liste) {
    const score = similariteNom(nom, f.nom);
    if (score >= seuil && (!best || score > best.score)) best = { ...f, score };
  }
  return best;
}

// ── Rattachement : l'IDENTIQUE s'applique, le PROCHE se propose (audit du 10/10/2026, constat 7) ──────
//
// Un fournisseur « proche » rattaché d'office (seuils 0,82 à la saisie, 0,7 à la lecture d'un PDF) faisait
// glisser une facture chez le mauvais fournisseur — « Maison Kathy » pris pour « Maman Kathy » — avec une
// pastille verte rassurante. Règle de fond : un appariement incertain se SIGNALE, il ne s'applique pas.
//  - `fournisseurIdentique` : le SEUL rattachement d'office — même nom à la casse, aux accents, aux espaces
//    et à la ponctuation près (`cle`) ; s'il y en a PLUSIEURS, ce n'est plus un rattachement sûr (à choisir).
//  - `fournisseursProches` : les ressemblants, à PROPOSER à l'écran (« Utiliser … » / « Créer »).

/** Les fournisseurs de même nom (casse, accents, espaces, ponctuation près). */
export function fournisseursIdentiques<T extends CandidatFournisseur>(nom: string, liste: readonly T[]): T[] {
  const k = cle(nom);
  return k ? liste.filter((f) => cle(f.nom) === k) : [];
}

/** Le fournisseur de même nom — seulement s'il est UNIQUE (sinon null : l'écran fait choisir). */
export function fournisseurIdentique<T extends CandidatFournisseur>(nom: string, liste: readonly T[]): T | null {
  const ids = fournisseursIdentiques(nom, liste);
  return ids.length === 1 ? ids[0] : null;
}

/** Les fournisseurs qui RESSEMBLENT au nom (au plus `max`, du plus ressemblant au moins), identiques compris s'ils sont plusieurs. */
export function fournisseursProches<T extends CandidatFournisseur>(nom: string, liste: readonly T[], { seuil = 0.7, max = 5 }: { seuil?: number; max?: number } = {}): (T & { score: number })[] {
  if (!cle(nom)) return [];
  const identiques = fournisseursIdentiques(nom, liste);
  // Un seul identique : c'est LE fournisseur, rien à proposer. Plusieurs : on les propose tous.
  if (identiques.length === 1) return [];
  return liste
    .map((f) => ({ ...f, score: similariteNom(nom, f.nom) }))
    .filter((f) => f.score >= seuil)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}
