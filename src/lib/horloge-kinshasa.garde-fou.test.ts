// Garde-fou de l'horloge (2026-10-01) : le jour, le mois, l'année, l'heure et la semaine COURANTS se
// déduisent de l'horloge par `lib/heure-kinshasa.ts` (`jourCourantKinshasaISO`, `moisCourantKinshasa`,
// `anneeCouranteKinshasa`, `numeroMoisCourantKinshasa`, `jourCivilKinshasa`, `dateHeureGenerationKinshasa`)
// — jamais par l'horloge BRUTE du serveur. Le serveur tourne en UTC, Kinshasa en UTC+1 : entre 00 h et
// 01 h, le 1er du mois, l'horloge brute dit encore le mois d'avant, alors que les sorties de stock, les
// pointages et le journal sont déjà datés du jour civil de Kinshasa (constaté à 00 h 19 WAT le 1er
// octobre : septembre affiché comme mois courant).
//
// Le détecteur lit le code comme un ARBRE (compilateur TypeScript), pas ligne à ligne : retours à la ligne,
// annotations, absence de point-virgule, chaînes sur plusieurs lignes ne le trompent pas. Est « horloge
// brute » : `new Date()` (sans argument), `Date.now()`, `new Date(…)` construit à partir de l'un d'eux ou
// d'une variable brute, une variable/un paramètre initialisé par l'un d'eux (ou paramètre `Date` nommé
// maintenant, now, aujourdhui, today, auj…). Interdit sur une horloge brute :
//  - lire ou écrire le calendrier : getUTC/get + FullYear|Month|Date|Day|Hours|Minutes|Seconds, set…,
//    toDateString, toTimeString ;
//  - toLocale(Date|Time)?String sans `timeZone: "Africa/Kinshasa"` ;
//  - toISOString().slice / .split / .substring / .substr (le jour d'un instant UTC) ;
//  - Intl.DateTimeFormat(…).format / formatToParts sans fuseau de Kinshasa ;
//  - la passer à moisDe, lundiDe, pariteSemaine, compterFamille, ancienneteEnMois (qui lisent une date PURE),
//    ou à une fonction LOCALE de formatage qui lit le calendrier de son paramètre (ex. `fr(new Date())`).
// À la place : `jourCivilKinshasa(maintenant)` (date pure de ce jour de Kinshasa, à lire en UTC) ou l'une
// des fonctions « courant » ci-dessus. Le détecteur est éprouvé sur des sources écrites ici (falsification).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const RACINE = path.resolve(__dirname, "../..");
const DOSSIERS = ["src/app", "src/lib", "src/components"];

// Le module des dates : le seul endroit autorisé à convertir l'horloge (liste fermée, nommée).
const EXCEPTIONS = new Set(["src/lib/heure-kinshasa.ts", "src/lib/dates-fr.ts"]);

const CALENDRIER = /^(?:get(?:UTC)?(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds)|set(?:UTC)?(?:FullYear|Month|Date|Hours|Minutes|Seconds)|toDateString|toTimeString)$/;
const LOCALE = /^toLocale(?:Date|Time)?String$/;
const DECOUPE_ISO = /^(?:slice|split|substring|substr)$/;
const PARAMETRE_INSTANT = /^(?:maintenant|now|aujourdhui|today|auj|ajd|instant|horloge)$/;
const ATTEND_UN_JOUR_CIVIL = new Set(["moisDe", "lundiDe", "pariteSemaine", "compterFamille", "ancienneteEnMois"]);

type Faute = { ligne: number; extrait: string };

