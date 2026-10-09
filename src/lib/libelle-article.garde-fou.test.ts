// Garde-fou de source : le nom d'un article du catalogue s'AFFICHE par `libelleArticle` (désignation +
// contenance si le nom ne la porte pas — demande de la Direction du 2026-10-09), jamais par la
// désignation brute ; et la désignation brute reste la CLÉ (classeurs, anti-doublon, imports, audit).
//
// Trois vérifications :
//  1. RECENSEMENT : dans les écrans, composants et PDF, chaque lecture `.designation` restante est
//     comptée fichier par fichier, avec sa raison. Une lecture de plus fait échouer le test : il faut
//     décider — nom affiché : `libelleArticle` (ou `libelleLigneArticle` pour une ligne de document) ;
//     clé, import, champ modifiable, nom déjà calculé en amont : la recenser ici avec sa raison ;
//  2. LECTURES PRISMA : partout dans src/, un `article: { select: { … designation: true … } }` lit
//     aussi la contenance (ou `CHAMPS_LIBELLE`) — sans elle, le libellé ne peut pas être complet —
//     sauf exceptions nommées (imports, rapprochements) ;
//  3. BRANCHEMENTS : les écrans, PDF, exports et notifications branchés appellent toujours le libellé
//     (un retour en arrière silencieux fait échouer le test).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(__dirname, "../..");
const RACINES_AFFICHAGE = ["src/app/(stock)", "src/app/(exploitation)", "src/components", "src/lib/pdf"];

type Raison = "CLE" | "IMPORT" | "AUDIT_ACTION" | "FORMULAIRE" | "AMONT" | "RESTO" | "FIGE" | "LEGUMES" | "VENTES";
const RAISONS: Record<Raison, string> = {
  CLE: "clé : rapprochement, tri, recherche, classeur de la Direction, articles proches (anti-doublon)",
  IMPORT: "import (classeur, PDF, CSV) : le nom lu se compare à la désignation brute",
  AUDIT_ACTION: "action serveur : clés d'anti-doublon, écriture, journal d'audit « avant → après » (la vraie désignation)",
  FORMULAIRE: "champ modifiable ou donnée transportée vers l'écran (qui calcule le libellé) : y écrire la contenance la réécrirait en base",
  AMONT: "le champ porte DÉJÀ le libellé, calculé en amont par `libelleArticle` (chargeur, lib, page serveur)",
  RESTO: "article du RESTAURANT (ArticleResto), qui a son propre nom",
  FIGE: "document figé : comptage archivé, ligne libre de bon (sans article), palmarès des lignes de bon",
  LEGUMES: "légumes frais : liste fixe, pas des articles du catalogue",
  VENTES: "plats vendus (fiches), pas des articles du catalogue",
};

