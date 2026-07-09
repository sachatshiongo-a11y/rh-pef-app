// Rapprochement d'une désignation lue sur une facture avec un article du catalogue, PAR MOTS-CLÉS.
// Ex. « Saumon frais 1KG » → « Filet de saumon norvégien » (jeton distinctif partagé : « saumon »).

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// Mots trop génériques / unités / conditionnements : ignorés pour la comparaison.
const STOP = new Set([
  "de", "des", "du", "la", "le", "les", "au", "aux", "en", "et", "a", "l", "d",
  "frais", "fraiche", "fraiches", "surgele", "surgelee", "congele", "congelee", "entier", "entiere",
  "sec", "seche", "nature", "bio", "premium", "extra", "qualite", "sans", "avec", "type", "special",
  "kg", "kgs", "g", "gr", "grs", "gramme", "grammes", "mg", "l", "lt", "ltr", "litre", "litres", "ml", "cl", "dl",
  "piece", "pieces", "pcs", "pc", "unite", "unites", "u", "x", "carton", "cartons", "ct", "boite", "boites",
  "paquet", "paquets", "sachet", "sachets", "sac", "bouteille", "bouteilles", "btl", "pack", "lot", "casier", "caisse",
]);

// Jetons significatifs : ≥ 3 lettres, hors mots génériques, et hors tokens commençant par un
// chiffre (quantités/unités collées : « 1kg », « 500g », « 12x1l »…).
const jetons = (s: string) =>
  strip(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w));

function lev(a: string, b: string): number {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[n];
}
// Deux jetons « proches » : identiques, ou l'un préfixe de l'autre (pluriel/déclinaison), ou ≤1 faute.
const proche = (a: string, b: string) =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a) || lev(a, b) <= 1));

export type CandidatArticle = { id: string; designation: string };

/**
 * Meilleur article du catalogue pour une désignation lue, ou null.
 * Score = part des mots-clés significatifs partagés (côté le plus court). Il faut au moins un
 * jeton distinctif commun (≥ 3 lettres). En cas d'égalité, on prend le libellé le plus ressemblant.
 */
export function meilleurArticle(designation: string, articles: CandidatArticle[], seuil = 0.5): (CandidatArticle & { score: number }) | null {
  const ta = jetons(designation);
  if (ta.length === 0) return null;
  const cleA = strip(designation).toLowerCase().replace(/[^a-z0-9]/g, "");
  let best: (CandidatArticle & { score: number; dist: number }) | null = null;
  for (const art of articles) {
    const tb = jetons(art.designation);
    if (tb.length === 0) continue;
    const communs = ta.filter((w) => tb.some((x) => proche(w, x))).length;
    if (communs === 0) continue;
    const score = communs / Math.min(ta.length, tb.length);
    if (score < seuil) continue;
    const dist = lev(cleA, strip(art.designation).toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (!best || score > best.score || (score === best.score && dist < best.dist)) {
      best = { ...art, score: Math.round(score * 100) / 100, dist };
    }
  }
  return best ? { id: best.id, designation: best.designation, score: best.score } : null;
}