function trouverHorlogeBrute(source: string, nom = "x.tsx"): Faute[] {
  const sf = ts.createSourceFile(nom, source, ts.ScriptTarget.Latest, true, nom.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const fautes: Faute[] = [];
  const signale = (n: ts.Node) => {
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    if (!fautes.some((f) => f.ligne === line + 1)) fautes.push({ ligne: line + 1, extrait: n.getText(sf).split("\n")[0].slice(0, 140) });
  };
  const nomDe = (n: ts.Node) => (ts.isIdentifier(n) ? n.text : "");
  const mentionneKinshasa = (n: ts.Node | undefined) => !!n && /Kinshasa/.test(n.getText(sf));

  // — Portées : chaque nom est résolu dans la portée déclarante la plus proche.
  const estPortee = (n: ts.Node) => ts.isBlock(n) || ts.isSourceFile(n) || ts.isFunctionLike(n) || ts.isCaseClause(n) || ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n);
  const porteeDe = (n: ts.Node): ts.Node => { let p: ts.Node = n.parent; while (!estPortee(p)) p = p.parent; return p; };
  type Decl = { initialiseur?: ts.Expression; parametre?: ts.ParameterDeclaration; fonction?: ts.Node };
  const declarations = new Map<ts.Node, Map<string, Decl>>();
  const declare = (portee: ts.Node, nom: string, d: Decl) => {
    if (!declarations.has(portee)) declarations.set(portee, new Map());
    declarations.get(portee)!.set(nom, d);
  };
  const collecter = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      declare(porteeDe(n), n.name.text, { initialiseur: n.initializer, fonction: n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) ? n.initializer : undefined });
    } else if (ts.isParameter(n) && ts.isIdentifier(n.name)) {
      declare(n.parent, n.name.text, { initialiseur: n.initializer, parametre: n });
    } else if (ts.isFunctionDeclaration(n) && n.name) {
      declare(porteeDe(n), n.name.text, { fonction: n });
    }
    ts.forEachChild(n, collecter);
  };
  collecter(sf);
  const resoudre = (id: ts.Identifier): Decl | undefined => {
    for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
      const d = declarations.get(p)?.get(id.text);
      if (d) return d;
    }
    return undefined;
  };

  // — « Horloge brute » (avec garde contre les définitions circulaires).
  const enCours = new Set<ts.Node>();
  const contientHorloge = (n: ts.Node): boolean => {
    let trouve = false;
    const visite = (x: ts.Node) => { if (!trouve) { if (estHorloge(x)) trouve = true; else ts.forEachChild(x, visite); } };
    visite(n);
    return trouve;
  };
  const estHorloge = (n: ts.Node | undefined): boolean => {
    if (!n) return false;
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) return estHorloge(n.expression);
    if (ts.isNewExpression(n) && nomDe(n.expression) === "Date") return !n.arguments || n.arguments.length === 0 || n.arguments.some((a) => contientHorloge(a));
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && nomDe(n.expression.expression) === "Date" && n.expression.name.text === "now") return true;
    if (ts.isConditionalExpression(n)) return estHorloge(n.whenTrue) || estHorloge(n.whenFalse);
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return estHorloge(n.left) || estHorloge(n.right);
    if (ts.isIdentifier(n)) {
      const d = resoudre(n);
      if (!d || enCours.has(n)) return false;
      if (d.parametre) {
        if (d.initialiseur) { enCours.add(n); const r = estHorloge(d.initialiseur); enCours.delete(n); if (r) return true; }
        return !!d.parametre.type && /^Date$/.test(d.parametre.type.getText(sf)) && PARAMETRE_INSTANT.test(n.text);
      }
      if (!d.initialiseur) return false;
      enCours.add(n); const r = estHorloge(d.initialiseur); enCours.delete(n);
      return r;
    }
    // `x.getTime()` etc. d'une horloge brute est un nombre, pas une date : on ne propage pas.
    return false;
  };

  // — Fonctions LOCALES de formatage : lisent le calendrier de leur paramètre sans fixer Kinshasa.
  const formateursLocaux = new Set<string>();
  const lisCalendrierDe = (corps: ts.Node, parametres: string[]) => {
    let lit = false;
    // Le récepteur dépend d'un paramètre : `d`, mais aussi `new Date(d)` (le cas d'attestation-paie).
    const dependDuParametre = (e: ts.Node): boolean => {
      let oui = false;
      const v = (y: ts.Node) => { if (ts.isIdentifier(y) && parametres.includes(y.text)) oui = true; else ts.forEachChild(y, v); };
      v(e);
      return oui;
    };
    const visite = (x: ts.Node) => {
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && dependDuParametre(x.expression.expression)) {
        const m = x.expression.name.text;
        if (CALENDRIER.test(m) || (LOCALE.test(m) && !x.arguments.some((a) => mentionneKinshasa(a)))) lit = true;
      }
      if (ts.isPropertyAccessExpression(x) && ts.isCallExpression(x.expression) && ts.isPropertyAccessExpression(x.expression.expression)
        && x.expression.expression.name.text === "toISOString" && dependDuParametre(x.expression.expression.expression) && DECOUPE_ISO.test(x.name.text)) lit = true;
      ts.forEachChild(x, visite);
    };
    visite(corps);
    return lit;
  };
  for (const map of declarations.values()) {
    for (const [nom, d] of map) {
      const f = d.fonction;
      if (!f || !ts.isFunctionLike(f) || !("body" in f) || !f.body) continue;
      const params = f.parameters.map((p) => nomDe(p.name)).filter(Boolean);
      if (params.length && lisCalendrierDe(f.body, params)) formateursLocaux.add(nom);
    }
  }

  // — Les usages interdits.
  const visite = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const f = n.expression;
      if (ts.isPropertyAccessExpression(f)) {
        const m = f.name.text;
        if (estHorloge(f.expression)) {
          if (CALENDRIER.test(m)) signale(n);
          else if (LOCALE.test(m) && !n.arguments.some((a) => mentionneKinshasa(a))) signale(n);
          else if (m === "toISOString" && ts.isPropertyAccessExpression(n.parent) && DECOUPE_ISO.test(n.parent.name.text)) signale(n);
        }
        if ((m === "format" || m === "formatToParts") && n.arguments.some((a) => estHorloge(a))) {
          let recepteur: ts.Node = f.expression;
          if (ts.isIdentifier(recepteur)) recepteur = resoudre(recepteur)?.initialiseur ?? recepteur;
          if (!mentionneKinshasa(recepteur)) signale(n);
        }
      }
      const appele = nomDe(f);
      if (appele && (ATTEND_UN_JOUR_CIVIL.has(appele) || formateursLocaux.has(appele)) && n.arguments.some((a) => estHorloge(a))) signale(n);
    }
    // Une horloge brute LUE par une destructuration ou un accès direct à `.getUTCMonth` sans appel (référence) : rare, non couvert.
    ts.forEachChild(n, visite);
  };
  visite(sf);
  return fautes.sort((a, b) => a.ligne - b.ligne);
}

