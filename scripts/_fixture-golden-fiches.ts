import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

/**
 * Fixture du classeur RÉEL de la Direction pour le test GOLDEN (`src/lib/fiches/golden.integration.test.ts`).
 *
 * POURQUOI UNE FIXTURE. « Fiche technique plats crash test.xlsx » pèse 57 Mo (images, styles) et
 * n'existe que sur la machine de Sacha : un golden qui en dépendrait ne tournerait nulle part
 * ailleurs — ni en CI, ni chez un autre développeur — et cesserait donc d'attraper les régressions
 * là où elles arrivent. On fige ici les seules données que le parseur lit : la VALEUR de chaque
 * cellule non vide de chaque onglet, plus le `!ref` d'origine. Aucune interprétation, aucun
 * arrondi, aucune reformulation : ce n'est pas un jeu de données inventé « à l'image » du
 * classeur, c'est le contenu du classeur, transcrit (≈ 46 Ko).
 *
 * PARITÉ GARANTIE. Le golden vérifie, quand le classeur réel est présent, que
 * `extraireCellules(classeur réel)` est STRICTEMENT ÉGAL à la fixture. Le jour où la Direction
 * modifie son classeur, ce test tombe et la fixture doit être régénérée :
 *
 *     npx tsx scripts/_fixture-golden-fiches.ts            (classeur au chemin par défaut)
 *     npx tsx scripts/_fixture-golden-fiches.ts "/chemin/classeur.xlsx"
 *
 * AUCUN ACCÈS BASE ici : ce module lit un fichier et écrit un JSON, rien d'autre.
 */

export const CHEMIN_CLASSEUR_REEL = "/Users/sachatshiongo/Downloads/Tableurs/Fiche technique plats crash test.xlsx";

/**
 * Emplacement de la fixture, résolu depuis la racine du dépôt (le script se lance de là).
 * Calculé DANS une fonction : ce module est aussi importé par un test, où l'on ne veut évaluer
 * aucun chemin de système de fichiers au chargement.
 */
export function cheminFixture(): string {
  return path.resolve(process.cwd(), "src", "lib", "fiches", "__fixtures__", "fiches-plats.json");
}

/** Valeur brute d'une cellule, telle que `xlsx` la restitue (`cell.v`). */
export type ValeurCellule = string | number | boolean;

export type FeuilleFixture = {
  /** Plage d'origine (`!ref`) : reprise telle quelle pour que le parseur balaie EXACTEMENT la même. */
  ref: string | null;
  /** Adresse A1 → valeur, cellules vides omises. */
  cellules: Record<string, ValeurCellule>;
};

export type FixtureClasseur = {
  /** Nom du fichier source, pour la traçabilité du rapport. */
  source: string;
  /** Ordre des onglets : il détermine l'ordre de lecture des fiches, donc l'ordre en base. */
  sheetNames: string[];
  sheets: Record<string, FeuilleFixture>;
};

/** Lit le classeur (valeurs seules : ni formules, ni styles — le parseur n'en lit aucun). */
export function lireClasseurReel(chemin = CHEMIN_CLASSEUR_REEL): XLSX.WorkBook {
  return XLSX.readFile(chemin, { cellFormula: false, cellHTML: false, cellStyles: false, bookDeps: false });
}

/**
 * Transcrit un classeur en fixture. Les valeurs non scalaires (dates) seraient converties en
 * texte : le classeur n'en contient aucune, et une apparition future serait visible dans le diff
 * du JSON plutôt que silencieuse.
 */
export function extraireCellules(wb: XLSX.WorkBook, source: string): FixtureClasseur {
  const sheets: Record<string, FeuilleFixture> = {};
  for (const nom of wb.SheetNames) {
    const ws = wb.Sheets[nom];
    const cellules: Record<string, ValeurCellule> = {};
    if (ws) {
      for (const [adresse, cell] of Object.entries(ws)) {
        if (adresse.startsWith("!")) continue;
        const v = (cell as XLSX.CellObject).v;
        if (v === undefined || v === null) continue;
        cellules[adresse] =
          typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v);
      }
    }
    sheets[nom] = { ref: (ws?.["!ref"] as string | undefined) ?? null, cellules };
  }
  return { source, sheetNames: [...wb.SheetNames], sheets };
}

/**
 * Reconstruit un `WorkBook` à partir de la fixture. Le parseur ne lit que `!ref` et `cell.v` :
 * le classeur reconstruit lui est donc indiscernable de l'original (c'est ce que le test de
 * parité vérifie, plutôt que de le supposer).
 */
export function classeurDepuisFixture(fixture: FixtureClasseur): XLSX.WorkBook {
  const Sheets: Record<string, XLSX.WorkSheet> = {};
  for (const nom of fixture.sheetNames) {
    const feuille = fixture.sheets[nom];
    const ws: XLSX.WorkSheet = {};
    for (const [adresse, v] of Object.entries(feuille?.cellules ?? {})) {
      ws[adresse] = { t: typeof v === "number" ? "n" : typeof v === "boolean" ? "b" : "s", v };
    }
    if (feuille?.ref) ws["!ref"] = feuille.ref;
    Sheets[nom] = ws;
  }
  return { SheetNames: [...fixture.sheetNames], Sheets };
}

// ─── Génération (CLI) ────────────────────────────────────────────────────────

function main() {
  const chemin = process.argv[2] ?? CHEMIN_CLASSEUR_REEL;
  if (!fs.existsSync(chemin)) {
    console.error(`Classeur introuvable : ${chemin}`);
    process.exit(1);
  }
  const cible = cheminFixture();
  const fixture = extraireCellules(lireClasseurReel(chemin), path.basename(chemin));
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  fs.writeFileSync(cible, `${JSON.stringify(fixture, null, 1)}\n`, "utf8");
  const cellules = Object.values(fixture.sheets).reduce((n, f) => n + Object.keys(f.cellules).length, 0);
  console.log(`Fixture écrite : ${cible}`);
  console.log(`  ${fixture.sheetNames.length} onglet(s), ${cellules} cellule(s), ${Math.round(fs.statSync(cible).size / 1024)} Ko`);
}

// Exécution directe uniquement (jamais lors d'un import par le test golden).
if (process.argv[1] && process.argv[1].endsWith("_fixture-golden-fiches.ts")) main();
