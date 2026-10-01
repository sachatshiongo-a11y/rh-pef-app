import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// GARDE-FOU (défaut du 2026-10-01) : `<input type="number">` lit « 150.000 » comme 150 et refuse
// « 1.500,5 ». Tout champ de nombre passe par `ChampNombre` (src/components/champ-nombre.tsx),
// relu côté serveur par `decSaisi` / `decSaisiOptionnel`. Ce test échoue dès qu'un
// `type="number"` réapparaît dans une page ou un composant.
function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
  });
}

describe("aucun champ de nombre du navigateur", () => {
  it('aucun `type="number"` dans src (pages et composants)', () => {
    const fautifs = fichiers(join(__dirname, "..")).flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((l, i) => (/type=["']number["']/.test(l) ? [`${f.split("/src/")[1]}:${i + 1}`] : []))
    );
    expect(fautifs).toEqual([]);
  });

  it("un nombre écrit par le PROGRAMME dans un champ de nombre passe par `versSaisie` (sinon « 2.125 » est relu 2125)", () => {
    // Heuristique : dans un fichier qui utilise ChampNombre, un `setX(String(...))` ou un
    // `defaultValue={String(...)}` écrit un nombre en notation anglaise (un simple affichage
    // `value={String(...)}` d'un autre composant n'est pas un champ).
    const fautifs = fichiers(join(__dirname, "..")).flatMap((f) => {
      const texte = readFileSync(f, "utf8");
      if (!texte.includes("ChampNombre")) return [];
      return texte.split("\n").flatMap((l, i) =>
        /set\w+\(String\(|defaultValue=\{String\(/.test(l) ? [`${f.split("/src/")[1]}:${i + 1}: ${l.trim()}`] : []
      );
    });
    expect(fautifs).toEqual([]);
  });
});