/** Lectures `.designation` restantes, par fichier : nombre exact et raison(s). */
const RECENSES: Record<string, { n: number; raisons: Raison[] }> = {
  "src/app/(stock)/stock/_tableau-de-bord/bloc-dlc-proches.tsx": { n: 1, raisons: ["AMONT"] }, // lib/dlc-stock
  "src/app/(stock)/stock/a-valider/detail-demande.tsx": { n: 3, raisons: ["AMONT"] }, // validations-stock/apercu
  "src/app/(stock)/stock/archives/[id]/page.tsx": { n: 1, raisons: ["FIGE"] },
  "src/app/(stock)/stock/catalogue/[id]/editer-article.tsx": { n: 2, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/catalogue/[id]/page.tsx": { n: 2, raisons: ["FORMULAIRE"] }, // valeur du formulaire + infobulle « nom enregistré »
  "src/app/(stock)/stock/catalogue/_view.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/catalogue/actions.ts": { n: 8, raisons: ["AUDIT_ACTION"] },
  "src/app/(stock)/stock/catalogue/catalogue-table.tsx": { n: 5, raisons: ["FORMULAIRE", "CLE"] }, // nom modifiable (contenance à côté) + tri
  "src/app/(stock)/stock/commandes/[id]/modifier/page.tsx": { n: 2, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/commandes/[id]/page.tsx": { n: 1, raisons: ["FIGE"] },
  "src/app/(stock)/stock/commandes/[id]/reception-client.tsx": { n: 2, raisons: ["AMONT"] },
  "src/app/(stock)/stock/commandes/actions.ts": { n: 5, raisons: ["AUDIT_ACTION"] },
  "src/app/(stock)/stock/commandes/nouveau/nouveau-client.tsx": { n: 2, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/commandes/nouveau/page.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/entree/actions.ts": { n: 24, raisons: ["AUDIT_ACTION"] },
  "src/app/(stock)/stock/entree/alertes-ligne.tsx": { n: 2, raisons: ["FORMULAIRE"] }, // nom tapé d'un nouvel article
  "src/app/(stock)/stock/entree/entree-client.tsx": { n: 5, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/entree/entree-telephone.tsx": { n: 5, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/entree/page.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/factures/[id]/page.tsx": { n: 5, raisons: ["CLE", "FIGE"] }, // clé du rapprochement bon/facture, ligne libre
  "src/app/(stock)/stock/factures/actions.ts": { n: 6, raisons: ["IMPORT", "AUDIT_ACTION"] },
  "src/app/(stock)/stock/factures/nouveau/nouveau-client.tsx": { n: 4, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/factures/nouveau/page.tsx": { n: 2, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/fiches/[id]/disponibilite-fiche.tsx": { n: 2, raisons: ["AMONT"] }, // lib/fiches/disponibilite
  "src/app/(stock)/stock/fiches/_data/charger-fiche.ts": { n: 2, raisons: ["FORMULAIRE", "RESTO"] },
  "src/app/(stock)/stock/fiches/import-bar-actions.ts": { n: 6, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/fiches/import-bar.tsx": { n: 9, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/imports/import-client.tsx": { n: 1, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/journalier/commande-grid.tsx": { n: 9, raisons: ["AMONT"] }, // journalier/page
  "src/app/(stock)/stock/journalier/comparaison-jour.tsx": { n: 3, raisons: ["AMONT"] },
  "src/app/(stock)/stock/journalier/comparaison-semaine.tsx": { n: 3, raisons: ["AMONT"] },
  "src/app/(stock)/stock/journalier/conso-jour.tsx": { n: 3, raisons: ["AMONT", "RESTO"] },
  "src/app/(stock)/stock/journalier/fiches-data.ts": { n: 3, raisons: ["CLE", "LEGUMES", "RESTO"] }, // fiche « Commande journalière » = classeur de la Direction
  "src/app/(stock)/stock/journalier/import-classeur-actions.ts": { n: 1, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/journalier/import-commande-actions.ts": { n: 1, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/journalier/table-conso.tsx": { n: 3, raisons: ["AMONT", "RESTO"] },
  "src/app/(stock)/stock/journalier/ventes-grid.tsx": { n: 9, raisons: ["VENTES"] },
  "src/app/(stock)/stock/mouvements/actions.ts": { n: 4, raisons: ["CLE"] }, // articles proches
  "src/app/(stock)/stock/mouvements/mouvements-client.tsx": { n: 5, raisons: ["AMONT", "CLE"] }, // mouvements/page (versLite) + articles proches
  "src/app/(stock)/stock/mouvements/page.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/page.tsx": { n: 3, raisons: ["AMONT", "FIGE"] }, // indicateurs/stock + palmarès des lignes de bon
  "src/app/(stock)/stock/recherche/page.tsx": { n: 2, raisons: ["CLE"] },
  "src/app/(stock)/stock/reconciliation/fiche/charger-articles.ts": { n: 1, raisons: ["CLE"] },
  "src/app/(stock)/stock/reconciliation/page.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/reconciliation/reconciliation-client.tsx": { n: 2, raisons: ["CLE"] },
  "src/app/(stock)/stock/restaurant/actions.ts": { n: 3, raisons: ["RESTO"] },
  "src/app/(stock)/stock/restaurant/bandeau-livraisons.tsx": { n: 6, raisons: ["AMONT", "RESTO"] }, // stock-restaurant-charger, rattachement-auto
  "src/app/(stock)/stock/restaurant/choix-article.tsx": { n: 2, raisons: ["AMONT"] }, // restaurant/page
  "src/app/(stock)/stock/restaurant/export-data.ts": { n: 1, raisons: ["RESTO"] },
  "src/app/(stock)/stock/restaurant/page.tsx": { n: 1, raisons: ["RESTO"] },
  "src/app/(stock)/stock/restaurant/restaurant-client.tsx": { n: 12, raisons: ["RESTO"] },
  "src/app/(stock)/stock/restaurant/restaurant-ecran.tsx": { n: 2, raisons: ["AMONT"] },
  "src/app/(exploitation)/exploitation/page.tsx": { n: 2, raisons: ["AMONT"] }, // indicateurs/stock
  "src/lib/pdf/fiche-achat-legumes.tsx": { n: 1, raisons: ["LEGUMES"] },
  "src/lib/pdf/fiche-inventaire-resto.tsx": { n: 2, raisons: ["RESTO"] },
};

/** Lectures Prisma de la désignation SANS la contenance : seulement là où le nom sert de clé. */
const SELECTS_SANS_CONTENANCE: Record<string, string> = {
  "src/lib/import-inventaire.ts": "import d'inventaire : fiches qui utilisent un article à supprimer (message d'import)",
  "src/lib/rattachement-auto.ts": "rattachement au restaurant : « rattaché à » sert à la règle (homonymes), pas à l'affichage du catalogue",
  "src/lib/doublons-imports.ts": "doublons d'import : rapprochement des mouvements importés",
};

/** Fichiers branchés sur le libellé : ils doivent l'appeler (écrans, PDF, exports, notifications, recherche). */
const BRANCHES = [
  // Inventaire / catalogue
  "src/app/(stock)/stock/catalogue/[id]/page.tsx", "src/app/(stock)/stock/catalogue/[id]/pdf/route.ts",
  "src/app/(stock)/stock/catalogue/catalogue-table.tsx", "src/app/(stock)/stock/catalogue/export/route.ts",
  "src/app/(stock)/stock/catalogue/imprimer/page.tsx", "src/app/(stock)/stock/catalogue/pdf/route.ts",
  "src/app/(stock)/stock/cloture/inventaire/route.ts", "src/lib/filtre-inventaire.ts",
  // Liste d'achat
  "src/app/(stock)/stock/entree/page.tsx", "src/app/(stock)/stock/entree/entree-client.tsx", "src/app/(stock)/stock/entree/entree-telephone.tsx",
  "src/app/(stock)/stock/entree/alertes-ligne.tsx", "src/components/stock/choix-article-proche.tsx", "src/lib/achats-liste-serveur.ts",
  // Mouvements + notifications
  "src/app/(stock)/stock/mouvements/page.tsx", "src/app/(stock)/stock/mouvements/mouvements-client.tsx",
  "src/lib/validations-stock/mouvement.ts", "src/lib/validations-stock/date-sortie.ts", "src/lib/validations-stock/stock-positif.ts", "src/lib/alerte-stock.ts",
  // Bons de commande, factures
  "src/app/(stock)/stock/commandes/[id]/page.tsx", "src/lib/pdf/bon-commande.tsx", "src/app/(stock)/stock/commandes/nouveau/nouveau-client.tsx",
  "src/app/(stock)/stock/factures/[id]/page.tsx", "src/app/(stock)/stock/factures/nouveau/nouveau-client.tsx", "src/app/(stock)/stock/factures/actions.ts",
  // Fiches techniques
  "src/app/(stock)/stock/fiches/[id]/editer-fiche.tsx", "src/app/(stock)/stock/fiches/_data/fiche-calc.ts", "src/lib/fiches/disponibilite.ts",
  // Réconciliation
  "src/app/(stock)/stock/reconciliation/reconciliation-client.tsx", "src/app/(stock)/stock/reconciliation/fiche/comptage-data.ts",
  "src/app/(stock)/stock/reconciliation/fiche/charger-articles.ts",
  // Conso. journalière
  "src/app/(stock)/stock/journalier/page.tsx", "src/app/(stock)/stock/journalier/export-data.ts", "src/app/(stock)/stock/journalier/donnees-restaurant.ts",
  // Stock restaurant
  "src/app/(stock)/stock/restaurant/page.tsx", "src/lib/stock-restaurant-charger.ts", "src/lib/rattachement-auto.ts",
  // À valider
  "src/lib/validations-stock/apercu.ts",
  // Tableau de bord, fournisseurs, recherche, rapports
  "src/app/(stock)/stock/page.tsx", "src/lib/indicateurs/stock.ts", "src/lib/dlc-stock.ts",
  "src/app/(stock)/stock/fournisseurs/[id]/page.tsx", "src/app/(stock)/stock/recherche/page.tsx", "src/lib/rapports.ts",
  // Choix d'article partagé (ChoixRecherche)
  "src/lib/recherche-options.ts",
];

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/\.fixture\.ts$/.test(n) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(RACINE, p).split(path.sep).join("/");
/** Source sans commentaires (les mots des commentaires ne comptent pas). */
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
/** Lectures de la désignation : `x.designation`, `x?.designation`, `x!.designation`. */
const lecturesDesignation = (src: string) => (sansCommentaires(src).match(/\.designation\b/g) ?? []).length;
/** Sélections Prisma d'un article qui lisent la désignation sans la contenance. */
const selectsSansContenance = (src: string) =>
  (sansCommentaires(src).match(/\b(?:article|articleStock)\s*:\s*\{\s*select\s*:\s*\{[^{}]*\}/g) ?? [])
    .filter((b) => /\bdesignation\s*:\s*true\b/.test(b) && !/contenance|CHAMPS_LIBELLE/.test(b));
/** Appelle-t-il le libellé ? */
const appelleLeLibelle = (src: string) => /\b(?:libelleArticle|libelleLigneArticle|optionsArticles|complementLibelle)\s*\(/.test(sansCommentaires(src));

const lire = (f: string) => readFileSync(path.join(RACINE, f), "utf8");

describe("garde-fou : le nom d'un article s'affiche par libelleArticle (contenance comprise)", () => {
  it("chaque lecture `.designation` des écrans, composants et PDF est recensée (nombre exact) avec sa raison", () => {
    const releve: Record<string, number> = {};
    for (const r of RACINES_AFFICHAGE) for (const p of fichiers(path.join(RACINE, r))) {
      const n = lecturesDesignation(readFileSync(p, "utf8"));
      if (n > 0) releve[rel(p)] = n;
    }
    const attendu = Object.fromEntries(Object.entries(RECENSES).map(([f, v]) => [f, v.n]));
    expect(releve, "nom affiché : libelleArticle(a) ; sinon recenser la lecture ici avec sa raison").toEqual(attendu);
    for (const v of Object.values(RECENSES)) for (const r of v.raisons) expect(RAISONS[r]).toBeTruthy();
  });

  it("une lecture Prisma de la désignation d'un article lit aussi sa contenance (sauf clés nommées)", () => {
    const fautifs: string[] = [];
    for (const p of fichiers(path.join(RACINE, "src"))) {
      const f = rel(p);
      const blocs = selectsSansContenance(readFileSync(p, "utf8"));
      if (blocs.length > 0 && !(f in SELECTS_SANS_CONTENANCE)) fautifs.push(`${f} : ${blocs[0]!.replace(/\s+/g, " ").slice(0, 100)}`);
    }
    expect(fautifs, "sélectionner CHAMPS_LIBELLE (designation + contenance) pour afficher le libellé").toEqual([]);
    for (const f of Object.keys(SELECTS_SANS_CONTENANCE)) expect(selectsSansContenance(lire(f)).length, `${f} : exception devenue inutile`).toBeGreaterThan(0);
  });

  it("les écrans, PDF, exports, notifications et la recherche branchés appellent toujours le libellé", () => {
    const debranches = BRANCHES.filter((f) => !existsSync(path.join(RACINE, f)) || !appelleLeLibelle(lire(f)));
    expect(debranches).toEqual([]);
  });

  it("les clés restent sur la désignation BRUTE : anti-doublon, imports, classeurs, audit", () => {
    // Anti-doublon et rapprochements : aucune trace du libellé.
    for (const f of ["src/lib/article-proche.ts", "src/lib/achats-doublons.ts", "src/lib/article-match.ts", "src/lib/import-inventaire.ts",
      "src/lib/import-mouvements.ts", "src/lib/classeur-commande.ts", "src/lib/fiches/classeur-bar.ts", "src/lib/fiches/rattachement-resto.ts",
      "src/lib/fiches-conso.ts", "src/lib/modeles-journaliers/index.ts", "src/lib/audit.ts"]) {
      expect(/libelle-article|libelleArticle|libelleLigneArticle/.test(sansCommentaires(lire(f))), f).toBe(false);
    }
    // Le journal d'audit d'une création, d'une fusion, d'une suppression écrit la vraie désignation.
    const actions = sansCommentaires(lire("src/app/(stock)/stock/catalogue/actions.ts"));
    expect(actions).toMatch(/champ: "suppression", ancienneValeur: a\.designation/);
    expect(actions).not.toMatch(/libelleArticle/);
    // La désignation n'est jamais réécrite avec le libellé (aucune écriture `designation: libelle…`).
    for (const p of fichiers(path.join(RACINE, "src"))) {
      const s = sansCommentaires(readFileSync(p, "utf8"));
      expect(/data\s*:\s*\{[^}]*designation\s*:\s*libelle(?:Article|LigneArticle)\(/.test(s), rel(p)).toBe(false);
    }
  });

  it("l'heuristique reconnaît une lecture brute, une sélection sans contenance et un branchement — et elles seules", () => {
    expect(lecturesDesignation("<td>{a.designation}</td>")).toBe(1);
    expect(lecturesDesignation("<td>{a?.designation ?? '—'}</td> {b!.designation}")).toBe(2);
    expect(lecturesDesignation("// a.designation\n/* b.designation */ <td>{libelleArticle(a)}</td>")).toBe(0);
    expect(lecturesDesignation('orderBy: { designation: "asc" }, select: { designation: true }')).toBe(0);
    expect(selectsSansContenance("include: { article: { select: { designation: true, unite: true } } }")).toHaveLength(1);
    expect(selectsSansContenance("include: { article: { select: { ...CHAMPS_LIBELLE, unite: true } } }")).toHaveLength(0);
    expect(selectsSansContenance("include: { article: { select: { designation: true, contenance: true, contenanceUnite: true } } }")).toHaveLength(0);
    expect(selectsSansContenance("include: { article: { select: { unite: true } } }")).toHaveLength(0);
    expect(appelleLeLibelle("const t = libelleArticle(a);")).toBe(true);
    expect(appelleLeLibelle("// libelleArticle(a)\nconst t = a.designation;")).toBe(false);
  });
});
