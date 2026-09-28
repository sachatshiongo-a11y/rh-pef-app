// JUMEAUX DE MOUVEMENTS DE STOCK — module pur (ni base, ni `server-only`).
//
// Deux mouvements sont « jumeaux » quand ils sont STRICTEMENT identiques sur les quatre critères
// qui font un mouvement : même article, même date (date pure, AAAA-MM-JJ), même type, même
// quantité (au millième, la précision de la colonne `Decimal(14, 3)`). Rien d'autre n'est
// comparé (ni l'origine, ni l'auteur) : c'est ce qui distingue une copie du même événement.
//
// Un jumeau n'est JAMAIS deviné : pas de tolérance, pas de rapprochement « presque ». Quand
// plusieurs mouvements portent la même clé, ils sont appariés UN À UN dans l'ordre reçu — deux
// livraisons identiques le même jour sont deux mouvements, pas un doublon.
//
// Né le 2026-09-28 : l'import d'inventaire avait recréé 602 mouvements déjà importés le matin
// même par l'import de mouvements (historique doublé, stock juste).

export type MouvementComparable = {
  articleId: string;
  /** Date pure : chaîne AAAA-MM-JJ, ou Date `@db.Date` (minuit UTC). */
  date: string | Date;
  type: string;
  /** Nombre, ou Decimal Prisma / chaîne (« 5.000 »). */
  quantite: number | string | { toString(): string };
};

/** Date pure AAAA-MM-JJ (une `@db.Date` est à minuit UTC : on lit en UTC). */
export function datePure(d: string | Date): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/** Quantité en millièmes entiers : « 5.000 », « 5 » et 5 se confondent ; 0,1 + 0,2 = 0,3. */
export function quantiteMilliemes(q: MouvementComparable["quantite"]): number {
  return Math.round(Number(typeof q === "number" ? q : q.toString()) * 1000);
}

export function cleJumeau(m: MouvementComparable): string {
  return `${m.articleId}|${datePure(m.date)}|${m.type}|${quantiteMilliemes(m.quantite)}`;
}

/**
 * Apparie un à un les `candidats` aux `references` de même clé, dans l'ordre des deux listes.
 * Une référence ne sert qu'une fois, un candidat aussi.
 */
export function apparierUnAUn<R extends MouvementComparable, C extends MouvementComparable>(
  references: R[],
  candidats: C[]
): { paires: { reference: R; candidat: C }[]; candidatsSeuls: C[]; referencesSeules: R[] } {
  const libres = new Map<string, R[]>();
  for (const r of references) {
    const k = cleJumeau(r);
    const l = libres.get(k);
    if (l) l.push(r);
    else libres.set(k, [r]);
  }
  const paires: { reference: R; candidat: C }[] = [];
  const candidatsSeuls: C[] = [];
  for (const c of candidats) {
    const l = libres.get(cleJumeau(c));
    const r = l?.shift();
    if (r) paires.push({ reference: r, candidat: c });
    else candidatsSeuls.push(c);
  }
  const referencesSeules = [...libres.values()].flat();
  // Ordre d'origine des références restantes (la Map regroupe par clé).
  const rang = new Map(references.map((r, i) => [r, i]));
  referencesSeules.sort((a, b) => rang.get(a)! - rang.get(b)!);
  return { paires, candidatsSeuls, referencesSeules };
}

export type EcartControle = { articleId: string; type: string; attendu: number; obtenu: number };

/**
 * Contrôle INDÉPENDANT de l'appariement : après retrait de `idsRetires` (pris parmi les
 * candidats), la somme des quantités par article et par type doit valoir ce qu'aurait donné UN
 * SEUL import — pour chaque clé, max(nb références, nb candidats) mouvements, pas la somme des
 * deux. Tout écart signale une copie oubliée (compte double) ou un mouvement sans jumeau retiré
 * (disparition). Quantités en millièmes entiers : aucune erreur d'arrondi.
 */
export function controleApresRetrait(
  references: (MouvementComparable & { id: string })[],
  candidats: (MouvementComparable & { id: string })[],
  idsRetires: Set<string>
): { verifies: number; ecarts: EcartControle[] } {
  const compte = (l: MouvementComparable[]) => {
    const n = new Map<string, number>();
    for (const m of l) n.set(cleJumeau(m), (n.get(cleJumeau(m)) ?? 0) + 1);
    return n;
  };
  const nRef = compte(references);
  const nCand = compte(candidats);
  const attendu = new Map<string, number>();
  const obtenu = new Map<string, number>();
  const ajoute = (t: Map<string, number>, articleId: string, type: string, v: number) => {
    const k = `${articleId}|${type}`;
    t.set(k, (t.get(k) ?? 0) + v);
  };
  const exemple = new Map<string, MouvementComparable>();
  for (const m of [...references, ...candidats]) exemple.set(cleJumeau(m), m);
  for (const [k, m] of exemple) {
    const n = Math.max(nRef.get(k) ?? 0, nCand.get(k) ?? 0);
    ajoute(attendu, m.articleId, m.type, n * quantiteMilliemes(m.quantite));
  }
  for (const m of references) ajoute(obtenu, m.articleId, m.type, quantiteMilliemes(m.quantite));
  for (const m of candidats) if (!idsRetires.has(m.id)) ajoute(obtenu, m.articleId, m.type, quantiteMilliemes(m.quantite));

  const ecarts: EcartControle[] = [];
  const cles = new Set([...attendu.keys(), ...obtenu.keys()]);
  for (const k of cles) {
    const a = attendu.get(k) ?? 0;
    const o = obtenu.get(k) ?? 0;
    if (a !== o) {
      const [articleId, type] = k.split("|");
      ecarts.push({ articleId, type, attendu: a / 1000, obtenu: o / 1000 });
    }
  }
  return { verifies: cles.size, ecarts };
}
