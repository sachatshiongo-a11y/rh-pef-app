// @vitest-environment happy-dom
//
// Liste d'achat — vue TÉLÉPHONE : un récapitulatif (une carte par article : toucher = modifier, ✕ = retirer
// avec « Annuler », cases à cocher + actions groupées), un panneau plein écran pour saisir un article
// (« Ajouter et suivant », « Terminé »), une barre de total, un brouillon local. UNE seule liste d'état
// partagée avec le tableur de l'ordinateur et UN seul envoi (`construireFormData`).
//
// Ce que ce fichier ne voit pas : les pixels (happy-dom n'applique pas les requêtes de conteneur `@4xl:`
// — les deux vues sont dans le DOM) ni le clavier virtuel d'iOS : voir les captures et le compte rendu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const { entree, verifier } = vi.hoisted(() => ({
  entree: vi.fn(async () => ({ crees: [], fournisseursCrees: [], avertissements: [] as string[] })),
  verifier: vi.fn(async () => ({ avertissements: [] })),
}));
vi.mock("./actions", () => ({ entreeListeAchat: entree, verifierDoublonsListe: verifier }));

import { ListeAchatForm } from "./entree-client";
import { choisirOption } from "@/lib/test/choix-recherche";
import { cleBrouillon, serialiserBrouillon, vide, type Ligne } from "@/lib/liste-achat-saisie";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "a0", designation: "Farine T55", unite: "Kg", domaine: "NOURRITURE", prix: "1.00" },
  { id: "a2", designation: "Huile de palme", unite: "pièce", domaine: "NOURRITURE", prix: "1.70" },
  { id: "a9", designation: "Sel gris", unite: "Kg", domaine: "NOURRITURE", prix: null },
];
const FOURNISSEURS = [{ id: "f0", nom: "Maman Épiphanie" }, { id: "f1", nom: "Grossiste Kin" }];
const CLE = cleBrouillon("u1");

let conteneur: HTMLDivElement;
let racine: Root;

const monter = (props: Partial<Parameters<typeof ListeAchatForm>[0]> = {}) =>
  act(() => racine.render(h(ListeAchatForm, { articles: ARTICLES, fournisseurs: FOURNISSEURS, aujourdhui: "2026-09-30", taux: 2800, estDirection: true, compteId: "u1", ...props })));

beforeEach(() => {
  entree.mockClear();
  window.localStorage.clear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  monter();
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  vi.restoreAllMocks();
});

