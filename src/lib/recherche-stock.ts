import { normTexte } from "@/lib/texte";

// RECHERCHE DE L'ESPACE STOCK — règles PURES (page /stock/recherche, tests). Audit du 10/10/2026, stock 20.
//
// La recherche est insensible aux accents ET à la casse (« creme » trouve « Crème », « etablissement »
// « Établissement ») : une base ne compare pas les accents, on filtre donc EN MÉMOIRE sur des champs
// minimaux. Un résultat TRONQUÉ le dit : « 12 premiers sur 37 », jamais une liste qui se fait passer
// pour complète.

export const LIMITE_RECHERCHE = 12;

/** Découpe la requête en mots (sans accents, minuscules) : tous doivent se retrouver dans le texte visé. */
export const motsRecherche = (q: string): string[] => normTexte(q).split(/\s+/).filter(Boolean);

/** Le texte contient-il TOUS les mots de la requête (accents et casse ignorés) ? */
export function contientTout(texte: string, mots: string[]): boolean {
  const t = normTexte(texte);
  return mots.length > 0 && mots.every((m) => t.includes(m));
}

/** Les éléments dont l'un des champs contient tous les mots : les `limite` premiers (ordre conservé) et le total. */
export function filtrerRecherche<T>(items: T[], q: string, champs: (t: T) => (string | null | undefined)[], limite = LIMITE_RECHERCHE): { premiers: T[]; total: number } {
  const mots = motsRecherche(q);
  const trouves = items.filter((t) => champs(t).some((c) => c && contientTout(c, mots)));
  return { premiers: trouves.slice(0, limite), total: trouves.length };
}

/** « (12) » ou « (12 premiers sur 37) » : le titre d'une section de résultats. */
export const compteRecherche = (affiches: number, total: number): string => (total > affiches ? `${affiches} premiers sur ${total}` : String(total));
