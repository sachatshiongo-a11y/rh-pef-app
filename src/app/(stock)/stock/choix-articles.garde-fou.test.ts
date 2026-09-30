// Garde-fou : plus AUCUNE liste déroulante <select> d'articles (ni de fournisseurs) dans l'espace
// Stock — on choisit en TAPANT le nom (`ChoixRecherche`, demande de la Direction du 2026-09-30 :
// « on doit pouvoir taper le nom de l'article pour le trouver dans les listes déroulantes »). Un
// <select> natif oblige à défiler 1 000 articles.
//
// Deux vérifications, dans les deux sens :
//  1. le NOMBRE de <select> de chaque fichier est recensé ci-dessous, avec la raison (motif, devise,
//     domaine, mois… : des listes COURTES et fermées). Un <select> de plus fait échouer le test : il
//     faut décider — article ou fournisseur : `ChoixRecherche` ; autre liste courte : la recenser ici ;
//  2. aucun <select> ne mentionne un article, un fournisseur ou un légume (id, désignation, liste
//     d'options), sauf les exceptions nommées (quelques propositions déjà rapprochées, pas le catalogue).
// La liste est lue dans le dépôt : un fichier recensé qui n'a plus de <select>, ou un écran du stock
// qui en gagne un, sont signalés.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(__dirname, "../../../..");
const STOCK = path.join(RACINE, "src/app/(stock)");

/** Les <select> qui restent : des listes courtes et fermées, jamais un choix d'article ou de fournisseur. */
const SELECTS_RECENSES: Record<string, { n: number; raison: string }> = {
  "src/app/(stock)/stock/entree/entree-client.tsx": { n: 1, raison: "domaine du nouvel article (Nourriture / Boisson / Autre)" },
  "src/app/(stock)/stock/reconciliation/page.tsx": { n: 1, raison: "filtre de domaine" },
  "src/app/(stock)/stock/journalier/import-classeur.tsx": { n: 1, raison: "« créer » ou « c'est telle fiche » parmi les 1 à 3 fiches proches déjà repérées" },
  "src/app/(stock)/stock/journalier/import-commande.tsx": { n: 1, raison: "6 propositions au plus (articles déjà rapprochés du classeur), pas le catalogue" },
  "src/app/(stock)/stock/journalier/menu-fiches-conso.tsx": { n: 1, raison: "jour de la fiche (7 jours)" },
  "src/app/(stock)/stock/mouvements/mouvements-client.tsx": { n: 1, raison: "motif de sortie (Perte / Livraison restaurant)" },
  "src/app/(stock)/stock/mouvements/page.tsx": { n: 2, raison: "filtres mois et motif" },
  "src/app/(stock)/stock/mouvements/changer-motif.tsx": { n: 1, raison: "motif" },
  "src/app/(stock)/stock/commandes/page.tsx": { n: 2, raison: "filtres année et mois" },
  "src/app/(stock)/stock/commandes/[id]/lier-facture.tsx": { n: 1, raison: "factures encore sans bon de commande (liste de documents, pas d'article)" },
  "src/app/(stock)/stock/commandes/[id]/page.tsx": { n: 1, raison: "statut du bon" },
  "src/app/(stock)/stock/imports/doublons-client.tsx": { n: 1, raison: "import d'inventaire à choisir (liste de fichiers importés)" },
  "src/app/(stock)/stock/archives/page.tsx": { n: 2, raison: "filtres entité et utilisateur" },
  "src/app/(stock)/stock/fiches/import-bar.tsx": { n: 3, raison: "unité de stock, unité de contenance, domaine du nouvel article" },
  "src/app/(stock)/stock/fiches/fiches-client.tsx": { n: 4, raison: "filtres catégorie / nature / état et type de la nouvelle fiche" },
  "src/app/(stock)/stock/factures/[id]/lier-bon.tsx": { n: 1, raison: "bons de commande à lier (liste de documents, pas d'article)" },
  "src/app/(stock)/stock/fiches/[id]/editer-fiche.tsx": { n: 1, raison: "type de la fiche (Plat / Bar)" },
  "src/app/(stock)/stock/factures/nouveau/nouveau-client.tsx": { n: 1, raison: "bon de commande à lier (liste de documents, pas d'article)" },
  "src/app/(stock)/stock/catalogue/catalogue-table.tsx": { n: 6, raison: "tri sur téléphone, domaine et catégorie (ajout), catégorie de l'action groupée, catégorie par ligne (tableau et carte) : listes courtes" },
  "src/app/(stock)/stock/catalogue/[id]/editer-article.tsx": { n: 2, raison: "unité de contenance et catégorie" },
};

