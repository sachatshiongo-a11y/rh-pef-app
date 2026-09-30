import { describe, it, expect } from "vitest";
import React from "react";
import { Document, Page, Text } from "@react-pdf/renderer";
import { policesDeRepli } from "@/lib/test/pdf-lecture";
import { renderPdfBuffer } from "./fonts";
import { texteSurPdf } from "./texte-sur";

const HOSTILE = "Shaker → verre ⇒ service ← retour ↑ haut ↓ bas −2 °C, 1 000 ml ! ⚠ glace ✓ 🍹🍋 Bacardi® Absolut™ ©​";

describe("texte saisi rendu sûr pour la police des PDF", () => {
  it("remplace ce qui a un équivalent, retire les pictogrammes, garde ©®™", () => {
    expect(texteSurPdf(HOSTILE)).toBe("Shaker -> verre -> service <- retour + haut - bas -2 °C, 1 000 ml ! glace Bacardi® Absolut™ ©");
  });

  it("le résultat se compose entièrement en Optima, dans les trois graisses", async () => {
    const styles = [{ fontWeight: 400 as const }, { fontWeight: 700 as const }, { fontStyle: "italic" as const }];
    const doc = React.createElement(Document, null, React.createElement(Page, { size: "A4", style: { fontFamily: "Optima", padding: 40 } },
      ...styles.map((style, i) => React.createElement(Text, { key: i, style }, texteSurPdf(HOSTILE)))));
    expect(policesDeRepli(await renderPdfBuffer(doc))).toEqual([]);
  }, 30_000);

  it("le contrôle voit bien le défaut quand le texte n'est PAS nettoyé", async () => {
    const doc = React.createElement(Document, null, React.createElement(Page, { size: "A4", style: { fontFamily: "Optima", padding: 40 } }, React.createElement(Text, null, HOSTILE)));
    expect(policesDeRepli(await renderPdfBuffer(doc)).length).toBeGreaterThan(0);
  }, 30_000);
});
