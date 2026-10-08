// Liste d'achat — ANTI-DOUBLON renforcé et DLC facultative (demande de la Direction du 2026-10-08) :
// les règles PURES (ni base, ni DOM), partagées par l'écran (ordinateur et téléphone) et le serveur.
// La recherche des articles proches vit dans `article-proche.ts` (règle de l'application Atelier).
//
// Le cœur de la demande (précision de Sacha) : le DOUBLON D'ARTICLE au catalogue — une ligne libre
// qui créerait un article déjà là sous un autre nom (« Tomate » quand « Tomates » existe).
// Correspondance exacte normalisée UNIQUE : rattachement automatique ; articles PROCHES : choix
// explicite (« Utiliser … » ou « Créer quand même un nouvel article ») — jamais deviné.
//
// Le DOUBLON D'ACHAT (même achat saisi deux fois) reste un AVERTISSEMENT non bloquant : même article
// sur deux lignes de la liste (signalé sur les deux), et le contrôle à ±14 jours de toujours.
import { cleAlnum } from "@/lib/texte";
import { contenanceCanonique, contenanceDansNom, sansContenance } from "@/lib/fiches/conversion";
import { jjmmaaaa } from "@/lib/achats-liste";

/**
 * Clé EXACTE d'une désignation, tolérante aux seules différences d'écriture : accents, casse,
 * espaces et séparateurs (« - », « ' », « . »), et écriture de la contenance (1L = 1 LTR = 100cl =
 * 1000 ml ; 33cl = 330 ml). « COCA-COLA 33 CL » et « coca cola 330ml » ont la même clé ; « Coca »
 * et « Coca 33cl » non (une contenance d'un côté seulement). Ni pluriel, ni ordre des mots : ceux-là
 * ne font que des articles PROCHES, à choisir. Vide si le nom n'a ni lettre ni chiffre.
 */
export function cleArticleExacte(nom: string): string {
  const n = sansLigatures(nom);
  const mots = cleAlnum(sansContenance(n));
  if (!mots) return "";
  const c = contenanceCanonique(contenanceDansNom(n));
  return c ? `${mots}|${c}` : mots;
}

/** « Œufs » → « Oeufs » : `cleAlnum` perdrait la ligature (« ufs »). */
export const sansLigatures = (s: string) => String(s ?? "").replace(/œ/g, "oe").replace(/Œ/g, "Oe").replace(/æ/g, "ae").replace(/Æ/g, "Ae");

/**
 * Deux désignations EXACTEMENT équivalentes : même clé normalisée ; à défaut, même clé stricte d'avant
 * (`cleAlnum` : « Coca33cl » = « coca 33cl », contenance collée illisible d'un côté) — SAUF si les deux
 * contenances sont lues et diffèrent : « Eau 1,5L » n'est pas « Eau 15L » (la clé stricte, qui jette la
 * virgule, les confondait).
 */
export function memeDesignation(a: string, b: string): boolean {
  const ca = cleArticleExacte(a);
  if (ca && ca === cleArticleExacte(b)) return true;
  const contA = contenanceCanonique(contenanceDansNom(sansLigatures(a)));
  const contB = contenanceCanonique(contenanceDansNom(sansLigatures(b)));
  if (contA && contB && contA !== contB) return false;
  const sa = cleAlnum(sansLigatures(a));
  return !!sa && sa === cleAlnum(sansLigatures(b));
}

// ── Types échangés entre le serveur et l'écran ────────────────────────────────────────────────────

/** Un article du catalogue proposé à la place d'une ligne libre (assez pour en faire une ligne du catalogue). */
/** `prix` : prix de référence dans sa devise `devisePrix` (absente = USD). */
export type ArticleCandidat = { id: string; designation: string; unite: string | null; domaine: string; prix: string | null; devisePrix?: "USD" | "CDF"; actif: boolean };

/**
 * Sort d'une ligne au catalogue :
 *  - `catalogue` : la ligne vise déjà un article choisi dans la liste ;
 *  - `auto` : ligne libre, UNE correspondance exacte normalisée → rattachée à cet article ;
 *  - `choix` : articles proches (ou plusieurs exacts) → la personne choisit ; `creationPossible` :
 *    « Créer quand même » est permis (faux quand plusieurs articles portent EXACTEMENT ce nom : un
 *    troisième serait un doublon certain) ;
 *  - `nouveau` : rien d'approchant, l'article sera créé.
 */
export type DecisionArticle =
  | { type: "catalogue" }
  | { type: "auto"; article: ArticleCandidat }
  | { type: "choix"; candidats: ArticleCandidat[]; creationPossible: boolean }
  | { type: "nouveau" };