const tel = () => conteneur.querySelector<HTMLElement>("[data-vue-telephone]")!;
const cartes = () => [...tel().querySelectorAll<HTMLElement>("[data-carte-achat]")];
const panneau = () => document.querySelector<HTMLElement>("[data-panneau-achat]");
const texteBouton = (racineDom: ParentNode, t: string) => [...racineDom.querySelectorAll("button")].find((b) => b.textContent?.replace(/\s+/g, " ").trim().includes(t)) as HTMLButtonElement | undefined;
const cliquer = (b: HTMLElement | undefined) => { if (!b) throw new Error("bouton introuvable"); act(() => b.click()); };
const champ = (nom: string) => panneau()!.querySelector<HTMLInputElement>(`[aria-label="${nom}"]`)!;
const articlePanneau = () => panneau()!.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const form = () => conteneur.querySelector("form")!;

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const ouvrir = () => cliquer(texteBouton(tel(), "Ajouter un article"));
/** Une entrée de la liste, par le panneau : article du catalogue (ou libre), quantité, éventuellement le montant. */
async function ajouter(opts: { article?: string; designation?: string; unite?: string; qte: string; montant?: string; pu?: string; fournisseur?: string; devise?: "CDF"; suite?: boolean }) {
  if (!panneau()) ouvrir();
  if (opts.article !== undefined) await choisirOption(articlePanneau(), opts.article);
  if (opts.designation) { cliquer(texteBouton(panneau()!, "Saisir un nouvel article")); taper(panneau()!.querySelector<HTMLInputElement>('input[id$="-designation"]')!, opts.designation); }
  if (opts.unite) taper(champ("Unité"), opts.unite);
  if (opts.devise) cliquer(texteBouton(panneau()!, "Francs (FC)"));
  taper(champ("Quantité"), opts.qte);
  if (opts.pu) taper(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Prix unitaire"]')!, opts.pu);
  if (opts.montant) taper(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Montant total"]')!, opts.montant);
  if (opts.fournisseur) taper(panneau()!.querySelector<HTMLInputElement>('input[id$="-fourn"]')!, opts.fournisseur);
  cliquer(texteBouton(panneau()!, opts.suite ? "Ajouter et suivant" : "Terminé"));
}
const resume = (c: HTMLElement) => [...c.querySelectorAll("[data-modifier] span")].map((x) => x.textContent).join(" ");
const norm = (t: string | null | undefined) => (t ?? "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
const deviseActive = () => panneau()!.querySelector('[aria-label="Devise de la ligne"] [aria-pressed="true"]')!.textContent;
const totaux = () => { const t = tel().querySelector("[data-total-telephone]"); return t ? [...t.querySelectorAll("p")].map((p) => norm(p.textContent)).join(" ") : null; };
/** Les champs nommés du tableur (ce que le formulaire du DOM porterait), dans l'ordre du document. */
const donneesDom = (): [string, string][] =>
  [...form().elements]
    .filter((e): e is HTMLInputElement | HTMLSelectElement => "name" in e && !!(e as HTMLInputElement).name && !(e as HTMLInputElement).disabled && (e as HTMLInputElement).type !== "submit" && (e as HTMLInputElement).type !== "button")
    .map((e) => [e.name, e.value]);

describe("Liste d'achat — téléphone : liste vide et barre", () => {
  it("liste vide : un message, le gros bouton « Ajouter un article », ni barre de total ni actions groupées", () => {
    expect(tel().querySelector("[data-liste-vide]")).not.toBeNull();
    expect(texteBouton(tel(), "Ajouter un article")).toBeDefined();
    expect(tel().querySelector("[data-barre-total]")).toBeNull();
    expect(cartes()).toHaveLength(0);
  });

  it("la vue téléphone se masque dès la liste large (requête de conteneur) ; elle n'a aucun champ nommé (rien en double dans l'envoi)", () => {
    expect(tel().className).toContain("@4xl:hidden");
    expect(tel().querySelectorAll("[name]")).toHaveLength(0);
    expect(tel().parentElement!.className).toContain("@container");
  });

  it("la barre de total est collée en bas dans la zone qui défile — jamais fixée sur la barre de navigation, jamais de flou", async () => {
    await ajouter({ article: "a0", qte: "2", montant: "3" });
    const barre = tel().querySelector<HTMLElement>("[data-barre-total]")!;
    expect(barre.className).toMatch(/\bsticky\b/);
    expect(barre.className).toMatch(/\bbottom-0\b/);
    expect(barre.className).not.toMatch(/\bfixed\b|backdrop|bg-[a-z-]+\/\d/);
  });
});

describe("Liste d'achat — téléphone : ajouter par le panneau", () => {
  it("le panneau est PLEIN ÉCRAN (portail), verrouille la page, et se ferme avec Terminé", async () => {
    ouvrir();
    const p = panneau()!;
    expect(p.getAttribute("role")).toBe("dialog");
    expect(p.parentElement).toBe(document.body);
    expect(p.className).toMatch(/\bfixed\b/);
    expect(document.body.style.position).toBe("fixed");
    cliquer(texteBouton(p, "Terminé")); // rien de saisi : on ferme, rien n'est ajouté
    expect(panneau()).toBeNull();
    expect(document.body.style.position).not.toBe("fixed");
    expect(cartes()).toHaveLength(0);
  });

  it("champs 16 px minimum et cibles de 48 px : boutons du bas, devise, champs", () => {
    ouvrir();
    for (const c of panneau()!.querySelectorAll("input:not([type=hidden])")) expect(c.className, c.getAttribute("aria-label") ?? "").toMatch(/\bh-12\b/);
    for (const c of panneau()!.querySelectorAll("input:not([type=hidden])")) expect(c.className).toMatch(/\btext-base\b/);
    for (const b of [...panneau()!.querySelectorAll("button")].filter((x) => /Dollars|Francs|Terminé|Ajouter et suivant/.test(x.textContent ?? ""))) expect(b.className).toMatch(/\bmin-h-12\b/);
    expect(panneau()!.querySelector('input[type="number"]')).toBeNull();
    expect(champ("Quantité").getAttribute("inputmode")).toBe("decimal");
  });

  it("article du catalogue + quantité : le prix du catalogue est proposé, la carte et la barre disent le total", async () => {
    await ajouter({ article: "a2", qte: "3" });
    expect(panneau()).toBeNull();
    expect(cartes()).toHaveLength(1);
    expect(resume(cartes()[0])).toBe("Huile de palme 3 pièce × 1,70 $ = 5,10 $");
    expect(totaux()).toBe("1 article 5,10 $");
  });

  it("« Ajouter et suivant » : l'article est dans la liste, le panneau reste ouvert, vidé — la devise et le fournisseur sont gardés", async () => {
    await ajouter({ article: "a0", qte: "2", montant: "30000", devise: "CDF", fournisseur: "Grossiste Kin", suite: true });
    expect(panneau()).not.toBeNull();
    expect(panneau()!.querySelector("[role=status]")!.textContent).toContain("« Farine T55 » ajouté");
    expect(cartes()).toHaveLength(1);
    expect(articlePanneau().value).toBe("");
    expect(champ("Quantité").value).toBe("");
    expect(panneau()!.querySelector<HTMLInputElement>('input[id$="-fourn"]')!.value).toBe("Grossiste Kin");
    expect(deviseActive()).toBe("Francs (FC)");
    await ajouter({ article: "a9", qte: "1", montant: "500" }); // le suivant : déjà en FC, chez le même fournisseur
    expect(cartes()).toHaveLength(2);
    expect(resume(cartes()[0])).toBe("Farine T55 2 Kg · 30 000 FC");
    expect(resume(cartes()[1])).toBe("Sel gris 1 Kg · 500 FC");
    expect(cartes()[1].textContent).toContain("Grossiste Kin");
  });

  it("le fournisseur connu d'une carte est un lien vers sa fiche ; un nom nouveau est annoncé comme tel", async () => {
    await ajouter({ article: "a0", qte: "1", fournisseur: "maman epiphanie" });
    await ajouter({ article: "a9", qte: "1", fournisseur: "Nouveau Fournisseur" });
    expect(cartes()[0].querySelector("a")!.getAttribute("href")).toBe("/stock/fournisseurs/f0");
    expect(cartes()[1].querySelector("a")).toBeNull();
    expect(cartes()[1].textContent).toContain("nouveau fournisseur");
  });

  it("des fournisseurs proches de la frappe se touchent pour être choisis", () => {
    ouvrir();
    taper(panneau()!.querySelector<HTMLInputElement>('input[id$="-fourn"]')!, "gross");
    cliquer(texteBouton(panneau()!.querySelector("[data-fournisseurs-proches]")!, "Grossiste Kin"));
    expect(panneau()!.querySelector<HTMLInputElement>('input[id$="-fourn"]')!.value).toBe("Grossiste Kin");
  });

  it("le prix unitaire remplit le montant ; le montant tapé détache le prix (« soit … l'unité ») et n'est plus jamais recalculé", async () => {
    ouvrir();
    taper(champ("Quantité"), "2,5");
    taper(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Prix unitaire"]')!, "3");
    expect(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Montant total"]')!.value).toBe("7,5");
    taper(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Montant total"]')!, "8");
    expect(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Prix unitaire"]')!.value).toBe("");
    expect(panneau()!.querySelector("[data-aide-pu]")!.textContent).toBe("soit 3,20 $ l'unité");
    taper(champ("Quantité"), "4"); // le prix n'existe plus : le montant du ticket reste 8
    expect(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Montant total"]')!.value).toBe("8");
  });

  it("la devise : un appui sur Francs convertit le PU du catalogue au taux ; les nombres tapés ne sont pas touchés", async () => {
    ouvrir();
    await choisirOption(articlePanneau(), "a2"); // 1,70 $
    taper(champ("Quantité"), "2");
    expect(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Montant total"]')!.value).toBe("3,4");
    cliquer(texteBouton(panneau()!, "Francs (FC)"));
    expect(panneau()!.querySelector<HTMLInputElement>('[aria-label="Prix unitaire FC"]')!.value).toBe("4760");
    expect(panneau()!.querySelector<HTMLInputElement>('[aria-label="Montant total FC"]')!.value).toBe("9520");
    taper(panneau()!.querySelector<HTMLInputElement>('[aria-label="Montant total FC"]')!, "9000");
    cliquer(texteBouton(panneau()!, "Dollars ($)"));
    // Le montant tapé ne serait pas converti : le panneau demande confirmation avant de changer la devise.
    expect(norm(panneau()!.querySelector("[data-confirmer-devise]")!.textContent)).toContain("9 000 FC deviendra 9 000,00 $");
    expect(panneau()!.querySelector('[aria-label="Montant total FC"]')).not.toBeNull();
    cliquer(texteBouton(panneau()!, "Changer la devise"));
    expect(panneau()!.querySelector<HTMLInputElement>('[aria-label="Montant total USD"]')!.value).toBe("9000"); // le ticket reste le ticket
  });

  it("quantité à la française : « 1 250,5 » est lu ; le panneau montre ce qu'il a lu", async () => {
    ouvrir();
    taper(champ("Quantité"), "1 250,5");
    expect(norm(panneau()!.textContent)).toContain("lu : 1 250,5");
    await choisirOption(articlePanneau(), "a0");
    cliquer(texteBouton(panneau()!, "Terminé"));
    expect(resume(cartes()[0])).toContain("1 250,5 Kg");
  });

  it("article LIBRE : nom, unité et domaine se saisissent (comme le tableur) et partent avec la ligne", async () => {
    ouvrir();
    expect(articlePanneau().value).toBe("");
    expect(panneau()!.querySelector('input[id$="-designation"]')).toBeNull(); // le cas courant (choisir dans la liste) n'est pas encombré
    cliquer(texteBouton(panneau()!, "Saisir un nouvel article"));
    taper(panneau()!.querySelector<HTMLInputElement>('input[id$="-designation"]')!, "Sucre en poudre");
    taper(champ("Unité"), "sac");
    cliquer(texteBouton(panneau()!, "Boisson"));
    taper(champ("Quantité"), "4");
    cliquer(texteBouton(panneau()!, "Terminé"));
    expect(resume(cartes()[0])).toBe("Sucre en poudre 4 sac · prix non saisi");
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    await act(async () => {});
    const fd = (entree.mock.calls[0] as unknown as [FormData])[0];
    expect(fd.getAll("articleId")[0]).toBe("");
    expect(fd.getAll("designation")[0]).toBe("Sucre en poudre");
    expect(fd.getAll("unite")[0]).toBe("sac");
    expect(fd.getAll("domaine")[0]).toBe("BOISSON");
  });

  it("un article du catalogue fige nom, unité et domaine (rien à saisir)", async () => {
    ouvrir();
    await choisirOption(articlePanneau(), "a2");
    expect(panneau()!.querySelector('input[id$="-designation"]')).toBeNull();
    expect(champ("Unité").readOnly).toBe(true);
    expect(champ("Unité").value).toBe("pièce");
  });
});

describe("Liste d'achat — téléphone : validation lisible", () => {
  it("sans article ni quantité : les deux refus s'affichent sous leur champ et rien n'est ajouté", () => {
    ouvrir();
    taper(champ("Quantité"), "0");
    cliquer(texteBouton(panneau()!, "Ajouter et suivant"));
    const alertes = [...panneau()!.querySelectorAll("[role=alert]")].map((a) => a.textContent);
    expect(alertes).toEqual(["Choisissez un article du catalogue, ou saisissez un nouvel article.", "Indiquez une quantité plus grande que 0."]);
    expect(cartes()).toHaveLength(0);
    expect(panneau()).not.toBeNull();
  });

  it("un nombre illisible ou ambigu est refusé avec le même message que la case du tableur", async () => {
    ouvrir();
    await choisirOption(articlePanneau(), "a0");
    taper(champ("Quantité"), "1,250");
    cliquer(texteBouton(panneau()!, "Terminé"));
    expect(panneau()!.querySelector("[role=alert]")!.textContent).toContain("ambigu");
    taper(champ("Quantité"), "2");
    taper(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Montant total"]')!, "12abc");
    cliquer(texteBouton(panneau()!, "Terminé"));
    expect(panneau()!.querySelector("[role=alert]")!.textContent).toContain("n'est pas un nombre");
    expect(cartes()).toHaveLength(0);
  });

  it("les refus disparaissent dès que le champ est corrigé (ils se recalculent à chaque frappe)", async () => {
    ouvrir();
    cliquer(texteBouton(panneau()!, "Ajouter et suivant"));
    expect(panneau()!.querySelectorAll("[role=alert]")).toHaveLength(2);
    await choisirOption(articlePanneau(), "a0");
    taper(champ("Quantité"), "1");
    expect(panneau()!.querySelectorAll("[role=alert]")).toHaveLength(0);
  });

  it("fermer une saisie commencée demande confirmation ; « Continuer » la garde, « Abandonner » la jette", async () => {
    ouvrir();
    await choisirOption(articlePanneau(), "a0");
    cliquer(panneau()!.querySelector<HTMLButtonElement>('[aria-label="Fermer sans ajouter"]')!);
    expect(panneau()!.querySelector("[role=alertdialog]")).not.toBeNull();
    cliquer(texteBouton(panneau()!, "Continuer la saisie"));
    expect(panneau()!.querySelector("[role=alertdialog]")).toBeNull();
    cliquer(panneau()!.querySelector<HTMLButtonElement>('[aria-label="Fermer sans ajouter"]')!);
    cliquer(texteBouton(panneau()!, "Abandonner"));
    expect(panneau()).toBeNull();
    expect(cartes()).toHaveLength(0);
  });

  it("Échap ferme le panneau vide", () => {
    ouvrir();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(panneau()).toBeNull();
  });
});

describe("Liste d'achat — téléphone : modifier, retirer, actions groupées", () => {
  beforeEach(async () => {
    await ajouter({ article: "a0", qte: "2", montant: "30" });
    await ajouter({ article: "a2", qte: "3" });
    await ajouter({ article: "a9", qte: "1", montant: "28000", devise: "CDF" });
  });

  it("toucher une carte rouvre le panneau pré-rempli ; « Mettre à jour » remplace la ligne (rien n'est ajouté)", async () => {
    expect(cartes()).toHaveLength(3);
    cliquer(cartes()[1].querySelector<HTMLElement>("[data-modifier]")!);
    expect(panneau()!.querySelector("h2")!.textContent).toBe("Modifier l'article");
    expect(articlePanneau().value).toBe("Huile de palme");
    expect(champ("Quantité").value).toBe("3");
    taper(champ("Quantité"), "4");
    cliquer(texteBouton(panneau()!, "Mettre à jour"));
    expect(panneau()).toBeNull();
    expect(cartes()).toHaveLength(3);
    expect(resume(cartes()[1])).toBe("Huile de palme 4 pièce × 1,70 $ = 6,80 $");
  });

  it("modifier puis « Annuler » ne change rien", () => {
    cliquer(cartes()[0].querySelector<HTMLElement>("[data-modifier]")!);
    taper(champ("Quantité"), "9");
    cliquer(texteBouton(panneau()!, "Annuler"));
    expect(resume(cartes()[0])).toBe("Farine T55 2 Kg · 30,00 $");
  });

  it("✕ retire la carte et propose « Annuler » : elle revient à sa place", () => {
    cliquer(cartes()[1].querySelector<HTMLButtonElement>('button[aria-label^="Retirer"]')!);
    expect(cartes()).toHaveLength(2);
    expect(tel().querySelector("[data-retrait]")!.textContent).toContain("Article retiré");
    cliquer(texteBouton(tel().querySelector("[data-retrait]")!, "Annuler"));
    expect(cartes().map((c) => c.querySelector("[data-modifier] span")!.textContent)).toEqual(["Farine T55", "Huile de palme", "Sel gris"]);
    expect(tel().querySelector("[data-retrait]")).toBeNull();
  });

  it("l'annulation du retrait s'efface d'elle-même au bout de quelques secondes", () => {
    vi.useFakeTimers();
    try {
      cliquer(cartes()[0].querySelector<HTMLButtonElement>('button[aria-label^="Retirer"]')!);
      expect(tel().querySelector("[data-retrait]")).not.toBeNull();
      act(() => { vi.advanceTimersByTime(8100); });
      expect(tel().querySelector("[data-retrait]")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("cases à cocher : « Tout sélectionner » puis « Retirer (3) » vide la liste ; « Annuler » rend les trois", () => {
    expect(tel().textContent).toContain("0 sélectionné(s)");
    const tout = tel().querySelector<HTMLInputElement>('label input[type="checkbox"]:not([aria-label])')!;
    act(() => tout.click());
    expect(tel().textContent).toContain("3 sélectionné(s)");
    cliquer(texteBouton(tel(), "Retirer (3)"));
    expect(cartes()).toHaveLength(0);
    expect(tel().querySelector("[data-liste-vide]")).not.toBeNull();
    expect(tel().querySelector("[data-retrait]")!.textContent).toContain("3 articles retirés");
    cliquer(texteBouton(tel(), "Annuler"));
    expect(cartes()).toHaveLength(3);
    expect(resume(cartes()[2])).toBe("Sel gris 1 Kg · 28 000 FC");
  });

  it("actions groupées : « Passer en FC » — un montant TAPÉ n'est pas converti : confirmation qui nomme chaque ligne ; seul le PU du catalogue l'est", () => {
    act(() => cartes()[0].querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    act(() => cartes()[1].querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    cliquer(texteBouton(tel(), "Passer en FC"));
    const c = tel().querySelector("[data-confirmer-devise]")!;
    expect(norm(c.textContent)).toContain("1 montant saisi n'est pas converti");
    expect(norm(c.textContent)).toContain("Farine T55 : 30,00 $ deviendra 30 FC");
    expect(norm(c.textContent)).not.toContain("Huile");
    expect(resume(cartes()[0])).toBe("Farine T55 2 Kg · 30,00 $"); // rien n'a bougé
    cliquer(texteBouton(c, "Garder la devise"));
    expect(tel().querySelector("[data-confirmer-devise]")).toBeNull();
    expect(resume(cartes()[0])).toBe("Farine T55 2 Kg · 30,00 $");
    cliquer(texteBouton(tel(), "Passer en FC"));
    cliquer(texteBouton(tel().querySelector("[data-confirmer-devise]")!, "Changer la devise"));
    expect(resume(cartes()[0])).toBe("Farine T55 2 Kg · 30 FC");
    expect(resume(cartes()[1])).toBe("Huile de palme 3 pièce × 4 760 FC = 14 280 FC"); // PU du catalogue converti au taux
    cliquer(texteBouton(tel(), "Passer en USD")); // le montant tapé de la farine est celui du ticket : confirmation à nouveau
    cliquer(texteBouton(tel().querySelector("[data-confirmer-devise]")!, "Changer la devise"));
    expect(resume(cartes()[0])).toBe("Farine T55 2 Kg · 30,00 $");
  });

  it("actions groupées sans montant tapé (PU du catalogue seul) : appliquée tout de suite, sans confirmation", () => {
    act(() => cartes()[1].querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    cliquer(texteBouton(tel(), "Passer en FC"));
    expect(tel().querySelector("[data-confirmer-devise]")).toBeNull();
    expect(resume(cartes()[1])).toBe("Huile de palme 3 pièce × 4 760 FC = 14 280 FC");
  });

  it("la barre de total : nombre d'articles, dollars et francs À PART, équivalent au taux", () => {
    expect(totaux()).toBe("3 articles 35,10 $ + 28 000 FC ≈ 45,10 $ au taux du jour");
  });

  it("sans taux, les francs ne sont pas convertis (« Taux non défini »)", () => {
    monter({ taux: 0 });
    expect(totaux()).toContain("Taux non défini : francs non convertis");
  });

  it("une ligne sans quantité (reprise d'un brouillon, saisie au tableur) est signalée et ne compte pas", () => {
    const ligne: Ligne = { ...vide("USD"), articleId: "a0", designation: "Farine T55", unite: "Kg" };
    window.localStorage.setItem(CLE, serialiserBrouillon({ jour: "2026-09-29", date: "2026-09-29", origine: "", deviseDefaut: "USD", lignes: [ligne] }));
    act(() => racine.unmount());
    racine = createRoot(conteneur);
    monter();
    cliquer(texteBouton(tel(), "Reprendre"));
    expect(cartes().at(-1)!.textContent).toContain("Quantité manquante");
    expect(totaux()).toContain("0 article");
  });
});

describe("Liste d'achat — date et origine", () => {
  it("une ligne compacte (« Aujourd'hui · 30 sept. 2026 »), dépliée d'un toucher ; la date et l'origine se modifient", () => {
    expect(tel().textContent).toContain("Aujourd'hui · 30 sept. 2026");
    cliquer(tel().querySelector<HTMLElement>("button[aria-expanded]")!);
    const date = tel().querySelector<HTMLInputElement>("#tel-date")!;
    expect(date.max).toBe("2026-09-30");
    taper(date, "2026-09-28");
    taper(tel().querySelector<HTMLInputElement>("#tel-origine")!, "Marché de Gombe");
    expect(tel().textContent).toContain("28 sept. 2026");
    expect(tel().textContent).toContain("Marché de Gombe");
  });

  it("la devise par défaut du haut est celle du panneau (et passe aux lignes encore vierges)", () => {
    cliquer(tel().querySelector<HTMLElement>("button[aria-expanded]")!);
    cliquer(texteBouton(tel(), "Francs (FC)"));
    ouvrir();
    expect(deviseActive()).toBe("Francs (FC)");
  });
});

describe("Liste d'achat — l'envoi : le MÊME pour les deux vues", () => {
  it("construit depuis l'état par la vue téléphone, il est identique champ par champ à ce que porte le tableur (même liste d'état)", async () => {
    await ajouter({ article: "a2", qte: "2,5", fournisseur: "Maman Épiphanie", devise: "CDF" });
    await ajouter({ designation: "Sel fin", unite: "Kg", qte: "4", montant: "10,5", fournisseur: "Nouveau Fournisseur" });
    const duTableur = donneesDom(); // les champs du tableur, relevés AVANT l'envoi (qui vide la liste)
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    await act(async () => {});
    expect(entree).toHaveBeenCalledTimes(1);
    const fd = (entree.mock.calls[0] as unknown as [FormData])[0];
    expect([...fd.entries()].map(([n, v]) => [n, String(v)])).toEqual(duTableur);
    expect(fd.getAll("articleId")).toEqual(["a2", "", "", ""]);
    expect(fd.getAll("quantite")).toEqual(["2,5", "4", "", ""]);
    expect(fd.getAll("devise")).toEqual(["CDF", "USD", "USD", "USD"]);
    expect(fd.getAll("fournisseurId")).toEqual(["f0", "", "", ""]);
    expect(fd.getAll("date")).toEqual(["2026-09-30"]);
  });

  it("« Enregistrer la liste » est inactif sans ligne à enregistrer, et se grise pendant l'envoi", async () => {
    await ajouter({ article: "a0", qte: "1" });
    let fin!: () => void;
    entree.mockImplementationOnce(() => new Promise((r) => { fin = () => r({ crees: [], fournisseursCrees: [], avertissements: [] }); }));
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    expect(texteBouton(tel(), "Enregistrement…")!.disabled).toBe(true);
    await act(async () => fin());
    expect(tel().querySelector("[data-barre-total]")).toBeNull(); // la liste est vide après l'enregistrement
  });

  it("un refus du serveur s'affiche (haut de page) et la liste est gardée", async () => {
    await ajouter({ article: "a0", qte: "1" });
    entree.mockImplementationOnce(async () => ({ erreur: "Période clôturée" }) as never);
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    await act(async () => {});
    expect(conteneur.querySelector("[role=alert]")!.textContent).toBe("Période clôturée");
    expect(cartes()).toHaveLength(1);
  });
});

describe("Liste d'achat — brouillon local", () => {
  const brouillon = (lignes: Partial<Ligne>[] = [{ articleId: "a0", designation: "Farine T55", unite: "Kg", qte: "2", pu: "15", montant: "30" }]) =>
    serialiserBrouillon({ jour: "2026-09-29", date: "2026-09-29", origine: "Marché", deviseDefaut: "USD", lignes: lignes.map((l) => ({ ...vide("USD"), ...l })) });
  const remonter = () => { act(() => racine.unmount()); racine = createRoot(conteneur); monter(); };

  it("la liste en cours est gardée dans l'appareil, une clé par compte, et sans les lignes vides", async () => {
    expect(window.localStorage.getItem(CLE)).toBeNull();
    await ajouter({ article: "a0", qte: "2", montant: "30" });
    const b = JSON.parse(window.localStorage.getItem(CLE)!);
    expect(b.v).toBe(1);
    expect(b.lignes).toHaveLength(1);
    expect(b.lignes[0]).toMatchObject({ articleId: "a0", qte: "2", montant: "30", devise: "USD" });
    expect(b.date).toBe(""); // la date n'est gardée que si on l'a changée
    expect(window.localStorage.getItem(cleBrouillon("autre"))).toBeNull();
  });

  it("à la réouverture : bandeau « Brouillon du … retrouvé » ; rien n'est écrasé tant qu'on n'a pas répondu", () => {
    window.localStorage.setItem(CLE, brouillon());
    remonter();
    const bandeau = tel().querySelector("[data-brouillon]")!;
    expect(bandeau.textContent).toContain("Brouillon du 29 sept. 2026 retrouvé");
    expect(bandeau.textContent).toContain("1 article non enregistré");
    expect(window.localStorage.getItem(CLE)).toBe(brouillon());
  });

  it("Reprendre : la liste revient (lignes, date, origine), le bandeau disparaît, le brouillon reste jusqu'à l'enregistrement", () => {
    window.localStorage.setItem(CLE, brouillon());
    remonter();
    cliquer(texteBouton(tel(), "Reprendre"));
    expect(tel().querySelector("[data-brouillon]")).toBeNull();
    expect(resume(cartes()[0])).toBe("Farine T55 2 Kg × 15,00 $ = 30,00 $");
    expect(conteneur.querySelector<HTMLInputElement>('input[name="date"]')!.value).toBe("2026-09-29");
    expect(conteneur.querySelector<HTMLInputElement>('input[name="origine"]')!.value).toBe("Marché");
    expect(window.localStorage.getItem(CLE)).not.toBeNull();
  });

  it("Reprendre alors qu'on a déjà saisi : le brouillon s'AJOUTE, rien n'est perdu", async () => {
    window.localStorage.setItem(CLE, brouillon());
    remonter();
    await ajouter({ article: "a9", qte: "1" });
    cliquer(texteBouton(tel(), "Reprendre"));
    expect(cartes().map((c) => c.querySelector("[data-modifier] span")!.textContent)).toEqual(["Sel gris", "Farine T55"]);
  });

  it("Effacer : le brouillon disparaît de l'appareil, la liste reste vide", () => {
    window.localStorage.setItem(CLE, brouillon());
    remonter();
    cliquer(texteBouton(tel(), "Effacer"));
    expect(tel().querySelector("[data-brouillon]")).toBeNull();
    expect(window.localStorage.getItem(CLE)).toBeNull();
    expect(cartes()).toHaveLength(0);
  });

  it("effacé après un enregistrement RÉUSSI ; gardé après un refus", async () => {
    await ajouter({ article: "a0", qte: "2", montant: "30" });
    entree.mockImplementationOnce(async () => ({ erreur: "Refusé" }) as never);
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    await act(async () => {});
    expect(window.localStorage.getItem(CLE)).not.toBeNull();
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    await act(async () => {});
    expect(window.localStorage.getItem(CLE)).toBeNull();
  });

  it("un stockage illisible (JSON cassé, forme inattendue) est ignoré sans bandeau ni erreur", () => {
    for (const brut of ["{pas du json", "42", JSON.stringify({ v: 2, lignes: [] }), JSON.stringify({ v: 1, lignes: "x" }), JSON.stringify({ v: 1, lignes: [] })]) {
      window.localStorage.setItem(CLE, brut);
      remonter();
      expect(tel().querySelector("[data-brouillon]"), brut).toBeNull();
    }
  });

  it("un brouillon trafiqué est assaini à la lecture (devise, domaine, longueurs, nombre de lignes)", () => {
    window.localStorage.setItem(CLE, JSON.stringify({ v: 1, jour: "n'importe quoi", lignes: [{ articleId: "a0", designation: "x".repeat(5000), devise: "EUR", domaine: "ZZZ", qte: "1" }, null, 3] }));
    remonter();
    cliquer(texteBouton(tel(), "Reprendre"));
    expect(cartes()).toHaveLength(1);
    expect(cartes()[0].textContent!.length).toBeLessThan(600);
  });

  it("stockage INDISPONIBLE (lecture et écriture refusées) : l'écran marche, sans brouillon", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("refusé"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("refusé"); });
    remonter();
    expect(tel().querySelector("[data-brouillon]")).toBeNull();
    await ajouter({ article: "a0", qte: "2", montant: "30" });
    expect(cartes()).toHaveLength(1);
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    await act(async () => {});
    expect(entree).toHaveBeenCalledTimes(1);
  });

  it("sans compte (compteId absent), aucun brouillon n'est lu ni écrit", async () => {
    monter({ compteId: undefined });
    window.localStorage.setItem(CLE, brouillon());
    await ajouter({ article: "a0", qte: "2" });
    expect(tel().querySelector("[data-brouillon]")).toBeNull();
    expect(window.localStorage.getItem(CLE)).toBe(brouillon());
  });
});

describe("Liste d'achat — suites de relecture", () => {
  const brouillon = (lignes: Partial<Ligne>[], date = "2026-09-29") =>
    serialiserBrouillon({ jour: "2026-09-29", date, origine: "", deviseDefaut: "USD", lignes: lignes.map((l) => ({ ...vide("USD"), ...l })) });
  const remonter = () => { act(() => racine.unmount()); racine = createRoot(conteneur); monter(); };
  const L1 = { articleId: "a0", designation: "Farine T55", unite: "Kg", qte: "2" };

  it("B — la date n'est reprise que si elle avait été changée ; sinon on garde aujourd'hui", () => {
    window.localStorage.setItem(CLE, brouillon([L1], ""));
    remonter();
    expect(tel().querySelector("[data-brouillon]")!.textContent).not.toContain("date de l'achat");
    cliquer(texteBouton(tel(), "Reprendre"));
    expect(tel().querySelector("[data-date-resume]")!.textContent).toContain("Aujourd'hui · 30 sept. 2026");
  });

  it("B — une date reprise est montrée dans le bandeau puis, bien visible, sur la ligne de résumé", () => {
    window.localStorage.setItem(CLE, brouillon([L1]));
    remonter();
    expect(tel().querySelector("[data-brouillon]")!.textContent).toContain("date de l'achat : 29 sept. 2026");
    cliquer(texteBouton(tel(), "Reprendre"));
    const r = tel().querySelector("[data-date-resume]")!;
    expect(r.textContent).toContain("29 sept. 2026");
    expect(r.textContent).toContain("pas aujourd'hui");
  });

  it("B — une date changée à la main est gardée dans le brouillon", async () => {
    cliquer(tel().querySelector<HTMLElement>("button[aria-expanded]")!);
    taper(tel().querySelector<HTMLInputElement>("#tel-date")!, "2026-09-28");
    await ajouter({ article: "a0", qte: "1" });
    expect(JSON.parse(window.localStorage.getItem(CLE)!).date).toBe("2026-09-28");
  });

  it("1 — un article absent du catalogue devient une ligne libre (désignation gardée)", async () => {
    window.localStorage.setItem(CLE, brouillon([{ articleId: "disparu", designation: "Vieil article", unite: "kg", qte: "3" }]));
    remonter();
    cliquer(texteBouton(tel(), "Reprendre"));
    expect(cartes()[0].textContent).toContain("Vieil article");
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    await act(async () => {});
    const fd = (entree.mock.calls[0] as unknown as [FormData])[0];
    expect([fd.getAll("articleId")[0], fd.getAll("designation")[0]]).toEqual(["", "Vieil article"]);
  });

  it("2 — le brouillon est effacé à l'enregistrement réussi même si le bandeau est encore ouvert", async () => {
    window.localStorage.setItem(CLE, brouillon([L1]));
    remonter();
    await ajouter({ article: "a9", qte: "1" });
    expect(tel().querySelector("[data-brouillon]")).not.toBeNull();
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    await act(async () => {});
    expect(window.localStorage.getItem(CLE)).toBeNull();
    expect(tel().querySelector("[data-brouillon]")).toBeNull();
  });

  it("4 — Tab reste dans le panneau (il boucle) et le focus revient au bouton d'ouverture à la fermeture", () => {
    const ouvreur = texteBouton(tel(), "Ajouter un article")!;
    act(() => ouvreur.focus());
    cliquer(ouvreur);
    const focalisables = [...panneau()!.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([readonly]), button")];
    const dernier = focalisables.at(-1)!;
    act(() => dernier.focus());
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => { dernier.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focalisables[0]);
    const premier = focalisables[0];
    const inv = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    act(() => { premier.dispatchEvent(inv); });
    expect(document.activeElement).toBe(dernier);
    cliquer(texteBouton(panneau()!, "Terminé"));
    expect(document.activeElement).toBe(ouvreur);
  });

  it("5 — date vidée : message lisible à l'enregistrement, rien n'est envoyé (aucun champ masqué ne bloque en silence)", async () => {
    await ajouter({ article: "a0", qte: "1" });
    cliquer(tel().querySelector<HTMLElement>("button[aria-expanded]")!);
    const date = tel().querySelector<HTMLInputElement>("#tel-date")!;
    expect(date.required).toBe(false);
    taper(date, "");
    cliquer(texteBouton(tel(), "Enregistrer la liste"));
    await act(async () => {});
    expect(conteneur.querySelector("[role=alert]")!.textContent).toBe("Choisissez la date de l'achat.");
    expect(entree).not.toHaveBeenCalled();
    expect(form().noValidate).toBe(true);
  });

  it("6 — la sélection est vidée quand on reprend un brouillon", async () => {
    window.localStorage.setItem(CLE, brouillon([L1]));
    remonter();
    await ajouter({ article: "a9", qte: "1" });
    act(() => cartes()[0].querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(tel().textContent).toContain("1 sélectionné(s)");
    cliquer(texteBouton(tel(), "Reprendre")); // le brouillon s'ajoute à la liste : la sélection d'avant ne vise plus rien de sûr
    expect(cartes()).toHaveLength(2);
    expect(tel().textContent).toContain("0 sélectionné(s)");
  });

  it("8 — « 1.250 » en prix unitaire ou en montant : l'alerte « milliers ? » est visible avant d'ajouter", () => {
    ouvrir();
    taper(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Prix unitaire"]')!, "1.250");
    expect(norm(panneau()!.textContent)).toContain("milliers ?");
    taper(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Prix unitaire"]')!, "");
    taper(panneau()!.querySelector<HTMLInputElement>('[aria-label^="Montant total"]')!, "1.250");
    expect(norm(panneau()!.textContent)).toContain("milliers ?");
  });
});

// ── Anti-doublon d'ARTICLE et DLC (Direction, 2026-10-08) ─────────────────────────────────────────
const TOMATES = { id: "t1", designation: "Tomates", unite: "kg", domaine: "NOURRITURE", prix: "2.00", actif: true };
type LigneVerif = { articleId: string; designation: string; quantite: number };
const attendreAnalyse = () => act(async () => { await new Promise((r) => setTimeout(r, 650)); });
const envoye = () => (entree.mock.calls.at(-1) as unknown as [FormData])[0];

describe("Liste d'achat — téléphone : article proche et DLC", () => {
  beforeEach(() => {
    verifier.mockImplementation((async (_d: string, ls: LigneVerif[]) => ({
      avertissements: [],
      lignes: ls.map((l) => (l.quantite > 0 && !l.articleId && l.designation.toLowerCase() === "tomate" ? { article: { type: "choix", candidats: [TOMATES], creationPossible: true } } : null)),
    })) as never);
  });
  afterEach(() => { verifier.mockImplementation(async () => ({ avertissements: [] })); });

  it("la carte « Tomate » montre le choix en cibles de 44 px ; rien ne part tant qu'il n'est pas fait", async () => {
    await ajouter({ designation: "Tomate", unite: "kg", qte: "3" });
    await attendreAnalyse();
    const carte = cartes()[0];
    const utiliser = carte.querySelector<HTMLButtonElement>("[data-utiliser='t1']")!;
    expect(utiliser.textContent).toContain("Utiliser « Tomates »");
    expect(utiliser.className).toContain("min-h-11");
    expect(carte.querySelector<HTMLButtonElement>("[data-creer]")!.className).toContain("min-h-11");
    await act(async () => { form().requestSubmit(); });
    expect(entree).not.toHaveBeenCalled();
  });

  it("« Utiliser « Tomates » » sur la carte : l'envoi porte l'article existant", async () => {
    await ajouter({ designation: "Tomate", unite: "kg", qte: "3" });
    await attendreAnalyse();
    cliquer(cartes()[0].querySelector<HTMLButtonElement>("[data-utiliser='t1']")!);
    await act(async () => { form().requestSubmit(); });
    expect(envoye().getAll("articleId")[0]).toBe("t1");
  });

  it("« Créer quand même » sur la carte : creerNouveau = 1 dans l'envoi (le même que celui du tableur)", async () => {
    await ajouter({ designation: "Tomate", unite: "kg", qte: "3" });
    await attendreAnalyse();
    cliquer(cartes()[0].querySelector<HTMLButtonElement>("[data-creer]")!);
    await act(async () => { form().requestSubmit(); });
    expect(envoye().getAll("creerNouveau")[0]).toBe("1");
    expect(envoye().getAll("designation")[0]).toBe("Tomate");
  });

  it("DLC dans le panneau, sous la quantité : facultative ; antérieure à l'achat → refus sous le champ ; montrée sur la carte", async () => {
    ouvrir();
    const p = panneau()!;
    const ordre = [...p.querySelectorAll("label")].map((l) => l.textContent?.replace(/\s+/g, " ").trim());
    expect(ordre.indexOf("DLC (facultatif)")).toBe(ordre.indexOf("Quantité") + 2); // Quantité, Unité, puis DLC
    await choisirOption(articlePanneau(), "a0");
    taper(champ("Quantité"), "2");
    taper(champ("DLC (facultatif)"), "2026-09-01");
    cliquer(texteBouton(p, "Terminé"));
    expect(panneau()!.textContent).toContain("La DLC (01/09/2026) est antérieure à la date de l'achat (30/09/2026).");
    taper(champ("DLC (facultatif)"), "2026-10-12");
    cliquer(texteBouton(panneau()!, "Terminé"));
    expect(cartes()[0].querySelector("[data-dlc-carte]")!.textContent).toBe("DLC 12 oct. 2026");
    await act(async () => { form().requestSubmit(); });
    expect(envoye().getAll("dlc")[0]).toBe("2026-10-12");
  });
});
