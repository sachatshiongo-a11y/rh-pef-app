import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FrisePaie } from "./frise-paie";

// La frise compte les jours avant la paie à partir d'« aujourd'hui » : le jour de Kinshasa, pas celui du
// serveur (UTC) — le 1er du mois à 00 h 30 Kinshasa, l'horloge UTC dit encore le dernier jour du mois d'avant.
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
afterEach(() => { vi.useRealTimers(); });
function a(instant: string) { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(instant)); }

describe("FrisePaie — le jour courant est celui de Kinshasa", () => {
  it("le 1er octobre à 00 h 30 Kinshasa (30 sept. 23 h 30 UTC) : octobre est déjà le mois en cours, « Jour 1 / 30 »", () => {
    a("2026-09-30T23:30:00Z");
    const t = texte(renderToStaticMarkup(<FrisePaie mois={10} annee={2026} etape={0} />));
    expect(t).toContain("paiement dans 29 j");
    expect(t).toContain("Jour 1 / 30");
  });
  it("le 30 septembre à 23 h 30 Kinshasa (22 h 30 UTC) : septembre est le mois en cours, octobre n'a pas commencé", () => {
    a("2026-09-30T22:30:00Z");
    expect(texte(renderToStaticMarkup(<FrisePaie mois={9} annee={2026} etape={0} compact={false} />))).toContain("jour de paie aujourd'hui");
    expect(texte(renderToStaticMarkup(<FrisePaie mois={10} annee={2026} etape={0} />))).not.toContain("paiement dans");
  });
});
