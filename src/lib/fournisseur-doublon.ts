import { cleAlnum } from "@/lib/texte";
import { similariteNom } from "@/lib/fournisseur-match";

// ANTI-DOUBLON DE FOURNISSEUR — même logique que les articles (lib/article-proche.ts), tous les chemins de
// création : écran Fournisseurs, Liste d'achat, facture, import de bons de commande (audit du 10/10/2026,
// stock 20). Module PUR : le serveur l'applique à la liste lue en base, à la saisie comme à l'enregistrement.
//
//  - nom IDENTIQUE (accents, casse, ponctuation, espaces près : `cleAlnum`) : c'est le même fournisseur —
//    jamais recréé (« refus » sur l'écran Fournisseurs, rattachement ailleurs, comme avant) ;
//  - nom PROCHE (« Kathy » / « Maison Kathy », « Imexco » / « STE IMEXCO ») : on MONTRE le fournisseur
//    existant et la personne choisit « Utiliser … » ou « Créer quand même » ; jamais deviné ni créé en silence.

/** Au-delà de cette ressemblance, un fournisseur existant est montré avant d'en créer un autre (seuil de `meilleurFournisseur`). */
export const SEUIL_FOURNISSEUR_PROCHE = 0.7;
export const MAX_FOURNISSEURS_PROCHES = 5;

export type FournisseurCandidat = { id: string; nom: string };

export type DecisionFournisseur =
  | { type: "nouveau" }
  | { type: "auto"; fournisseur: FournisseurCandidat }
  | { type: "choix"; candidats: FournisseurCandidat[]; creationPossible: boolean };

/**
 * Sort d'un nom de fournisseur tapé face aux fournisseurs existants :
 *  - UN fournisseur de même nom (clé alphanumérique) : « auto » (c'est lui) ;
 *  - PLUSIEURS de même nom (doublon déjà en base) : choix entre eux, sans « Créer quand même » ;
 *  - des fournisseurs PROCHES : choix, avec « Créer quand même » ;
 *  - rien : nouveau.
 */
export function decisionFournisseur(nom: string, existants: readonly FournisseurCandidat[]): DecisionFournisseur {
  const saisi = (nom ?? "").trim();
  const cle = cleAlnum(saisi);
  if (!cle) return { type: "nouveau" };
  const memes = existants.filter((f) => cleAlnum(f.nom) === cle);
  if (memes.length === 1) return { type: "auto", fournisseur: memes[0] };
  if (memes.length > 1) return { type: "choix", candidats: memes.slice(0, MAX_FOURNISSEURS_PROCHES), creationPossible: false };
  const proches = existants
    .map((f, ordre) => ({ f, ordre, score: similariteNom(saisi, f.nom) }))
    .filter((x) => x.score >= SEUIL_FOURNISSEUR_PROCHE)
    .sort((a, b) => b.score - a.score || a.ordre - b.ordre)
    .slice(0, MAX_FOURNISSEURS_PROCHES)
    .map((x) => x.f);
  return proches.length > 0 ? { type: "choix", candidats: proches, creationPossible: true } : { type: "nouveau" };
}

/** Réponse d'une création de fournisseur refusée pour doublon : RIEN n'est créé, l'écran montre les candidats. */
export type DoublonFournisseur = { doublonFournisseur: true; nom: string; candidats: FournisseurCandidat[]; creationPossible: boolean; message: string };

export function doublonFournisseur(nom: string, d: Exclude<DecisionFournisseur, { type: "nouveau" }>): DoublonFournisseur {
  const saisi = nom.trim();
  if (d.type === "auto") {
    return { doublonFournisseur: true, nom: saisi, candidats: [d.fournisseur], creationPossible: false, message: `« ${saisi} » existe déjà dans les fournisseurs sous ce nom (« ${d.fournisseur.nom} ») : utilisez-le. Rien n'a été créé.` };
  }
  return {
    doublonFournisseur: true, nom: saisi, candidats: d.candidats, creationPossible: d.creationPossible,
    message: d.creationPossible
      ? `« ${saisi} » ressemble à ${d.candidats.length > 1 ? "des fournisseurs déjà enregistrés" : "un fournisseur déjà enregistré"} (${d.candidats.map((c) => `« ${c.nom} »`).join(", ")}) : utilisez-${d.candidats.length > 1 ? "en un" : "le"}, ou créez quand même un nouveau fournisseur. Rien n'a été créé.`
      : `« ${saisi} » existe déjà plusieurs fois dans les fournisseurs (${d.candidats.map((c) => `« ${c.nom} »`).join(", ")}) : choisissez-en un. Rien n'a été créé.`,
  };
}

export const estDoublonFournisseur = (r: unknown): r is DoublonFournisseur =>
  typeof r === "object" && r !== null && "doublonFournisseur" in r && (r as { doublonFournisseur?: unknown }).doublonFournisseur === true;
