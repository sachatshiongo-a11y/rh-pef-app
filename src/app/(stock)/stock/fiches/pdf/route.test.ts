import { describe, it, expect, vi, beforeEach } from "vitest";

// PDF des fiches techniques : droits de l'espace Stock (comme l'Excel), sélection et ordre (comme
// l'Excel), version chiffrée SEULEMENT sur demande explicite (`?prix=avec`), photos transmises.
// Le document et le rendu sont remplacés : on vérifie QUELLES fiches partent, dans quel ordre, et
// avec quoi.

const etat = vi.hoisted(() => ({
  garde: { ok: true } as { ok: true } | { ok: false; reponse: Response },
  fiches: null as null | { nom: string; chiffres: unknown; photo: unknown }[],
  editeLe: "",
  chargements: 0,
  photosDemandees: [] as string[],
}));

vi.mock("@/lib/garde-route", () => ({ exigerEspaceStock: async () => etat.garde }));
vi.mock("@/lib/pdf/fonts", () => ({ renderPdfBuffer: async () => Buffer.from("%PDF-factice") }));
vi.mock("@/lib/pdf/fiche-technique", () => ({
  FichesTechniquesDocument: (p: { fiches: NonNullable<typeof etat.fiches>; editeLe: string }) => { etat.fiches = p.fiches; etat.editeLe = p.editeLe; return null; },
}));
vi.mock("@/lib/fiches/photo-fiche-pdf", () => ({
  chargerPhotosPdf: async (fiches: { id: string; photoUrl: string | null }[]) => {
    etat.photosDemandees = fiches.map((f) => f.id);
    return new Map(fiches.filter((f) => f.photoUrl).map((f) => [f.id, { data: Buffer.from(f.id), format: "jpg" }]));
  },
}));

const vue = (id: string, nom: string, categorie: string, type: "PLAT" | "BAR", estSousRecette = false, photoUrl: string | null = null) => ({
  id, nom, categorie, type, nbPortions: 1, tauxTVA: "0.16", prixVenteTTC: "10", coefficientMargeCible: "",
  estSousRecette, rendementQuantite: "", rendementUnite: "", recette: "", actif: true, photoUrl,
  lignes: [{ id: `${id}-l1`, articleId: "a1", sousFicheId: null, unite: "g", quantite: "100", ordre: 1 }],
});
// Ordre du chargement réel : catégorie puis nom.
const VUES = [
  vue("sauce", "Sauce tomate", "Bases", "PLAT", true),
  vue("rhum", "Rhum arrangé", "Rhum", "BAR"),
  vue("mojito", "Mojito", "Cocktail", "BAR", false, "/fichiers/fiches-techniques/mojito.jpg"),
  vue("virgin", "Virgin colada", "Mocktail", "BAR"),
  vue("bolo", "Bolognaise", "Pâtes classiques", "PLAT"),
  vue("bordeaux", "Bordeaux", "Vin rouge", "BAR"),
];
vi.mock("../_data/charger-fiche", () => ({
  chargerFichesVues: async () => { etat.chargements++; return VUES; },
  chargerArticlesDesFiches: async () => [{ id: "a1", designation: "Farine", unite: "kg", prixUnitaireUSD: "2", actif: true }],
}));

const { GET } = await import("./route");
const exporter = async (qs: string) => {
  const r = await GET(new Request(`http://x/stock/fiches/pdf${qs}`));
  return { r, noms: (etat.fiches ?? []).map((f) => f.nom) };
};

beforeEach(() => {
  etat.garde = { ok: true };
  etat.fiches = null;
  etat.chargements = 0;
  etat.photosDemandees = [];
});

describe("PDF des fiches — droits", () => {
  it("hors de l'espace Stock : la réponse du garde, et RIEN n'est lu en base", async () => {
    etat.garde = { ok: false, reponse: new Response("Accès refusé", { status: 403 }) };
    const { r } = await exporter("?vue=boissons&prix=avec");
    expect(r.status).toBe(403);
    expect(etat.chargements).toBe(0);
    expect(etat.fiches).toBeNull();
  });
});

describe("PDF des fiches — sélection et ordre (les mêmes que l'Excel)", () => {
  it("?vue=boissons : les boissons seules, cocktails & mocktails d'abord", async () => {
    const { r, noms } = await exporter("?vue=boissons&prix=avec");
    expect(noms).toEqual(["Mojito", "Virgin colada", "Rhum arrangé", "Bordeaux"]);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("Content-Disposition")).toMatch(/^attachment; filename="Fiches_techniques_Boissons_\d{4}-\d{2}-\d{2}\.pdf"$/);
  });

  it("?vue=plats : les plats et les sous-recettes, aucune boisson", async () => {
    const { noms } = await exporter("?vue=plats&prix=avec");
    expect(noms).toEqual(["Sauce tomate", "Bolognaise"]);
  });

  it("la sélection (?ids=) : exactement les fiches choisies, dans l'ordre de l'écran", async () => {
    const { noms } = await exporter("?vue=boissons&ids=bordeaux,mojito&prix=avec");
    expect(noms).toEqual(["Mojito", "Bordeaux"]);
  });

  it("une seule fiche (page de la fiche) : son nom dans le fichier", async () => {
    const { r, noms } = await exporter("?ids=bolo&prix=sans");
    expect(noms).toEqual(["Bolognaise"]);
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="Fiche_technique_Bolognaise_sans_prix.pdf"');
  });

  it("aucune fiche retenue : 404 lisible, pas un PDF vide", async () => {
    const { r } = await exporter("?ids=inconnue&prix=avec");
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("Aucune fiche technique à exporter.");
    expect(etat.fiches).toBeNull();
  });
});

describe("PDF des fiches — avec ou sans prix", () => {
  it("?prix=avec : chaque fiche porte ses chiffres (moteur)", async () => {
    await exporter("?vue=plats&prix=avec");
    expect(etat.fiches!.every((f) => f.chiffres !== null)).toBe(true);
  });

  it("?prix=sans, valeur inconnue ou absente : AUCUN chiffre transmis au document", async () => {
    for (const qs of ["?vue=plats&prix=sans", "?vue=plats&prix=AVEC", "?vue=plats&prix=1", "?vue=plats"]) {
      etat.fiches = null;
      const { r } = await exporter(qs);
      expect(etat.fiches!.length, qs).toBe(2);
      expect(etat.fiches!.every((f) => f.chiffres === null), qs).toBe(true);
      expect(r.headers.get("Content-Disposition"), qs).toContain("_sans_prix.pdf");
    }
  });
});

describe("PDF des fiches — photos", () => {
  it("seules les fiches exportées sont lues ; la photo arrive sur SA fiche, les autres n'en ont pas", async () => {
    await exporter("?vue=boissons&prix=sans");
    expect(etat.photosDemandees.sort()).toEqual(["bordeaux", "mojito", "rhum", "virgin"]);
    const parNom = new Map(etat.fiches!.map((f) => [f.nom, f.photo]));
    expect(parNom.get("Mojito")).toEqual({ data: Buffer.from("mojito"), format: "jpg" });
    expect(parNom.get("Bordeaux")).toBeNull();
  });
});
