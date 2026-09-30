// Garde-fou de la décision d'argent de la Direction du 2026-09-29 : « la paie ne doit pas être
// affectée » — la pause PAR DÉFAUT d'un pointage n'est jamais déduite. Toutes les heures d'un
// pointage passent par UNE fonction, `heuresPayables` (`lib/pointage-jour.ts`), qui lit le drapeau
// `pauseParDefaut`. Ce test lit le CODE du dépôt : un fichier qui recalcule des heures en retirant
// `pauseMinutes` lui-même (le piège : « départ − arrivée − pauseMinutes » en oubliant le drapeau)
// le fait échouer, en nommant le fichier et la ligne.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(__dirname, "../..");
const SRC = path.join(RACINE, "src");

/** La fonction unique. */
const FONCTION_UNIQUE = "src/lib/pointage-jour.ts";
/**
 * L'import IVMS (`ajusterHeuresJour`) : une AUTRE pause — celle des pointeuses à empreinte (import
 * de rapport), décision client de 2026-07, toujours déduite. Ce n'est pas `Pointage.pauseMinutes`
 * (aucun pointage n'y est lu), et la décision du 2026-09-29 ne l'a pas changée (« rien d'autre ne
 * bouge »). Exception NOMMÉE, vérifiée ci-dessous : elle ne doit jamais toucher un pointage.
 */
const IMPORT_IVMS = "src/lib/pointage.ts";

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const p = path.join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (/\.(ts|tsx)$/.test(nom) && !/\.test\.(ts|tsx)$/.test(nom)) out.push(p);
  }
  return out;
}

/** Le code sans ses commentaires (un commentaire qui cite la règle n'est pas un calcul). */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Une ARITHMÉTIQUE sur une pause de pointage : « − pauseMinutes », « pauseMinutes / 60 », « × 60 000 ». */
const CALCUL_SUR_PAUSE = [
  /[-−]\s*\(?\s*[\w.!?]*\bpauseMinutes\b/,
  /\bpauseMinutes\b[\w\s.!?()]*[/*]\s*(60|3_?600|60_?000)\b/,
];

function calculsSurPause(source: string): number[] {
  return sansCommentaires(source)
    .split("\n")
    .flatMap((ligne, i) => (CALCUL_SUR_PAUSE.some((re) => re.test(ligne)) ? [i + 1] : []));
}

const tous = fichiers(SRC).map((p) => ({ rel: path.relative(RACINE, p).split(path.sep).join("/"), source: readFileSync(p, "utf8") }));

describe("garde-fou — les heures d'un pointage ne se calculent QUE dans heuresPayables", () => {
  it("le détecteur mord sur les formes du piège (et pas sur un commentaire)", () => {
    expect(calculsSurPause("const h = (fin - debut) / 3_600_000 - p.pauseMinutes / 60;")).toEqual([1]);
    expect(calculsSurPause("const h = ms / 3_600_000 - pointage.pauseMinutes / 60;")).toEqual([1]);
    expect(calculsSurPause("const net = brut - (p.pauseMinutes ?? 0) * 60_000;")).toEqual([1]);
    expect(calculsSurPause("heuresNettes(debut, fin, pauseMinutes)")).toEqual([]);
    expect(calculsSurPause("// départ - arrivée - pauseMinutes / 60")).toEqual([]);
    expect(calculsSurPause("data: { pauseMinutes: 0, pauseParDefaut: true }")).toEqual([]);
  });

  it("la liste des fichiers lus est complète (pages, écrans, moteur)", () => {
    const noms = tous.map((f) => f.rel);
    for (const attendu of [
      FONCTION_UNIQUE,
      "src/lib/pointage-scan.ts",
      "src/lib/pointage-cloture.ts",
      "src/app/(app)/pointer/pointer-client.tsx",
      "src/app/(app)/pointer/suivi/lignes-suivi.ts",
      "src/app/(app)/presences/page.tsx",
    ])
      expect(noms).toContain(attendu);
    expect(noms.length).toBeGreaterThan(200);
  });

  it("aucun fichier ne retire `pauseMinutes` lui-même, hors de la fonction unique (et de l'import IVMS, nommé)", () => {
    const fautifs = tous
      .filter((f) => f.rel !== FONCTION_UNIQUE && f.rel !== IMPORT_IVMS)
      .flatMap((f) => calculsSurPause(f.source).map((l) => `${f.rel}:${l}`));
    expect(fautifs, "calculer les heures d'un pointage : heuresPayables (lib/pointage-jour.ts)").toEqual([]);
  });

  it("la fonction unique retire la pause via pauseDeduiteMinutes, qui lit le drapeau `pauseParDefaut`", () => {
    const source = tous.find((f) => f.rel === FONCTION_UNIQUE)!.source;
    expect(source).toMatch(/export function pauseDeduiteMinutes\([^)]*\): number \{\s*if \(p\.pauseParDefaut\) return 0;/);
    expect(source).toMatch(/export function heuresPayables\(/);
    expect(source).toMatch(/- pauseDeduiteMinutes\(p\) \/ 60/);
  });

  it("l'exception IVMS ne touche jamais un pointage : aucune lecture du modèle Pointage ni du drapeau", () => {
    const source = sansCommentaires(tous.find((f) => f.rel === IMPORT_IVMS)!.source);
    expect(source).not.toMatch(/pauseParDefaut|\.pointage\.|PausePointage/);
    expect(calculsSurPause(tous.find((f) => f.rel === IMPORT_IVMS)!.source).length).toBeLessThanOrEqual(1);
  });

  it("plus aucune seconde fonction d'heures : `heuresNettes` a disparu, `heuresPayables` n'est définie qu'une fois", () => {
    const definitions = tous.filter((f) => /function heuresPayables\b|const heuresPayables\b/.test(f.source)).map((f) => f.rel);
    expect(definitions).toEqual([FONCTION_UNIQUE]);
    expect(tous.filter((f) => /\bheuresNettes\s*\(/.test(sansCommentaires(f.source))).map((f) => f.rel)).toEqual([]);
  });
});
