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

/** Résultat de la lecture d'une saisie : `valeur` null = case vidée (effacement). */
export type LectureNombre = { ok: true; valeur: number | null } | { ok: false };

// Chiffres, une seule marque décimale (virgule OU point), signe facultatif. Pas d'exposant
// (« 1e3 »), pas d'hexadécimal (« 0x10 »), pas d'« Infinity » : `Number()` les accepterait tous.
const MOTIF_NOMBRE = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

/**
 * Lecture STRICTE d'un nombre tapé dans une case (tableurs) : à la française — « 2,5 » comme
 * « 2.5 » — et tolérante aux espaces, y compris insécables (« 1 250,5 », copié depuis Excel ou
 * depuis un montant formaté par `formaterNombre`). Contrairement à `dec`/`decOptionnel`, une
 * saisie illisible n'est PAS confondue avec zéro ou avec une case vide : elle est signalée
 * (`ok: false`), pour ne jamais enregistrer autre chose que ce qui a été tapé.
 */
export function lireSaisieNombre(saisie: string): LectureNombre {
  const s = String(saisie ?? "").replace(/[\s   ]/g, "");
  if (s === "") return { ok: true, valeur: null };
  if (!MOTIF_NOMBRE.test(s)) return { ok: false };
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? { ok: true, valeur: n } : { ok: false };
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
