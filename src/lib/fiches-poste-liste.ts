// Écran « Fiches de poste » — logique PURE de la liste (aucune base, aucun DOM) : une ligne par
// intitulé de poste (postes des salariés actifs + fiches sans salarié), rangée sous son DÉPARTEMENT
// (le secteur le plus fréquent parmi les salariés actifs du poste — la fiche n'a pas de département
// propre), recherche et filtre « documentée / à documenter ».

import { motsDe } from "@/lib/recherche-options";
import { normTexte } from "@/lib/texte";

/** Champs d'une fiche de poste tels que l'écran les reçoit (mêmes noms que le modèle `FichePoste`). */
export type FicheDePoste = {
  id: string;
  poste: string;
  descriptionPoste: string | null;
  description: string | null;
  typeContrat: string | null;
  echelleSalariale: string | null;
  categorieProfessionnelle: string | null;
  superieurHierarchique: string | null;
  tempsTravail: string | null;
  competencesTechniques: string | null;
  savoirEtre: string | null;
  formationsRequises: string | null;
  diplomesRequis: string | null;
  experiencesExigees: string | null;
  fichierUrl: string | null;
  fichierNom: string | null;
};

export type Occupant = { id: string; nom: string; photoUrl: string | null };

export type LigneFichePoste = {
  poste: string;
  fiche: FicheDePoste | null;
  /** Salariés ACTIFS qui occupent le poste. */
  occupants: Occupant[];
  /** Département de rattachement (secteur le plus fréquent des occupants) ; null sans salarié actif. */
  departement: string | null;
  documentee: boolean;
};

/** Même règle qu'avant la refonte : une description (missions ou activités) ou un document joint. */
export function estDocumentee(f: Pick<FicheDePoste, "fichierUrl" | "description" | "descriptionPoste"> | null | undefined): boolean {
  return Boolean(f?.fichierUrl || f?.description || f?.descriptionPoste);
}

export const SANS_DEPARTEMENT = "Sans salarié actif";

/** Fiches au plus par lot PDF (ZIP) : chaque PDF se génère dans la même requête, la mémoire du serveur est comptée. */
export const MAX_FICHES_PAR_LOT = 50;

/** Lignes de l'écran, triées par intitulé (ordre français). */
export function lignesFichesPoste(
  employesActifs: readonly (Occupant & { poste: string; secteur: string })[],
  fiches: readonly FicheDePoste[],
): LigneFichePoste[] {
  const parPoste = new Map<string, (Occupant & { secteur: string })[]>();
  for (const e of employesActifs) {
    const p = e.poste.trim();
    if (!p) continue;
    if (!parPoste.has(p)) parPoste.set(p, []);
    parPoste.get(p)!.push(e);
  }
  const ficheParPoste = new Map(fiches.map((f) => [f.poste, f]));
  const postes = [...new Set([...parPoste.keys(), ...ficheParPoste.keys()])].sort((a, b) => a.localeCompare(b, "fr"));
  return postes.map((poste) => {
    const occupants = (parPoste.get(poste) ?? []).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    // Secteur le plus fréquent, comparé sans casse ni accents (« cuisine » = « Cuisine ») et affiché
    // sous sa première écriture rencontrée ; à égalité, l'ordre alphabétique (stable d'un affichage à l'autre).
    const compte = new Map<string, { libelle: string; n: number }>();
    for (const o of occupants) {
      const libelle = o.secteur.trim();
      if (!libelle) continue;
      const cle = normTexte(libelle);
      const c = compte.get(cle) ?? { libelle, n: 0 };
      c.n++;
      compte.set(cle, c);
    }
    const departement = [...compte.values()].sort((a, b) => b.n - a.n || a.libelle.localeCompare(b.libelle, "fr"))[0]?.libelle ?? null;
    const fiche = ficheParPoste.get(poste) ?? null;
    return { poste, fiche, occupants: occupants.map(({ id, nom, photoUrl }) => ({ id, nom, photoUrl })), departement, documentee: estDocumentee(fiche) };
  });
}

export type FiltreStatut = "tous" | "documentees" | "a-faire";

/** Recherche (intitulé, département, nom d'un occupant ; mots dans le désordre, sans accents) + statut. */
export function filtrerFichesPoste(lignes: readonly LigneFichePoste[], saisie: string, statut: FiltreStatut): LigneFichePoste[] {
  const mots = motsDe(saisie);
  return lignes.filter((l) => {
    if (statut === "documentees" && !l.documentee) return false;
    if (statut === "a-faire" && l.documentee) return false;
    if (mots.length === 0) return true;
    const foin = normTexte([l.poste, l.departement ?? "", ...l.occupants.map((o) => o.nom)].join(" | "));
    return mots.every((m) => foin.includes(m));
  });
}

/** Groupes par département (ordre alphabétique), « Sans salarié actif » en dernier. */
export function grouperParDepartement(lignes: readonly LigneFichePoste[]): { departement: string; lignes: LigneFichePoste[] }[] {
  const groupes = new Map<string, LigneFichePoste[]>();
  for (const l of lignes) {
    const d = l.departement ?? SANS_DEPARTEMENT;
    if (!groupes.has(d)) groupes.set(d, []);
    groupes.get(d)!.push(l);
  }
  return [...groupes.entries()]
    .sort(([a], [b]) => (a === SANS_DEPARTEMENT ? 1 : b === SANS_DEPARTEMENT ? -1 : a.localeCompare(b, "fr")))
    .map(([departement, l]) => ({ departement, lignes: l }));
}

/** Première ligne non vide d'un texte (aperçu d'une mission dans la liste). */
export function premiereLigne(texte: string | null | undefined): string {
  return (texte ?? "").split(/\r?\n/).map((l) => l.replace(/^[•\-–*]\s*/, "").trim()).find(Boolean) ?? "";
}
