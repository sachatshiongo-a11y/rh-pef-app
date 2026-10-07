import { colonneDesignation, cleTexte, lireFeuillesXlsx, propre } from "@/lib/xlsx-leger";
import { ressemblance, SEUIL_PROCHE } from "@/lib/classeur-ventes";
import { SEPARATEUR_SOUS_RUBRIQUE, type EspaceVente } from "@/lib/ventes-journalieres";

// « Importer les lignes du classeur Commande journalière » (Conso. journalière → Commande,
// 2026-09-29) : la Direction dépose son classeur « PEF Commande Journalière » ; l'application en lit
// les lignes (« Fiche commande cuisine », « Fiche commande Bar ») et PROPOSE pour chacune l'article
// du catalogue correspondant. Rien n'est rattaché par devinette : seule une correspondance EXACTE
// (sans casse ni accents) est cochée d'office ; « proche de … » se décide à la main ; une ligne sans
// article est « absente du catalogue » (aucun article n'est créé : c'est un geste de la Direction).
// Fonctions PURES, utilisables dans le navigateur (lecture du fichier) comme sur le serveur.
//
// Lecture des feuilles, telle que le classeur est construit :
//  - la colonne des désignations est celle de la cellule « Désignation » (« Désignation/Date ») ;
//  - une RUBRIQUE est une rangée surlignée comme celles qui portent « Commande | Livraison » à côté
//    (« Viande -Volaille-Poisson-Crustacé », « Bière importée ») — le gras n'y dit rien, tout est gras ;
//  - une sous-rubrique est numérotée (« 1. Viande Rouge ») : « Viande … — 1. Viande Rouge » ;
//  - la feuille « Salle » (vide) est ignorée.

export type LigneCommandeClasseur = {
  feuille: EspaceVente;
  rubrique: string;
  nom: string;
  /** Unité écrite dans le classeur (feuille cuisine), pour information. */
  unite: string | null;
  rang: number;
  /** Numéro de la rangée dans la feuille Excel (lecture d'un classeur ; le document du jour s'y cale, lib/modeles-journaliers). */
  ligne?: number;
};

export type LectureCommande = { ok: true; lignes: LigneCommandeClasseur[] } | { ok: false; erreur: string };

const REFUS =
  "Ce fichier n'est pas le classeur « Commande journalière » : il faut une feuille « Fiche commande cuisine » et une feuille « Fiche commande Bar », chacune avec une colonne « Désignation ».";

const colonneSuivante = (col: string) => String.fromCharCode(col.charCodeAt(col.length - 1) + 1);
const estSousRubrique = (t: string) => /^\d+\s*\.\s*\S/.test(t);

/** Lit le classeur « Commande journalière ». Ne lève jamais. */
export async function lireClasseurCommande(donnees: ArrayBuffer | Uint8Array): Promise<LectureCommande> {
  const lu = await lireFeuillesXlsx(donnees, (nom) => nom.includes("commande cuisine") || nom.includes("commande bar"));
  if (!lu.ok) return lu;
  const trouver = (motif: string) => [...lu.feuilles.entries()].find(([n]) => n.includes(motif))?.[1];
  const feuilles = ([["CUISINE", "commande cuisine"], ["BAR", "commande bar"]] as const).map(([feuille, motif]) => {
    const rangees = trouver(motif);
    const tete = rangees && colonneDesignation(rangees);
    return rangees && tete ? { feuille, col: tete.col, suite: rangees.slice(tete.entete + 1) } : null;
  });
  if (feuilles.some((f) => f === null)) return { ok: false, erreur: REFUS };
  // Fonds des rubriques (styles communs aux deux feuilles) : ceux des rangées qui portent
  // « Commande » à côté de la désignation. Un fond « aucun » ne désigne jamais une rubrique.
  const fonds = new Set<number>();
  for (const { col, suite } of feuilles as NonNullable<(typeof feuilles)[number]>[]) {
    for (const cs of suite) {
      const d = cs.find((c) => c.col === col);
      if (d?.texte && cs.some((c) => c.col !== col && c.texte && cleTexte(c.texte) === "commande")) fonds.add(d.fond);
    }
  }
  fonds.delete(0);
  const lignes: LigneCommandeClasseur[] = [];
  for (const { feuille, col, suite } of feuilles as NonNullable<(typeof feuilles)[number]>[]) {
    let rubrique: string | null = null;
    let parent: string | null = null;
    let rang = 0;
    const vues = new Set<string>();
    for (const cs of suite) {
      const d = cs.find((c) => c.col === col);
      if (!d?.texte || cleTexte(d.texte).startsWith("designation")) continue;
      const aCommande = cs.some((c) => c.col !== col && c.texte && cleTexte(c.texte) === "commande");
      if (aCommande || fonds.has(d.fond)) { parent = d.texte; rubrique = d.texte; continue; }
      if (estSousRubrique(d.texte)) { rubrique = `${parent ?? d.texte}${parent ? SEPARATEUR_SOUS_RUBRIQUE + d.texte : ""}`; continue; }
      const r = rubrique ?? "Sans rubrique";
      const k = `${cleTexte(r)}|${cleTexte(d.texte)}`;
      if (vues.has(k)) continue;
      vues.add(k);
      const unite = feuille === "CUISINE" ? cs.find((c) => c.col === colonneSuivante(col))?.texte ?? null : null;
      lignes.push({ feuille, rubrique: r, nom: d.texte, unite, rang: ++rang, ligne: d.ligne });
    }
  }
  if (!lignes.some((l) => l.feuille === "CUISINE") || !lignes.some((l) => l.feuille === "BAR")) return { ok: false, erreur: REFUS };
  return { ok: true, lignes };
}

