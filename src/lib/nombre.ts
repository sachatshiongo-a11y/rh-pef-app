// Lecture des nombres saisis dans les formulaires (virgule française acceptée).
// Avant : la même fonction `dec` était copiée dans 7 fichiers d'actions, en deux variantes.

/** Nombre décimal d'un champ de formulaire — 0 si vide ou illisible. */
export const dec = (v: FormDataEntryValue | null | undefined): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

/** Variante « champ facultatif » : null si vide ou illisible. */
export const decOptionnel = (v: FormDataEntryValue | null | undefined): number | null => {
  const s = String(v ?? "").replace(",", ".").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Résultat de la lecture d'une saisie : `valeur` null = case vidée (effacement). `ambigu` : la
 * saisie (« 1,250 ») a été lue comme un DÉCIMAL alors qu'elle pouvait vouloir dire 1 250.
 */
export type LectureNombre =
  | { ok: true; valeur: number | null; ambigu?: true }
  | { ok: false; raison: "illisible" | "ambigu" };

/**
 * « 1,250 » ou « 1.250 » : UN séparateur suivi d'exactement 3 chiffres, après 1 à 3 chiffres
 * (sans espace de milliers, et pas « 0,250 ») — virgule décimale ou séparateur de milliers ?
 *  - "decimal" (défaut) : lu comme un décimal (1,25), et signalé par `ambigu: true` ;
 *  - "refuser" : refusé — colonnes entières ou de quantité de stock, où 1,25 et 1 250 sont
 *    tous deux plausibles et où une erreur d'un facteur 1 000 ne se voit pas.
 */
export type OptionsLecture = { ambigu?: "decimal" | "refuser" };

// Partie entière : chiffres collés, OU groupés par 3 avec des espaces (« 1 250 », « 12 500 000 » —
// pas « 1 5 » ni « 2 5 », qui sont des fautes de frappe). Puis une seule marque décimale.
// Pas d'exposant (« 1e3 »), d'hexadécimal (« 0x10 ») ni d'« Infinity » : `Number()` les accepterait.
const MOTIF_NOMBRE = /^([+-]?)(\d{1,3}(?: \d{3})+|\d+)?(?:([.,])(\d*))?$/;

/**
 * Lecture STRICTE d'un nombre tapé ou collé dans une case — LE lecteur partagé des tableurs.
 * À la française (« 2,5 » comme « 2.5 »), espaces de milliers tolérés, y compris insécables
 * (« 1 250,5 », copié depuis Excel ou depuis `formaterNombre`). Contrairement à `dec` /
 * `decOptionnel`, une saisie illisible n'est PAS confondue avec zéro ou avec une case vide : elle
 * est signalée (`ok: false`), pour ne jamais enregistrer autre chose que ce qui a été tapé.
 */
export function lireSaisieNombre(saisie: string, options: OptionsLecture = {}): LectureNombre {
  const s = String(saisie ?? "").replace(/[\u00A0\u202F\u2007\t]/g, " ").trim();
  if (s === "") return { ok: true, valeur: null };
  const m = MOTIF_NOMBRE.exec(s);
  if (!m) return { ok: false, raison: "illisible" };
  const [, signe, entier = "", sep, decimales = ""] = m;
  if (entier === "" && decimales === "") return { ok: false, raison: "illisible" }; // « , » ou « - »
  const n = Number(`${signe}${entier.replace(/ /g, "") || "0"}.${decimales || "0"}`);
  if (!Number.isFinite(n)) return { ok: false, raison: "illisible" };
  const ambigu = sep !== undefined && decimales.length === 3 && /^[1-9]\d{0,2}$/.test(entier);
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
 * (`type="text" inputMode="decimal"`) : chiffres et une virgule ou un point. Le navigateur
 * bloque l'envoi d'autre chose — ce que faisait `type="number"` — et `dec` lit la virgule.
 */
export const MOTIF_HTML_DECIMAL_POSITIF = "[0-9]*[.,]?[0-9]*";
