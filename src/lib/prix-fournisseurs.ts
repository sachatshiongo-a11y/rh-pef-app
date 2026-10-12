// DERNIER PRIX PAR FOURNISSEUR D'UN ARTICLE (2026-10-16) — module PUR : ni base, ni session.
//
// Demande de la Direction : « pour chaque fournisseur de l'article, le dernier prix d'achat, sa date et son
// origine (Liste d'achat, facture, bon de commande), pour comparer qui est le moins cher ». Le prix est CALCULÉ
// depuis l'historique d'achats, jamais copié dans une colonne (une copie divergerait d'une facture corrigée,
// d'un achat supprimé ou d'un bon annulé).
//
// Règles de fond, toutes déjà celles de la maison :
//  - LA DEVISE DE SAISIE FAIT FOI : un achat saisi en francs reste « 7 000 FC », jamais ramené à un pivot en
//    dollars puis reconverti. L'autre devise ne s'affiche qu'en « ≈ » au taux du jour (`src/lib/prix-article.ts`).
//  - Le prix est ramené à l'UNITÉ DE L'ARTICLE par la porte unique des conversions (`facteurVersArticle`, plus
//    « carton » via `uniteParCarton`). Une unité qui ne se convertit pas n'est JAMAIS devinée : la ligne est
//    montrée telle que saisie, marquée « non comparable », et exclue du classement.
//  - Un prix absent, nul ou illisible n'est pas un prix : jamais un zéro dans la comparaison.
//  - Classement « moins cher » : dans une même devise sans taux ; entre devises, seulement avec un taux du jour
//    (« ≈ ») ; sans taux et devises mêlées, la comparaison est annoncée impossible, pas supposée.

import Decimal from "decimal.js";
import { facteurVersArticle, normaliserUnite } from "@/lib/fiches/conversion";
import { tauxUtilisable, type DevisePrix } from "@/lib/prix-article";

export type OriginePrix = "FACTURE" | "LISTE_ACHAT" | "BON_COMMANDE";

export const LIBELLE_ORIGINE: Record<OriginePrix, string> = { FACTURE: "Facture", LISTE_ACHAT: "Liste d'achat", BON_COMMANDE: "Bon de commande" };

/** À égalité de date, la facture (prix réellement facturé) prime sur l'achat direct, puis sur le bon (intention). */
const RANG_ORIGINE: Record<OriginePrix, number> = { FACTURE: 0, LISTE_ACHAT: 1, BON_COMMANDE: 2 };

type Dec = { toString(): string } | string | number | null | undefined;
const dec = (v: Dec): Decimal | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  try { const d = new Decimal(String(v)); return d.isFinite() ? d : null; } catch { return null; }
};
const positif = (v: Dec): Decimal | null => { const d = dec(v); return d !== null && d.greaterThan(0) ? d : null; };

/** Un achat chez un fournisseur, tel que l'historique le dit : un prix PAR `uniteLigne`, dans `devise`. */
export type AchatFournisseur = {
  fournisseurId: string;
  date: Date;
  origine: OriginePrix;
  /** Facture ou bon (pour le lien) ; null pour la Liste d'achat. */
  refId: string | null;
  /** « n° 123 », « 001/PEF/JANV/26 » ; null = pas de libellé (la Liste d'achat). */
  refLibelle: string | null;
  devise: DevisePrix;
  prixUnitaire: Dec;
  /** Unité du prix (ligne de facture / de bon) ; vide = celle de l'article (achat direct : toujours la sienne). */
  uniteLigne: string | null;
};

/** Ce qu'il faut de l'article pour ramener un prix à son unité de stock. */
export type UnitesArticle = { unite: string | null; uniteParCarton?: Dec; contenance?: Dec; contenanceUnite?: string | null };

// ── Lecture des trois sources ────────────────────────────────────────────────

type MouvementAchat = {
  fournisseurId: string | null; date: Date; quantite: Dec; devise: DevisePrix | null; montantOrigine: Dec; montantUSD: Dec;
};

/**
 * Achat direct de la Liste d'achat : prix = montant ÷ quantité, DANS LA DEVISE DE SAISIE de la ligne (francs :
 * `montantOrigine`, jamais le montant en dollars recalculé ; dollars : `montantOrigine`, à défaut `montantUSD`
 * des lignes d'avant la devise par ligne). Sans fournisseur, quantité ou montant : pas d'achat exploitable.
 */
export function achatDeMouvement(m: MouvementAchat): AchatFournisseur | null {
  if (!m.fournisseurId) return null;
  const qte = positif(m.quantite);
  if (qte === null) return null;
  if (m.devise === "CDF") {
    const montant = positif(m.montantOrigine);
    return montant === null ? null : { fournisseurId: m.fournisseurId, date: m.date, origine: "LISTE_ACHAT", refId: null, refLibelle: null, devise: "CDF", prixUnitaire: montant.div(qte), uniteLigne: null };
  }
  const montant = positif(m.montantOrigine) ?? positif(m.montantUSD);
  return montant === null ? null : { fournisseurId: m.fournisseurId, date: m.date, origine: "LISTE_ACHAT", refId: null, refLibelle: null, devise: "USD", prixUnitaire: montant.div(qte), uniteLigne: null };
}

