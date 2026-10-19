import { sha256Hex } from "./sha256";
import {
  PDFArray, PDFBool, PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFStream, PDFString,
  type PDFContext, type PDFDocument, type PDFObject,
} from "pdf-lib";

/**
 * DÉDUPLICATION DES OBJETS LOURDS APRÈS FUSION (13/10/2026).
 *
 * LE DÉFAUT. Le rendu par blocs (`blocs.tsx`) produit un petit PDF par fenêtre ou par lot, puis les réunit : chacun
 * embarquait SA copie du logo et de son masque de transparence (SMask), si bien que 60 bulletins pesaient 2,86 Mo au lieu
 * de 0,6 Mo (le logo seul : 1,67 Mo en 60 exemplaires identiques).
 *
 * LE REMÈDE. Après la fusion, tout flux qui est une IMAGE (logo, masque, signature) ou un programme de POLICE (et sa table
 * ToUnicode) est haché avec son dictionnaire ; les doublons EXACTS sont repointés vers un représentant unique, puis supprimés.
 *
 * POURQUOI C'EST SANS RISQUE.
 *  - Le hachage porte sur le contenu brut du flux ET sur son dictionnaire (filtre, dimensions, espace colorimétrique, profondeur,
 *    décodage…), dont les références (SMask, Mask, profil ICC) sont remplacées par l'empreinte de l'objet visé, récursivement :
 *    deux images ne sont fusionnées que si tout ce qui les décrit est octet pour octet identique. Deux logos différents, ou le
 *    même logo avec deux masques différents, restent deux objets.
 *  - On ne fusionne jamais deux objets « presque » identiques. En particulier, deux sous-ensembles de police qui ne portent pas
 *    exactement les mêmes glyphes ne sont PAS fusionnés (et ne pourraient pas l'être : les codes des glyphes sont renumérotés
 *    d'un sous-ensemble à l'autre, les flux de contenu qui les utilisent en dépendent). Seuls les sous-ensembles strictement
 *    identiques le sont (même programme de police, même ToUnicode) : les dictionnaires de police eux-mêmes (largeurs, descripteur)
 *    sont laissés à leur place, seul le flux lourd est partagé.
 *  - Un flux référencé plusieurs fois est un cas normal en PDF (un XObject partagé par plusieurs pages).
 *
 * Après repointage, les doublons deviennent orphelins et sont retirés du contexte (`context.delete`) : ils ne sont pas écrits.
 */

export type BilanDedup = { flux: number; supprimes: number; octetsEconomises: number };

const N = (nom: string) => PDFName.of(nom);

/** Clés dont la valeur est un flux candidat, hors images (les images se reconnaissent à /Subtype /Image). */
const CLES_FLUX_POLICE = ["FontFile", "FontFile2", "FontFile3", "ToUnicode"].map(N);

/** Chaque morceau suivi d'un octet nul, comme avant (node:crypto) : sha256Hex tourne aussi dans le navigateur. */
const sha = (...morceaux: (string | Uint8Array)[]) => sha256Hex(...morceaux.flatMap((m) => [m, "\u0000"]));

/**
 * Empreinte canonique d'un objet PDF : les références sont suivies et remplacées par l'empreinte de leur cible, les clés de
 * dictionnaire sont triées. `null` si l'objet ne peut pas être décrit avec certitude (cycle, profondeur excessive, type
 * inconnu) : il n'est alors jamais fusionné.
 */
