import { aDesFrancs, ajouterAuTotal, libelleEquivalent, libelleTotal, totalVide, type DeviseFacture, type MontantsFactureBrut, type TotalDevises } from "@/lib/facture-devise";
import { estEchue, statutAffiche } from "@/lib/facture-echue";
import { deviseBon, libelleTotalListe, type BonBrut } from "@/lib/bon-commande-devise";
import { libellesPrix, type PrixArticleBrut } from "@/lib/prix-article";
import { libelleArticle, type ArticleLibelle } from "@/lib/libelle-article";
import { STATUT_BC_LABEL, STATUT_FACTURE_LABEL } from "@/lib/stock";

// FICHE FOURNISSEUR EXPORTABLE (PDF) — la DONNÉE de la fiche, déjà mise en texte.
//
// Module pur (ni base, ni React-PDF) : la route lit la base, ce module compose la fiche, le composant
// `src/lib/pdf/fiche-fournisseur.tsx` ne fait que la dessiner. Changer la mise en page = toucher le seul
// composant ; changer un chiffre = toucher ce module.
//
// Règle des montants : un montant ILLISIBLE (absent, ou pas un nombre) n'est jamais remplacé par zéro.
// La facture s'écrit « — », elle n'entre dans aucun total, et la fiche le dit (`avertissement`).

/** Combien de lignes récentes la fiche montre (le nombre réel est toujours écrit à côté). */
export const MAX_FACTURES_FICHE = 15;
export const MAX_BONS_FICHE = 10;
export const MAX_ARTICLES_FICHE = 150;
/** Fiches par document (le bouton « Exporter » du lot se désactive au-delà ; la route refuse aussi). */
export const MAX_FICHES_PDF = 50;

export type FournisseurBrut = {
  id: string; nom: string; contactNom: string | null; telephone: string | null; email: string | null; adresse: string | null;
  ville: string | null; pays: string | null; rccm: string | null; idNational: string | null;
  delaiPaiement: string | null; delaiLivraison: string | null; modePaiement: string | null; produits: string | null;
};
export type FactureBrute = MontantsFactureBrut & {
  numero: string | null; date: Date | null; dateEcheance: Date | null; statut: string; annee: number; mois: number;
};
export type BonBrutFiche = BonBrut & { numero: string; date: Date; statut: string; nbLignes: number; nbSansPrix: number };
export type ArticleBrutFiche = PrixArticleBrut & ArticleLibelle & { categorieNom: string | null; habituel: boolean };

export type ChiffreFiche = { libelle: string; valeur: string; sousTexte?: string; teinte?: "attention" | "alerte" | "entree" };
export type FicheFournisseurExport = {
  nom: string;
  identite: { libelle: string; valeur: string }[];
  chiffres: ChiffreFiche[];
  /** Phrase quand des montants de facture sont illisibles (ils ne sont comptés dans aucun total). */
  avertissement: string | null;
  factures: { numero: string; date: string; echeance: string; montant: string; reste: string; statut: string; statutCle: string }[];
  nbFactures: number;
  bons: { numero: string; date: string; statut: string; total: string }[];
  nbBons: number;
  articles: { designation: string; categorie: string; lien: string; prix: string; prixAutre: string | null }[];
  nbArticles: number;
};