function sources(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = path.join(dossier, nom);
    if (statSync(chemin).isDirectory()) { sortie.push(...sources(chemin)); continue; }
    if (!/\.(ts|tsx)$/.test(nom) || /\.test\.tsx?$/.test(nom)) continue;
    sortie.push(chemin);
  }
  return sortie;
}

describe("horloge brute interdite hors du module des dates", () => {
  it("aucun fichier de src/app, src/lib, src/components ne lit le calendrier, l'heure ou le jour de l'horloge brute", () => {
    const fautes: string[] = [];
    let nbFichiers = 0;
    for (const d of DOSSIERS) {
      for (const f of sources(path.join(RACINE, d))) {
        const rel = path.relative(RACINE, f).split(path.sep).join("/");
        if (EXCEPTIONS.has(rel)) continue;
        nbFichiers++;
        for (const t of trouverHorlogeBrute(readFileSync(f, "utf8"), f)) fautes.push(`${rel}:${t.ligne}  ${t.extrait}`);
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
  const attrape: Record<string, string> = {
    "lecture directe du mois": "const m = new Date().getUTCMonth() + 1;",
    "lecture locale de l'année": "const a = new Date().getFullYear();",
    "toISOString().slice": "const j = new Date().toISOString().slice(0, 10);",
    "toISOString().split": "const j = new Date().toISOString().split('T')[0];",
    "toISOString().substring": "const j = new Date().toISOString().substring(0, 10);",
    "toLocaleDateString direct": 'const j = new Date().toLocaleDateString("fr-FR");',
    "toLocaleDateString en UTC (pas Kinshasa)": 'const j = new Date().toLocaleDateString("fr-FR", { timeZone: "UTC" });',
    "variable initialisée par new Date()": "const now = new Date();\nconst m = now.getUTCMonth();",
    "let": "let auj = new Date();\nconst j = auj.getUTCDate();",
    "annotation de type": "const d: Date = new Date();\nconst m = d.getUTCMonth();",
    "sans point-virgule": "const d = new Date()\nconst m = d.getUTCMonth()",
    "déclaration sur deux lignes": "const maintenant =\n  new Date();\nconst m = maintenant.getMonth();",
    "déclarations multiples": "const a = 1, d = new Date();\nconst m = d.getMonth();",
    "Date.now() enveloppé": "const m = new Date(Date.now()).getUTCMonth();",
    "variable Date.now()": "const d = new Date(Date.now());\nconst m = d.getUTCMonth();",
    "décalage d'une heure à la main": "const k = new Date(Date.now() + 3_600_000); const m = k.getUTCMonth();",
    "date construite depuis une variable brute": "const n = new Date();\nconst x = new Date(n.getTime() + 86400000);\nconst m = x.getUTCMonth();",
    "chaîne sur plusieurs lignes": "new Date()\n  .getUTCMonth();",
    "destructuration d'une lecture": "const { y } = { y: new Date().getUTCFullYear() };",
    "setDate sur une horloge brute": "const d = new Date(); d.setDate(d.getDate() + 1);",
    "paramètre maintenant": "function f(maintenant: Date) { return maintenant.getUTCFullYear(); }",
    "paramètre aujourdhui": "function f(aujourdhui: Date) { return aujourdhui.getUTCDay(); }",
    "paramètre today (flèche)": "const f = (today: Date) => today.getUTCDate();",
    "paramètre à valeur par défaut brute": "function f(ref: Date = new Date()) { return ref.getUTCMonth(); }",
    "heure à l'heure du serveur": 'const h = new Date(x).toLocaleString("fr-FR");\nconst a = new Date().toLocaleTimeString("fr-FR");',
    "toLocaleTimeString d'une variable brute": 'const m = new Date();\nconst h = m.toLocaleTimeString("fr-FR", { hour: "2-digit" });',
    "Intl sans fuseau": "const j = new Intl.DateTimeFormat('fr-FR').format(new Date());",
    "Intl via une variable sans fuseau": "const f = new Intl.DateTimeFormat('fr-FR');\nconst j = f.format(new Date());",
    "fonction locale de formatage (attestation-paie)": "const fr = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'UTC' });\nconst t = <Text>Fait à Kinshasa, le {fr(new Date())}</Text>;",
    "fonction locale de formatage dérivée (new Date(d), attestation-paie réelle)": "const fr = (d: Date | string | null | undefined) =>\n  d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/^1 /, '1er ') : '—';\nconst t = <Text>Fait à Kinshasa, le {fr(new Date())}</Text>;",
    "fonction locale de formatage (function)": "function fr(d: Date) { return d.getUTCDate(); }\nconst t = fr(new Date());",
    "moisDe(horloge)": "const m = moisDe(new Date());",
    "lundiDe(horloge)": "const m = lundiDe(new Date());",
    "compterFamille(horloge) (composition-familiale)": "const comptage = compterFamille(membres, new Date(), ageLimiteEnfant);",
    "ancienneteEnMois(horloge)": "const a = ancienneteEnMois(embauche, new Date());",
  };
  it.each(Object.entries(attrape))("attrape : %s", (_nom, source) => {
    expect(trouverHorlogeBrute(source).length).toBeGreaterThan(0);
  });

  const accepte: Record<string, string> = {
    "passe par Kinshasa": "const k = jourCivilKinshasa(new Date());\nconst m = k.getUTCMonth();",
    "date pure stockée": "const d = new Date(`${iso}T00:00:00Z`);\nconst m = d.getUTCMonth();",
    "date pure stockée (toLocaleDateString)": 'const j = new Date(x).toLocaleDateString("fr-FR");',
    "commentaire": "// new Date().getUTCMonth() est interdit\n/* const now = new Date();\n now.getMonth() */",
    "un instant, pas un jour": "const t = new Date().getTime();\nconst e = new Date(Date.now() + 5000);\nrow.expiresAt = e;",
    "heure avec fuseau de Kinshasa": 'const h = new Date(x).toLocaleString("fr-FR", { timeZone: "Africa/Kinshasa" });\nconst m = new Date();\nconst h2 = m.toLocaleTimeString("fr-FR", { timeZone: "Africa/Kinshasa" });',
    "Intl avec fuseau de Kinshasa": "const j = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(new Date());",
    "fonction locale appelée sur une date pure": "const fr = (d: Date) => d.getUTCDate();\nconst t = fr(jourCivilKinshasa(new Date()));\nconst u = fr(row.date);",
    "nom réutilisé dans une autre portée": "function a() { const now = new Date(); return now.getTime(); }\nfunction b() { const now = jourCivilKinshasa(new Date()); return now.getUTCMonth(); }",
    // Exception nommée : un paramètre `dateRef` est une date PURE (famille.ts, payroll.ts : « âge », « ancienneté »
    // à une date de référence). Ce n'est pas lui qu'on surveille mais l'appelant : `compterFamille` et
    // `ancienneteEnMois` sont dans ATTEND_UN_JOUR_CIVIL, leur passer l'horloge brute est refusé (cas ci-dessus).
    "paramètre dateRef (date pure)": "function f(dateRef: Date) { return dateRef.getUTCFullYear(); }",
    "moisDe d'une date pure": "const m = moisDe(jourCivilKinshasa(new Date()));\nconst n = moisDe(row.date);",
  };
  it.each(Object.entries(accepte))("laisse passer : %s", (_nom, source) => {
    expect(trouverHorlogeBrute(source)).toEqual([]);
  });
});
