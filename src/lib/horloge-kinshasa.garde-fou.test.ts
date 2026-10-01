// Garde-fou de l'horloge (2026-10-01) : le jour, le mois, l'année et la semaine COURANTS se déduisent
// de l'horloge par `lib/heure-kinshasa.ts` (`jourCourantKinshasaISO`, `moisCourantKinshasa`,
// `anneeCouranteKinshasa`, `numeroMoisCourantKinshasa`, `jourCivilKinshasa`) — jamais par l'horloge
// BRUTE du serveur. Le serveur tourne en UTC, Kinshasa en UTC+1 : entre 00 h et 01 h, le 1er du mois,
// l'horloge brute dit encore le mois d'avant, alors que les sorties de stock, les pointages et le
// journal sont déjà datés du jour civil de Kinshasa (constaté à 00 h 19 WAT le 1er octobre : septembre
// affiché comme mois courant).
//
// Ce que le test interdit, dans `src/` hors tests :
//  1. `new Date().getUTCMonth()` & co (et leurs formes locales `getMonth()`, `getFullYear()`…) ;
//  2. `new Date().toISOString().slice(…)` et `new Date().toLocaleDateString(…)` : le jour d'un instant brut ;
//  3. une variable reçue de `new Date()` (sans argument) ou un paramètre `maintenant|now|aujourdhui: Date`
//     dont on lit ensuite l'année, le mois, le jour du mois ou le jour de la semaine ;
//  4. l'HEURE d'un instant lue à l'heure du serveur : `new Date(…).toLocaleString(` / `.toLocaleTimeString(`
//     sans `timeZone`, ou `.toLocaleDateString/TimeString/String(` sans `timeZone` sur une variable reçue de
//     `new Date()` (« généré le … à 05:28 » retardait d'une heure en permanence). À la place :
//     `dateHeureGenerationKinshasa`, `dateHeureKinshasa`, ou l'option `timeZone: "Africa/Kinshasa"`.
// À la place : `jourCivilKinshasa(maintenant)` (date pure de ce jour, à lire en UTC) ou l'une des
// fonctions « courant » ci-dessus.
//
// Le test se falsifie lui-même : `trouverHorlogeBrute` est éprouvée sur des sources écrites ici.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(__dirname, "../..");
const DOSSIERS = ["src/app", "src/lib", "src/components"];

// Le module des dates : le seul endroit autorisé à convertir l'horloge (liste fermée, nommée).
const EXCEPTIONS = new Set(["src/lib/heure-kinshasa.ts", "src/lib/dates-fr.ts"]);

const LECTURE = "(?:getUTC|get)(?:Month|FullYear|Date|Day)";

/** Retire les commentaires de ligne et de bloc (approximation suffisante pour du code TS/TSX du dépôt). */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}

function trouverHorlogeBrute(source: string): { ligne: number; extrait: string }[] {
  const code = sansCommentaires(source);
  const lignes = code.split("\n");
  const noms = new Set<string>();
  for (const m of code.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*new Date\(\)\s*;/g)) noms.add(m[1]);
  for (const m of code.matchAll(/\b(maintenant|now|aujourdhui)\s*:\s*Date\b/g)) noms.add(m[1]);

  // Règles qui ne valent que si la ligne ne fixe pas de fuseau.
  const sansFuseau: RegExp[] = [
    /new Date\([^)]*\)\s*\.\s*toLocale(?:Time)?String\(/,
    ...[...noms].map((n) => new RegExp(`\\b${n}\\s*\\.\\s*toLocale(?:Date|Time)?String\\(`)),
  ];
  const regles: RegExp[] = [
    new RegExp(`new Date\\(\\)\\s*\\.\\s*${LECTURE}\\(`),
    /new Date\(\)\s*\.\s*toISOString\(\)\s*\.\s*slice\(/,
    /new Date\(\)\s*\.\s*toLocaleDateString\(/,
    ...[...noms].map((n) => new RegExp(`\\b${n}\\s*\\.\\s*${LECTURE}\\(`)),
  ];
  const trouves: { ligne: number; extrait: string }[] = [];
  lignes.forEach((l, i) => {
    if (regles.some((r) => r.test(l)) || (!/timeZone/.test(l) && sansFuseau.some((r) => r.test(l)))) trouves.push({ ligne: i + 1, extrait: l.trim().slice(0, 140) });
  });
  return trouves;
}

function sources(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = path.join(dossier, nom);
    if (statSync(chemin).isDirectory()) { sortie.push(...sources(chemin)); continue; }
    if (!/\.(ts|tsx)$/.test(nom)) continue;
    if (/\.(test|integration\.test|garde-fou\.test|render\.test)\.tsx?$/.test(nom) || /\.test\.tsx?$/.test(nom)) continue;
    sortie.push(chemin);
  }
  return sortie;
}

