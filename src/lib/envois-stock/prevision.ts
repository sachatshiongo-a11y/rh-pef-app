// QUAND COMMANDER (Direction, 2026-10-18 : « savoir quand faire les commandes, me faire les bons rappels ») — module PUR
// (ni base, ni horloge) : la date limite de commande d'un article, d'après ce qu'il consomme et le délai du fournisseur.
//
// La règle, écrite ici une fois et dite telle quelle dans le courriel :
//   consommation par jour = sorties des 28 derniers jours (hier compris, aujourd'hui exclu) ÷ 28
//   jours restants        = stock actuel ÷ consommation par jour
//   rupture prévue        = aujourd'hui + jours restants (arrondis à l'entier inférieur)
//   commander avant le    = rupture prévue − délai de livraison du fournisseur habituel
//   quantité suggérée     = consommation × (délai + 14 jours) − stock actuel, arrondie à l'unité supérieure
//
// Rien n'est supposé : un délai de livraison non renseigné (ou illisible) compte pour 0 jour ET la ligne le dit ; un
// article sorti un seul jour sur la période n'a pas de consommation fiable et n'est pas prévu. Un article déjà à 0 (ou
// moins) mais consommé sur la période est EN RUPTURE : à commander aujourd'hui, sans date de rupture (on ne sait pas
// quand il est tombé à 0) — confirmé par la Direction le 2026-10-18 : les stocks à 0 de l'app sont réels. La prévision ne vaut que ce que valent les saisies : si
// les sorties ou les réceptions ne sont pas enregistrées, la date est fausse — le courriel le rappelle.

/** Période de consommation observée, en jours. */
export const FENETRE_JOURS = 28;
/** Nombre minimal de jours avec au moins une sortie sur la période (en dessous : pas de prévision). */
export const JOURS_SORTIE_MIN = 2;
/** Un article figure dans le courriel si sa date limite de commande tombe au plus tard dans ce nombre de jours. */
export const HORIZON_JOURS = 3;
/** Jours de consommation que la quantité suggérée couvre APRÈS la livraison. */
export const COUVERTURE_JOURS = 14;

export type EntreePrevision = {
  quantite: number;
  /** Total des sorties sur les `FENETRE_JOURS` jours. */
  sorties: number;
  /** Nombre de jours distincts avec au moins une sortie sur la période. */
  joursSortie: number;
  /** Texte libre du fournisseur (« 1 jour(s) », « 7 »…), ou null. */
  delaiLivraison: string | null | undefined;
};

export type Prevision = {
  /** Stock déjà à 0 ou moins : à commander aujourd'hui (les dates ci-dessous valent alors aujourd'hui). */
  enRupture: boolean;
  consoParJour: number;
  joursRestants: number;
  /** Délai lu en jours, ou null s'il n'est pas renseigné / pas lisible (compté 0 dans le calcul). */
  delai: number | null;
  ruptureISO: string;
  commanderAvantISO: string;
  /** Jours entre aujourd'hui et la date limite (négatif : en retard). */
  joursAvantCommande: number;
  quantiteSuggeree: number;
};

/** Le délai de livraison en jours, lu dans le texte du fournisseur (« 1 jour(s) », « 7  jour(s) », « 3 »), ou null. */
export function lireDelai(texte: string | null | undefined): number | null {
  const m = (texte ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** `AAAA-MM-JJ` décalé de `jours` jours (dates pures, minuit UTC). */
export function decalerISO(iso: string, jours: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** La prévision d'un article, ou null quand il n'y a rien à prévoir (pas assez de sorties sur la période). */
export function prevoir(e: EntreePrevision, aujourdhuiISO: string): Prevision | null {
  if (e.sorties <= 0 || e.joursSortie < JOURS_SORTIE_MIN) return null;
  const consoParJour = e.sorties / FENETRE_JOURS;
  const delai = lireDelai(e.delaiLivraison);
  const stock = Math.max(0, e.quantite); // un stock négatif (saisie en retard) ne réduit pas le besoin
  const enRupture = e.quantite <= 0;
  const joursRestants = stock / consoParJour;
  const avantRupture = Math.floor(joursRestants);
  const joursAvantCommande = enRupture ? 0 : avantRupture - (delai ?? 0);
  const besoin = consoParJour * ((delai ?? 0) + COUVERTURE_JOURS) - stock;
  return {
    enRupture, consoParJour, joursRestants, delai,
    ruptureISO: decalerISO(aujourdhuiISO, avantRupture),
    commanderAvantISO: decalerISO(aujourdhuiISO, joursAvantCommande),
    joursAvantCommande,
    quantiteSuggeree: Math.max(0, Math.ceil(besoin - 1e-9)),
  };
}

/** À mettre dans le courriel : la date limite tombe dans l'horizon (ou est déjà passée). */
export const aCommander = (p: Prevision | null): p is Prevision => p !== null && p.joursAvantCommande <= HORIZON_JOURS;

/** « EN RETARD de 2 j », « AUJOURD'HUI », « demain », « dans 3 j ». */
export function libelleEcheance(jours: number): string {
  if (jours < 0) return `EN RETARD de ${-jours} j`;
  if (jours === 0) return "AUJOURD'HUI";
  if (jours === 1) return "demain";
  return `dans ${jours} j`;
}
