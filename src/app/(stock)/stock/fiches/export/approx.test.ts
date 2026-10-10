import { describe, it, expect, vi, beforeEach } from "vitest";

// Audit restaurant du 10/10/2026 — un coût qui passe par un article au prix en FRANCS (converti en
// dollars au taux du jour) est « ≈ » à l'écran ; il l'est aussi dans l'Excel et le PDF des fiches,
// dans la cellule / le total — jamais exporté comme un chiffre exact.

const recu = vi.hoisted(() => ({ classeur: null as null | { feuilles: { entete: string[]; lignes: unknown[][] }[] } }));
vi.mock("@/lib/garde-route", () => ({ exigerEspaceStock: async () => ({ ok: true }) }));
vi.mock("@/lib/export-excel", () => ({
  classeurExcel: async (c: NonNullable<typeof recu.classeur>) => { recu.classeur = c; return Buffer.from(""); },
}));
const ligne = (id: string, articleId: string) => ({ id, articleId, sousFicheId: null, unite: "kg", quantite: "2", ordre: 1 });
const vue = (id: string, nom: string, articleId: string, extra: Record<string, unknown> = {}) => ({
  id, nom, categorie: "Pâtes", type: "PLAT" as const, nbPortions: 1, tauxTVA: "0.16", prixVenteTTC: "20", coefficientMargeCible: "",
  estSousRecette: false, rendementQuantite: "", rendementUnite: "", recette: "", actif: true, photoUrl: null, lignes: [ligne(`${id}-l`, articleId)], ...extra,
});
const VUES = [vue("exact", "Plat exact", "usd"), vue("approx", "Plat en francs", "fc"), vue("partiel", "Plat partiel", "fc", { lignes: [ligne("p1", "fc"), { id: "p2", articleId: null, sousFicheId: null, unite: "kg", quantite: "1", ordre: 2 }] })];
const ARTICLES = [
  { id: "usd", designation: "Farine", unite: "kg", prixUnitaireUSD: "3", actif: true },
  { id: "fc", designation: "Riz (prix en francs)", unite: "kg", prixUnitaireUSD: "3", prixApprox: true, prixSaisi: { devise: "CDF", montant: "8400" }, actif: true },
];
vi.mock("../_data/charger-fiche", () => ({ chargerFichesVues: async () => VUES, chargerArticlesDesFiches: async () => ARTICLES }));

const { GET } = await import("./route");
const { construireContexte } = await import("../_data/fiche-calc");
const { versFichePdf } = await import("../_data/fiche-pdf");

beforeEach(() => { recu.classeur = null; });

describe("export Excel des fiches : le coût « ≈ » le dit dans sa cellule", () => {
  it("coût exact : un NOMBRE ; coût au prix en francs : « ≈ 6 (converti au taux du jour) » ; partiel : « ≥ » prime, la cause reste dite", async () => {
    await GET(new Request("http://x/stock/fiches/export?vue=plats"));
    const f = recu.classeur!.feuilles[0]!;
    const iCout = f.entete.indexOf("Coût total HT USD");
    const iPortion = f.entete.indexOf("Coût / portion HT USD");
    const iPvHt = f.entete.indexOf("PV HT USD");
    const iMarge = f.entete.indexOf("Marge brute USD");
    const parNom = (nom: string) => f.lignes.find((l) => l[0] === nom)!;
    expect(parNom("Plat exact")[iCout]).toBe(6);
    expect(parNom("Plat exact")[iMarge]).toEqual(expect.any(Number));
    expect(parNom("Plat en francs")[iCout]).toBe("≈ 6 (converti au taux du jour)");
    expect(parNom("Plat en francs")[iPortion]).toBe("≈ 6 (converti au taux du jour)");
    // La marge dérive du coût : « ≈ » aussi. Le prix de vente DÉCIDÉ (20 TTC), lui, ne dépend pas du coût.
    expect(String(parNom("Plat en francs")[iMarge])).toMatch(/^≈ .*converti au taux du jour/);
    expect(typeof parNom("Plat en francs")[iPvHt]).toBe("number");
    expect(parNom("Plat partiel")[iCout]).toBe("≥ 6 (coût partiel, converti au taux du jour)");
  });
});

describe("PDF des fiches : « ≈ » devant le coût, la ligne et le total ; la fiche en dollars reste exacte", () => {
  const ctx = () => {
    const articles = new Map(ARTICLES.map((a) => [a.id, a]));
    return { contexte: construireContexte(VUES, articles), articles, noms: new Map(VUES.map((v) => [v.id, { nom: v.nom }])), vues: new Map(VUES.map((v) => [v.id, v])) };
  };
  const pdf = (id: string) => versFichePdf(VUES.find((v) => v.id === id)!, ctx(), { avecPrix: true, photo: null }).chiffres!;

  it("fiche au prix en francs", () => {
    const c = pdf("approx");
    expect(c.cout.map((i) => i.valeur)).toEqual(["≈ 6,00 $", "≈ 6,00 $"]);
    expect(c.lignes[0]!.cout).toBe("≈ 6,00 $");
    expect(c.total).toBe("≈ 6,00 $");
    expect(c.avertissements.some((a) => a.includes("converti en dollars au taux du jour"))).toBe(true);
  });

  it("fiche en dollars : aucun « ≈ »", () => {
    const c = pdf("exact");
    expect(c.cout.map((i) => i.valeur)).toEqual(["6,00 $", "6,00 $"]);
    expect(c.total).toBe("6,00 $");
    expect(c.avertissements).toEqual([]);
  });

  it("sans la carte des fiches dans le contexte, rien n'est qualifié (ancien appel inchangé)", () => {
    const { vues: _v, ...sans } = ctx();
    void _v;
    expect(versFichePdf(VUES[1]!, sans, { avecPrix: true, photo: null }).chiffres!.total).toBe("6,00 $");
  });
});
