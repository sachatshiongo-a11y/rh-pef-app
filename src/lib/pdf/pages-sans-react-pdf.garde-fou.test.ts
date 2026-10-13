import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU (mesure de performance du 13/10/2026) : AUCUNE page ni aucun layout ne charge @react-pdf au démarrage.
 *
 * `@react-pdf/renderer` (avec fontkit, yoga, pdfkit) pèse lourd à charger ; sur l'instance gratuite de Render (0,1 vCPU,
 * 512 Mo) il alourdit le démarrage à froid et la mémoire de TOUTES les pages qui l'embarquent, alors que seules les routes
 * de téléchargement l'utilisent. Une page qui a besoin d'un PDF (action « signer », « générer ») le charge À LA DEMANDE :
 * `const { genererContratPdf } = await import("@/lib/pdf/contrat-buffer")`.
 *
 * Le test construit le graphe des imports STATIQUES (valeurs) de chaque `page.tsx` et `layout.tsx` de `src/app`, de proche en
 * proche à travers `src/`, et échoue dès qu'un chemin atteint un fichier qui importe `@react-pdf/*`. Ignorés : `import type`
 * (effacé à la compilation), `import()` dynamique (chargé à la demande) et les paquets externes.
 */

const SRC = path.resolve(__dirname, "../..");
const EXT = [".ts", ".tsx"];

function fichiers(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? (e.name === "node_modules" ? [] : fichiers(p)) : EXT.includes(path.extname(e.name)) ? [p] : [];
  });
}

/** Spécificateurs des imports statiques de VALEURS d'un source (hors `import type`, hors imports dont tous les noms sont `type`). */
export function importsStatiques(source: string): string[] {
  const sans = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const trouves: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+([^;'"]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  for (let m = re.exec(sans); m; m = re.exec(sans)) {
    if (m[4]) { trouves.push(m[4]); continue; }
    const clause = m[2].trim();
    if (/^type\s/.test(clause)) continue; // import type X / export type { X }
    const accolades = /^\{([\s\S]*)\}$/.exec(clause);
    if (accolades) {
      const noms = accolades[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (noms.length > 0 && noms.every((n) => /^type\s/.test(n))) continue;
    }
    trouves.push(m[3]);
  }
  return trouves;
}

type Systeme = { lire: (f: string) => string; existe: (f: string) => boolean };
const disque: Systeme = { lire: (f) => fs.readFileSync(f, "utf8"), existe: (f) => fs.existsSync(f) && fs.statSync(f).isFile() };

function resoudre(depuis: string, spec: string, io: Systeme): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(depuis), spec) : null;
  if (!base) return null; // paquet externe
  return [base, ...EXT.map((e) => base + e), ...EXT.map((e) => path.join(base, "index" + e))].find((c) => io.existe(c)) ?? null;
}

/** Chemin (liste de fichiers) du premier import transitif de @react-pdf atteint depuis `racine`, ou null. */
export function cheminVersReactPdf(racine: string, io: Systeme = disque): string[] | null {
  const vus = new Set<string>();
  const parcourir = (f: string, chemin: string[]): string[] | null => {
    if (vus.has(f)) return null;
    vus.add(f);
    for (const spec of importsStatiques(io.lire(f))) {
      if (spec.startsWith("@react-pdf/")) return [...chemin, f, spec];
      const cible = resoudre(f, spec, io);
      if (cible) {
        const r = parcourir(cible, [...chemin, f]);
        if (r) return r;
      }
    }
    return null;
  };
  return parcourir(racine, []);
}

const rel = (f: string) => path.relative(SRC, f);

describe("aucune page ni layout ne charge @react-pdf au démarrage", () => {
  const racines = fichiers(path.join(SRC, "app")).filter((f) => /[\\/](page|layout)\.tsx$/.test(f));

  it("le recensement trouve les pages et layouts (sinon le test ne prouve rien)", () => {
    expect(racines.length).toBeGreaterThan(50);
  });

  it("l'analyse reconnaît ce qu'elle doit (import statique, type, dynamique)", () => {
    expect(importsStatiques(`import { a } from "@/x";\nimport type { B } from "@/y";\nimport { type C } from "@/z";\nimport { type D, e } from "@/w";\nexport { f } from "./g";\nexport type { H } from "./h";\nconst m = await import("@/lib/pdf/contrat-buffer");`))
      .toEqual(["@/x", "@/w", "./g"]);
  });

  it("l'analyse trouve un chemin transitif, et le laisse passer s'il n'est que dynamique ou de types (faux graphe)", () => {
    const f = (x: string) => path.join(SRC, x);
    const faux = (fichiers: Record<string, string>): Systeme => ({ lire: (p) => fichiers[p] ?? "", existe: (p) => p in fichiers });
    const statique = faux({
      [f("app/page.tsx")]: `import { a } from "@/lib/a";`,
      [f("lib/a.ts")]: `export { b } from "./b";`,
      [f("lib/b.ts")]: `import { Document } from "@react-pdf/renderer";`,
    });
    expect(cheminVersReactPdf(f("app/page.tsx"), statique)).toEqual([f("app/page.tsx"), f("lib/a.ts"), f("lib/b.ts"), "@react-pdf/renderer"]);
    const sain = faux({
      [f("app/page.tsx")]: `import type { T } from "@/lib/a";\nconst { b } = await import("@/lib/b");`,
      [f("lib/a.ts")]: `import { Document } from "@react-pdf/renderer";`,
      [f("lib/b.ts")]: `import { Document } from "@react-pdf/renderer";`,
    });
    expect(cheminVersReactPdf(f("app/page.tsx"), sain)).toBeNull();
  });

  it.each(racines.map((f) => [rel(f), f]))("%s", (_nom, f) => {
    const chemin = cheminVersReactPdf(f);
    expect(chemin && chemin.map((x) => (x.startsWith(SRC) ? rel(x) : x)).join("\n  → "), "charge @react-pdf au démarrage").toBeNull();
  });
});
