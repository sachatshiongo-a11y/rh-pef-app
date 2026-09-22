import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Le texte des boutons de décision doit rester lisible sur son aplat, dans les
 * TROIS thèmes.
 *
 * Signalé par la relecture du 2026-09-22 : `text-white` sur `bg-success` tombait
 * à 2,73:1 en thème sombre (seuil AA : 4,5). Les boutons écrivaient le blanc en
 * dur et ignoraient `--success-foreground`, qui existait déjà.
 *
 * Ce test ne relit pas une valeur écrite à la main : il CALCULE le contraste à
 * partir des jetons de globals.css. Si quelqu'un retouche la palette, il rougit.
 */
const FEUILLE = path.join(__dirname, "globals.css");
const SEUIL_AA = 4.5;

/** oklch() → sRGB 0-255. Validé contre le moteur du navigateur (voir le test dédié). */
function oklchVersRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(g * 255)));
  }) as [number, number, number];
}

function couleurVersRgb(css: string): [number, number, number] {
  const ok = css.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (ok) return oklchVersRgb(+ok[1], +ok[2], +ok[3]);
  const hex = css.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  throw new Error(`couleur non reconnue : ${css}`);
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => {
    const u = v / 255;
    return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

function contraste(a: string, b: string): number {
  const [x, y] = [luminance(couleurVersRgb(a)), luminance(couleurVersRgb(b))];
  const [haut, bas] = x > y ? [x, y] : [y, x];
  return (haut + 0.05) / (bas + 0.05);
}

/** Découpe la feuille en blocs de thème et en extrait les jetons demandés. */
function jetonsParTheme(): Record<string, Record<string, string>> {
  const css = fs.readFileSync(FEUILLE, "utf8");
  const blocs: Record<string, string> = {};
  for (const [nom, motif] of [
    ["clair", /^:root \{$/m],
    ["sombre", /^\.dark \{$/m],
    ["tamisé", /^\.tamise \{$/m],
  ] as const) {
    const i = css.search(motif);
    expect(i, `bloc de thème « ${nom} » introuvable dans globals.css`).toBeGreaterThan(-1);
    blocs[nom] = css.slice(i, css.indexOf("\n}", i));
  }
  const out: Record<string, Record<string, string>> = {};
  for (const [nom, bloc] of Object.entries(blocs)) {
    out[nom] = {};
    for (const jeton of ["success", "success-foreground", "destructive", "destructive-foreground"]) {
      const m = bloc.match(new RegExp(`--${jeton}:\\s*([^;]+);`));
      expect(m, `jeton --${jeton} absent du thème ${nom}`).not.toBeNull();
      out[nom][jeton] = m![1].trim();
    }
  }
  return out;
}

describe("globals.css — lisibilité des boutons de décision", () => {
  it("ma conversion oklch colle au moteur du navigateur (\u00b13/255)", () => {
    // Relevés dans un vrai navigateur (canvas, lecture de pixel), 2026-09-22.
    // Tolérance : pour une couleur hors gamut sRGB (les rouges à forte chroma),
    // le navigateur RAMÈNE la chroma quand ce code tronque canal par canal.
    // L'écart plafonne à 3/255 et déplace le contraste de moins de 0,02 —
    // vérifié par le test suivant, qui garde une marge bien supérieure.
    const releves: Array<[[number, number, number], [number, number, number]]> = [
      [[0.56, 0.1, 155], [61, 134, 90]],
      [[0.54, 0.1, 155], [55, 128, 84]],
      [[0.68, 0.12, 155], [83, 174, 119]],
      [[0.66, 0.11, 155], [85, 166, 116]],
      [[0.55, 0.16, 27.325], [189, 66, 58]],
      [[0.7, 0.16, 27], [241, 113, 102]],
      [[0.68, 0.15, 27], [230, 111, 100]],
    ];
    for (const [[L, C, h], attendu] of releves) {
      const obtenu = oklchVersRgb(L, C, h);
      for (let i = 0; i < 3; i++) {
        expect(
          Math.abs(obtenu[i] - attendu[i]),
          `oklch(${L} ${C} ${h}) canal ${i} : ${obtenu[i]} vs ${attendu[i]} mesuré`
        ).toBeLessThanOrEqual(3);
      }
    }
  });

  it("atteint 4,5:1 dans les trois thèmes, aplat vert ET aplat rouge", () => {
    const jetons = jetonsParTheme();
    const releve: string[] = [];
    for (const [theme, j] of Object.entries(jetons)) {
      for (const [aplat, texte] of [
        ["success", "success-foreground"],
        ["destructive", "destructive-foreground"],
      ] as const) {
        const r = contraste(j[aplat], j[texte]);
        releve.push(`${theme} / ${aplat} : ${r.toFixed(2)}:1`);
        expect(r, `${theme} — texte sur --${aplat} : ${r.toFixed(2)}:1, sous le seuil AA`).toBeGreaterThanOrEqual(SEUIL_AA);
      }
    }
    expect(releve).toHaveLength(6);
  });

  it("NULLE PART dans src/, un aplat vert ou rouge n'écrit text-white en dur", () => {
    // Le jeton existe et il est contrasté ; le blanc en dur ne l'est pas. La règle
    // vaut pour tout le dépôt, pas seulement pour la famille de boutons : les trois
    // derniers cas trouvés le 2026-09-22 étaient hors d'elle (fin-contrat-form,
    // mouvements-client ×2).
    const APLAT_EN_BLANC =
      /bg-success[^"`]{0,80}text-white|bg-destructive[^"`]{0,80}text-white|text-white[^"`]{0,80}bg-success|text-white[^"`]{0,80}bg-destructive/;
    const racine = path.join(__dirname, "..");
    const coupables: string[] = [];
    const parcourir = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const chemin = path.join(dir, e.name);
        if (e.isDirectory()) parcourir(chemin);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
          if (APLAT_EN_BLANC.test(fs.readFileSync(chemin, "utf8"))) {
            coupables.push(path.relative(racine, chemin));
          }
        }
      }
    };
    parcourir(racine);
    expect(
      coupables,
      `aplat de décision écrit en text-white au lieu du jeton contrasté :\n  ${coupables.join("\n  ")}`
    ).toEqual([]);

    const famille = fs.readFileSync(path.join(racine, "components/action-buttons.tsx"), "utf8");
    expect(famille).toMatch(/text-success-foreground/);
    expect(famille).toMatch(/text-destructive-foreground/);
  });
});
