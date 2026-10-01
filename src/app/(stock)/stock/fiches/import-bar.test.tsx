// @vitest-environment happy-dom
//
// « Importer les fiches du bar » : ce que voit la Direction. Le VRAI classeur (fixture) est déposé ;
// les actions serveur sont remplacées par la même logique pure (rattacherFiches…) sur des fiches et
// un catalogue de test. On vérifie la simulation affichée, les correspondances sûres acceptées
// d'office, le blocage d'une unité inconvertible, l'action groupée, et ce qui part au serveur.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import JSZip from "jszip";
import { choisirEnTapant, choisirOption, libellesOuverts, listeOuverte, ouvrirChoix, taperChoix, toucheChoix } from "@/lib/test/choix-recherche";
import {
  rattacherFiches, rattacherIngredients, type ArticleExistant, type ChoixImportBar, type FicheBarLue, type FicheExistanteBar,
} from "@/lib/fiches/classeur-bar";

const F = (id: string, nom: string, categorie: string, nbIngredients = 0): FicheExistanteBar =>
  ({ id, nom, categorie, type: "BAR", estSousRecette: false, actif: true, nbIngredients, recetteVide: true, prixVenteTTC: 15 });
const FICHES = [F("pc", "Pina Colada", "Cocktail"), { ...F("pm", "Pina Colada", "Mocktail"), aPhoto: true }, F("mo", "Mojito", "Cocktail", 2), F("kir", "Kir Royal", "Apéritif"), F("gt", "Gin Tonic", "Cocktail", 3)];
const ARTICLES: ArticleExistant[] = [
  { id: "rum", designation: "Rum Saint James blc 70cl", unite: "L", prixUnitaireUSD: 17.8571, domaine: "BOISSON", contenance: null, contenanceUnite: null },
  { id: "bac", designation: "Bacardi blanc-1l", unite: "Bouteille", prixUnitaireUSD: 15, domaine: "BOISSON", contenance: null, contenanceUnite: null },
  { id: "cit", designation: "Citron", unite: "Kg", prixUnitaireUSD: 2, domaine: "NOURRITURE", contenance: null, contenanceUnite: null },
];

const appels = vi.hoisted(() => ({
  analyserFichesBar: vi.fn(),
  appliquerImportBar: vi.fn<(lues: unknown, choix: unknown) => Promise<unknown>>(async () => ({
    ok: true as const, remplies: ["Pina Colada"], creees: [], identiques: [], dejaRemplies: [], ignorees: [], nonEcrites: [], articlesCrees: ["Lait de Coco"], contenancesEcrites: [], lignesIgnorees: [], recettesConservees: [],
    fichesEcrites: [{ feuille: "Pinacolada cocktail", ficheId: "pc" }, { feuille: "PinaColada mocktail", ficheId: "pm" }],
  })),
  envoyerPhotoFicheImport: vi.fn<(ficheId: string, fd: FormData) => Promise<unknown>>(async () => ({ ok: true as const, statut: "ENVOYEE" })),
}));
vi.mock("./import-bar-actions", () => appels);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: unknown }) => createElement("a", { href, ...p }, children as never) }));

const { ImportFichesBar } = await import("./import-bar");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OCTETS = fs.readFileSync(path.join(process.cwd(), "src/lib/fiches/__fixtures__/fiches-bar.xlsx"));
let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  appels.analyserFichesBar.mockReset();
  appels.analyserFichesBar.mockImplementation(async (lues: FicheBarLue[]) => ({
    ok: true as const, fiches: rattacherFiches(lues, FICHES), ingredients: rattacherIngredients(lues, ARTICLES), articles: ARTICLES, fichesBar: FICHES,
  }));
  appels.appliquerImportBar.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => racine.unmount());
  conteneur.remove();
});