describe("horloge brute interdite hors du module des dates", () => {
  it("aucun fichier de src/app, src/lib, src/components ne lit le mois, l'année ou le jour de l'horloge brute", () => {
    const fautes: string[] = [];
    let nbFichiers = 0;
    for (const d of DOSSIERS) {
      for (const f of sources(path.join(RACINE, d))) {
        const rel = path.relative(RACINE, f).split(path.sep).join("/");
        if (EXCEPTIONS.has(rel)) continue;
        nbFichiers++;
        for (const t of trouverHorlogeBrute(readFileSync(f, "utf8"))) fautes.push(`${rel}:${t.ligne}  ${t.extrait}`);
      }
    }
    expect(nbFichiers).toBeGreaterThan(300); // la liste est bien lue (pas un dossier vide qui passerait)
    expect(fautes, `Horloge brute (UTC) : utiliser lib/heure-kinshasa.ts\n${fautes.join("\n")}`).toEqual([]);
  });

  it("les exceptions nommées existent encore (une exception périmée est retirée de la liste)", () => {
    for (const e of EXCEPTIONS) expect(statSync(path.join(RACINE, e)).isFile(), e).toBe(true);
  });
});

describe("trouverHorlogeBrute — le détecteur lui-même (falsification)", () => {
  it("attrape la lecture directe de l'horloge brute", () => {
    expect(trouverHorlogeBrute("const m = new Date().getUTCMonth() + 1;")).toHaveLength(1);
    expect(trouverHorlogeBrute("const a = new Date().getFullYear();")).toHaveLength(1);
    expect(trouverHorlogeBrute("const j = new Date().toISOString().slice(0, 10);")).toHaveLength(1);
    expect(trouverHorlogeBrute('const j = new Date().toLocaleDateString("fr-FR");')).toHaveLength(1);
  });
  it("attrape la variable reçue de new Date() puis lue, et le paramètre « maintenant »", () => {
    expect(trouverHorlogeBrute("const now = new Date();\nconst m = now.getUTCMonth();")).toHaveLength(1);
    expect(trouverHorlogeBrute("let auj = new Date();\nconst j = auj.getUTCDate();")).toHaveLength(1); // quel que soit le nom
    expect(trouverHorlogeBrute("function f(maintenant: Date) { return maintenant.getUTCFullYear(); }")).toHaveLength(1);
    expect(trouverHorlogeBrute("function f(aujourdhui: Date) { return aujourdhui.getUTCDay(); }")).toHaveLength(1);
  });
  it("laisse passer ce qui passe par Kinshasa, les dates pures et les commentaires", () => {
    expect(trouverHorlogeBrute("const k = jourCivilKinshasa(new Date());\nconst m = k.getUTCMonth();")).toHaveLength(0);
    expect(trouverHorlogeBrute("const d = new Date(`${iso}T00:00:00Z`);\nconst m = d.getUTCMonth();")).toHaveLength(0);
    expect(trouverHorlogeBrute("// new Date().getUTCMonth() est interdit")).toHaveLength(0);
    expect(trouverHorlogeBrute("/* const now = new Date();\n now.getMonth() */")).toHaveLength(0);
    expect(trouverHorlogeBrute("const t = new Date().getTime();")).toHaveLength(0); // un instant, pas un jour
  });
  it("attrape l'heure lue à l'heure du serveur, accepte celle qui fixe le fuseau", () => {
    expect(trouverHorlogeBrute('const h = new Date(x).toLocaleString("fr-FR");')).toHaveLength(1);
    expect(trouverHorlogeBrute('const h = d.toLocaleTimeString("fr-FR", { hour: "2-digit" });\nconst d = new Date(x).toLocaleTimeString("fr-FR");')).toHaveLength(1);
    expect(trouverHorlogeBrute('const m = new Date();\nconst h = m.toLocaleTimeString("fr-FR", { hour: "2-digit" });')).toHaveLength(1);
    expect(trouverHorlogeBrute('const m = new Date();\nconst j = m.toLocaleDateString("fr-FR");')).toHaveLength(1);
    expect(trouverHorlogeBrute('const h = new Date(x).toLocaleString("fr-FR", { timeZone: "Africa/Kinshasa" });')).toHaveLength(0);
    expect(trouverHorlogeBrute('const m = new Date();\nconst h = m.toLocaleTimeString("fr-FR", { timeZone: "Africa/Kinshasa" });')).toHaveLength(0);
    expect(trouverHorlogeBrute('const j = new Date(x).toLocaleDateString("fr-FR");')).toHaveLength(0); // date pure stockée : se lit telle quelle
  });
});