type LigneDocument = {
  prixUnitaireUSD: Dec; prixUnitaireCDF: Dec; unite: string | null;
};

/** Ligne de facture : le prix dans la devise de SA facture ; facture sans date ou sans fournisseur : pas d'achat daté. */
export function achatDeLigneFacture(l: LigneDocument & { facture: { id: string; numero: string | null; date: Date | null; fournisseurId: string | null; devise: DevisePrix } }): AchatFournisseur | null {
  const f = l.facture;
  if (!f.fournisseurId || !f.date) return null;
  const prix = positif(f.devise === "CDF" ? l.prixUnitaireCDF : l.prixUnitaireUSD);
  return prix === null ? null : { fournisseurId: f.fournisseurId, date: f.date, origine: "FACTURE", refId: f.id, refLibelle: f.numero, devise: f.devise, prixUnitaire: prix, uniteLigne: l.unite };
}

/** Statuts d'un bon qui ENGAGENT une commande (ni brouillon, ni annulé). */
export const STATUTS_BON_ENGAGES = ["VALIDE", "ENVOYE", "RECU_PARTIEL", "RECU"] as const;

/** Ligne de bon de commande engagé : le prix dans la devise du bon ; ligne sans prix (NUL ou 0) : rien. */
export function achatDeLigneBon(l: LigneDocument & { bon: { id: string; numero: string; date: Date; fournisseurId: string | null; devise: DevisePrix; statut: string } }): AchatFournisseur | null {
  const b = l.bon;
  if (!b.fournisseurId || !(STATUTS_BON_ENGAGES as readonly string[]).includes(b.statut)) return null;
  const prix = positif(b.devise === "CDF" ? l.prixUnitaireCDF : l.prixUnitaireUSD);
  return prix === null ? null : { fournisseurId: b.fournisseurId, date: b.date, origine: "BON_COMMANDE", refId: b.id, refLibelle: b.numero, devise: b.devise, prixUnitaire: prix, uniteLigne: l.unite };
}

// ── Prix ramené à l'unité de l'article ───────────────────────────────────────

export type PrixALUnite = { ok: true; prix: Decimal } | { ok: false; motif: string };

/**
 * Prix par UNITÉ DE L'ARTICLE. Unité de ligne vide = celle de l'article (un achat direct, un bon saisi dans
 * l'unité du catalogue). Sinon : même unité → tel quel ; « carton » → ÷ unités par carton de l'article ;
 * sinon la porte unique `facteurVersArticle` (kg → g, litre → bouteille de 75 cl…). Introuvable : refus qui
 * nomme les deux unités.
 */
export function prixALUniteArticle(prix: Decimal, uniteLigne: string | null, article: UnitesArticle): PrixALUnite {
  const ligne = (uniteLigne ?? "").trim();
  if (ligne === "") return { ok: true, prix };
  const unite = (article.unite ?? "").trim();
  if (unite === "") return { ok: false, motif: `l'article n'a pas d'unité ; le prix est par « ${ligne} »` };
  if (normaliserUnite(ligne) === normaliserUnite(unite)) return { ok: true, prix };
  if (normaliserUnite(ligne) === "carton") {
    const parCarton = positif(article.uniteParCarton);
    return parCarton === null
      ? { ok: false, motif: `prix par « ${ligne} » : le nombre d'unités par carton de l'article est inconnu` }
      : { ok: true, prix: prix.div(parCarton) };
  }
  const f = facteurVersArticle(ligne, { unite, contenance: dec(article.contenance), contenanceUnite: article.contenanceUnite ?? null });
  if (f === null || f.num.isZero()) return { ok: false, motif: `prix par « ${ligne} », l'article se compte en « ${unite} » : conversion impossible` };
  return { ok: true, prix: prix.times(f.den).div(f.num) };
}

// ── Dernier prix par fournisseur ─────────────────────────────────────────────

export type DernierPrixFournisseur = {
  fournisseurId: string;
  date: Date;
  origine: OriginePrix;
  refId: string | null;
  refLibelle: string | null;
  /** Devise de SAISIE de l'achat — celle qui fait foi. */
  devise: DevisePrix;
  /** Prix par unité de l'article dans `devise` (texte décimal exact) ; null si l'unité ne se convertit pas. */
  prix: string | null;
  /** Le prix tel que saisi (par `uniteLigne`), rappelé quand il diffère de l'unité de l'article. */
  prixSaisi: string;
  uniteLigne: string | null;
  /** Pourquoi `prix` est null (unité non convertible). */
  motif: string | null;
  /** Nombre d'achats chiffrés de ce fournisseur pour cet article. */
  nbAchats: number;
};

