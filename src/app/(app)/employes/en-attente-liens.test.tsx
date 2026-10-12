import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationsEnAttente } from "./creations-en-attente";
import { ModifsEnAttente } from "./modifs-en-attente";

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const creations = [{ id: "c1", nom: "Awa Kabongo", auteurNom: "Rachel", le: "12/10/2026" }];
const modifs = [{ id: "m1", auteurNom: "Rachel", le: "12/10/2026", motif: null, lignes: ["Téléphone : 0970000000 → 0980000000"] }];

// Lot 4 : le renvoi vers « À valider » est montré à TOUS (la page est ouverte à tous les rôles, lot 3) ; seul le verbe change.
describe("fiches en attente — le renvoi vers « À valider »", () => {
  it("nouvelles fiches : « Décider » pour la Direction, « Voir » pour les autres", () => {
    expect(texte(renderToStaticMarkup(<CreationsEnAttente creations={creations} estDirection />))).toContain("Décider dans « À valider » →");
    const autre = texte(renderToStaticMarkup(<CreationsEnAttente creations={creations} estDirection={false} />));
    expect(autre).toContain("Voir dans « À valider » →");
    expect(autre).not.toContain("Décider");
  });

  it("modification de fiche : « Décider » pour la Direction, « Voir » pour les autres", () => {
    expect(texte(renderToStaticMarkup(<ModifsEnAttente demandes={modifs} estDirection />))).toContain("Décider dans « À valider » →");
    const autre = texte(renderToStaticMarkup(<ModifsEnAttente demandes={modifs} estDirection={false} />));
    expect(autre).toContain("Voir dans « À valider » →");
    expect(autre).not.toContain("Décider");
  });

  it("le lien mène au même endroit pour tous (la section des modifications de fiches)", () => {
    for (const estDirection of [true, false]) {
      expect(renderToStaticMarkup(<ModifsEnAttente demandes={modifs} estDirection={estDirection} />)).toContain('href="/a-valider#modifications-fiches"');
    }
  });
});
