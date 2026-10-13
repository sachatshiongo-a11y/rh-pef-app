import { describe, it, expect } from "vitest";
import { renderPdfOuRefus } from "./fonts";
import { TableauDocument, TablesDocument, TableauxParPartieDocument, type Cellule } from "./tableau";
import { ComparaisonDocument } from "./comparaison";
import { PLAFOND_LIGNES_PDF, PdfTropLongError, messagePdfTropLong } from "./plafond";

/**
 * Audit du 10/10/2026, sécurité 2, revu le 13/10/2026 : rendu d'un seul bloc, un PDF tabulaire bloquait la boucle d'événements
 * (carré du nombre de lignes : 1 000 lignes = 10 s) et faisait tomber l'instance. Rendu PAR BLOCS (blocs.tsx), le coût est
 * linéaire (≈ 3 à 4 ms par ligne) : le plafond protège désormais le TEMPS TOTAL de la réponse (≤ 30 s sur l'instance gratuite
 * de Render, soit 600 lignes). Au-delà, le document est REFUSÉ AVANT TOUT RENDU (413 lisible, qui renvoie vers l'Excel),
 * jamais tronqué.
 */

const colonnes = [{ header: "A", width: "50%" }, { header: "B", width: "50%" }];
const lignes = (n: number): Cellule[][] => Array.from({ length: n }, (_, i) => [`L${i}`, i]);

describe("plafond des PDF tabulaires", () => {
  it("le plafond est de 600 lignes, et le message dit le compte réel et le maximum", () => {
    expect(PLAFOND_LIGNES_PDF).toBe(600);
    const m = messagePdfTropLong(4321);
    expect(m).toMatch(/^Document trop long : 4 321 lignes, maximum 600/);
    expect(m).toContain("réduisez la période");
    expect(m).toContain("exportez en Excel");
    expect(m).not.toMatch(/[ −]/);
  });

  it("TableauDocument : 600 lignes se construisent, 601 sont refusées", () => {
    expect(() => TableauDocument({ titre: "T", sousTitre: "S", colonnes, lignes: lignes(600) })).not.toThrow();
    expect(() => TableauDocument({ titre: "T", sousTitre: "S", colonnes, lignes: lignes(601) })).toThrow(PdfTropLongError);
  });

  it("plusieurs tableaux / parties : c'est le TOTAL du document qui compte", () => {
    const t = { colonnes, lignes: lignes(301) };
    expect(() => TablesDocument({ titre: "T", sousTitre: "S", tables: [t, t] })).toThrow(PdfTropLongError);
    expect(() => TableauxParPartieDocument({ titre: "T", sousTitre: "S", parties: [{ titre: "1", ...t }, { titre: "2", ...t }] })).toThrow(PdfTropLongError);
    const p = { titre: "P", groupes: [], colonnes, lignes: Array.from({ length: 301 }, () => ["a", "b"]) };
    expect(() => ComparaisonDocument({ titre: "T", sousTitre: "S", parties: [p, p] as never })).toThrow(PdfTropLongError);
  });

  it("renderPdfOuRefus : 413 en texte lisible, sans rendu (mémoire et temps négligeables même pour 200 000 lignes)", async () => {
    const enorme = lignes(200_000);
    global.gc?.();
    const avant = process.memoryUsage().heapUsed;
    const t0 = Date.now();
    const r = await renderPdfOuRefus(() => TableauDocument({ titre: "T", sousTitre: "S", colonnes, lignes: enorme }));
    const duree = Date.now() - t0;
    const pris = process.memoryUsage().heapUsed - avant;
    expect(r).toBeInstanceOf(Response);
    const rep = r as Response;
    expect(rep.status).toBe(413);
    expect(rep.headers.get("Content-Type")).toMatch(/^text\/plain/);
    const texte = await rep.text();
    expect(texte).toBe(messagePdfTropLong(200_000));
    expect(texte.length).toBeLessThanOrEqual(300); // affiché tel quel par TelechargerLien
    expect(duree).toBeLessThan(2000);
    expect(pris).toBeLessThan(50 * 1024 * 1024);
  }, 120_000);

  it("une autre erreur de construction n'est PAS maquillée en 413", async () => {
    await expect(renderPdfOuRefus(() => { throw new Error("autre"); })).rejects.toThrow("autre");
  });

  it("sous le plafond, le PDF est bien rendu", async () => {
    const r = await renderPdfOuRefus(() => TableauDocument({ titre: "T", sousTitre: "S", colonnes, lignes: lignes(5) }));
    expect(Buffer.isBuffer(r)).toBe(true);
    expect((r as Buffer).subarray(0, 4).toString()).toBe("%PDF");
  }, 60_000);
});
