// « Exports » (stock.exports) masque les boutons : la liste des adresses masquées doit être EXACTEMENT celle
// des routes qui exigent la permission — sinon un bouton reste affiché pour un 403, ou disparaît à tort.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { exportStockGouverne } from "@/lib/permissions";

const RACINE = join(process.cwd(), "src/app/(stock)");
function routes(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? routes(p) : n === "route.ts" ? [p] : [];
  });
}
/** « src/app/(stock)/stock/catalogue/[id]/pdf/route.ts » → « /stock/catalogue/x/pdf ». */
const adresse = (p: string) => "/" + relative(RACINE, p).split(sep).slice(0, -1).map((s) => (s.startsWith("[") ? "x" : s)).join("/");

describe("exports du Stock : boutons masqués = routes gardées par stock.exports", () => {
  const toutes = routes(RACINE);
  it.each(toutes.map((p) => [adresse(p), p]))("%s", (url, p) => {
    const garde = /permission:\s*"stock\.exports"/.test(readFileSync(p, "utf8"));
    expect(exportStockGouverne(url), `${url} : route ${garde ? "gardée" : "non gardée"} par stock.exports`).toBe(garde);
    expect(exportStockGouverne(`${url}?a=1`)).toBe(garde);
  });
  it("factures et clôture ne sont jamais masquées", () => {
    expect(exportStockGouverne("/stock/factures/export?ids=a")).toBe(false);
    expect(exportStockGouverne("/stock/fournisseurs/imprimer")).toBe(false);
  });
});