/** Exceptions : <select> qui parlent d'articles, mais pour une poignée de propositions déjà faites. */
const EXCEPTIONS_ARTICLES = new Set(["src/app/(stock)/stock/journalier/import-commande.tsx"]);

// Un <select> qui parle d'un article, d'un fournisseur ou d'un légume.
const PARLE_D_ARTICLES = /articleId|fournisseurId|\barticles?\.map|\bfournisseurs?\.map|\bLEGUMES\b|name="(legume|source)"/;

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(RACINE, p).split(path.sep).join("/");
/** Source sans commentaires (les mots « <select> » des commentaires ne comptent pas). */
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const blocsSelect = (src: string) => sansCommentaires(src).match(/<select[\s\S]*?<\/select>/g) ?? [];

const tous = fichiers(STOCK).map(rel);
const nbSelects = (f: string) => blocsSelect(readFileSync(path.join(RACINE, f), "utf8")).length;

describe("garde-fou : plus de liste déroulante d'articles ni de fournisseurs dans le Stock", () => {
  it("chaque <select> du Stock est recensé (nombre exact), avec sa raison", () => {
    const relevé: Record<string, number> = {};
    for (const f of tous) { const n = nbSelects(f); if (n > 0) relevé[f] = n; }
    const attendu = Object.fromEntries(Object.entries(SELECTS_RECENSES).map(([f, v]) => [f, v.n]));
    expect(relevé).toEqual(attendu);
  });

  it("aucun <select> ne propose des articles, des fournisseurs ou des légumes (sauf exceptions nommées)", () => {
    const fautifs: string[] = [];
    for (const f of tous) {
      for (const bloc of blocsSelect(readFileSync(path.join(RACINE, f), "utf8"))) {
        if (PARLE_D_ARTICLES.test(bloc) && !EXCEPTIONS_ARTICLES.has(f)) fautifs.push(`${f} : ${bloc.slice(0, 90).replace(/\s+/g, " ")}…`);
      }
    }
    expect(fautifs, "utiliser <ChoixRecherche> (components/choix-recherche) au lieu d'un <select>").toEqual([]);
  });

  it("les exceptions nommées existent encore et ont encore un <select> d'articles (sinon les retirer)", () => {
    for (const f of EXCEPTIONS_ARTICLES) {
      expect(f in SELECTS_RECENSES, f).toBe(true);
      expect(blocsSelect(readFileSync(path.join(RACINE, f), "utf8")).some((b) => PARLE_D_ARTICLES.test(b)), f).toBe(true);
    }
  });

  it("l'heuristique reconnaît un <select> d'articles, et seulement lui", () => {
    const article = '<select value={l.articleId}>{articles.map((a) => <option key={a.id}>{a.designation}</option>)}</select>';
    const motif = '<select name="motif"><option value="PERTE">Perte</option></select>';
    expect(PARLE_D_ARTICLES.test(blocsSelect(article)[0]!)).toBe(true);
    expect(PARLE_D_ARTICLES.test(blocsSelect(motif)[0]!)).toBe(false);
    expect(blocsSelect("// <select>\n/* <select> */ <div/>")).toHaveLength(0);
  });

  it("le champ partagé existe et n'envoie jamais le texte tapé (aucun `name` sur le champ visible)", () => {
    const src = readFileSync(path.join(RACINE, "src/components/choix-recherche.tsx"), "utf8");
    expect(src).toContain('role="combobox"');
    expect(src).toMatch(/<input type="hidden" name=\{name\}/);
    expect(sansCommentaires(src)).not.toMatch(/backdrop-(blur|filter)/); // jamais sur un élément fixe (PWA iOS)
  });
});
