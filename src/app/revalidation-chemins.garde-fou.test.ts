// Garde-fou (audit du 10/10/2026, ergonomie 17) : `revalidatePath("/attestations")` visait une page qui n'existe pas —
// la liste que l'on voulait rafraîchir (Documents) restait périmée sans qu'aucune erreur ne le dise. Chaque
// `revalidatePath("<chemin littéral>")` du code doit désigner une PAGE (ou une route) qui existe.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
function tous(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : tous(p);
    return [p];
  });
}
const fichiers = tous(path.join(SRC, "app"));
/** Motifs de routes : « (app)/employes/[id]/page.tsx » → /employes/[id] (groupes retirés). */
const routes = fichiers
  .map((f) => path.relative(path.join(SRC, "app"), f).split(path.sep))
  .filter((seg) => /^(page\.tsx|route\.ts)$/.test(seg[seg.length - 1]))
  .map((seg) => "/" + seg.slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)).join("/"));
const existe = (chemin: string) => {
  const cible = chemin.replace(/\/$/, "") || "/";
  return routes.some((r) => {
    const motif = new RegExp("^" + (r === "/" ? "" : r).replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+") + "$");
    return motif.test(cible === "/" ? "" : cible) || (r === "/" && cible === "/");
  });
};

describe("revalidatePath ne vise que des pages qui existent", () => {
  it("le scan voit des chemins et des routes", () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(existe("/documents")).toBe(true);
    expect(existe("/employes/abc")).toBe(true);
    expect(existe("/attestations")).toBe(false); // il n'y a que /attestations/[id] et /attestations/export
  });

  it("chaque revalidatePath(\"/chemin\") littéral désigne une page ou une route", () => {
    const inconnus: string[] = [];
    for (const f of fichiers.filter((x) => /\.(ts|tsx)$/.test(x) && !/\.test\.tsx?$/.test(x))) {
      readFileSync(f, "utf8").split("\n").forEach((ligne, i) => {
        for (const m of ligne.matchAll(/revalidatePath\(\s*["'](\/[^"'`$]*)["']/g)) {
          if (!existe(m[1])) inconnus.push(`${path.relative(SRC, f)}:${i + 1} ${m[1]}`);
        }
      });
    }
    expect(inconnus).toEqual([]);
  });
});
