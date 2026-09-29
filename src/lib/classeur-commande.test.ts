import { describe, it, expect } from "vitest";
import fs from "node:fs";
import JSZip from "jszip";
import { analyserLignesCommande, lireClasseurCommande, type ArticleCatalogueImport, type LigneCommandeClasseur } from "./classeur-commande";

/**
 * « Importer les lignes du classeur Commande journalière » : lecture du classeur de la Direction et
 * correspondance avec le catalogue — exacte cochée, proche / homonyme à choisir, jamais devinée.
 */

const VRAI_CLASSEUR = `${process.env.HOME}/Downloads/PEF Commande Journalière.xlsx`;

/** Cellule : texte (fond 0), { t, fond } (fond 3 = surligné comme les rubriques), nombre, vide. */
type Cel = string | { t: string; fond: number } | number | null;
async function classeur(feuilles: Record<string, Cel[][]>): Promise<Uint8Array> {
  const z = new JSZip();
  const partages: string[] = [];
  const idx = (t: string) => { const i = partages.indexOf(t); if (i >= 0) return i; partages.push(t); return partages.length - 1; };
  const noms = Object.keys(feuilles);
  noms.forEach((nom, k) => {
    const rangees = feuilles[nom]!.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => {
      const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
      if (c === null) return "";
      if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
      const o = typeof c === "string" ? { t: c, fond: 0 } : c;
      return `<c r="${ref}" s="${o.fond}" t="s"><v>${idx(o.t)}</v></c>`;
    }).join("")}</row>`).join("");
    z.file(`xl/worksheets/sheet${k + 1}.xml`, `<worksheet><sheetData>${rangees}</sheetData></worksheet>`);
  });
  z.file("xl/workbook.xml", `<workbook><sheets>${noms.map((n, k) => `<sheet name="${n}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("")}</sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<Relationships>${noms.map((_, k) => `<Relationship Id="rId${k + 1}" Target="worksheets/sheet${k + 1}.xml"/>`).join("")}</Relationships>`);
  z.file("xl/sharedStrings.xml", `<sst>${partages.map((t) => `<si><t>${t.replace(/&/g, "&amp;").replace(/'/g, "&apos;")}</t></si>`).join("")}</sst>`);
  // Style n = fond n (0 = aucun ; 3 = orange des rubriques ; 4 = blanc de certaines lignes).
  z.file("xl/styles.xml", `<styleSheet><fonts count="1"><font><b/></font></fonts><cellXfs count="5">${[0, 1, 2, 3, 4].map((n) => `<xf fontId="0" fillId="${n}"/>`).join("")}</cellXfs></styleSheet>`);
  return z.generateAsync({ type: "uint8array" });
}
const R = (t: string) => ({ t, fond: 3 });

describe("lecture du classeur Commande journalière", () => {
  it("rubriques surlignées (avec ou sans « Commande | Livraison »), sous-rubriques numérotées, unités de la cuisine, feuille Salle ignorée", async () => {
    const r = await lireClasseurCommande(await classeur({
      "Fiche commande cuisine ": [
        ["Date : "], ["COMMANDE CUISINE", "Semaine", 32],
        [{ t: "Désignation/Date", fond: 2 }, "Unité", "Commande", "Livraison"],
        [R("Viande -Volaille-Poisson-Crustacé")],
        ["1. Viande Rouge"], ["Carré d'agneau ", "Kg"], ["Côtes de porc ", "Pièce"],
        ["5.Portions "], ["Portions Bolognaise", "Pièce"],
        [R("Crèmerie-Fromagerie"), "Commande", "Livraison"], ["Beurre", "Unité"],
        [R("Fruits & Légumes frais"), "Commande", "Livraison"], [{ t: "Ail", fond: 4 }, "Kg"],
      ],
      "Fiche commande Bar ": [
        [{ t: "Désignation", fond: 2 }, "Commande", "Livraison"],
        [R("Eau plate et petillante")], ["Acqua Panna"], [{ t: "S. pellegrino", fond: 4 }],
        [R("Bière importée")], ["Heineken importé"],
      ],
      "Fiche commande Salle": [["Désignation"], ["Nappe"]],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lignes.map((l) => `${l.feuille} ${l.rang}. ${l.rubrique} | ${l.nom} | ${l.unite ?? ""}`)).toEqual([
      "CUISINE 1. Viande -Volaille-Poisson-Crustacé — 1. Viande Rouge | Carré d'agneau | Kg",
      "CUISINE 2. Viande -Volaille-Poisson-Crustacé — 1. Viande Rouge | Côtes de porc | Pièce",
      "CUISINE 3. Viande -Volaille-Poisson-Crustacé — 5.Portions | Portions Bolognaise | Pièce",
      "CUISINE 4. Crèmerie-Fromagerie | Beurre | Unité",
      "CUISINE 5. Fruits & Légumes frais | Ail | Kg",
      "BAR 1. Eau plate et petillante | Acqua Panna | ",
      "BAR 2. Eau plate et petillante | S. pellegrino | ",
      "BAR 3. Bière importée | Heineken importé | ",
    ]);
  });

  it("refuse en clair un autre classeur (celui des ventes, par exemple) ou un fichier illisible", async () => {
    const ventes = await lireClasseurCommande(await classeur({ Cuisine: [["Designation/Date"], ["Carbonara"]], Bar: [["Designation/Date"], ["Coca"]] }));
    expect(ventes).toEqual({ ok: false, erreur: expect.stringContaining("« Fiche commande cuisine »") });
    expect(await lireClasseurCommande(new TextEncoder().encode("pas un zip"))).toEqual({ ok: false, erreur: expect.stringContaining("Fichier illisible") });
  });

  it.skipIf(!fs.existsSync(VRAI_CLASSEUR))("le VRAI classeur : ~190 lignes cuisine, ~140 bar, rubriques dans l'ordre", async () => {
    const r = await lireClasseurCommande(fs.readFileSync(VRAI_CLASSEUR));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cuisine = r.lignes.filter((l) => l.feuille === "CUISINE");
    const bar = r.lignes.filter((l) => l.feuille === "BAR");
    expect(cuisine.length).toBeGreaterThan(180);
    expect(bar.length).toBeGreaterThan(130);
    expect(cuisine[0]).toMatchObject({ rubrique: "Viande -Volaille-Poisson-Crustacé — 1. Viande Rouge", nom: "Carré d'agneau", unite: "Kg", rang: 1 });
    expect([...new Set(cuisine.map((l) => l.rubrique.split(" — ")[0]))]).toEqual([
      "Viande -Volaille-Poisson-Crustacé", "Crèmerie-Fromagerie", "Pâtes", "Fruits & Légumes frais", "Epices et assaisonements",
      "Autres", "Produits d'entretien & Autre non-alimentaire", "Boulangerie-Patisserie",
    ]);
    expect(bar[0]).toMatchObject({ rubrique: "Eau plate et petillante", nom: "Acqua Panna", rang: 1 });
    expect(bar.map((l) => l.rubrique)).toContain("Bière importée");
  }, 60_000);
});

describe("correspondance avec le catalogue", () => {
  const A = (id: string, designation: string, domaine: ArticleCatalogueImport["domaine"] = "NOURRITURE", extra: Partial<ArticleCatalogueImport> = {}): ArticleCatalogueImport =>
    ({ id, designation, nomCourt: null, domaine, surFicheCommande: false, ordreCommande: null, rubriqueCommande: null, ...extra });
  const L = (nom: string, rang: number, feuille: "CUISINE" | "BAR" = "CUISINE", rubrique = "Crèmerie-Fromagerie"): LigneCommandeClasseur => ({ feuille, rubrique, nom, unite: null, rang });

  it("exacte (casse et accents ignorés, désignation ou nom court) cochée ; proche, homonymes, absente décochées ; légume frais à part", () => {
    const articles = [
      A("cailles", "CAILLES"), A("agneau", "Lamb Rack NZ", "NOURRITURE", { nomCourt: "Carré d'agneau" }),
      A("b1", "Beurre Lurpak"), A("b2", "Elle & Vire Beurre"),
      A("m1", "Mozzarella"), A("m2", "mozzarella"),
      A("ail", "Ail"), A("coca", "Coca Cola", "BOISSON"),
    ];
    const p = analyserLignesCommande(
      [L("Cailles", 1), L("Carre d'Agneau", 2), L("Beurre", 3), L("Mozzarella", 4), L("Ail", 5), L("Gouda de chèvre", 6), L("Coca", 7), L("Coca Cola", 1, "BAR", "Limonade et autre"), L("Courgette", 8)],
      [...articles, A("courg", "courgettes")], ["Ail", "Oignons", "Courgettes"],
    );
    expect(p.map((x) => [x.nom, x.statut, x.articleId, x.cochee, x.candidats.map((c) => c.id)])).toEqual([
      ["Cailles", "EXACTE", "cailles", true, ["cailles"]],
      ["Carre d'Agneau", "EXACTE", "agneau", true, ["agneau"]], // par le nom court
      ["Beurre", "PROCHE", null, false, ["b1", "b2"]], // jamais choisi à la place de la Direction
      ["Mozzarella", "AMBIGUE", null, false, ["m1", "m2"]],
      ["Ail", "LEGUME", null, false, []], // la fiche l'imprime déjà (liste des légumes)
      ["Gouda de chèvre", "ABSENTE", null, false, []],
      ["Coca", "ABSENTE", null, false, []], // un article du bar ne se propose pas sur la feuille cuisine
      ["Coca Cola", "EXACTE", "coca", true, ["coca"]],
      ["Courgette", "LEGUME", null, false, []], // « Courgettes » de la liste, au pluriel près
    ]);
  });

  it("idempotence : un article déjà à ce rang, sous cette rubrique, avec son nom court, n'est pas recoché", () => {
    const p = analyserLignesCommande([L("Cailles", 1)], [A("c", "Cailles", "NOURRITURE", { surFicheCommande: true, ordreCommande: 1, rubriqueCommande: "Crèmerie-Fromagerie", nomCourt: "Cailles" })]);
    expect(p[0]).toMatchObject({ statut: "DEJA", cochee: false, articleId: "c" });
  });
});
