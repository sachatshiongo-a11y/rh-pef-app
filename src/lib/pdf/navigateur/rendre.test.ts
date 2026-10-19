import { describe, it, expect } from "vitest";
import { feuillesCommande, pdfModele } from "@/lib/modeles-journaliers";
import { fichesCommandeEssai, SEMAINE_ESSAI } from "@/lib/modeles-journaliers/donnees-essai";
import { documentImprimable } from "@/lib/modeles-journaliers/imprimable";
import { policesOptimaBase64 } from "@/lib/pdf/fonts";
import { pagesDuPdf, pixelsDifferentsParPage, policesDeRepli } from "@/lib/test/pdf-lecture";
import { compacterDonnees, donneesPdfValides, partieImprimable, type DonneesPdfNavigateur } from "./donnees";
import { fabriquerPdf } from "./rendre";

/**
 * Le PDF fabriqué par le NAVIGATEUR (ici : le même code, sous Node) est celui du serveur, page pour
 * page, au pixel près : même semaine de commande (14 fiches), même titre, pied sous la dernière.
 * Le rendu « navigateur » passe en premier : sa police vient des données (base64), pas du disque.
 */
describe("PDF de la semaine fabriqué par le navigateur", () => {
  it("mêmes pages que le serveur, polices embarquées, avancement jour par jour", async () => {
    const jours = await Promise.all(SEMAINE_ESSAI.map(async (date) => ({ date, fiches: await fichesCommandeEssai({ date }) })));
    const titre = "Commande journalière — semaine 40, du 28/09 au 04/10";
    const pied = "Sorties sans motif : essai.";
    const parties = [];
    for (const [i, j] of jours.entries()) {
      const r = await feuillesCommande([j]);
      parties.push(documentImprimable(r.modele.gabarit, r.feuilles, titre, i === jours.length - 1 ? pied : undefined));
    }
    // Comme la route : compacté, puis passé par JSON.
    const transport = JSON.stringify(compacterDonnees("semaine.pdf", policesOptimaBase64(), parties));
    expect(transport.length).toBeLessThan(1_500_000); // 6,8 Mo avant la forme compacte
    const donnees = JSON.parse(transport) as DonneesPdfNavigateur;
    expect(donneesPdfValides(donnees)).toBe(true);
    expect(donnees.images).toHaveLength(1); // le logo, une seule fois pour 14 fiches
    expect(donnees.styles).toHaveLength(1);
    // L'aller-retour est exact : le navigateur imprime exactement ce que le serveur aurait imprimé.
    parties.forEach((doc, i) => expect(partieImprimable(donnees, i)).toEqual(JSON.parse(JSON.stringify(doc))));

    const avancement: string[] = [];
    const navigateur = Buffer.from(await fabriquerPdf(donnees, (f, t) => avancement.push(`${f}/${t}`)));
    expect(avancement).toEqual(["1/7", "2/7", "3/7", "4/7", "5/7", "6/7", "7/7"]);
    expect(policesDeRepli(navigateur)).toEqual([]);

    const serveur = await pdfModele(await feuillesCommande(jours), titre, pied);
    const attendu = (await pagesDuPdf(serveur)).map((p) => p.plat);
    expect((await pagesDuPdf(navigateur)).map((p) => p.plat)).toEqual(attendu);
    expect(attendu.filter((t) => t.includes(pied))).toHaveLength(1);
    expect((await pixelsDifferentsParPage(serveur, navigateur)).every((n) => n === 0)).toBe(true);
  }, 300_000);

  it("forme des données : une réponse incomplète n'engage pas le rendu", () => {
    const feuille = { rangees: [], logo: { ancre: {}, image: 0 } };
    const doc = { titre: "t", styles: 0, feuilles: [feuille] };
    const polices = { regular: "a", bold: "b", italic: "c", boldItalic: "d" };
    const ok = { fichier: "x.pdf", polices, images: ["png"], styles: [[]], parties: [doc] };
    expect(donneesPdfValides(ok)).toBe(true);
    expect(donneesPdfValides(null)).toBe(false);
    expect(donneesPdfValides({ ...ok, fichier: "" })).toBe(false);
    expect(donneesPdfValides({ ...ok, polices: { ...polices, bold: "" } })).toBe(false);
    expect(donneesPdfValides({ ...ok, parties: [] })).toBe(false);
    expect(donneesPdfValides({ ...ok, parties: [{ ...doc, feuilles: [] }] })).toBe(false);
    expect(donneesPdfValides({ ...ok, parties: [{ ...doc, styles: 1 }] })).toBe(false); // jeu de styles absent
    expect(donneesPdfValides({ ...ok, images: [] })).toBe(false); // logo référencé, absent
  });
});
