// Garde-fou (audit du 10/10/2026, ergonomie 9) : un nombre décimal AFFICHÉ s'écrit à la française (12,5 et non 12.5).
// `toFixed(1)` rend un point : il ne doit pas finir à l'écran, dans un tableau imprimable ni dans un PDF.
// Passage obligé : `formaterDecimales` / `formaterNombre` (lib/montant). Restent permis : `toFixed(...).replace(".", ",")`,
// un champ caché dont la valeur part au serveur, le tracé d'un graphique SVG, et `toFixed(0)` (aucune décimale).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { formaterDecimales } from "@/lib/montant";

const SRC = path.resolve(__dirname, "..");
function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : fichiers(p);
    return /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
  });
}

describe("décimales à la française", () => {
  it("formaterDecimales : virgule, nombre de décimales fixe", () => {
    expect(formaterDecimales(12.5, 1)).toBe("12,5");
    expect(formaterDecimales(12, 1)).toBe("12,0");
    expect(formaterDecimales(0.1234, 2)).toBe("0,12");
    expect(formaterDecimales(1234.5, 2)).toBe("1 234,50");
  });

  it("aucun écran n'affiche un décimal fabriqué par toFixed (point)", () => {
    const fautifs: string[] = [];
    for (const f of [...fichiers(path.join(SRC, "app")), ...fichiers(path.join(SRC, "components"))]) {
      readFileSync(f, "utf8").split("\n").forEach((ligne, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
        for (const m of ligne.matchAll(/\.toFixed\((\d+)\)(\.replace\(["']\.["'], ["'],["']\))?/g)) {
          if (m[1] === "0" || m[2]) continue; // aucune décimale, ou point déjà remplacé par la virgule
          if (/type="hidden"/.test(ligne)) continue; // valeur envoyée au serveur, jamais lue à l'écran
          if (/"M"|"L"/.test(ligne)) continue; // tracé de courbe SVG
          fautifs.push(`${path.relative(SRC, f)}:${i + 1}`);
        }
      });
    }
    expect(fautifs).toEqual([]);
  });
});