const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte)) as HTMLButtonElement;
const select = (label: string) => conteneur.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
// « Fiche visée par… » et « Article pour… » sont des champs où l'on tape (combobox), plus des <select> :
// `valeur` lit ce qui est choisi (l'id, comme l'ancienne valeur du select), `choisir` clique l'option.
const combo = (label: string) => conteneur.querySelector<HTMLInputElement>(`input[role="combobox"][aria-label="${label}"]`)!;
const valeur = (label: string) => combo(label).dataset.valeur;
const choisir = (label: string, id: string) => choisirOption(combo(label), id);
/** Titre du groupe (role="group" nommé par aria-labelledby) sous lequel une option est listée. */
const groupeDe = (option: Element) => {
  const g = option.closest('[role="group"]');
  return g ? document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent ?? null : null;
};
const choisirSelect = (s: HTMLSelectElement, v: string) => act(() => { s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); });
const ligne = (nom: string) => [...conteneur.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("td .font-medium")?.textContent === nom)!;

/** La fixture + des photos : Piña colada (propre), Virgin Piña Colada (propre, fiche qui a déjà une photo), Mojito ↔ Virgin Mojito (partagée), un logo partout. */
async function avecPhotos(): Promise<Uint8Array> {
  const z = await JSZip.loadAsync(OCTETS);
  const photos: Record<number, string[]> = { 1: ["pina.jpg"], 2: ["virgin.jpg"], 5: ["mojito.jpg"], 6: ["mojito.jpg"] };
  for (const [n, ms] of Object.entries(photos)) {
    z.file(`xl/worksheets/_rels/sheet${n}.xml.rels`, `<Relationships><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`);
    z.file(`xl/drawings/_rels/drawing${n}.xml.rels`, `<Relationships>${["logo.png", ...ms].map((m, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m}"/>`).join("")}</Relationships>`);
  }
  for (const m of ["logo.png", "pina.jpg", "virgin.jpg", "mojito.jpg"]) z.file(`xl/media/${m}`, new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
  return z.generateAsync({ type: "uint8array" });
}

async function deposer(octets: Uint8Array | Buffer = OCTETS) {
  act(() => racine.render(createElement(ImportFichesBar)));
  await act(async () => { bouton("Importer les fiches du bar").click(); });
  const input = conteneur.querySelector<HTMLInputElement>('input[type="file"]')!;
  const fichier = new File([octets as BlobPart], "Fiches techniques du bar.xlsx");
  Object.defineProperty(input, "files", { value: [fichier] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await vi.waitFor(() => expect(conteneur.textContent).toContain("1. Fiches"));
}

describe("Importer les fiches du bar — simulation", () => {
  it("dépose le classeur : 29 feuilles, correspondances sûres acceptées, le reste à décider ; rien n'est écrit", async () => {
    await deposer();
    expect(appels.analyserFichesBar).toHaveBeenCalledTimes(1);
    expect(appels.appliquerImportBar).not.toHaveBeenCalled();
    expect(valeur("Fiche visée par Piña colada")).toBe("fiche:pc");
    expect(valeur("Fiche visée par Virgin Piña Colada")).toBe("fiche:pm");
    expect(valeur("Fiche visée par Kir Royal")).toBe(""); // Apéritif ≠ Cocktail : jamais d'office
    expect(ligne("Kir Royal").textContent).toContain("à décider");
    // « Proches » : jamais sur la seule contenance (« COINTREAU 70CL » ≠ « Rum … 70cl »).
    await ouvrirChoix(combo("Article pour COINTREAU 70CL"));
    const rum = [...listeOuverte()!.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.dataset.choixId === "art:rum")!;
    expect(groupeDe(rum)).toBe("Catalogue"); // cherchable dans tout le catalogue, mais jamais proposé comme « proche »
    await toucheChoix(combo("Article pour COINTREAU 70CL"), "Escape");
    expect(valeur("Article pour RUM SAINT JAMES BLC 70CL")).toBe("art:rum");
    expect(ligne("RUM SAINT JAMES BLC 70CL").textContent).toContain("correspondance sûre");
    expect(valeur("Article pour Lait de Coco")).toBe("");
    // Le Mojito a déjà une recette : la case « Remplacer » est proposée, décochée.
    expect(ligne("Mojito").textContent).toContain("Remplacer la recette existante (2 ingrédient(s))");
    expect(conteneur.textContent).toContain("29 feuille(s) · 0 prête(s) · 28 à décider · 1 bloquée(s)");
    expect(bouton("Appliquer").disabled).toBe(true);
    expect(conteneur.textContent).toContain("« Liste des fournisseurs » (pas une fiche technique");
  });

  it("choisir des articles rend la fiche prête ; une unité inconvertible la bloque et le dit", async () => {
    await deposer();
    for (const l of ["Jus d'Ananas-100", "Lait de Coco", "Sirop de Sucre de canne-70", "MONIN COCONUT FRUIT 1LTR", "BACARDI BLC 1L"]) {
      await choisir(`Article pour ${l}`, "creer");
    }
    expect(ligne("Piña colada").textContent).toContain("prête");
    expect(ligne("Lait de Coco").textContent).toContain("cl → l"); // « Créer » : article au litre
    expect(bouton("Appliquer").textContent).toBe("Appliquer (2 fiches)");

    // Bouteille sans contenance : « 1 l, lu dans le nom », pré-rempli, visible, modifiable.
    await choisir("Article pour BACARDI BLC 1L", "art:bac");
    const qte = conteneur.querySelector<HTMLInputElement>('input[aria-label="Contenance de Bacardi blanc-1l"]')!;
    expect(qte.value).toBe("1");
    expect(select("Unité de contenance de Bacardi blanc-1l").value).toBe("l");
    expect(ligne("BACARDI BLC 1L").textContent).toContain("1 l, lu dans le nom — à vérifier · sera écrite sur l'article");
    expect(ligne("BACARDI BLC 1L").textContent).toContain("cl → Bouteille de 1 l");
    expect(ligne("Piña colada").textContent).toContain("prête");
    // Effacée : la ligne est bloquée tant qu'elle manque.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(qte, ""); qte.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(ligne("Piña colada").textContent).toContain("bloquée");
    expect(ligne("Piña colada").textContent).toContain("BACARDI BLC 1L : contenance de « Bacardi blanc-1l » à renseigner (1 Bouteille = combien ?)");
    expect(ligne("BACARDI BLC 1L").textContent).toContain("contenance à renseigner");
    expect(bouton("Appliquer").textContent).toBe("Appliquer (1 fiche)"); // reste la Virgin Piña Colada, sans rhum
  });

  it("unité réellement inconvertible (citron à l'unité, catalogue au kilo) : bloquée et dite", async () => {
    await deposer();
    expect(valeur("Article pour citron")).toBe("art:cit"); // même nom : sûr…
    expect(ligne("citron").textContent).toContain("unité → Kg : inconvertible"); // … mais inconvertible
    expect(ligne("Mojito").textContent).toContain("citron : unité inconvertible : unité → Kg");
  });

  it("« Accepter les correspondances sûres » remet les choix sûrs ; « Appliquer » envoie lues + choix après confirmation", async () => {
    await deposer();
    await choisir("Fiche visée par Piña colada", "ignorer");
    await choisir("Article pour RUM SAINT JAMES BLC 70CL", "ignorer");
    await act(async () => { bouton("Accepter les correspondances sûres").click(); });
    expect(valeur("Fiche visée par Piña colada")).toBe("fiche:pc");
    expect(valeur("Article pour RUM SAINT JAMES BLC 70CL")).toBe("art:rum");
    expect(valeur("Fiche visée par Kir Royal")).toBe(""); // l'action groupée ne décide rien d'autre
    // « Remplacer » coché pour la fiche Gin Tonic, puis l'action groupée remet le Mojito sur sa
    // correspondance sûre : la case, qui valait pour Gin Tonic, est décochée.
    await choisir("Fiche visée par Mojito", "fiche:gt");
    const caseMojito = () => ligne("Mojito").querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { caseMojito().click(); });
    expect(caseMojito().checked).toBe(true);
    await act(async () => { bouton("Accepter les correspondances sûres").click(); });
    expect(valeur("Fiche visée par Mojito")).toBe("fiche:mo");
    expect(caseMojito().checked).toBe(false);

    for (const l of ["Jus d'Ananas-100", "Lait de Coco", "Sirop de Sucre de canne-70", "MONIN COCONUT FRUIT 1LTR", "BACARDI BLC 1L"]) await choisir(`Article pour ${l}`, "creer");
    const confirmer = vi.fn<(message: string) => boolean>(() => true);
    vi.stubGlobal("confirm", confirmer);
    await act(async () => { bouton("Appliquer (2 fiches)").click(); });
    expect(confirmer.mock.calls[0]![0]).toContain("· 5 article(s) créé(s) au catalogue");
    expect(appels.appliquerImportBar).toHaveBeenCalledTimes(1);
    const [lues, choix] = appels.appliquerImportBar.mock.calls[0]! as unknown as [FicheBarLue[], ChoixImportBar];
    expect(lues).toHaveLength(29);
    expect(choix.fiches["Pinacolada cocktail"]).toEqual({ cible: "fiche:pc", categorie: "Cocktail", remplacer: false });
    expect(choix.ingredients["lait de coco"]).toEqual({ cible: "creer", domaine: "BOISSON" });
    await vi.waitFor(() => expect(conteneur.textContent).toContain("Import des fiches du bar terminé."));
    expect(conteneur.textContent).toContain("Articles créés au catalogue (1) : Lait de Coco");
  });

  it("refus de confirmation : rien n'est envoyé", async () => {
    await deposer();
    for (const l of ["Jus d'Ananas-100", "Lait de Coco", "Sirop de Sucre de canne-70", "MONIN COCONUT FRUIT 1LTR", "BACARDI BLC 1L"]) await choisir(`Article pour ${l}`, "creer");
    vi.stubGlobal("confirm", () => false);
    await act(async () => { bouton("Appliquer (2 fiches)").click(); });
    expect(appels.appliquerImportBar).not.toHaveBeenCalled();
  });

  it("photos : vignette, cochée si propre à la feuille, décochée si partagée, jamais sur une fiche qui en a une ; envoyées une par une après l'écriture", async () => {
    await deposer(await avecPhotos());
    const caseDe = (nom: string) => conteneur.querySelector<HTMLInputElement>(`input[aria-label="Importer la photo de ${nom}"]`)!;
    expect(ligne("Piña colada").querySelector("img")).not.toBeNull();
    expect(caseDe("Piña colada").checked).toBe(true);
    expect([caseDe("Virgin Piña Colada").checked, caseDe("Virgin Piña Colada").disabled]).toEqual([false, true]);
    expect(ligne("Virgin Piña Colada").textContent).toContain("la fiche a déjà une photo : gardée");
    expect(caseDe("Mojito").checked).toBe(false);
    expect(ligne("Mojito").textContent).toContain("partagée avec « Virgin Mojito »");
    expect(ligne("Blue Hawaiian").querySelector('input[aria-label^="Importer la photo"]')).toBeNull(); // le logo seul : rien

    for (const l of ["Jus d'Ananas-100", "Lait de Coco", "Sirop de Sucre de canne-70", "MONIN COCONUT FRUIT 1LTR", "BACARDI BLC 1L"]) await choisir(`Article pour ${l}`, "creer");
    const confirmer = vi.fn<(message: string) => boolean>(() => true);
    vi.stubGlobal("confirm", confirmer);
    await act(async () => { bouton("Appliquer (2 fiches)").click(); });
    expect(confirmer.mock.calls[0]![0]).toContain("· 1 photo(s) envoyée(s), une à une");
    await vi.waitFor(() => expect(conteneur.textContent).toContain("Photos importées (1) : Pinacolada cocktail"));
    expect(appels.envoyerPhotoFicheImport).toHaveBeenCalledTimes(1); // pas la mocktail : sa fiche a déjà une photo
    const [ficheId, fd] = appels.envoyerPhotoFicheImport.mock.calls[0]!;
    expect(ficheId).toBe("pc");
    expect((fd.get("photo") as File).type).toBe("image/jpeg");
  });

  it("article SANS unité : unité de stock jamais supposée (prix « par ? »), ligne bloquée jusqu'au choix, nommé dans la confirmation", async () => {
    const jus: ArticleExistant = { id: "jus", designation: "Jus d'Ananas-Ceres-1L", unite: null, prixUnitaireUSD: 2.86, domaine: "BOISSON", contenance: null, contenanceUnite: null };
    appels.analyserFichesBar.mockImplementationOnce(async (lues: FicheBarLue[]) => ({
      ok: true as const, fiches: rattacherFiches(lues, FICHES), ingredients: rattacherIngredients(lues, [...ARTICLES, jus]), articles: [...ARTICLES, jus], fichesBar: FICHES,
    }));
    await deposer();
    for (const l of ["Lait de Coco", "Sirop de Sucre de canne-70", "MONIN COCONUT FRUIT 1LTR", "BACARDI BLC 1L"]) await choisir(`Article pour ${l}`, "creer");
    await choisir("Article pour Jus d'Ananas-100", "art:jus");
    expect(select("Unité de stock de Jus d'Ananas-Ceres-1L").value).toBe(""); // jamais « Bouteille » d'office
    expect(conteneur.querySelector<HTMLInputElement>('input[aria-label="Contenance de Jus d\'Ananas-Ceres-1L"]')!.value).toBe("1");
    expect(ligne("Jus d'Ananas-100").textContent).toContain("prix actuel : 2,86 $ par ?");
    expect(ligne("Piña colada").textContent).toContain("bloquée");
    choisirSelect(select("Unité de stock de Jus d'Ananas-Ceres-1L"), "Brique");
    expect(ligne("Piña colada").textContent).toContain("prête");
    const confirmer = vi.fn<(message: string) => boolean>(() => false);
    vi.stubGlobal("confirm", confirmer);
    await act(async () => { bouton("Appliquer (2 fiches)").click(); });
    expect(confirmer.mock.calls[0]![0]).toContain("· unité de stock POSÉE sur des articles qui n'en avaient pas : Jus d'Ananas-Ceres-1L → Brique");
    expect(confirmer.mock.calls[0]![0]).toContain("· 1 contenance(s) écrite(s) au catalogue : Jus d'Ananas-Ceres-1L → 1 l");
  });

  it("« Créer » qui réutilise un article existant sans contenance : le champ contenance s'affiche", async () => {
    const coco: ArticleExistant = { id: "coco", designation: "Monin Coconut Fruit-1L", unite: "Bouteille", prixUnitaireUSD: 16, domaine: "BOISSON", contenance: null, contenanceUnite: null };
    appels.analyserFichesBar.mockImplementationOnce(async (lues: FicheBarLue[]) => {
      // Simulation d'une analyse antérieure à l'article : le libellé n'y était pas reconnu.
      const ingredients = rattacherIngredients(lues, ARTICLES);
      return { ok: true as const, fiches: rattacherFiches(lues, FICHES), ingredients, articles: [...ARTICLES, coco], fichesBar: FICHES };
    });
    await deposer();
    await choisir("Article pour MONIN COCONUT FRUIT 1LTR", "creer");
    expect(ligne("MONIN COCONUT FRUIT 1LTR").textContent).toContain("« Créer » : un article porte déjà ce nom et cette contenance, il sera réutilisé");
    expect(conteneur.querySelector<HTMLInputElement>('input[aria-label="Contenance de Monin Coconut Fruit-1L"]')!.value).toBe("1");
  });

  it("classeur à une seule feuille illustrée : la photo (peut-être le logo) est proposée DÉCOCHÉE", async () => {
    const z = await JSZip.loadAsync(OCTETS);
    z.file("xl/worksheets/_rels/sheet1.xml.rels", `<Relationships><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    z.file("xl/drawings/_rels/drawing1.xml.rels", `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>`);
    z.file("xl/media/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await deposer(await z.generateAsync({ type: "uint8array" }));
    expect(conteneur.querySelector<HTMLInputElement>('input[aria-label="Importer la photo de Piña colada"]')!.checked).toBe(false);
    expect(ligne("Piña colada").textContent).toContain("classeur trop court pour reconnaître le logo d'en-tête");
  });

  it("« Remplacer » : la confirmation dit que TOUTES les lignes (sous-recettes comprises) et les portions sont remplacées", async () => {
    await deposer();
    for (const l of ["Sirop de Sucre de canne-70", "Scheweppes Soda", "Feuille de menthe"]) await choisir(`Article pour ${l}`, "creer");
    await choisir("Article pour citron", "ignorer");
    expect(ligne("Mojito").textContent).toContain("déjà remplie");
    await act(async () => { ligne("Mojito").querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    expect(ligne("Mojito").textContent).toContain("prête");
    const confirmer = vi.fn<(message: string) => boolean>(() => false);
    vi.stubGlobal("confirm", confirmer);
    await act(async () => { bouton("Appliquer").click(); });
    expect(confirmer.mock.calls[0]![0]).toContain("dont 1 REMPLACÉE(S) (Mojito) : TOUTES leurs lignes actuelles, sous-recettes comprises, et leur nombre de portions sont remplacés par ceux du classeur");
    expect(appels.appliquerImportBar).not.toHaveBeenCalled();
  });
});

