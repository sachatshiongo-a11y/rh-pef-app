import { formaterNombre } from "@/lib/montant";
import type { Colonne, PartieTableau } from "@/lib/pdf/tableau";
import type { ConsommationReelle } from "@/lib/stock-restaurant";
import { cleCase, SEPARATEUR_SOUS_RUBRIQUE, type EspaceVente, type LigneVente } from "@/lib/ventes-journalieres";

// Fiches de l'onglet Consommation (Stock → Conso. journalière), reproduites d'après les deux
// classeurs de la Direction (2026-09-28) et remplies avec les données de l'application :
//
//   1. « PEF Rapport journalier cuisine et bar » — une feuille Cuisine (les PLATS vendus), une
//      feuille Bar (les BOISSONS vendues) ; une SEMAINE par fiche : « Semaine N », « Désignation/Date »
//      puis une colonne par jour (jour abrégé + date), du lundi au samedi ; lignes regroupées par
//      rubrique ; aucun total. Rempli par la saisie des ventes (onglet Ventes, 2026-09-29).
//   1 bis. « Consommation réelle du restaurant » — ce que le rapport journalier montrait jusqu'au
//      2026-09-29, faute de ventes saisies : même forme, la consommation réelle des ARTICLES du
//      restaurant (comptages). Gardée sous ce nom, à part.
//   2. « PEF Commande Journalière » — « Fiche commande cuisine » (Désignation/Date | Unité | Commande
//      | Livraison) et « Fiche commande Bar » (Désignation | Commande | Livraison, sans unité) ; un
//      JOUR par fiche (« Date : … », « Semaine N ») ; lignes regroupées par rubrique ; aucun total.
//
// Fonctions PURES (ni Prisma, ni React). Règles : l'inconnu s'écrit « — », jamais 0 ; une case
// vide dit « rien ce jour-là » (rien commandé, rien livré) ; aucun rattachement n'est deviné.

export type EspaceFiche = "CUISINE" | "BAR";

/** Valeur d'une case : nombre connu, texte (unité), `null` = inconnu (« — »), "" = rien (case vide). */
export type ValeurFiche = number | string | null;
/** Une case de la fiche ; `ecart` : consommation négative (plus compté que reçu), signalée. */
export type CaseFiche = { valeur: ValeurFiche; ecart?: boolean };
export type RoleColonne = "cmd" | "liv" | "conso" | "vente" | null;

/**
 * Clé de la ligne dans le classeur de la Direction (rubrique, noms possibles) : le document du jour
 * l'écrit sur la rangée du classeur qui porte ce nom (lib/modeles-journaliers). `legume` : ligne de
 * la liste des légumes frais, rapprochée sans pluriel ni ponctuation.
 */
export type CleLigne = { rubrique: string; noms: string[]; legume?: boolean; mention?: string };
export type LigneFiche = { designation: string; cases: CaseFiche[]; cle?: CleLigne };
export type SectionFiche = { titre: string; lignes: LigneFiche[] };

/** Fiche prête à rendre en PDF et en Excel. */
export type Fiche = {
  /** Espace (feuille cuisine ou bar du classeur). */
  espace: EspaceFiche;
  /** Nom de la feuille Excel (celui du classeur). */
  feuille: string;
  /** Titre de la fiche (partie du PDF, titre de la feuille Excel). */
  titre: string;
  /** Ligne sous le titre (« Date : 22/09/2026 », comme la case « Date : » du classeur). */
  sousTitre?: string;
  /** Colonnes après « Désignation ». */
  colonnes: { entete: string; role: RoleColonne }[];
  /** Libellé de la 1re colonne (« Désignation/Date » ou « Désignation », comme le classeur). */
  enteteDesignation: string;
  sections: SectionFiche[];
};

export const SANS_RUBRIQUE = "Sans catégorie";
export const A_CLASSER = "À classer";

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const JOURS_LONGS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const jourPur = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Numéro de semaine ISO (lundi → dimanche) d'une date PURE AAAA-MM-JJ. */
export function semaineIso(iso: string): number {
  const d = jourPur(iso);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // jeudi de la semaine
  const premierJanvier = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return 1 + Math.floor((d.getTime() - premierJanvier.getTime()) / (7 * 86_400_000));
}

