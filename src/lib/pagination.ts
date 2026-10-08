// PAGINATION DES TABLEAUX (décision de la Direction, 2026-10-08) : depuis que les tableaux ne sont plus
// enfermés dans des boîtes à défilement, un tableau de 300 lignes allonge la page. Règle commune :
// 50 lignes par page par défaut, au choix 50 / 100 / Tout ; la page et la taille vivent dans l'URL
// (`?page=`, `?par=`), à côté des filtres. Ce module est PUR (aucun accès à `window`, à la base ni à
// React) : il sert aux pages serveur (skip/take, liens), aux tableaux déjà chargés en entier (tranche)
// et au composant `components/pagination.tsx`.

/** Taille de page : 50 par défaut, 100, ou « tout » (toutes les lignes sur une seule page). */
export type ParPage = 50 | 100 | "tout";
export const PAR_DEFAUT: ParPage = 50;
export const TAILLES_PAGE: readonly ParPage[] = [50, 100, "tout"];
/** Plus petite taille proposée : en dessous, un tableau tient sur une page et la barre de pagination disparaît. */
export const PLUS_PETITE_PAGE = 50;

/** Paramètres d'URL de la pagination — à retirer d'un lien qui change de filtre (la page repart à 1). */
export const PARAM_PAGE = "page";
export const PARAM_PAR = "par";

const premier = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** `?par=` brut → taille de page (toute valeur inconnue = 50). */
export function lireParPage(v: unknown): ParPage {
  const s = premier(v);
  return s === "100" || s === 100 ? 100 : s === "tout" ? "tout" : PAR_DEFAUT;
}

/** `?page=` brut → numéro de page (entier ≥ 1 ; toute valeur illisible = 1). */
export function lireNumeroPage(v: unknown): number {
  const s = premier(v);
  const n = typeof s === "number" ? s : typeof s === "string" && /^\d{1,9}$/.test(s) ? Number(s) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Lit la pagination d'un `searchParams` Next. */
export function lirePagination(sp: { page?: unknown; par?: unknown } | null | undefined): { page: number; par: ParPage } {
  return { page: lireNumeroPage(sp?.page), par: lireParPage(sp?.par) };
}

export type FenetrePage = {
  /** Page effective (ramenée dans [1, nbPages] : une page 9 demandée sur 3 donne la 3). */
  page: number;
  nbPages: number;
  par: ParPage;
  total: number;
  /** Rang (à partir de 1) de la première et de la dernière ligne affichées ; 0 et 0 si rien. */
  de: number;
  a: number;
  /** Indices de tranche : lignes `[debut, fin[`. */
  debut: number;
  fin: number;
  /** Pour Prisma : `skip` et `take` (`take` absent pour « tout »). */
  skip: number;
  take: number | undefined;
};

/** La fenêtre affichée pour `total` lignes. PURE. */
export function fenetrePage(total: number, pageDemandee: number, par: ParPage): FenetrePage {
  const n = Math.max(0, Math.floor(total));
  const taille = par === "tout" ? Math.max(n, 1) : par;
  const nbPages = Math.max(1, Math.ceil(n / taille));
  const page = Math.min(Math.max(1, Math.floor(pageDemandee) || 1), nbPages);
  const debut = (page - 1) * taille;
  const fin = Math.min(n, debut + taille);
  return { page, nbPages, par, total: n, de: n === 0 ? 0 : debut + 1, a: fin, debut, fin, skip: debut, take: par === "tout" ? undefined : par };
}

/** « 51–100 sur 342 » (« 1 sur 1 » pour une seule ligne, « 0 » si rien). */
export function compteurPage(f: Pick<FenetrePage, "de" | "a" | "total">): string {
  if (f.total === 0) return "0";
  return f.de === f.a ? `${f.de} sur ${f.total}` : `${f.de}–${f.a} sur ${f.total}`;
}

/** La tranche de lignes de la page (pour les tableaux déjà chargés en entier). */
export function tranche<T>(lignes: readonly T[], f: Pick<FenetrePage, "debut" | "fin">): T[] {
  return lignes.slice(f.debut, f.fin);
}

/** Changer la taille garde la première ligne affichée à l'écran : la page qui la contient avec la nouvelle taille. */
export function pageApresChangementTaille(debut: number, par: ParPage): number {
  return par === "tout" ? 1 : Math.floor(Math.max(0, debut) / par) + 1;
}

/** Numéros affichés dans la barre : la première, la dernière, la page courante et ses voisines, « … » entre. */
export function numerosPages(page: number, nbPages: number): (number | "…")[] {
  const garde = new Set([1, nbPages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= nbPages));
  const tries = [...garde].sort((x, y) => x - y);
  const res: (number | "…")[] = [];
  tries.forEach((p, i) => {
    if (i > 0) {
      const prec = tries[i - 1];
      if (p - prec === 2) res.push(prec + 1); // un seul numéro manquant : on l'affiche plutôt qu'un « … »
      else if (p - prec > 2) res.push("…");
    }
    res.push(p);
  });
  return res;
}

/** Applique page/taille à des paramètres d'URL : les valeurs par défaut (page 1, 50 par page) s'effacent. */
export function appliquerPagination(params: URLSearchParams, page: number, par: ParPage): URLSearchParams {
  const p = new URLSearchParams(params);
  if (page > 1) p.set(PARAM_PAGE, String(page)); else p.delete(PARAM_PAGE);
  if (par !== PAR_DEFAUT) p.set(PARAM_PAR, String(par)); else p.delete(PARAM_PAR);
  return p;
}

/** Les paramètres d'un `searchParams` Next en `URLSearchParams`, SANS la page (un changement de filtre repart à la page 1) ; la taille est conservée. */
export function paramsSansPage(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === PARAM_PAGE || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  }
  return p;
}

/** Adresse d'une page : chemin + paramètres courants (filtres, recherche, tri…) + page et taille. */
export function hrefPagination(chemin: string, params: Record<string, string | string[] | undefined>, page: number, par: ParPage): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === PARAM_PAGE || k === PARAM_PAR || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  }
  const qs = appliquerPagination(p, page, par).toString();
  return qs ? `${chemin}?${qs}` : chemin;
}