const joursFr = (d: Date | null): string => {
  if (!d) return "—";
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`;
};

/** Un montant de la base lu comme nombre ; `null` s'il est absent, vide ou pas un nombre (jamais 0 à sa place). */
export function lireMontant(v: { toString(): string } | string | number | null | undefined): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Le montant et le reste d'une facture dans SA devise, chacun `null` s'il est illisible. */
export function montantsLisibles(f: MontantsFactureBrut): { devise: DeviseFacture; montant: number | null; reste: number | null } {
  const devise: DeviseFacture = f.devise === "CDF" ? "CDF" : "USD";
  return devise === "CDF"
    ? { devise, montant: lireMontant(f.montantCDF), reste: lireMontant(f.resteAPayerCDF) }
    : { devise, montant: lireMontant(f.montantUSD), reste: lireMontant(f.resteAPayerUSD) };
}

const fmt = (n: number, devise: DeviseFacture) => libelleTotal(ajouterAuTotal(totalVide(), devise, n));

/** Les quatre chiffres de la fiche (même règles que la fiche à l'écran), par devise, sans jamais compter un montant illisible. */
export function chiffresFactures(factures: FactureBrute[], taux: number | null | undefined, auj?: string): { chiffres: ChiffreFiche[]; avertissement: string | null } {
  let total = totalVide(), regle = totalVide(), impaye = totalVide(), echu = totalVide();
  let nbARegler = 0, nbEchu = 0, nbMontantIllisible = 0, nbResteIllisible = 0;
  for (const f of factures) {
    const m = montantsLisibles(f);
    if (m.montant === null) { nbMontantIllisible++; continue; }
    total = ajouterAuTotal(total, m.devise, m.montant);
    if (m.reste === null) { nbResteIllisible++; continue; }
    regle = ajouterAuTotal(regle, m.devise, m.montant - m.reste);
    if (f.statut !== "REGLEE") { impaye = ajouterAuTotal(impaye, m.devise, m.reste); nbARegler++; }
    if (estEchue(f, auj)) { echu = ajouterAuTotal(echu, m.devise, m.reste); nbEchu++; }
  }
  // Rien de lisible : « — », pas « 0,00 $ » (un zéro dirait « rien à payer »).
  const lib = (t: TotalDevises, lisible: boolean) => (lisible ? libelleTotal(t) : "—");
  const eq = (t: TotalDevises) => (aDesFrancs(t) ? (libelleEquivalent(t, taux) ?? undefined) : undefined);
  const aTotal = factures.length - nbMontantIllisible > 0 || factures.length === 0;
  const aReste = factures.length - nbMontantIllisible - nbResteIllisible > 0 || factures.length === 0;
  const chiffres: ChiffreFiche[] = [
    { libelle: "Total facturé", valeur: lib(total, aTotal), sousTexte: eq(total) },
    { libelle: "Payé", valeur: lib(regle, aReste), sousTexte: eq(regle), teinte: "entree" },
    { libelle: `Impayé (${nbARegler})`, valeur: lib(impaye, aReste), sousTexte: eq(impaye), teinte: aReste && (impaye.usd > 0 || aDesFrancs(impaye)) ? "attention" : undefined },
    { libelle: `Échu (${nbEchu})`, valeur: lib(echu, aReste), sousTexte: eq(echu), teinte: aReste && (echu.usd > 0 || aDesFrancs(echu)) ? "alerte" : undefined },
  ];
  const n = nbMontantIllisible + nbResteIllisible;
  const avertissement = n === 0 ? null : `${n} facture(s) au montant ou au reste à payer illisible : non comptée(s) dans les chiffres ci-dessus et marquée(s) « — » dans la liste.`;
  return { chiffres, avertissement };
}

const IDENTITE: [keyof FournisseurBrut, string][] = [
  ["contactNom", "Contact"], ["telephone", "Téléphone"], ["email", "E-mail"], ["adresse", "Adresse"], ["ville", "Ville"], ["pays", "Pays"],
  ["rccm", "RCCM"], ["idNational", "ID National"], ["delaiPaiement", "Délai de paiement"], ["delaiLivraison", "Délai de livraison"],
  ["modePaiement", "Mode de paiement"], ["produits", "Produits fournis"],
];

/** Compose la fiche d'un fournisseur ; `factures`/`bons`/`articles` : TOUS ceux du fournisseur (les plus récents sont retenus ici). */
export function construireFiche(
  f: FournisseurBrut, factures: FactureBrute[], bons: BonBrutFiche[], articles: ArticleBrutFiche[], taux: number | null | undefined, auj?: string,
): FicheFournisseurExport {
  const { chiffres, avertissement } = chiffresFactures(factures, taux, auj);
  const recentes = [...factures].sort((a, b) => b.annee - a.annee || b.mois - a.mois || (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)).slice(0, MAX_FACTURES_FICHE);
  const bonsRecents = [...bons].sort((a, b) => b.date.getTime() - a.date.getTime() || b.numero.localeCompare(a.numero)).slice(0, MAX_BONS_FICHE);
  const articlesTries = [...articles].sort((a, b) => libelleArticle(a).localeCompare(libelleArticle(b), "fr"));
  return {
    nom: f.nom,
    identite: IDENTITE.flatMap(([cle, libelle]) => (f[cle] && String(f[cle]).trim() ? [{ libelle, valeur: String(f[cle]).trim() }] : [])),
    chiffres,
    avertissement,
    factures: recentes.map((x) => {
      const m = montantsLisibles(x);
      return {
        numero: x.numero ?? "—", date: joursFr(x.date), echeance: joursFr(x.dateEcheance),
        montant: m.montant === null ? "—" : fmt(m.montant, m.devise),
        reste: m.reste === null ? "—" : fmt(m.reste, m.devise),
        // Statut à la lecture (échue jugée sur l'échéance), comme l'écran Factures ; reste illisible : le statut stocké.
        statutCle: m.reste === null ? x.statut : statutAffiche(x, auj),
        statut: STATUT_FACTURE_LABEL[m.reste === null ? x.statut : statutAffiche(x, auj)] ?? x.statut,
      };
    }),
    nbFactures: factures.length,
    bons: bonsRecents.map((b) => ({
      numero: b.numero, date: joursFr(b.date), statut: STATUT_BC_LABEL[b.statut] ?? b.statut,
      total: libelleTotalListe({ total: lireMontant(deviseBon(b) === "CDF" ? b.totalCDF : b.totalUSD), devise: deviseBon(b), sansPrix: b.nbSansPrix, nbLignes: b.nbLignes }),
    })),
    nbBons: bons.length,
    articles: articlesTries.slice(0, MAX_ARTICLES_FICHE).map((a) => {
      const p = libellesPrix(a, taux); // prix dans SA devise, l'autre devise au taux du jour (« ≈ — » sans taux)
      return { designation: libelleArticle(a), categorie: a.categorieNom ?? "—", lien: a.habituel ? "Habituel" : "Occasionnel", prix: p.principal, prixAutre: p.autre };
    }),
    nbArticles: articles.length,
  };
}

/** Lignes d'une fiche dessinée (sert au plafond de lignes du PDF). */
export const lignesDeLaFiche = (x: FicheFournisseurExport): number => x.factures.length + x.bons.length + x.articles.length + x.identite.length;