/** « Lun 21/09 » : jour abrégé et date, comme les deux lignes d'en-tête du classeur. */
export function enteteJour(iso: string): string {
  const d = jourPur(iso);
  return `${JOURS_COURTS[(d.getUTCDay() + 6) % 7]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** « 22/09/2026 ». */
export const dateCourte = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** « mardi 22 septembre 2026 ». */
export function dateLongue(iso: string): string {
  const d = jourPur(iso);
  return `${JOURS_LONGS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Regroupe des lignes (déjà dans l'ordre voulu) en rubriques, à chaque changement de rubrique. */
function enSections<T>(items: T[], rubrique: (t: T) => string, ligne: (t: T) => LigneFiche): SectionFiche[] {
  const sections: SectionFiche[] = [];
  for (const it of items) {
    const titre = rubrique(it);
    const derniere = sections[sections.length - 1];
    if (derniere && derniere.titre === titre) derniere.lignes.push(ligne(it));
    else sections.push({ titre, lignes: [ligne(it)] });
  }
  return sections;
}

// ─── 1. Rapport journalier cuisine et bar (ventes) ───────────────────────────

/**
 * Rapport journalier d'un espace pour une semaine : le NOMBRE VENDU de chaque plat (Cuisine) ou
 * boisson (Bar), jour par jour, tel que saisi dans l'onglet Ventes. `jours` : les 7 jours (lundi →
 * dimanche). Lundi → samedi comme le classeur ; le dimanche n'y est ajouté que s'il porte une vente
 * — une donnée n'est jamais cachée pour tenir dans le modèle. Jour non saisi = « — », jamais 0 ;
 * 0 saisi = 0. `lignes` : celles de l'écran de saisie, dans son ordre (rubriques comprises).
 */
export function ficheRapportJournalier(p: {
  espace: EspaceVente;
  jours: string[];
  lignes: LigneVente[];
  ventes: ReadonlyMap<string, number>;
}): Fiche {
  const dimancheVendu = p.jours[6] !== undefined && p.lignes.some((l) => p.ventes.has(cleCase(l.cle, p.jours[6]!)));
  const jours = p.jours.slice(0, dimancheVendu ? 7 : 6);
  return {
    espace: p.espace,
    feuille: p.espace === "CUISINE" ? "Cuisine" : "Bar",
    titre: `Rapport journalier ${p.espace === "CUISINE" ? "cuisine" : "bar"} — semaine ${semaineIso(p.jours[0]!)}`,
    enteteDesignation: "Désignation/Date",
    colonnes: jours.map((j) => ({ entete: enteteJour(j), role: "vente" as const })),
    sections: enSections(
      p.lignes,
      (l) => l.rubrique,
      (l) => ({
        designation: l.inactif ? `${l.designation} (désactivé)` : l.designation,
        cases: jours.map((j) => ({ valeur: p.ventes.get(cleCase(l.cle, j)) ?? null })),
        // « (désactivé) » suit la ligne jusque sur la rangée du classeur (son libellé y est celui du classeur).
        cle: { rubrique: l.rubrique, noms: [l.designation], ...(l.inactif ? { mention: " (désactivé)" } : {}) },
      }),
    ),
  };
}

// ─── 1 bis. Consommation réelle du restaurant (articles) ─────────────────────

export type ArticleRapport = { id: string; designation: string; unite: string | null; categorie: string | null };

/** Case de consommation : la quantité si elle est connue (signalée si négative), sinon « — ». */
export function caseConso(c: ConsommationReelle): CaseFiche {
  return c.etat === "CONNUE" ? { valeur: Number(c.quantite), ecart: c.negative } : { valeur: null };
}

/**
 * Consommation réelle d'un espace du restaurant pour une semaine : la CONSOMMATION RÉELLE de chaque
 * article du restaurant (comptages), jour par jour — le contenu du « Rapport journalier » avant la
 * saisie des ventes, gardé sous son vrai nom. `jours` : les 7 jours (lundi → dimanche).
 * Comme le classeur, la fiche va du lundi au samedi ; le dimanche n'y est ajouté que s'il porte
 * une consommation connue — une donnée n'est jamais cachée pour tenir dans le modèle.
 * `articles` : articles ACTIFS de l'espace, dans l'ordre de l'écran « Stock restaurant ».
 */
export function ficheConsommationReelle(p: {
  espace: EspaceFiche;
  jours: string[];
  articles: ArticleRapport[];
  conso: (articleId: string, jour: string) => ConsommationReelle;
}): Fiche {
  const cases = new Map(p.articles.map((a) => [a.id, p.jours.map((j) => caseConso(p.conso(a.id, j)))]));
  const dimancheConnu = [...cases.values()].some((c) => c[6] !== undefined && c[6].valeur !== null);
  const nbJours = dimancheConnu ? 7 : 6;
  const libelle = p.espace === "CUISINE" ? "cuisine" : "bar";
  return {
    espace: p.espace,
    feuille: p.espace === "CUISINE" ? "Conso. réelle cuisine" : "Conso. réelle bar",
    titre: `Consommation réelle ${libelle} — semaine ${semaineIso(p.jours[0]!)}`,
    enteteDesignation: "Désignation/Date",
    colonnes: p.jours.slice(0, nbJours).map((j) => ({ entete: enteteJour(j), role: "conso" as const })),
    sections: enSections(
      p.articles,
      (a) => a.categorie?.trim() || SANS_RUBRIQUE,
      (a) => ({ designation: `${a.designation}${a.unite ? ` (${a.unite})` : ""}`, cases: cases.get(a.id)!.slice(0, nbJours) }),
    ),
  };
}

// ─── 2. Commande journalière ─────────────────────────────────────────────────

export type ArticleCommande = {
  id: string; designation: string; unite: string | null; categorie: string | null;
  /** Nom court saisi au catalogue (« Carré d'agneau »). */
  nomCourt?: string | null;
  /** Désignations des articles du restaurant (Stock restaurant) rattachés à cet article, actifs. */
  nomsRestaurant?: string[];
  /** Coché « Sur la fiche commande » (import du classeur ou Inventaire). */
  surFicheCommande?: boolean;
  /** Rang et rubrique du classeur « Commande journalière » (« Viande … — 1. Viande Rouge »). */
  ordreCommande?: number | null;
  rubriqueCommande?: string | null;
};

/**
 * Nom imprimé sur la fiche commande (demande de Sacha, 2026-09-29 : « la cuisine n'a pas besoin du
 * nom complet ») : le NOM COURT saisi au catalogue ; à défaut, le nom de l'article du restaurant
 * rattaché — s'il n'y en a qu'UN (deux rattachés : aucun n'est choisi au hasard) ; à défaut, la
 * désignation du catalogue. Rien n'est déduit du texte.
 */
export function nomImprime(a: Pick<ArticleCommande, "designation" | "nomCourt" | "nomsRestaurant">): string {
  const court = a.nomCourt?.trim();
  if (court) return court;
  const resto = (a.nomsRestaurant ?? []).map((n) => n.trim()).filter(Boolean);
  return resto.length === 1 ? resto[0]! : a.designation.trim();
}

/** Rubriques du classeur « PEF Commande Journalière », dans son ordre (le reste suit, alphabétique). */
export const RUBRIQUES_COMMANDE: Record<EspaceFiche, string[]> = {
  CUISINE: [
    "Viande -Volaille-Poisson-Crustacé", "Crèmerie-Fromagerie", "Pâtes", "Fruits & Légumes frais", "Épices et assaisonnements",
    "Autres", "Produits d'entretien & Autre non-alimentaire", "Boulangerie-Patisserie",
  ],
  BAR: [
    "Eau plate et petillante", "Limonade et autre", "Bière locale", "Bière importée", "Sirop", "Jus de fruit", "Apéritif",
    "Vin Blanc", "Vin Rosé", "Vin Rouge", "Vin Mousseux", "Champagne", "Digestif", "Cognac", "Gin, Vodka et Tequila", "Rhum", "Whisky", "Autres",
  ],
};
/** Titre de la rubrique des légumes frais, celui du classeur. */
export const RUBRIQUE_LEGUMES = "Fruits & Légumes frais";

const cleRubrique = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export type LegumeCommande = { designation: string; unite: string | null; commande: number | null; livraison: number | null };

const quantite = (q: number | null | undefined): ValeurFiche => (q ? q : "");

/**
 * Fiche commande d'un espace pour UN jour : pour chaque article, la quantité COMMANDÉE par le
 * restaurant (onglet Commande) et la quantité LIVRÉE (sorties « Livraison restaurant » du jour).
 * Case vide = rien commandé / rien livré ; unité absente du catalogue = « — ». Noms COURTS
 * (`nomImprime`), rubriques dans l'ordre du classeur « PEF Commande Journalière ».
 * Cuisine : colonne Unité et la rubrique « Fruits & Légumes frais » (commande de l'onglet Commande,
 * livraison = achats du jour, comme la Comparaison). Bar : pas de colonne Unité, comme le classeur.
 */
export function ficheCommandeJournaliere(p: {
  espace: EspaceFiche;
  date: string;
  articles: ArticleCommande[];
  commandes: Map<string, number>;
  livraisons: Map<string, number>;
  legumes?: LegumeCommande[];
}): Fiche {
  const cuisine = p.espace === "CUISINE";
  const colonnes: Fiche["colonnes"] = [
    ...(cuisine ? [{ entete: "Unité", role: null }] : []),
    { entete: "Commande", role: "cmd" },
    { entete: "Livraison", role: "liv" },
  ];
  // Unité : celle du catalogue, « — » quand elle n'y est pas renseignée.
  const ligne = (designation: string, unite: string | null, cmd: ValeurFiche, liv: ValeurFiche, cle: CleLigne): LigneFiche => ({
    designation,
    cases: [...(cuisine ? [{ valeur: unite?.trim() || null }] : []), { valeur: cmd }, { valeur: liv }],
    cle,
  });
  // Ordre du CLASSEUR : ses rubriques dans son ordre (puis les autres, alphabétiques ; « À classer »
  // en dernier) ; dans une rubrique, les lignes au rang du classeur, puis celles sans rang par nom ;
  // un article imprimé SANS être coché (il a une commande ou une livraison ce jour-là) ferme sa
  // rubrique. Une sous-rubrique (« Viande … — 1. Viande Rouge ») imprime sa rubrique au-dessus.
  const reference = RUBRIQUES_COMMANDE[p.espace].map(cleRubrique);
  const parentDe = (r: string) => r.split(SEPARATEUR_SOUS_RUBRIQUE)[0]!;
  const rang = (titre: string) => {
    if (titre === A_CLASSER) return Number.MAX_SAFE_INTEGER;
    const i = reference.indexOf(cleRubrique(parentDe(titre)));
    return i < 0 ? reference.length : i;
  };
  const INFINI = Number.POSITIVE_INFINITY;
  const compare = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });
  const items = p.articles.map((a) => ({
    a, nom: nomImprime(a),
    rubrique: a.rubriqueCommande?.trim() || a.categorie?.trim() || A_CLASSER,
    horsFiche: a.surFicheCommande === false,
    ordre: a.surFicheCommande === false ? INFINI : a.ordreCommande ?? INFINI,
  }));
  const premier = new Map<string, number>();
  for (const x of items) premier.set(x.rubrique, Math.min(premier.get(x.rubrique) ?? INFINI, x.ordre));
  const diff = (a: number, b: number) => (a === b ? 0 : a - b);
  // Rubrique : celles du classeur importé dans SON ordre (rang de leur première ligne) ; puis les
  // autres, dans l'ordre des rubriques du classeur de PEF, puis alphabétiques ; « À classer » en dernier.
  const cleRub = (r: string): [number, number] => {
    if (r === A_CLASSER) return [2, 0];
    const p = premier.get(r)!;
    return Number.isFinite(p) ? [0, p] : [1, rang(r)];
  };
  const tries = items.sort((x, y) => {
    const [gx, rx] = cleRub(x.rubrique), [gy, ry] = cleRub(y.rubrique);
    return gx - gy || diff(rx, ry) || compare(x.rubrique, y.rubrique)
      || Number(x.horsFiche) - Number(y.horsFiche) || diff(x.ordre, y.ordre) || compare(x.nom, y.nom);
  });
  const groupes = enSections(
    tries,
    (x) => x.rubrique,
    (x) => ligne(x.nom, x.a.unite, quantite(p.commandes.get(x.a.id)), quantite(p.livraisons.get(x.a.id)), {
      // Sous son nom imprimé (nom court importé du classeur), sa désignation ou son nom court.
      rubrique: x.rubrique, noms: [x.nom, x.a.designation, ...(x.a.nomCourt?.trim() ? [x.a.nomCourt] : [])],
    }),
  );
  if (cuisine && p.legumes?.length) {
    const legumes = {
      titre: RUBRIQUE_LEGUMES,
      lignes: p.legumes.map((l) => ligne(l.designation, l.unite, quantite(l.commande), quantite(l.livraison), { rubrique: RUBRIQUE_LEGUMES, noms: [l.designation], legume: true })),
    };
    // Des articles déjà rangés sous « Fruits & Légumes frais » : une seule rubrique, légumes à la suite.
    const meme = groupes.find((g) => cleRubrique(g.titre) === cleRubrique(RUBRIQUE_LEGUMES));
    if (meme) meme.lignes.push(...legumes.lignes);
    else {
      const i = groupes.findIndex((s) => rang(s.titre) > rang(RUBRIQUE_LEGUMES));
      groupes.splice(i < 0 ? groupes.length : i, 0, legumes);
    }
  }
  const sections: SectionFiche[] = [];
  let parentPrecedent: string | null = null;
  for (const g of groupes) {
    const k = g.titre.indexOf(SEPARATEUR_SOUS_RUBRIQUE);
    if (k < 0) { sections.push(g); parentPrecedent = null; continue; }
    const parent = g.titre.slice(0, k);
    if (parent !== parentPrecedent) sections.push({ titre: parent, lignes: [] });
    sections.push({ titre: g.titre.slice(k + SEPARATEUR_SOUS_RUBRIQUE.length), lignes: g.lignes });
    parentPrecedent = parent;
  }
  return {
    espace: p.espace,
    feuille: cuisine ? "Fiche commande cuisine" : "Fiche commande Bar",
    titre: `Commande ${cuisine ? "cuisine" : "bar"} — semaine ${semaineIso(p.date)}`,
    sousTitre: `Date : ${dateCourte(p.date)}`,
    enteteDesignation: cuisine ? "Désignation/Date" : "Désignation",
    colonnes,
    sections,
  };
}

/** Vrai quand la fiche commande porte au moins une quantité commandée ou livrée. */
export function ficheCommandeRemplie(f: Fiche): boolean {
  return f.sections.some((s) => s.lignes.some((l) => l.cases.some((c, i) => {
    const role = f.colonnes[i]?.role;
    return (role === "cmd" || role === "liv") && typeof c.valeur === "number";
  })));
}

/** Nom de feuille Excel d'une fiche commande de la semaine : « Lun 29 Cuisine », « Lun 29 Bar » (≤ 31 caractères). */
export function nomFeuilleJour(iso: string, espace: EspaceFiche): string {
  const d = jourPur(iso);
  return `${JOURS_COURTS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${espace === "CUISINE" ? "Cuisine" : "Bar"}`;
}

/**
 * Commande journalière de TOUTE une semaine : pour chaque jour (lundi → samedi, et le dimanche
 * seulement s'il porte une commande ou une livraison — une donnée n'est jamais cachée, un jour
 * vide n'est pas ajouté au modèle), les fiches du jour dans l'ordre des `espaces` (Cuisine puis
 * Bar). Chaque fiche prend le nom de feuille de son jour (« Lun 29 Cuisine »).
 * `jours` : les 7 jours de la semaine, dans l'ordre, chacun avec ses fiches (une par espace).
 */
export function fichesCommandeSemaine(jours: { date: string; fiches: Fiche[] }[], espaces: EspaceFiche[]): { date: string; fiches: Fiche[] }[] {
  return jours
    .filter((j) => jourPur(j.date).getUTCDay() !== 0 || j.fiches.some(ficheCommandeRemplie))
    .map((j) => ({ date: j.date, fiches: j.fiches.map((f, i) => ({ ...f, feuille: nomFeuilleJour(j.date, espaces[i]!) })) }));
}

// ─── Rendu : PDF (une partie par fiche) et Excel (une feuille par fiche) ─────

/** Couleurs des exports de la Conso. journalière : vert = commandé, rouge = livré, indigo = consommé, bleu canard = vendu. */
export const COULEUR_PDF: Record<Exclude<RoleColonne, null>, string> = { cmd: "#1B7F3B", liv: "#B42318", conso: "#3730A3", vente: "#0F766E" };
export const COULEUR_EXCEL: Record<Exclude<RoleColonne, null>, string> = { cmd: "FF1B7F3B", liv: "FFB42318", conso: "FF3730A3", vente: "FF0F766E" };

/** Texte d'une case dans le PDF : format maison, « — » pour l'inconnu, « (écart) » si négative. */
export function texteCase(c: CaseFiche): string {
  if (c.valeur === null) return "—";
  if (typeof c.valeur === "string") return c.valeur;
  const t = formaterNombre(c.valeur, { maximumFractionDigits: 3 });
  return c.ecart ? `${t} (écart)` : t;
}

/** Valeur d'une case dans l'Excel : un NOMBRE quand il est connu (calculable), sinon le texte. */
export function valeurExcel(c: CaseFiche): string | number {
  return c.valeur === null ? "—" : c.valeur;
}

/** Lignes à plat (rubriques comprises) et indices des lignes de rubrique. */
function aPlat<T>(f: Fiche, cellule: (c: CaseFiche) => T): { lignes: (string | T)[][]; sectionRows: number[] } {
  const lignes: (string | T)[][] = [];
  const sectionRows: number[] = [];
  for (const s of f.sections) {
    sectionRows.push(lignes.length);
    lignes.push([s.titre]);
    for (const l of s.lignes) lignes.push([l.designation, ...l.cases.map(cellule)]);
  }
  return { lignes, sectionRows };
}

/** Largeurs PDF : la désignation garde la place qu'il lui faut, les colonnes se partagent le reste. */
function largeurs(f: Fiche): Colonne[] {
  const n = f.colonnes.length;
  const designation = n >= 7 ? 30 : n >= 6 ? 34 : n === 3 ? 52 : 60;
  const reste = `${(100 - designation) / n}%`;
  return [
    { header: f.enteteDesignation, width: `${designation}%` },
    ...f.colonnes.map((c) => ({ header: c.entete, width: reste, align: (c.role ? "right" : "center") as "right" | "center" })),
  ];
}

/** Partie du PDF (une page ou plus, en-tête de colonnes répété) pour une fiche. */
export function partiePdf(f: Fiche): PartieTableau {
  const { lignes, sectionRows } = aPlat(f, texteCase);
  return {
    titre: f.titre,
    ...(f.sousTitre ? { sousTitre: f.sousTitre } : {}),
    colonnes: largeurs(f),
    lignes,
    sectionRows,
    couleurCellule: (r, c) => {
      // « — » reste discret : la couleur (et le gras) signale une quantité, pas son absence.
      const role = c > 0 && lignes[r]?.[c] !== "—" ? f.colonnes[c - 1]?.role : null;
      return role ? COULEUR_PDF[role] : undefined;
    },
  };
}

/**
 * Feuille Excel d'une fiche : même contenu, nombres calculables. Les rubriques sont des lignes
 * fusionnées, comme dans le classeur : pas d'autofiltre (un tri mélangerait les rubriques), le
 * volet reste figé sur la ligne des colonnes. Aucune ligne de total : le classeur n'en a pas.
 */
export function feuilleExcel(f: Fiche): {
  nom: string; titre: string; entete: string[]; lignes: (string | number)[][]; sectionRows: number[];
  couleurTexteCellule: (r: number, c: number) => string | undefined;
} {
  const { lignes, sectionRows } = aPlat(f, valeurExcel);
  const rubriques = new Set(sectionRows);
  return {
    nom: f.feuille,
    titre: f.sousTitre ? `${f.titre} — ${f.sousTitre}` : f.titre,
    entete: [f.enteteDesignation, ...f.colonnes.map((c) => c.entete)],
    lignes,
    sectionRows,
    couleurTexteCellule: (r, c) => {
      if (rubriques.has(r) || c === 0) return undefined;
      const role = f.colonnes[c - 1]?.role;
      return role ? COULEUR_EXCEL[role] : undefined;
    },
  };
}
