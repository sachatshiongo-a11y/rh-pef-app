import { describe, it, expect } from "vitest";
import path from "node:path";
import React from "react";
// @ts-expect-error -- fontkit (déjà utilisé par @react-pdf) n'embarque pas ses types ; seul openSync sert ici.
import * as fontkitBrut from "fontkit";
import { Document, Page, Text } from "@react-pdf/renderer";
import { policesDeRepli } from "@/lib/test/pdf-lecture";
import { renderPdfBuffer } from "./fonts";
import { dansOptima, texteSurPdf } from "./texte-sur";

const HOSTILE = "Shaker → verre ⇒ service ← retour ↑ haut ↓ bas −2 °C, 1 000 ml ! ⚠ glace ✓ 🍹🍋 Bacardi® Absolut™ ©​";

/**
 * Caractères sondés par la relecture (2026-09-30) : ceux qu'un classeur ou un téléphone produisent
 * et qu'Optima n'a pas — plus leurs voisins qu'elle a.
 */
const SONDES = [
  "№ 5", "H₂O", "CO₂", "m²", "cm³", "①②③", "⑴", "Ⅳ", "ﬀ", "ﬁ", "½", "⅓", "¼", "‰", "€", "•", "Ω", "µ", "°",
  "™", "®", "©", "é", "à", "“”", "‘’", "…", "—", "–", "‑", "‐", "−", "→", "≈", "≠", "≤", "≥", "√", "∞",
  "×", "÷", "✓", "★", "⚠", "🍋", "🍹", " ", " ", "　", " ", " ", "​", "️", "ℓ", "℃", "ª", "º",
].join(" ");

const fontkit = fontkitBrut as { openSync(chemin: string): { characterSet: number[] } };

/** Couverture RÉELLE : caractères présents dans les trois fichiers Optima embarqués. */
function couvertureReelle(): Set<number> {
  const dir = path.join(process.cwd(), "assets/fonts");
  const polices = ["Optima-Regular.ttf", "Optima-Bold.ttf", "Optima-Italic.ttf"].map((f) => fontkit.openSync(path.join(dir, f)));
  const [premiere, ...autres] = polices.map((p) => new Set(p.characterSet));
  return new Set([...premiere].filter((cp) => autres.every((s) => s.has(cp))));
}
const REELLE = couvertureReelle();
const composeEnOptima = (texte: string) => [...texte].every((c) => c === "\n" || c === "\t" || REELLE.has(c.codePointAt(0)!));

describe("texte saisi rendu sûr pour la police des PDF", () => {
  it("remplace ce qui a un équivalent, retire les pictogrammes, garde ©®™", () => {
    expect(texteSurPdf(HOSTILE)).toBe("Shaker -> verre -> service <- retour + haut - bas -2 °C, 1 000 ml ! glace Bacardi® Absolut™ ©");
  });

  it("formes de compatibilité et espaces : lisibles, jamais perdues quand un équivalent existe", () => {
    expect(texteSurPdf("№ 5 · H₂O · 20 m² · ① · ﬀ · 1 000　g · caf" + "é")).toBe("No 5 · H2O · 20 m² · 1 · ff · 1 000 g · café");
    expect(texteSurPdf("½ ‰ € • ≥ ×")).toBe("½ ‰ € • ≥ ×"); // présents dans Optima : intacts
  });

  it("la liste de couverture écrite dans le code est EXACTEMENT celle des fichiers de police", () => {
    const exclus = (cp: number) => cp < 0x20 || (cp >= 0x300 && cp <= 0x36f) || cp === 0xf8ff || cp === 0xffff;
    const attendue = [...REELLE].filter((cp) => !exclus(cp)).sort((a, b) => a - b);
    const declaree: number[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) if (!(cp >= 0xd800 && cp <= 0xdfff) && cp !== 0x0a && cp !== 0x09 && dansOptima(String.fromCodePoint(cp))) declaree.push(cp);
    expect(declaree.map((c) => c.toString(16))).toEqual(attendue.map((c) => c.toString(16)));
  });

  it("balayage : AUCUN caractère du plan de base ni émoji ne ressort hors de la police", () => {
    const fautifs: string[] = [];
    const essayer = (cp: number) => {
      const r = texteSurPdf(`a${String.fromCodePoint(cp)}b`);
      if (!composeEnOptima(r) || /[− ]/.test(r)) fautifs.push(cp.toString(16));
    };
    for (let cp = 0x20; cp <= 0xffff; cp++) if (!(cp >= 0xd800 && cp <= 0xdfff)) essayer(cp);
    for (let cp = 0x1f300; cp <= 0x1faff; cp++) essayer(cp);
    expect(fautifs).toEqual([]);
  });

  it("le résultat se compose entièrement en Optima, dans les trois graisses", async () => {
    const styles = [{ fontWeight: 400 as const }, { fontWeight: 700 as const }, { fontStyle: "italic" as const }];
    const doc = React.createElement(Document, null, React.createElement(Page, { size: "A4", style: { fontFamily: "Optima", padding: 40 } },
      ...styles.flatMap((style, i) => [HOSTILE, SONDES].map((t, j) => React.createElement(Text, { key: `${i}-${j}`, style }, texteSurPdf(t))))));
    expect(policesDeRepli(await renderPdfBuffer(doc))).toEqual([]);
  }, 30_000);

  it("le contrôle voit bien le défaut quand le texte n'est PAS nettoyé", async () => {
    for (const brut of [HOSTILE, "№ 5 · H₂O · ①"]) {
      const doc = React.createElement(Document, null, React.createElement(Page, { size: "A4", style: { fontFamily: "Optima", padding: 40 } }, React.createElement(Text, null, brut)));
      expect(policesDeRepli(await renderPdfBuffer(doc)).length, brut).toBeGreaterThan(0);
    }
  }, 30_000);
});