describe("Importer les fiches du bar — choisir en tapant", () => {
  it("un article du catalogue se trouve en tapant son nom (plus de « Chercher un autre article… »), mots dans le désordre", async () => {
    await deposer();
    expect(conteneur.textContent).not.toContain("Chercher un autre article");
    await taperChoix(combo("Article pour Lait de Coco"), "1l bacardi");
    expect(libellesOuverts()).toEqual(["Bacardi blanc-1l (Bouteille)"]);
    await toucheChoix(combo("Article pour Lait de Coco"), "Enter");
    expect(valeur("Article pour Lait de Coco")).toBe("art:bac");
    expect(combo("Article pour Lait de Coco").value).toBe("Bacardi blanc-1l (Bouteille)");
  });

  it("une fiche existante se trouve en tapant son nom ; « Créer » et « Ignorer » restent proposés", async () => {
    await deposer();
    await choisirEnTapant(combo("Fiche visée par Kir Royal"), "kir");
    expect(valeur("Fiche visée par Kir Royal")).toBe("fiche:kir");
    await ouvrirChoix(combo("Fiche visée par Kir Royal"));
    expect(libellesOuverts().slice(0, 3)).toContain("Créer la fiche « Kir Royal »");
    expect(libellesOuverts()).toContain("Ignorer cette feuille");
    await toucheChoix(combo("Fiche visée par Kir Royal"), "Escape");
  });

  it("les 29 feuilles et les ingrédients partagent UNE liste de fiches et UNE liste d'articles (une seule liste ouverte à la fois)", async () => {
    await deposer();
    await ouvrirChoix(combo("Article pour Lait de Coco"));
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    expect(conteneur.querySelectorAll('select[aria-label^="Article pour"], select[aria-label^="Fiche visée par"]')).toHaveLength(0);
  });
});