const dateOrdre = (d: Date) => d.getTime();

/**
 * Le dernier achat de CHAQUE fournisseur : le plus récent par date ; à date égale, la facture avant la Liste
 * d'achat avant le bon. Un fournisseur dont aucun achat n'a de prix n'apparaît pas (il n'a pas de prix, pas un
 * prix de 0). L'ordre rendu : le plus récent d'abord.
 */
export function dernierPrixParFournisseur(achats: readonly AchatFournisseur[], article: UnitesArticle): DernierPrixFournisseur[] {
  const parFournisseur = new Map<string, AchatFournisseur[]>();
  for (const a of achats) {
    if (positif(a.prixUnitaire) === null) continue;
    const l = parFournisseur.get(a.fournisseurId) ?? [];
    l.push(a);
    parFournisseur.set(a.fournisseurId, l);
  }
  const res: DernierPrixFournisseur[] = [];
  for (const [fournisseurId, liste] of parFournisseur) {
    const dernier = [...liste].sort((x, y) => dateOrdre(y.date) - dateOrdre(x.date) || RANG_ORIGINE[x.origine] - RANG_ORIGINE[y.origine])[0]!;
    const brut = positif(dernier.prixUnitaire)!;
    const conv = prixALUniteArticle(brut, dernier.uniteLigne, article);
    res.push({
      fournisseurId, date: dernier.date, origine: dernier.origine, refId: dernier.refId, refLibelle: dernier.refLibelle, devise: dernier.devise,
      prix: conv.ok ? conv.prix.toString() : null, prixSaisi: brut.toString(), uniteLigne: dernier.uniteLigne, motif: conv.ok ? null : conv.motif, nbAchats: liste.length,
    });
  }
  return res.sort((x, y) => dateOrdre(y.date) - dateOrdre(x.date) || x.fournisseurId.localeCompare(y.fournisseurId));
}

// ── Comparaison ──────────────────────────────────────────────────────────────

export type ComparaisonPrix = {
  /** UN_SEUL : un seul prix comparable, rien à comparer ; DEVISES_SANS_TAUX : devises mêlées et pas de taux du jour. */
  etat: "AUCUN" | "UN_SEUL" | "COMPARE" | "DEVISES_SANS_TAUX";
  /** Par fournisseur : ses prix et sa place. */
  lignes: (DernierPrixFournisseur & {
    /** Le prix dans l'AUTRE devise au taux du jour (« ≈ »), null sans taux ou sans prix. */
    autre: { devise: DevisePrix; valeur: number } | null;
    moinsCher: boolean;
    /** Écart au moins cher, en % (0 pour lui-même) ; null si non comparé. */
    ecartPct: number | null;
  })[];
};

/**
 * Classe les derniers prix. Valeur de comparaison : le prix dans la devise commune ; si les devises sont mêlées,
 * en dollars au taux du jour (« ≈ »). Sans taux et devises mêlées : aucun classement (annoncé). Les lignes dont
 * l'unité ne se convertit pas sont gardées, marquées, et ne participent pas.
 */
export function comparerPrix(derniers: readonly DernierPrixFournisseur[], taux: number | null | undefined): ComparaisonPrix {
  const t = tauxUtilisable(taux ?? null);
  const comparables = derniers.filter((d) => d.prix !== null);
  const devises = new Set(comparables.map((d) => d.devise));
  const mixte = devises.size > 1;
  const valeur = (d: DernierPrixFournisseur): Decimal | null => {
    const p = new Decimal(d.prix!);
    if (!mixte) return p;
    if (t === null) return null;
    return d.devise === "USD" ? p : p.div(t);
  };
  const valeurs = new Map<string, Decimal>();
  if (comparables.length > 1 && !(mixte && t === null)) for (const d of comparables) { const v = valeur(d); if (v !== null) valeurs.set(d.fournisseurId, v); }
  const min = valeurs.size > 1 ? Decimal.min(...valeurs.values()) : null;
  const lignes = derniers.map((d) => {
    const v = valeurs.get(d.fournisseurId);
    let autre: { devise: DevisePrix; valeur: number } | null = null;
    if (d.prix !== null && t !== null) autre = d.devise === "USD" ? { devise: "CDF", valeur: new Decimal(d.prix).times(t).toNumber() } : { devise: "USD", valeur: new Decimal(d.prix).div(t).toNumber() };
    return {
      ...d, autre,
      moinsCher: min !== null && v !== undefined && v.equals(min),
      ecartPct: min !== null && v !== undefined && min.greaterThan(0) ? v.minus(min).div(min).times(100).toNumber() : null,
    };
  });
  const etat: ComparaisonPrix["etat"] = comparables.length === 0 ? "AUCUN" : comparables.length === 1 ? "UN_SEUL" : mixte && t === null ? "DEVISES_SANS_TAUX" : "COMPARE";
  return { etat, lignes };
}