function empreinte(ctx: PDFContext, objet: PDFObject | undefined, memo: Map<string, string | null>, pile: Set<string>, profondeur = 0): string | null {
  if (objet === undefined) return "undef";
  if (profondeur > 12) return null;
  if (objet instanceof PDFRef) {
    const tag = objet.tag;
    if (memo.has(tag)) return memo.get(tag)!;
    if (pile.has(tag)) return null; // cycle
    pile.add(tag);
    const cible = ctx.lookup(objet);
    const e = cible === undefined ? `ref-orpheline:${tag}` : empreinte(ctx, cible, memo, pile, profondeur + 1);
    pile.delete(tag);
    memo.set(tag, e);
    return e;
  }
  if (objet instanceof PDFStream) {
    const d = empreinte(ctx, objet.dict, memo, pile, profondeur + 1);
    if (d === null) return null;
    return `S(${sha(d, objet.getContents())})`;
  }
  if (objet instanceof PDFDict) {
    const entrees: string[] = [];
    for (const [cle, valeur] of objet.entries()) {
      if (cle.asString() === "/Length") continue; // dérivé du contenu, qui est haché
      const e = empreinte(ctx, valeur, memo, pile, profondeur + 1);
      if (e === null) return null;
      entrees.push(`${cle.asString()}=${e}`);
    }
    return `<<${entrees.sort().join(",")}>>`;
  }
  if (objet instanceof PDFArray) {
    const elements: string[] = [];
    for (let i = 0; i < objet.size(); i++) {
      const e = empreinte(ctx, objet.get(i), memo, pile, profondeur + 1);
      if (e === null) return null;
      elements.push(e);
    }
    return `[${elements.join(",")}]`;
  }
  if (objet instanceof PDFName || objet instanceof PDFNumber || objet instanceof PDFBool || objet === PDFNull
    || objet instanceof PDFString || objet instanceof PDFHexString) return objet.toString();
  return null;
}

/** Flux candidats : images, programmes de police et tables ToUnicode. */
function candidats(ctx: PDFContext): PDFRef[] {
  const refs = new Map<string, PDFRef>();
  for (const [ref, objet] of ctx.enumerateIndirectObjects()) {
    if (objet instanceof PDFStream && objet.dict.get(N("Subtype")) instanceof PDFName && (objet.dict.get(N("Subtype")) as PDFName).asString() === "/Image") refs.set(ref.tag, ref);
    const dict = objet instanceof PDFStream ? objet.dict : objet instanceof PDFDict ? objet : undefined;
    if (!dict) continue;
    for (const cle of CLES_FLUX_POLICE) {
      const v = dict.get(cle);
      if (v instanceof PDFRef) refs.set(v.tag, v);
    }
  }
  return [...refs.values()];
}

/** Repointe, dans `valeur` (dictionnaire ou tableau, récursivement), toute référence à un doublon vers son représentant. */
function repointer(valeur: PDFObject | undefined, vers: Map<string, PDFRef>): number {
  let n = 0;
  if (valeur instanceof PDFStream) return repointer(valeur.dict, vers);
  if (valeur instanceof PDFDict) {
    for (const [cle, v] of valeur.entries()) {
      if (v instanceof PDFRef) { const r = vers.get(v.tag); if (r) { valeur.set(cle, r); n++; } }
      else n += repointer(v, vers);
    }
  } else if (valeur instanceof PDFArray) {
    for (let i = 0; i < valeur.size(); i++) {
      const v = valeur.get(i);
      if (v instanceof PDFRef) { const r = vers.get(v.tag); if (r) { valeur.set(i, r); n++; } }
      else n += repointer(v, vers);
    }
  }
  return n;
}

/**
 * Fusionne, dans `doc`, les images et programmes de police strictement identiques. À appeler une fois le document assemblé,
 * avant `save`. Renvoie ce qui a été fait (pour les tests et les mesures).
 */
export function dedupliquerObjets(doc: PDFDocument): BilanDedup {
  const ctx = doc.context;
  const memo = new Map<string, string | null>();
  const representant = new Map<string, PDFRef>(); // empreinte → premier exemplaire
  const doublons = new Map<string, PDFRef>(); // tag du doublon → représentant
  const aSupprimer: PDFRef[] = [];
  let octetsEconomises = 0;
  const liste = candidats(ctx);
  for (const ref of liste) {
    const e = empreinte(ctx, ref, memo, new Set());
    if (e === null) continue;
    const premier = representant.get(e);
    if (!premier) { representant.set(e, ref); continue; }
    if (premier.tag === ref.tag) continue;
    doublons.set(ref.tag, premier);
    aSupprimer.push(ref);
    const flux = ctx.lookup(ref);
    if (flux instanceof PDFStream) octetsEconomises += flux.getContents().length;
  }
  if (doublons.size === 0) return { flux: liste.length, supprimes: 0, octetsEconomises: 0 };
  for (const [, objet] of ctx.enumerateIndirectObjects()) repointer(objet, doublons);
  // Les doublons sont désormais orphelins (plus rien ne les désigne : leurs propres références, SMask comprises, ne comptent pas).
  for (const ref of aSupprimer) ctx.delete(ref);
  return { flux: liste.length, supprimes: doublons.size, octetsEconomises };
}
