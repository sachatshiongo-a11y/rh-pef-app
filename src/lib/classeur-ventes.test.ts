import { describe, it, expect } from "vitest";
import fs from "node:fs";
import JSZip from "jszip";
import { analyserLignesClasseur, lireClasseurVentes, ressemblance, type FicheExistante, type LigneClasseur } from "./classeur-ventes";

/**
 * « Importer les lignes du classeur » : lecture du classeur de la Direction (« PEF Rapport journalier
 * cuisine et bar ») et comparaison avec les fiches existantes. Un classeur synthétique fixe les
 * règles ; le VRAI classeur (25 Mo, logo TIFF) est relu quand il est présent sur la machine.
 */

const VRAI_CLASSEUR = "/Users/sachatshiongo/Documents/Pâtes en Folie/ PEF Rapport journalier cuisine et bar.xlsx";

type Cel = string | { t: string; gras?: boolean } | number | null;
/** Construit un .xlsx minimal : feuilles → rangées → cellules (texte, gras, nombre). */
async function classeur(feuilles: Record<string, Cel[][]>, extra: (z: JSZip) => void = () => {}): Promise<Uint8Array> {
  const z = new JSZip();
  const partages: string[] = [];
  const idx = (t: string) => { const i = partages.indexOf(t); if (i >= 0) return i; partages.push(t); return partages.length - 1; };
  const noms = Object.keys(feuilles);
  noms.forEach((nom, k) => {
    const rangees = feuilles[nom]!.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => {
      const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
      if (c === null) return `<c r="${ref}" s="0"/>`;
      if (typeof c === "number") return `<c r="${ref}" s="0"><v>${c}</v></c>`;
      const o = typeof c === "string" ? { t: c } : c;
      return `<c r="${ref}" s="${o.gras ? 1 : 0}" t="s"><v>${idx(o.t)}</v></c>`;
    }).join("")}</row>`).join("");
    z.file(`xl/worksheets/sheet${k + 1}.xml`, `<worksheet><sheetData>${rangees}</sheetData></worksheet>`);
  });
  z.file("xl/workbook.xml", `<workbook><sheets>${noms.map((n, k) => `<sheet name="${n}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("")}</sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<Relationships>${noms.map((_, k) => `<Relationship Id="rId${k + 1}" Target="worksheets/sheet${k + 1}.xml"/>`).join("")}</Relationships>`);
  z.file("xl/sharedStrings.xml", `<sst>${partages.map((t) => `<si><t xml:space="preserve">${t.replace(/&/g, "&amp;").replace(/'/g, "&apos;")}</t></si>`).join("")}</sst>`);
  z.file("xl/styles.xml", `<styleSheet><fonts count="2"><font><sz val="12"/></font><font><b/><sz val="12"/></font></fonts><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`);
  extra(z);
  return z.generateAsync({ type: "uint8array" });
}

const G = (t: string) => ({ t, gras: true });
const ENTETE: Cel[] = [G("Designation/Date "), G("Lun"), G("Mar")];

describe("lecture du classeur", () => {
  it("rubriques en gras, sous-rubriques, formats de vente (« Verre »…), en-têtes répétés et nombres ignorés, ordre du classeur", async () => {
    const r = await lireClasseurVentes(await classeur({
      "Cuisine ": [
        [G("Rapport journalier cuisine "), "Semaine", 8],
        [], ENTETE, [null, 46076, 46077],
        [G("Entrées Froides ")], ["Duo de capitaine et saumon fumé  et vinaigrette  maracuja "], ["Salade composée de chez nous"],
        [G("Pâtes")], ["Farfalle"],
        [G("Supplément ")], // rubrique sans ligne : ignorée
      ],
      "Bar ": [
        ENTETE,
        [G("Vin blanc")], ["Vin blanc maison"], ["Verre"], ["Pichet 1/4"], ["Bouteille"], ["Vieux Pape blanc"],
        [G("Vin rouge")], [G("Français")], ["Tour Prignac"], [G("Italien")], ["Chianti Superiore"],
        [null, G("Lundi"), G("Mardi")], ENTETE, // en-têtes répétés au milieu de la feuille
        [G("Bière locale")], ["Heineken"], [G("Bière importée")], ["Heineken"], ["Castel & Co"],
      ],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vue = (f: string) => r.lignes.filter((l) => l.feuille === f).map((l) => `${l.rang}. ${l.rubrique} | ${l.nom}`);
    expect(vue("CUISINE")).toEqual([
      "1. Entrées Froides | Duo de capitaine et saumon fumé et vinaigrette maracuja",
      "2. Entrées Froides | Salade composée de chez nous",
      "3. Pâtes | Farfalle",
    ]);
    expect(vue("BAR")).toEqual([
      "1. Vin blanc | Vin blanc maison — Verre",
      "2. Vin blanc | Vin blanc maison — Pichet 1/4",
      "3. Vin blanc | Vin blanc maison — Bouteille",
      "4. Vin blanc | Vieux Pape blanc",
      "5. Vin rouge — Français | Tour Prignac",
      "6. Italien | Chianti Superiore",
      "7. Bière locale | Heineken",
      "8. Bière importée | Heineken",
      "9. Bière importée | Castel & Co",
    ]);
  });

  it("refuse en clair un fichier qui n'est pas ce classeur (jamais une exception)", async () => {
    const pasZip = await lireClasseurVentes(new TextEncoder().encode("bonjour"));
    expect(pasZip).toEqual({ ok: false, erreur: expect.stringContaining("Fichier illisible") });
    const autreClasseur = await lireClasseurVentes(await classeur({ "Fiche commande cuisine": [ENTETE, ["Beurre"]], Bar: [ENTETE, ["Coca"]] }));
    expect(autreClasseur).toEqual({ ok: false, erreur: expect.stringContaining("feuille « Cuisine » et une feuille « Bar »") });
    const sansColonne = await lireClasseurVentes(await classeur({ Cuisine: [["Carbonara"]], Bar: [ENTETE, ["Coca"]] }));
    expect(sansColonne).toEqual({ ok: false, erreur: expect.stringContaining("Designation/Date") });
    expect((await lireClasseurVentes(new Uint8Array(61 * 1024 * 1024))).ok).toBe(false); // trop lourd, rien n'est lu
  });

  it("ne décompresse jamais les images (le logo TIFF de 25 Mo du vrai classeur)", async () => {
    const donnees = await classeur({ Cuisine: [ENTETE, ["Carbonara"]], Bar: [ENTETE, ["Coca"]] }, (z) => z.file("xl/media/image1.tiff", new Uint8Array(1024)));
    // Espion sur la décompression d'une entrée de l'archive (ZipObject.async).
    const proto = Object.getPrototypeOf((await JSZip.loadAsync(donnees)).file("xl/workbook.xml")!) as { async: (...a: unknown[]) => Promise<unknown> };
    const original = proto.async;
    const lues: string[] = [];
    proto.async = function (this: { name: string }, ...a: unknown[]) { lues.push(this.name); return original.apply(this, a); };
    try {
      expect((await lireClasseurVentes(donnees)).ok).toBe(true);
    } finally {
      proto.async = original;
    }
    expect(lues).toContain("xl/worksheets/sheet1.xml"); // l'espion voit bien les lectures
    expect(lues.filter((n) => n.includes("media"))).toEqual([]);
  });

  it.skipIf(!fs.existsSync(VRAI_CLASSEUR))("le VRAI classeur de la Direction : 50 lignes Cuisine, 140 lignes Bar, dans son ordre", async () => {
    const r = await lireClasseurVentes(fs.readFileSync(VRAI_CLASSEUR));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cuisine = r.lignes.filter((l) => l.feuille === "CUISINE");
    const bar = r.lignes.filter((l) => l.feuille === "BAR");
    expect(cuisine).toHaveLength(50);
    expect(bar).toHaveLength(140);
    expect([...new Set(cuisine.map((l) => l.rubrique))]).toEqual([
      "Entrées Froides", "Entrées chaudes", "Pâtes classiques", "Pâtes en Folie", "Pâtes", "Autres accompagnements", "Desserts",
    ]);
    expect(cuisine[0]).toEqual({ feuille: "CUISINE", rubrique: "Entrées Froides", nom: "Duo de capitaine et saumon fumé et vinaigrette maracuja", rang: 1 });
    expect(bar.map((l) => l.nom)).toContain("Vin blanc maison — Verre");
    expect(bar.map((l) => l.nom)).not.toContain("Vin blanc maison"); // intitulé de formats, pas une vente
    expect(bar.find((l) => l.nom === "Tour Prignac")!.rubrique).toBe("Vin rouge — Français");
    expect(bar.at(-1)).toMatchObject({ rubrique: "Cocktail", nom: "Tequila Sunrise", rang: 140 });
  }, 60_000);
});

describe("comparaison avec les fiches existantes", () => {
  const f = (id: string, nom: string, categorie: string | null, type: "PLAT" | "BAR" = "PLAT", extra: Partial<FicheExistante> = {}): FicheExistante =>
    ({ id, nom, categorie, type, estSousRecette: false, libelleVente: null, ...extra });
  const L = (feuille: "CUISINE" | "BAR", rubrique: string, nom: string, rang: number): LigneClasseur => ({ feuille, rubrique, nom, rang });

  it("présente, à créer, « proche de » (jamais fusionnée), rubrique « Pâtes » décochée, orthographe de rubrique reprise", () => {
    const fiches = [
      f("bolo", "Bolognaise", "Pâtes classiques"),
      f("duo", "Duo de capitaine et de saumon fumé", "Entrées froides"),
      f("sauce", "Pesto", "Pâtes classiques", "PLAT", { estSousRecette: true }),
      f("salade", "Salade farfalle façon césar", "Entrées froides"),
    ];
    const p = analyserLignesClasseur([
      L("CUISINE", "Entrées Froides ", "Duo de capitaine et saumon fumé et vinaigrette maracuja", 1),
      L("CUISINE", "Entrées Froides ", "Salade composée de chez nous", 2),
      L("CUISINE", "Pâtes classiques", "BOLOGNAISE", 3),
      L("CUISINE", "Pâtes classiques", "Pesto", 4),
      L("CUISINE", "Pâtes", "Penne", 5),
    ], fiches);
    const vue = Object.fromEntries(p.map((x) => [x.nom, { statut: x.statut, action: x.action, rubrique: x.rubrique, ficheId: x.ficheId, proches: x.proches.map((y) => y.libelle) }]));
    expect(vue["BOLOGNAISE"]).toEqual({ statut: "PRESENTE", action: "ordre", rubrique: "Pâtes classiques", ficheId: "bolo", proches: [] });
    expect(vue["Duo de capitaine et saumon fumé et vinaigrette maracuja"]).toEqual({
      statut: "ABSENTE", action: "ignorer", rubrique: "Entrées froides", ficheId: "duo", proches: ["Duo de capitaine et de saumon fumé (Entrées froides)"],
    });
    expect(vue["Salade composée de chez nous"]).toMatchObject({ statut: "ABSENTE", action: "creer", rubrique: "Entrées froides", proches: [] });
    // Même nom qu'une SOUS-RECETTE : signalé, décoché, jamais rattaché (ce n'est pas un plat vendu).
    expect(vue["Pesto"]).toMatchObject({ statut: "ABSENTE", action: "ignorer", ficheId: null, proches: ["même nom : Pesto (Pâtes classiques) — sous-recette"] });
    expect(vue["Penne"]).toMatchObject({ statut: "ABSENTE", action: "ignorer", proches: [] }); // rubrique « Pâtes »
  });

  it("un nom répété dans la feuille (« Heineken » locale / importée) : présent seulement dans SA rubrique", () => {
    const p = analyserLignesClasseur(
      [L("BAR", "Bière locale", "Heineken", 1), L("BAR", "Bière importée", "Heineken", 2)],
      [f("h1", "Heineken", "Bière locale", "BAR")],
    );
    expect(p.map((x) => [x.rubriqueClasseur, x.statut, x.action])).toEqual([["Bière locale", "PRESENTE", "ordre"], ["Bière importée", "ABSENTE", "ignorer"]]);
    expect(p[1]!.proches[0]!.libelle).toBe("même nom : Heineken (Bière locale) — fiche Bar");
  });

  it("faute de frappe probable par rapport aux articles du bar : signalée et décochée ; une simple ressemblance ne l'est pas", () => {
    const p = analyserLignesClasseur(
      [L("BAR", "Gin", "Gery Goose", 1), L("BAR", "Rhum", "Havaba Club", 2), L("BAR", "Limonade", "Coca", 3), L("BAR", "Apéritif", "Spritz", 4), L("BAR", "Champagne", "Ruinart Blanc de Blancs", 5)],
      [], ["Grey Goose 75cl", "Havana Club 70cl", "Noix de coco purée", "Sprite", "Ruinart Blanc &Blancs", "Martini blanc blanc 75cl"],
    );
    expect(p.map((x) => [x.nom, x.action, x.proches.map((y) => y.libelle)])).toEqual([
      ["Gery Goose", "ignorer", ["orthographe proche de l'article du bar « Grey Goose 75cl »"]],
      ["Havaba Club", "ignorer", ["orthographe proche de l'article du bar « Havana Club 70cl »"]],
      ["Coca", "creer", []],
      ["Spritz", "creer", []],
      ["Ruinart Blanc de Blancs", "creer", []], // un article l'écrit exactement (au pluriel près)
    ]);
  });

  it("idempotence : une fiche créée par l'import (nom ou libellé) est « présente » au passage suivant", () => {
    const p = analyserLignesClasseur([L("CUISINE", "Desserts", "Tiramisu aux fruits exotiques", 1), L("CUISINE", "Pâtes classiques", "aux quatre fromages", 2)], [
      f("t", "Tiramisu aux fruits exotiques", "Desserts"),
      f("q", "4 fromages", "Pâtes classiques", "PLAT", { libelleVente: "aux quatre fromages" }),
    ]);
    expect(p.map((x) => [x.statut, x.ficheId])).toEqual([["PRESENTE", "t"], ["PRESENTE", "q"]]);
  });

  it("ressemblance : mots significatifs, singulier, une faute de frappe près (jamais sur un nombre)", () => {
    expect(ressemblance("Gratiné de cossa au beurre de corai", "Gratiné de cossas de Mayombe au beurre de corail")).toEqual({ score: 1, flou: true });
    expect(ressemblance("aux quatre fromages", "4 fromages")).toEqual({ score: 1, flou: false });
    expect(ressemblance("Glenfiddich 12", "Glenfiddich 15 ans 70cl").score).toBe(0.5);
    expect(ressemblance("Lasagne Végétarienne", "Lasagne classique").score).toBe(0.5);
  });
});
