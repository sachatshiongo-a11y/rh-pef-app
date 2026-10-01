// Lecture des nombres saisis dans les formulaires (virgule française acceptée).
// Avant : la même fonction `dec` était copiée dans 7 fichiers d'actions, en deux variantes.

/**
 * Nombre d'un champ de formulaire — 0 si vide. Depuis le 2026-10-01, lu À LA FRANÇAISE (virgule =
 * SEULE décimale, point et espace = milliers, cf. `lireSaisieNombre`) et une saisie illisible lève
 * une erreur lisible au lieu de devenir 0. ⚠️ Une valeur écrite par le PROGRAMME dans un champ
 * passe par `ecrireSaisieNombre` / `versSaisie` (« 2.5 » serait refusé, « 2.125 » lu 2125).
 */
export const dec = (v: FormDataEntryValue | null | undefined): number => decSaisi(v);

/** Variante « champ facultatif » : null si vide ; illisible → erreur (cf. `dec`). */
export const decOptionnel = (v: FormDataEntryValue | null | undefined): number | null => decSaisiOptionnel(v);

/**
 * Résultat de la lecture d'une saisie : `valeur` null = case vidée (effacement). `ambigu` : la
 * saisie (« 1,250 ») a été lue comme un DÉCIMAL alors qu'elle pouvait vouloir dire 1 250.
 */
export type LectureNombre =
  | { ok: true; valeur: number | null; ambigu?: true }
  | { ok: false; raison: "illisible" | "ambigu" };

/**
 * « 1,250 » ou « 1.250 » : UN séparateur suivi d'exactement 3 chiffres, après 1 à 3 chiffres
 * (sans autre séparateur, et pas « 0,250 »). Depuis le 2026-10-01 la règle les lit sans hésiter —
 * « 1,250 » = 1,25 (virgule = décimale), « 1.250 » = 1 250 (point = milliers) — mais l'écrivain a
 * pu penser l'inverse :
 *  - "decimal" (défaut) : lu selon la règle, et signalé par `ambigu: true` ;
 *  - "refuser" : refusé — colonnes entières ou de quantité de stock, où une erreur d'un facteur
 *    1 000 ne se voit pas.
 */
export type OptionsLecture = { ambigu?: "decimal" | "refuser" };

// Règle de Sacha (2026-10-01, la même dans Bolimo et l'Atelier) : la VIRGULE est la SEULE
// décimale ; le POINT et l'ESPACE séparent les milliers. Partie entière : chiffres collés, OU
// groupés par 3 avec UN type de séparateur (« 1 250 », « 1.250 », « 12.500.000 » — pas « 1 5 »,
// « 1.5 » ni « 0.125 », illisibles : « écrivez 1,5 », cf. `conseilSaisie`). Puis une virgule.
// Pas d'exposant (« 1e3 »), d'hexadécimal (« 0x10 ») ni d'« Infinity » : `Number()` les accepterait.
const MOTIF_NOMBRE = /^([+-]?)([1-9]\d{0,2}([ .])\d{3}(?:\3\d{3})*|\d+)?(?:,(\d*))?$/;

/**
 * Lecture STRICTE d'un nombre tapé ou collé dans une case — LE lecteur partagé des tableurs et
 * des formulaires. À la française : « 2,5 » (la virgule seule est décimale), milliers par espaces
 * — y compris insécables (« 1 250,5 », copié depuis Excel ou depuis `formaterNombre`) — ou par
 * points (« 150.000 »). Contrairement à `dec` /
 * `decOptionnel`, une saisie illisible n'est PAS confondue avec zéro ou avec une case vide : elle
 * est signalée (`ok: false`), pour ne jamais enregistrer autre chose que ce qui a été tapé.
 */
