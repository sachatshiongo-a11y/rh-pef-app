// @vitest-environment happy-dom
//
// Barre d'actions groupées de l'Inventaire (Direction, 2026-10-14) : « Supprimer (N) » (Direction seule, en rouge, avec un
// aperçu puis une confirmation) et « Unité » (Appliquer (N) pour la Direction, Proposer (N) pour les autres, avec la
// confirmation quand des articles ont du stock, un historique, un prix, une fiche ou un rattachement).
// Les actions serveur sont simulées : ce test prouve le rendu par rôle et l'enchaînement des gestes, pas la base
// (voir suppression-masse.integration.test.ts et unite-masse.integration.test.ts pour les règles).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CLASSES_DANGER, CLASSES_GEOMETRIE } from "@/components/action-buttons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = vi.hoisted(() => ({
  changerUnite: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  apercuSuppression: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  supprimer: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  basculerActif: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => undefined),
}));
vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: vi.fn(), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(), changerDomaineEnMasse: vi.fn(),
  basculerActifArticles: (...a: unknown[]) => A.basculerActif(...a), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), ajouterFournisseurEnMasse: vi.fn(), retirerFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(),
  corrigerStocksNegatifs: vi.fn(),
  changerUniteEnMasse: (...a: unknown[]) => A.changerUnite(...a),
  apercuSuppressionArticles: (...a: unknown[]) => A.apercuSuppression(...a),
  supprimerArticlesEnMasse: (...a: unknown[]) => A.supprimer(...a),
}));

const { CatalogueTable } = await import("./catalogue-table");
type ArticleRow = Parameters<typeof CatalogueTable>[0]["articles"][number];

const base = { code: null, surFicheCommande: false, domaine: "NOURRITURE" as const, categorieId: "c1", fournisseurId: null, uniteParCarton: null, prix: "2", haussePct: null, stockMinimum: "1", niveau: "OK" as const };
const ARTICLES: ArticleRow[] = [
  { ...base, id: "a1", designation: "Cannelle", unite: "kg", quantite: "0" },
  { ...base, id: "a2", designation: "Farine", unite: "Kg", quantite: "12" },
  { ...base, id: "a3", designation: "Levure", unite: "g", quantite: "3" },
];

let conteneur: HTMLDivElement;
let racine: Root;
const monter = (estDirection: boolean) => act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: [{ id: "c1", nom: "Farines", domaine: "NOURRITURE" }], fournisseurs: [], estDirection })));
beforeEach(() => {
  for (const f of Object.values(A)) f.mockReset();
  A.basculerActif.mockResolvedValue(undefined);
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; });