/** Analyse d'UNE ligne de la liste, à la saisie comme à l'enregistrement : son sort au catalogue. */
export type AnalyseLigne = { article: DecisionArticle };

// ── Doublons DANS la liste ────────────────────────────────────────────────────────────────────────

/**
 * Lignes de la MÊME liste qui visent le même article : même article du catalogue (ou ligne libre
 * rattachée à lui), ou même désignation libre (clé exacte normalisée). Rend, pour chaque ligne
 * concernée (indice), les indices des AUTRES lignes. Les lignes `ignoree` (rien d'enregistrable)
 * ne comptent pas. Avertissement seulement : deux sacs de farine à deux prix restent possibles.
 */
export function doublonsDansListe(lignes: readonly { articleId: string; designation: string; ignoree?: boolean }[], resolu: (i: number) => string | null = () => null): Map<number, number[]> {
  const parCle = new Map<string, number[]>();
  lignes.forEach((l, i) => {
    if (l.ignoree) return;
    const id = l.articleId || resolu(i);
    const cle = id ? `id:${id}` : cleArticleExacte(l.designation) ? `libre:${cleArticleExacte(l.designation)}` : "";
    if (!cle) return;
    parCle.set(cle, [...(parCle.get(cle) ?? []), i]);
  });
  const res = new Map<number, number[]>();
  for (const groupe of parCle.values()) {
    if (groupe.length < 2) continue;
    for (const i of groupe) res.set(i, groupe.filter((j) => j !== i));
  }
  return res;
}

// ── DLC (date limite de consommation), facultative ────────────────────────────────────────────────

const RE_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const jourValide = (s: string) => RE_JOUR.test(s) && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s;

/** Ce que la DLC saisie a de faux (vide = rien) : illisible, ou antérieure à la date de l'achat. */
export function erreurDlc(dlc: string, dateAchatISO: string): string | null {
  const s = (dlc ?? "").trim();
  if (!s) return null;
  if (!jourValide(s)) return "DLC illisible : choisissez une date ou laissez le champ vide.";
  if (jourValide(dateAchatISO) && s < dateAchatISO) return `La DLC (${jjmmaaaa(s)}) est antérieure à la date de l'achat (${jjmmaaaa(dateAchatISO)}).`;
  // Borne de vraisemblance : une année mal tapée (« 2062 ») ne passe pas.
  if (jourValide(dateAchatISO) && Number(s.slice(0, 4)) > Number(dateAchatISO.slice(0, 4)) + 10) return `La DLC (${jjmmaaaa(s)}) est à plus de 10 ans de l'achat : vérifiez l'année.`;
  return null;
}

/**
 * Lit la DLC d'une ligne (serveur) : vide → null (facultative) ; illisible ou antérieure à la date de
 * l'achat → refus lisible qui nomme la ligne. Une date PURE (`AAAA-MM-JJ`), sans fuseau.
 */
export function lireDlc(saisie: string, dateAchatISO: string, ligne: { rang: number; designation: string }): string | null {
  const s = (saisie ?? "").trim();
  if (!s) return null;
  const e = erreurDlc(s, dateAchatISO);
  if (e) throw new Error(`Ligne ${ligne.rang}${ligne.designation ? ` (« ${ligne.designation} »)` : ""} : ${e} Corrigez-la ou videz-la ; rien n'a été enregistré.`);
  return s;
}

/** Jours entre aujourd'hui et la DLC (dates pures) : négatif = dépassée, 0 = aujourd'hui. */
export function joursAvantDlc(dlcISO: string, aujourdhuiISO: string): number {
  return Math.round((Date.parse(`${dlcISO}T00:00:00.000Z`) - Date.parse(`${aujourdhuiISO}T00:00:00.000Z`)) / 86_400_000);
}

/** Pastille d'une DLC, la même partout (tableau de bord, fiche article) : rouge dépassée, orange sous 2 jours. */
export function classePastilleDlc(jours: number): string {
  return jours < 0 ? "bg-red-100 text-red-800" : jours <= 2 ? "bg-amber-100 text-amber-900" : "bg-muted text-foreground";
}

/** « dépassée de 3 j », « aujourd'hui », « demain », « dans 5 j ». */
export function libelleJoursDlc(jours: number): string {
  if (jours < 0) return `dépassée de ${-jours} j`;
  if (jours === 0) return "aujourd'hui";
  if (jours === 1) return "demain";
  return `dans ${jours} j`;
}
