import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { BoutonSigner } from "./bouton-signer";

// Espace salarié, au téléphone : le bouton « Signer » est une cible tactile d'au moins 44 px
// (décision Direction 2026-09-28). Les écrans de la Direction gardent leur taille compacte.
const action = async () => undefined;
const rendu = (tactile?: boolean, etat: "A_SIGNER" | "A_RESIGNER" = "A_SIGNER") =>
  renderToStaticMarkup(
    <BoutonSigner cible="BULLETIN" cibleId="b" nomSalarie="Awa" libelleDocument="Bulletin" cote="SALARIE" etat={etat} signeLeTexte={null} action={action} tactile={tactile} />,
  );

describe("BoutonSigner — variante tactile", () => {
  it("tactile : hauteur minimale 44 px (min-h-11), pour signer comme pour resigner", () => {
    expect(rendu(true)).toMatch(/min-h-11/);
    expect(rendu(true, "A_RESIGNER")).toMatch(/min-h-11/);
  });
  it("par défaut (écrans de la Direction) : taille compacte inchangée", () => {
    expect(rendu()).not.toMatch(/min-h-11/);
    expect(rendu()).toMatch(/px-2\.5 py-1 text-xs/);
  });

  it("chaque BoutonSigner de l'espace salarié est tactile", () => {
    const racine = path.resolve(__dirname, "../app/espace");
    const fichiers = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = path.join(d, n);
        return statSync(p).isDirectory() ? fichiers(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
      });
    const fautifs: string[] = [];
    for (const f of fichiers(racine)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<BoutonSigner\b[^>]*?\/>/gs)) if (!/\btactile\b/.test(m[0])) fautifs.push(path.relative(racine, f));
    }
    expect(fautifs).toEqual([]);
  });
});