const cocher = async (...noms: string[]) => {
  for (const n of noms) {
    const ligne = [...conteneur.querySelectorAll("table tbody tr")].find((tr) => [...tr.querySelectorAll("a")].some((a) => a.textContent === n))!;
    await act(async () => { ligne.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
  }
};
const bouton = (texte: string | RegExp) => [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => (typeof texte === "string" ? b.textContent === texte : texte.test(b.textContent ?? "")));
const cliquer = async (b: HTMLElement | undefined) => { expect(b, "bouton introuvable").toBeTruthy(); await act(async () => { b!.click(); }); };
const saisirUnite = async (v: string) => {
  const champ = conteneur.querySelector<HTMLInputElement>('input[aria-label="Nouvelle unité des articles sélectionnés"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(champ, v);
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("rendu de la barre par rôle", () => {
  it("Direction : « Supprimer (N) » en rouge (famille action-buttons) et « Appliquer (N) » pour l'unité", async () => {
    monter(true);
    await cocher("Cannelle", "Farine");
    const sup = bouton("Supprimer (2)")!;
    expect(sup).toBeTruthy();
    expect(sup.className).toContain(CLASSES_DANGER); // contour rouge plein de la norme, pas une peinture à la main
    expect(sup.hasAttribute("data-supprimer-lot")).toBe(true);
    const unite = bouton("Appliquer (2)")!;
    expect(unite).toBeTruthy();
    expect(unite.disabled).toBe(true); // pas d'unité saisie
    await saisirUnite("g");
    expect(bouton("Appliquer (2)")!.disabled).toBe(false);
    // Les listes de suggestion reprennent les unités du catalogue (Kg, kg, g) et les usuelles.
    const suggestions = [...conteneur.querySelectorAll("datalist#unites-inventaire option")].map((o) => o.getAttribute("value"));
    expect(suggestions).toEqual(expect.arrayContaining(["kg", "Kg", "g", "Pièce", "Bouteille"]));
  });

  it("autre rôle : « Proposer (N) » pour l'unité, AUCUN bouton Supprimer ni Fusionner", async () => {
    monter(false);
    await cocher("Cannelle", "Farine");
    expect(bouton(/^Supprimer/)).toBeUndefined();
    expect(bouton("Fusionner en 1…")).toBeUndefined();
    expect(bouton("Proposer (2)")).toBeTruthy();
    expect(bouton("Appliquer (2)")).toBeUndefined();
    expect(conteneur.querySelector("[data-supprimer-lot]")).toBeNull();
  });

  it("les boutons de la barre partagent la géométrie de la norme (forme, espacement, texte)", async () => {
    monter(true);
    await cocher("Cannelle", "Farine");
    await saisirUnite("g");
    const barre = bouton("Supprimer (2)")!.closest("div")!;
    const geometrie = CLASSES_GEOMETRIE.split(" ");
    const sansGeometrie = [...barre.querySelectorAll<HTMLButtonElement>("button")]
      .filter((b) => b.textContent !== "Annuler" && !b.className.includes("underline"))
      .filter((b) => !geometrie.every((c) => b.className.split(" ").includes(c)))
      .map((b) => b.textContent);
    expect(sansGeometrie).toEqual([]);
  });
});

describe("suppression groupée : aperçu, confirmation, compte rendu", () => {
  const apercu = {
    supprimables: [{ id: "a1", designation: "Cannelle", stock: null, liensResto: 0 }],
    conserves: [{ id: "a2", designation: "Farine", attaches: ["12 mouvements"], raison: "Farine : 12 mouvements" }],
    introuvables: 0,
  };

  it("l'aperçu nomme ce qui part et ce qui reste ; rien n'est supprimé avant la confirmation", async () => {
    A.apercuSuppression.mockResolvedValue(apercu);
    monter(true);
    await cocher("Cannelle", "Farine");
    await cliquer(bouton("Supprimer (2)"));
    expect(A.apercuSuppression).toHaveBeenCalledWith(["a1", "a2"]);
    expect(A.supprimer).not.toHaveBeenCalled();
    const panneau = conteneur.querySelector("[data-confirmation-suppression]")!;
    expect(panneau.textContent).toContain("Supprimer définitivement 1 article ?");
    expect(panneau.textContent).toContain("Cannelle");
    expect(panneau.textContent).toContain("1 conservé car il a un historique");
    expect(panneau.textContent).toContain("12 mouvements");
    expect(panneau.querySelector('a[href="/stock/catalogue/a2"]')!.textContent).toBe("Farine"); // nom cliquable vers sa fiche
    expect(bouton("Désactiver les 1 conservé")).toBeTruthy();
  });

  it("un stock non nul qui partira avec l'article est dit avant la confirmation", async () => {
    A.apercuSuppression.mockResolvedValue({ supprimables: [{ id: "a1", designation: "Cannelle", stock: "5 g", liensResto: 0 }], conserves: [], introuvables: 0 });
    monter(true);
    await cocher("Cannelle");
    await cliquer(bouton("Supprimer (1)"));
    expect(conteneur.querySelector("[data-confirmation-suppression]")!.textContent).toContain("stock non nul qui sera effacé avec l'article : Cannelle (5 g)");
  });

  it("confirmer supprime, affiche « 1 supprimé · 1 conservé… » et propose de DÉSACTIVER les conservés", async () => {
    A.apercuSuppression.mockResolvedValue(apercu);
    A.supprimer.mockResolvedValue({ proposition: false, supprimes: 1, message: "1 supprimé · 1 conservé car il a un historique (désactivez-le ou fusionnez-le)", conserves: apercu.conserves });
    monter(true);
    await cocher("Cannelle", "Farine");
    await cliquer(bouton("Supprimer (2)"));
    await cliquer(bouton("Supprimer définitivement (1)"));
    expect(A.supprimer).toHaveBeenCalledWith(["a1", "a2"]);
    expect(conteneur.querySelector("[data-confirmation-suppression]")).toBeNull();
    const res = conteneur.querySelector("[data-resultat-suppression]")!;
    expect(res.textContent).toContain("1 supprimé · 1 conservé car il a un historique (désactivez-le ou fusionnez-le)");
    expect(res.textContent).toContain("Farine");
    expect(res.textContent).toContain("12 mouvements");
    await cliquer(bouton("Désactiver les 1 conservé"));
    expect(A.basculerActif).toHaveBeenCalledWith(["a2"], false); // l'action existante, avec les seuls conservés
    expect(conteneur.querySelector("[data-resultat-suppression]")).toBeNull();
    expect(conteneur.querySelector("[data-compte-rendu]")!.textContent).toContain("1 article désactivé");
  });

  it("aucun article supprimable : pas de bouton Supprimer définitivement, seulement Désactiver", async () => {
    A.apercuSuppression.mockResolvedValue({ supprimables: [], conserves: apercu.conserves, introuvables: 0 });
    monter(true);
    await cocher("Farine");
    await cliquer(bouton("Supprimer (1)"));
    expect(conteneur.querySelector("[data-confirmation-suppression]")!.textContent).toContain("Aucun de ces articles ne peut être supprimé");
    expect(bouton(/^Supprimer définitivement/)).toBeUndefined();
    expect(bouton("Désactiver les 1 conservé")).toBeTruthy();
  });

  it("un refus du serveur s'affiche (jamais avalé) et rien ne s'ouvre", async () => {
    A.apercuSuppression.mockResolvedValue({ erreur: "Supprimer est réservé à la Direction." });
    monter(true);
    await cocher("Cannelle");
    await cliquer(bouton("Supprimer (1)"));
    expect(conteneur.textContent).toContain("Supprimer est réservé à la Direction.");
    expect(conteneur.querySelector("[data-confirmation-suppression]")).toBeNull();
  });
});

describe("unité en masse : confirmation quand des articles ont du stock ou un historique", () => {
  const ligne = { id: "a2", designation: "Farine", avant: "Kg", apres: "g", nature: "A_RISQUE", confirmer: true, raisons: ["stock 12 Kg", "4 mouvements"], alertes: ["Rattaché à « Farine T55 » (Cuisine, compté en kg) : le stock du restaurant change."] };
  const apercu = { unite: "g", total: 2, nbChangent: 2, nbInchanges: 0, nbOrthographe: 0, nbPosees: 0, nbLibres: 1, aConfirmer: [ligne], confirmes: ["a2"], resume: "1 article a déjà du stock, des mouvements, un prix, une fiche technique ou un rattachement au restaurant : leurs quantités et prix resteront les mêmes chiffres dans la nouvelle unité (g), rien n'est converti." };

  it("Direction : sans risque, l'unité est appliquée tout de suite, sans panneau, et la sélection est vidée", async () => {
    A.changerUnite.mockResolvedValue({ proposition: false, message: "Unité « g » appliquée à 1 article." });
    monter(true);
    await cocher("Cannelle");
    await saisirUnite("g");
    await cliquer(bouton("Appliquer (1)"));
    expect(A.changerUnite).toHaveBeenCalledWith(["a1"], "g", undefined);
    expect(conteneur.querySelector("[data-confirmation-unite]")).toBeNull();
    expect(conteneur.querySelector("[data-compte-rendu]")!.textContent).toBe("Unité « g » appliquée à 1 article.");
    expect(bouton("Supprimer (1)")).toBeUndefined(); // sélection vidée : la barre a disparu
  });

  it("Direction : avec des articles à risque, la confirmation les compte et les nomme ; « Appliquer quand même » renvoie les identifiants confirmés", async () => {
    A.changerUnite.mockResolvedValueOnce({ confirmation: true, apercu });
    A.changerUnite.mockResolvedValueOnce({ proposition: false, message: "Unité « g » appliquée à 2 articles, dont 1 avec stock…" });
    monter(true);
    await cocher("Cannelle", "Farine");
    await saisirUnite("g");
    await cliquer(bouton("Appliquer (2)"));
    const panneau = conteneur.querySelector("[data-confirmation-unite]")!;
    expect(panneau.textContent).toContain("Changer l'unité en « g » : 1 article à confirmer");
    expect(panneau.textContent).toContain("1 article a déjà du stock");
    expect(panneau.textContent).toContain("Kg → g");
    expect(panneau.textContent).toContain("stock 12 Kg · 4 mouvements");
    expect(panneau.textContent).toContain("⚠ Rattaché à « Farine T55 »");
    expect(panneau.querySelector('a[href="/stock/catalogue/a2"]')!.textContent).toBe("Farine");
    expect(panneau.textContent).toContain("1 autre article sans stock ni historique : changement libre.");
    expect(A.changerUnite).toHaveBeenCalledTimes(1); // rien n'est confirmé tant que la Direction n'a pas cliqué
    await cliquer(bouton("Appliquer quand même (2)"));
    expect(A.changerUnite).toHaveBeenLastCalledWith(["a1", "a2"], "g", ["a2"]);
    expect(conteneur.querySelector("[data-confirmation-unite]")).toBeNull();
  });

  it("Annuler ferme la confirmation sans rien écrire", async () => {
    A.changerUnite.mockResolvedValue({ confirmation: true, apercu });
    monter(true);
    await cocher("Farine");
    await saisirUnite("g");
    await cliquer(bouton("Appliquer (1)"));
    await cliquer([...conteneur.querySelectorAll<HTMLButtonElement>("[data-confirmation-unite] button")].find((b) => b.textContent === "Annuler"));
    expect(conteneur.querySelector("[data-confirmation-unite]")).toBeNull();
    expect(A.changerUnite).toHaveBeenCalledTimes(1);
  });

  it("autre rôle : « Proposer (N) » envoie la proposition et affiche l'information d'attente de la Direction", async () => {
    A.changerUnite.mockResolvedValue({ proposition: true, message: "Proposition envoyée à la Direction : 2 articles ne changent qu'après sa validation." });
    monter(false);
    await cocher("Cannelle", "Farine");
    await saisirUnite("g");
    await cliquer(bouton("Proposer (2)"));
    expect(A.changerUnite).toHaveBeenCalledWith(["a1", "a2"], "g", undefined);
    expect(conteneur.textContent).toContain("Proposition envoyée à la Direction");
    expect(conteneur.querySelector('a[href="/stock/a-valider"]')).toBeTruthy();
  });

  it("un refus du serveur (unité vide, article introuvable…) s'affiche", async () => {
    A.changerUnite.mockResolvedValue({ erreur: "Article introuvable : rechargez la page." });
    monter(true);
    await cocher("Cannelle");
    await saisirUnite("g");
    await cliquer(bouton("Appliquer (1)"));
    expect(conteneur.textContent).toContain("Article introuvable : rechargez la page.");
  });
});
