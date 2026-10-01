import type { StatutBonCommande, StatutFacture } from "@prisma/client";
import { grouperParMois } from "@/lib/dates-fr";

// FICHE FOURNISSEUR — onglets et filtres, règles partagées (demande de la Direction, 2026-10-01).
//
// Module pur (ni base, ni `server-only`) : lu par la page, par ses tests et par les pages Facture /
// Bon de commande qui renvoient vers la fiche. L'onglet et le filtre vivent DANS L'URL
// (`?onglet=factures&filtre=payees`) : un lien de retour, un favori ou un rechargement retombent
// exactement là où on était.

export const ONGLETS_FOURNISSEUR = ["factures", "bons", "achats", "articles", "coordonnees"] as const;
export type OngletFournisseur = (typeof ONGLETS_FOURNISSEUR)[number];
export const ONGLET_PAR_DEFAUT: OngletFournisseur = "factures";

export const FILTRES_FACTURES = ["a-regler", "payees", "toutes"] as const;
export type FiltreFactures = (typeof FILTRES_FACTURES)[number];
export const FILTRE_FACTURES_PAR_DEFAUT: FiltreFactures = "a-regler";

export const FILTRES_BONS = ["en-cours", "recus", "tous"] as const;
export type FiltreBons = (typeof FILTRES_BONS)[number];
export const FILTRE_BONS_PAR_DEFAUT: FiltreBons = "en-cours";

/** Un paramètre d'URL peut arriver en tableau (`?a=1&a=2`) : on ne retient que la première valeur. */
const premier = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** `?onglet=` : valeur absente ou inconnue → Factures. */
export function lireOnglet(v: string | string[] | undefined): OngletFournisseur {
  const x = premier(v);
  return (ONGLETS_FOURNISSEUR as readonly string[]).includes(x ?? "") ? (x as OngletFournisseur) : ONGLET_PAR_DEFAUT;
}

export function lireFiltreFactures(v: string | string[] | undefined): FiltreFactures {
  const x = premier(v);
  return (FILTRES_FACTURES as readonly string[]).includes(x ?? "") ? (x as FiltreFactures) : FILTRE_FACTURES_PAR_DEFAUT;
}

export function lireFiltreBons(v: string | string[] | undefined): FiltreBons {
  const x = premier(v);
  return (FILTRES_BONS as readonly string[]).includes(x ?? "") ? (x as FiltreBons) : FILTRE_BONS_PAR_DEFAUT;
}

/**
 * « À régler » = les MÊMES statuts que le filtre « À payer » de l'écran Factures (`?statut=du`) :
 * ni réglée, ni rien d'autre — une facture échue non réglée est à régler. Source unique : l'écran
 * Factures importe cette constante.
 */
export const STATUTS_FACTURE_A_REGLER: StatutFacture[] = ["A_REGLER", "ECHUE_NON_REGLEE"];

/** Statuts d'un bon de commande « en cours » : pas encore reçu en totalité, pas annulé. */
export const STATUTS_BC_EN_COURS: StatutBonCommande[] = ["BROUILLON", "VALIDE", "ENVOYE", "RECU_PARTIEL"];

/** Statuts retenus par un filtre de factures ; `undefined` = pas de restriction (Toutes). */
export function statutsFactures(filtre: FiltreFactures): StatutFacture[] | undefined {
  if (filtre === "a-regler") return STATUTS_FACTURE_A_REGLER;
  if (filtre === "payees") return ["REGLEE"];
  return undefined;
}

/** Statuts retenus par un filtre de bons ; `undefined` = pas de restriction (Tous, annulés compris). */
export function statutsBons(filtre: FiltreBons): StatutBonCommande[] | undefined {
  if (filtre === "en-cours") return STATUTS_BC_EN_COURS;
  if (filtre === "recus") return ["RECU"];
  return undefined;
}

/** Adresse d'un onglet de la fiche — toujours explicite (`?onglet=`), jamais « la racine » : elle reste valable si le défaut change. */
export function lienFiche(fournisseurId: string, onglet: OngletFournisseur, filtre?: FiltreFactures | FiltreBons): string {
  const p = new URLSearchParams({ onglet });
  const defaut = onglet === "factures" ? FILTRE_FACTURES_PAR_DEFAUT : onglet === "bons" ? FILTRE_BONS_PAR_DEFAUT : null;
  if (filtre && defaut && filtre !== defaut) p.set("filtre", filtre);
  return `/stock/fournisseurs/${fournisseurId}?${p}`;
}

/**
 * Le lien de retour d'une facture / d'un bon ouvert DEPUIS la fiche (`?retour=`). Valeur lue dans
 * l'URL, donc jamais crue : on n'accepte que l'adresse d'un onglet de LA fiche de CE fournisseur
 * (forme exacte produite par `lienFiche`), jamais une adresse libre — ni autre site, ni autre fiche.
 */
export function lireRetourFiche(retour: string | string[] | undefined, fournisseurId: string | null): string | null {
  const r = premier(retour);
  if (!r || !fournisseurId) return null;
  const attendu = `/stock/fournisseurs/${fournisseurId}?`;
  if (!r.startsWith(attendu)) return null;
  const q = new URLSearchParams(r.slice(attendu.length));
  const onglet = q.get("onglet");
  if (!onglet || !(ONGLETS_FOURNISSEUR as readonly string[]).includes(onglet)) return null;
  const filtre = q.get("filtre");
  const valides: readonly string[] = onglet === "factures" ? FILTRES_FACTURES : onglet === "bons" ? FILTRES_BONS : [];
  if (filtre !== null && !valides.includes(filtre)) return null;
  // Reconstruit : on renvoie ce qu'on sait être sain, pas la chaîne d'origine.
  return lienFiche(fournisseurId, onglet as OngletFournisseur, (filtre ?? undefined) as FiltreFactures | FiltreBons | undefined);
}

/** « ?retour=… » à ajouter au lien d'une facture / d'un bon quand on y va depuis la fiche. */
export const suffixeRetour = (lienDeLaFiche: string) => `?retour=${encodeURIComponent(lienDeLaFiche)}`;

/**
 * Regroupe des factures par MOIS DE LA FACTURE — le mois rangé sur la facture (`annee`/`mois`),
 * celui que l'écran Factures utilise : une facture reste dans le même mois partout. Réutilise le
 * groupement de `dates-fr` (ordre d'entrée conservé : trier du plus récent au plus ancien avant).
 */
export function grouperFacturesParMois<T extends { annee: number; mois: number }>(factures: T[]): { cle: string; titre: string; items: T[] }[] {
  return grouperParMois(factures, (x) => new Date(Date.UTC(x.annee, x.mois - 1, 1)));
}