export function lireSaisieNombre(saisie: string, options: OptionsLecture = {}): LectureNombre {
  const s = String(saisie ?? "").replace(/[\u00A0\u202F\u2007\t]/g, " ").trim();
  if (s === "") return { ok: true, valeur: null };
  const m = MOTIF_NOMBRE.exec(s);
  if (!m) return { ok: false, raison: "illisible" };
  const [, signe, entier = "", sepMilliers, decimales] = m;
  if (entier === "" && !decimales) return { ok: false, raison: "illisible" }; // « , » ou « - »
  const n = Number(`${signe}${entier.replace(/[ .]/g, "") || "0"}.${decimales || "0"}`);
  if (!Number.isFinite(n)) return { ok: false, raison: "illisible" };
  // « 1,250 » (virgule, 3 décimales, petite partie entière) ou « 1.250 » (un seul groupe de
  // milliers par un point, sans décimales) : l'écrivain a pu penser l'autre sens.
  const ambigu =
    (decimales !== undefined && decimales.length === 3 && /^[1-9]\d{0,2}$/.test(entier)) ||
    (sepMilliers === "." && /^[1-9]\d{0,2}\.\d{3}$/.test(entier) && decimales === undefined);
  if (!ambigu) return { ok: true, valeur: n };
  return options.ambigu === "refuser" ? { ok: false, raison: "ambigu" } : { ok: true, valeur: n, ambigu: true };
}

// Sans séparateur de milliers ni exposant (`String(1e-7)` donnerait « 1e-7 », illisible au retour),
// 9 décimales au plus : 0,1 + 0,2 ne doit pas s'écrire « 0,30000000000000004 ».
const FORMAT_SAISIE = new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 9 });

/** Écriture d'un nombre dans une case : virgule décimale, relisible telle quelle par `lireSaisieNombre`. */
export function ecrireSaisieNombre(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
  return FORMAT_SAISIE.format(n).replace(".", ",");
}

/**
 * Motif HTML (`pattern`) d'un champ de FORMULAIRE numérique positif sans flèches
 * (champ texte, `inputMode="decimal"`) : chiffres, points et espaces de milliers, puis une virgule
 * décimale. Le navigateur bloque l'envoi d'autre chose ; `dec` relit avec la même règle.
 */
export const MOTIF_HTML_DECIMAL_POSITIF = "[0-9 .\u00a0\u202f]*(,[0-9]*)?";

// ── Fonctions communes aux trois applications (Bolimo, Atelier, PEF — 2026-10-01) ────────────────

/** Nombre saisi, ou null si VIDE ou ILLISIBLE (cf. `lireSaisieNombre`). */
export function lireNombreSaisi(v: FormDataEntryValue | string | null | undefined): number | null {
  const l = lireSaisieNombre(String(v ?? ""));
  return l.ok ? l.valeur : null;
}

/** Écrit un nombre pour un champ de saisie (virgule décimale) — alias de `ecrireSaisieNombre`. */
export const versSaisie = (n: number): string => ecrireSaisieNombre(n);

/**
 * Conseil pour une saisie illisible qui a pris le POINT pour la décimale (« 1.5 » → « écrivez
 * 1,5 ») ; null si la saisie est lisible ou si remplacer le point ne la rendrait pas lisible.
 */
export function conseilSaisie(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s || lireSaisieNombre(s).ok || s.includes(",") || (s.match(/\./g) ?? []).length !== 1) return null;
  const propose = s.replace(".", ",");
  return lireSaisieNombre(propose).ok ? `écrivez ${propose}` : null;
}

const MESSAGE_ILLISIBLE = "virgule pour les décimales (1,5), point ou espace pour les milliers (150.000 ou 150 000)";

/**
 * Lecture SERVEUR d'un champ de nombre : 0 si vide, erreur lisible si illisible — jamais un zéro
 * silencieux. `libelle` nomme le champ dans le message.
 */
export function decSaisi(v: FormDataEntryValue | string | null | undefined, libelle?: string): number {
  return decSaisiOptionnel(v, libelle) ?? 0;
}

/** Variante « champ facultatif » de `decSaisi` : null si vide, erreur lisible si illisible. */
export function decSaisiOptionnel(v: FormDataEntryValue | string | null | undefined, libelle?: string): number | null {
  const brut = String(v ?? "").trim();
  if (brut === "") return null;
  const l = lireSaisieNombre(brut);
  if (l.ok) return l.valeur;
  const conseil = conseilSaisie(brut);
  throw new Error(`« ${brut} » illisible${libelle ? ` (${libelle})` : ""} : ${conseil ? `${conseil} — la virgule est la décimale` : MESSAGE_ILLISIBLE}.`);
}

/** Vrai si la saisie contient un séparateur AMBIGU (point, espace) — là où la lecture mérite
 *  d'être montrée. La virgule ne l'est jamais (toujours la décimale). */
export const aSeparateur = (s: string): boolean => /[.\s\u00a0\u202f]/.test(s.trim());