// ─── Correspondance avec le catalogue ────────────────────────────────────────

export type ArticleCatalogueImport = {
  id: string; designation: string; nomCourt: string | null; domaine: "NOURRITURE" | "BOISSON" | "AUTRE";
  surFicheCommande: boolean; ordreCommande: number | null; rubriqueCommande: string | null;
};

export type PropositionCommande = {
  cle: string;
  feuille: EspaceVente;
  rubrique: string;
  nom: string;
  unite: string | null;
  rang: number;
  /**
   * EXACTE : un seul article porte ce nom (désignation ou nom court) — cochée ;
   * DEJA : déjà sur la fiche, au même rang et sous la même rubrique — rien à faire ;
   * PROCHE / AMBIGUE : à choisir à la main — décochée ;
   * LEGUME : légume frais (liste des légumes : la fiche les imprime déjà) ; ABSENTE : absente du catalogue.
   */
  statut: "EXACTE" | "DEJA" | "PROCHE" | "AMBIGUE" | "LEGUME" | "ABSENTE";
  articleId: string | null;
  candidats: { id: string; libelle: string; nomCourt: string | null }[];
  cochee: boolean;
};

/** Domaines du catalogue repris sur chaque feuille (comme la fiche : cuisine = nourriture ET « autre »). */
const DOMAINES: Record<EspaceVente, ArticleCatalogueImport["domaine"][]> = { CUISINE: ["NOURRITURE", "AUTRE"], BAR: ["BOISSON"] };
/** Clé d'un légume : sans casse, accents, ponctuation ni pluriel (« Courgette » = « Courgettes »). */
export const cleLegume = (s: string) => cleTexte(s).split(/[^a-z0-9]+/).filter(Boolean).map((m) => (m.length > 3 && m.endsWith("s") ? m.slice(0, -1) : m)).join("");
const libelle = (a: ArticleCatalogueImport) => (a.nomCourt ? `${a.designation} (nom court « ${a.nomCourt} »)` : a.designation);

/** Propose, pour chaque ligne du classeur, l'article correspondant — jamais deviné. */
export function analyserLignesCommande(lignes: LigneCommandeClasseur[], articles: ArticleCatalogueImport[], legumes: string[] = []): PropositionCommande[] {
  const legumesConnus = new Set(legumes.map(cleLegume));
  return lignes.map((l) => {
    const n = cleTexte(l.nom);
    const famille = articles.filter((a) => DOMAINES[l.feuille].includes(a.domaine));
    const exacts = famille.filter((a) => cleTexte(a.designation) === n || (a.nomCourt !== null && cleTexte(a.nomCourt) === n));
    const base = { cle: `${l.feuille}|${cleTexte(l.rubrique)}|${n}`, feuille: l.feuille, rubrique: l.rubrique, nom: l.nom, unite: l.unite, rang: l.rang };
    const cand = (a: ArticleCatalogueImport) => ({ id: a.id, libelle: libelle(a), nomCourt: a.nomCourt });
    // Légume frais de la liste des légumes : la fiche l'imprime déjà (rubrique « Fruits & Légumes
    // frais ») — le poser aussi sur un article l'imprimerait deux fois.
    if (l.feuille === "CUISINE" && legumesConnus.has(cleLegume(l.nom))) return { ...base, statut: "LEGUME" as const, articleId: null, candidats: [], cochee: false };
    if (exacts.length === 1) {
      const a = exacts[0]!;
      const deja = a.surFicheCommande && a.ordreCommande === l.rang && cleTexte(a.rubriqueCommande ?? "") === cleTexte(l.rubrique) && !!a.nomCourt;
      return { ...base, statut: deja ? "DEJA" as const : "EXACTE" as const, articleId: a.id, candidats: [cand(a)], cochee: !deja };
    }
    if (exacts.length > 1) return { ...base, statut: "AMBIGUE" as const, articleId: null, candidats: exacts.map(cand), cochee: false };
    // Proches : part des mots de la LIGNE du classeur retrouvés dans l'article (« Beurre » →
    // « Beurre Lurpak ») — un article au nom très court ne remonte pas pour un seul mot commun.
    const proches = famille
      .map((a) => ({ a, s: Math.max(ressemblance(l.nom, a.designation, "premier").score, a.nomCourt ? ressemblance(l.nom, a.nomCourt, "premier").score : 0) }))
      .filter((x) => x.s >= SEUIL_PROCHE)
      .sort((x, y) => y.s - x.s || x.a.designation.localeCompare(y.a.designation, "fr"))
      .slice(0, 6);
    if (proches.length > 0) return { ...base, statut: "PROCHE" as const, articleId: null, candidats: proches.map((x) => cand(x.a)), cochee: false };
    return { ...base, statut: "ABSENTE" as const, articleId: null, candidats: [], cochee: false };
  });
}

export { propre };
