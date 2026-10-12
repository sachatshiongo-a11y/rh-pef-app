import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU (audit du 10/10/2026, sécurité 2) : toute route qui rend un document TABULAIRE à
 * longueur variable passe par `renderPdfOuRefus`. Les documents plafonnés (`verifierPlafondPdf`)
 * LÈVENT au-delà de 1 500 lignes ; rendus par `renderPdfBuffer`, ce refus deviendrait une erreur
 * 500 muette au lieu du 413 lisible. Le test parcourt `src/app` à chaque passage : une nouvelle
 * route qui rend l'un de ces documents sans `renderPdfOuRefus` le fait échouer.
 */
const DOCUMENTS_PLAFONNES = ["TableauDocument", "TablesDocument", "TableauxParPartieDocument", "ComparaisonDocument", "RapportExploitationDocument", "LivrePaieDocument"];
const APP = path.resolve(__dirname, "../../app");

function routes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? routes(p) : /^route\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("routes PDF tabulaires : refus lisible au-delà du plafond", () => {
  const concernees = routes(APP).filter((f) => DOCUMENTS_PLAFONNES.some((d) => new RegExp(`\\b${d}\\(`).test(fs.readFileSync(f, "utf8"))));

  it("le recensement trouve les routes attendues (sinon le test ne prouve rien)", () => {
    expect(concernees.length).toBeGreaterThanOrEqual(11);
  });

  it.each(concernees.map((f) => [path.relative(APP, f), f]))("%s rend ses documents plafonnés par renderPdfOuRefus", (_rel, f) => {
    const src = fs.readFileSync(f, "utf8");
    for (const d of DOCUMENTS_PLAFONNES) {
      // Aucun `renderPdfBuffer(Document(` direct, sur une ligne ou la suivante.
      expect(src, d).not.toMatch(new RegExp(`renderPdfBuffer\\(\\s*${d}\\(`));
    }
    expect(src).toMatch(/renderPdfOuRefus\(\(\) =>/);
    expect(src).toMatch(/instanceof Response\) return/);
  });
});
