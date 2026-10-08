// @vitest-environment happy-dom
//
// Liste d'achat (Stock → Achats & mouvements) : mise en page « tableur » sur ordinateur (UNE rangée
// par ligne, en-tête de colonnes unique), cases de nombres sans flèches, Entrée qui descend sans
// jamais envoyer, DEVISE PAR LIGNE (2026-09-30) et envoi (mêmes champs, même ordre, plus la devise de
// chaque ligne). La vue TÉLÉPHONE (récapitulatif + panneau plein écran, même état, même envoi) est
// testée dans entree-telephone.test.tsx ; l'identité des deux envois, ici (dernier bloc).
//
// Ce que ce fichier ne voit pas : les pixels. Happy-dom n'applique pas les requêtes de conteneur
// (`@4xl:`) ; on vérifie donc les classes posées, et la mise en page réelle se contrôle à l'œil
// (1440 × 900 et 375 × 812 — voir le compte rendu de la livraison).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const { entree, verifier } = vi.hoisted(() => ({
  entree: vi.fn(async () => ({ crees: [], fournisseursCrees: [], avertissements: [] })),
  verifier: vi.fn(async () => ({ avertissements: [] })),
}));
vi.mock("./actions", () => ({ entreeListeAchat: entree, verifierDoublonsListe: verifier }));

import { ListeAchatForm } from "./entree-client";
import { choisirEnTapant, choisirOption, libellesOuverts, taperChoix, valeurChoisie } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "a0", designation: "Farine T55", unite: "Kg", domaine: "NOURRITURE", prix: "1.00" },
  { id: "a2", designation: "Huile de palme", unite: "pièce", domaine: "NOURRITURE", prix: "1.70" },
  { id: "a16", designation: "Eau minérale 1,5 L", unite: "L", domaine: "BOISSON", prix: "6.60" },
  { id: "a9", designation: "Sel gris", unite: "Kg", domaine: "NOURRITURE", prix: null },
];
const FOURNISSEURS = [{ id: "f0", nom: "Maman Épiphanie" }, { id: "f1", nom: "Grossiste Kin" }];

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  entree.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(ListeAchatForm, { articles: ARTICLES, fournisseurs: FOURNISSEURS, aujourdhui: "2026-09-30", taux: 2800, estDirection: true })));
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const lignes = () => [...conteneur.querySelectorAll<HTMLElement>("[data-ligne-achat]")];
const form = () => conteneur.querySelector("form")!;
const cas = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="${nom}"]`)!;
const active = () => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label");
const classes = (el: Element) => el.getAttribute("class") ?? "";
/** Le champ de choix d'article d'une ligne (le <select> d'avant est devenu un champ où l'on tape). */
const champArticle = (l: Element) => l.querySelector<HTMLInputElement>('input[role="combobox"][data-choix-recherche="articleId"]')!;
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.trim() === texte)!;

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** Saisie puis sortie de la case (la case partagée enregistre à la sortie, comme à l'écran). */
async function saisir(el: HTMLInputElement, texte: string) {
  act(() => el.focus());
  taper(el, texte);
  await act(async () => el.blur());
}
function choisir(el: HTMLSelectElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, valeur);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function entree_(el: HTMLElement) {
  let ev!: KeyboardEvent;
  await act(async () => {
    ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  });
  return ev;
}
/**
 * Ce que le navigateur enverrait : les champs nommés, dans l'ordre du document, SANS les champs
 * désactivés (happy-dom, lui, les inclut — le domaine figé d'un article du catalogue doublerait).
 */
function donnees(): [string, string][] {
  return [...form().elements]
    .filter((e): e is HTMLInputElement | HTMLSelectElement => "name" in e && !!(e as HTMLInputElement).name && !(e as HTMLInputElement).disabled && (e as HTMLInputElement).type !== "submit" && (e as HTMLInputElement).type !== "button")
    .map((e) => [e.name, e.value]);
}

describe("Liste d'achat — ordinateur : un tableur, une rangée par ligne", () => {
  it("UNE rangée par ligne d'achat (4 au départ, une de plus avec « + Ligne »)", () => {
    expect(lignes()).toHaveLength(4);
    act(() => bouton("+ Ligne").click());
    expect(lignes()).toHaveLength(5);
    // Une rangée = une seule grille de 10 colonnes : article, désignation, unité, domaine, qté, PU, montant + devise, DLC, fournisseur, ✕.
    for (const l of lignes()) expect(classes(l)).toMatch(/@4xl:grid-cols-\[[^\]]*\]/);
    const gabarit = /@4xl:grid-cols-\[([^\]]*)\]/.exec(classes(lignes()[0]))![1];
    expect(gabarit.split("_")).toHaveLength(10);
  });

  it("l'en-tête de colonnes est UNIQUE (pas répété dans chaque ligne) et n'apparaît que sur la liste large", () => {
    const entetes = [...conteneur.querySelectorAll("span")].filter((s) => s.textContent === "Article (catalogue)");
    expect(entetes).toHaveLength(1);
    const barre = entetes[0].parentElement!;
    expect(classes(barre)).toMatch(/\bhidden\b/);
    expect(classes(barre)).toMatch(/@4xl:grid\b/);
    expect(barre.textContent).toBe("Article (catalogue)Désignation (libre si nouveau)UnitéDomaineQtéPUMontantDLCFournisseur (facultatif)Retirer");
    act(() => bouton("+ Ligne").click());
    expect([...conteneur.querySelectorAll("span")].filter((s) => s.textContent === "Article (catalogue)")).toHaveLength(1);
    // L'en-tête n'est dans aucune ligne.
    for (const l of lignes()) expect(l.contains(barre)).toBe(false);
  });

  it("l'en-tête ne porte plus de devise (« PU », « Montant ») : chaque ligne a la sienne, à côté de son montant", () => {
    act(() => bouton("CDF (FC)").click());
    const barre = [...conteneur.querySelectorAll("span")].find((s) => s.textContent === "Article (catalogue)")!.parentElement!;
    expect(barre.textContent).not.toMatch(/USD|CDF|FC/);
    for (const l of lignes()) {
      const devise = l.querySelector("button[data-devise-ligne]")!;
      // Collée au montant, dans la même cellule de la grille.
      expect(devise.parentElement).toBe(l.querySelector("input[aria-label^='Montant']")!.parentElement);
    }
  });

  it("montant + devise et la DLC (2026-10-08) tiennent dans la rangée : minimum ≤ 55 rem, sous le seuil de 56 rem", () => {
    const gabarit = /@4xl:grid-cols-\[([^\]]*)\]/.exec(classes(lignes()[0]))![1];
    const colonnes = gabarit.split("_");
    // Écart entre cases lu sur la rangée (gap-1 = 0,25 rem), compté entre chaque colonne.
    const ecart = Number(/\bgap-([\d.]+)\b/.exec(classes(lignes()[0]))![1]) * 0.25;
    const minimum = colonnes.reduce((t, c) => t + Number(/(?:minmax\()?([\d.]+)rem/.exec(c)![1]), 0) + (colonnes.length - 1) * ecart;
    expect(minimum).toBe(54.75);
    expect(minimum).toBeLessThanOrEqual(55);
  });

  it("la liste suit la largeur de SA colonne (requête de conteneur), pas celle de l'écran", () => {
    const enveloppe = lignes()[0].parentElement!.parentElement!;
    expect(classes(enveloppe)).toContain("@container");
  });
});

describe("Liste d'achat — cases de nombres du tableur", () => {
  it("quantité, PU et montant sont des CelluleNombre : champs texte au pavé décimal, aucun type=number (pas de flèches)", () => {
    expect(conteneur.querySelector('input[type="number"]')).toBeNull();
    for (const l of lignes()) {
      const cases = l.querySelectorAll<HTMLInputElement>("input[data-tableur-col]");
      expect([...cases].map((c) => c.dataset.tableurCol)).toEqual(["0", "1", "2"]);
      for (const c of cases) {
        expect(c.type).toBe("text");
        expect(c.getAttribute("inputmode")).toBe("decimal");
      }
    }
    expect(conteneur.querySelector("[data-tableur]")).not.toBeNull();
  });

  it("Entrée descend à la MÊME colonne de la ligne suivante, sans envoyer le formulaire", async () => {
    act(() => cas("Prix unitaire USD, ligne 1").focus());
    const ev = await entree_(cas("Prix unitaire USD, ligne 1"));
    expect(ev.defaultPrevented).toBe(true);
    expect(active()).toBe("Prix unitaire USD, ligne 2");
    await entree_(cas("Montant USD, ligne 2"));
    expect(active()).toBe("Montant USD, ligne 3");
    expect(entree).not.toHaveBeenCalled();
  });

  it("Entrée sur la DERNIÈRE ligne ajoute une ligne et se place dans la même colonne (comme « + Ligne »)", async () => {
    act(() => cas("Quantité, ligne 4").focus());
    await entree_(cas("Quantité, ligne 4"));
    expect(lignes()).toHaveLength(5);
    expect(active()).toBe("Quantité, ligne 5");
    expect(entree).not.toHaveBeenCalled();
  });

  it("Entrée dans n'importe quel champ (désignation, fournisseur…) n'envoie jamais le formulaire", async () => {
    for (const el of [conteneur.querySelector<HTMLInputElement>("input[name=designation]")!, cas("Fournisseur de la ligne 1"), cas("Unité, ligne 1")]) {
      const ev = await entree_(el);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(entree).not.toHaveBeenCalled();
  });

  it("quantité × PU remplit le montant, la virgule française est lue, le montant reste modifiable (règle inchangée)", async () => {
    await saisir(cas("Quantité, ligne 1"), "2,5");
    await saisir(cas("Prix unitaire USD, ligne 1"), "3");
    expect(cas("Montant USD, ligne 1").value).toBe("7,5");
    await saisir(cas("Montant USD, ligne 1"), "8");
    expect(cas("Montant USD, ligne 1").value).toBe("8");
    await saisir(cas("Quantité, ligne 1"), "4"); // quantité modifiée et PU renseigné → recalculé
    expect(cas("Montant USD, ligne 1").value).toBe("12");
  });
});

describe("Liste d'achat — l'envoi : mêmes champs, plus la devise DE CHAQUE LIGNE", async () => {
  // Référence d'origine : le FormData de l'ANCIEN formulaire (champs `type=number`, une carte de 3 rangées
  // par ligne), relevé dans un navigateur. Il envoyait UN champ `devise` (global, avant les lignes), et
  // la bascule du haut CONVERTISSAIT tous les montants.
  //
  // Mis à jour le 2026-09-30 (devise par ligne) : le sélecteur du haut n'est plus qu'un défaut pour les
  // nouvelles lignes et n'envoie RIEN ; chaque ligne envoie SA `devise`, juste après son `montant`, dans
  // l'ordre des lignes — comme `articleId`, `quantite`… que le serveur lit par position (un ancien envoi,
  // à devise unique, retombe sur elle : voir entree.integration.test.ts). Tout le reste est inchangé :
  // mêmes noms, même ordre, nombres à la française (virgule décimale, depuis le 2026-10-01), PU jamais envoyé, une valeur par ligne et par nom.
  // Le scénario MÉLANGE les devises : la ligne 1 passe en FC (son PU repris du catalogue est converti
  // au taux, 1,70 $ × 2 800 = 4 760 FC), la ligne 2 reste en USD, la ligne 3 est saisie en FC.
  const ATTENDU = [
    ["date", "2026-09-30"], ["origine", ""],
    ["articleId", "a2"], ["designation", "Huile de palme"], ["unite", "pièce"], ["domaine", "NOURRITURE"], ["quantite", "2,5"], ["montant", "11900"], ["devise", "CDF"], ["dlc", "2026-10-15"], ["fournisseurNom", "Maman Épiphanie"], ["fournisseurId", "f0"], ["creerNouveau", ""],
    ["articleId", ""], ["designation", "Sel gris"], ["unite", "Kg"], ["domaine", "BOISSON"], ["quantite", "4"], ["montant", "10,5"], ["devise", "USD"], ["dlc", ""], ["fournisseurNom", "Nouveau Fournisseur"], ["fournisseurId", ""], ["creerNouveau", ""],
    ["articleId", ""], ["designation", ""], ["unite", ""], ["domaine", "NOURRITURE"], ["quantite", "7"], ["montant", "24500"], ["devise", "CDF"], ["dlc", ""], ["fournisseurNom", ""], ["fournisseurId", ""], ["creerNouveau", ""],
    ["articleId", ""], ["designation", ""], ["unite", ""], ["domaine", "NOURRITURE"], ["quantite", ""], ["montant", ""], ["devise", "USD"], ["dlc", ""], ["fournisseurNom", ""], ["fournisseurId", ""], ["creerNouveau", ""],
  ];
  // Depuis le 2026-10-08 : `dlc` (facultative) après la devise, `creerNouveau` (« Créer quand même ») en fin de ligne.
  const NOMS_PAR_LIGNE = ["articleId", "designation", "unite", "domaine", "quantite", "montant", "devise", "dlc", "fournisseurNom", "fournisseurId", "creerNouveau"];

  async function scenario() {
    const L = (i: number) => lignes()[i];
    await choisirOption(champArticle(L(0)), "a2");
    await saisir(cas("Quantité, ligne 1"), "2,5");
    act(() => deviseDe(0).click()); // PU du catalogue (1,70 $) → 4 760 FC ; montant = 2,5 × 4 760
    taper(cas("Fournisseur de la ligne 1"), "Maman Épiphanie");
    taper(cas("DLC (facultatif), ligne 1"), "2026-10-15");
    taper(L(1).querySelector<HTMLInputElement>("input[name=designation]")!, "Sel gris");
    taper(L(1).querySelector<HTMLInputElement>("input[name=unite]")!, "Kg");
    choisir(L(1).querySelector("select[name=domaine]")!, "BOISSON");
    await saisir(cas("Quantité, ligne 2"), "4");
    await saisir(cas("Montant USD, ligne 2"), "10,5");
    taper(cas("Fournisseur de la ligne 2"), "Nouveau Fournisseur");
    act(() => deviseDe(2).click());
    await saisir(cas("Quantité, ligne 3"), "7");
    await saisir(cas("Prix unitaire FC, ligne 3"), "3500");
  }

  it("champs dans l'ordre, une devise par ligne juste après son montant, aucune devise globale", async () => {
    await scenario();
    expect(donnees()).toEqual(ATTENDU);
  });

  it("le PU n'est jamais envoyé ; un champ par ligne et par nom (aucun doublon d'une présentation à l'autre)", async () => {
    await scenario();
    const noms = donnees().map(([n]) => n);
    for (const nom of NOMS_PAR_LIGNE) expect(noms.filter((n) => n === nom)).toHaveLength(4);
    expect(noms.filter((n) => n === "date" || n === "origine")).toHaveLength(2);
    expect(noms).toHaveLength(2 + 4 * NOMS_PAR_LIGNE.length);
  });

  it("les montants partent à la FRANÇAISE (virgule décimale, sans espace), même tapés avec un espace de milliers", async () => {
    await saisir(cas("Quantité, ligne 1"), "1 250,5");
    await saisir(cas("Montant USD, ligne 1"), "3,75");
    const d = donnees();
    expect(d.filter(([n]) => n === "quantite")[0][1]).toBe("1250,5");
    expect(d.filter(([n]) => n === "montant")[0][1]).toBe("3,75");
  });

  it("l'envoi construit depuis l'état est IDENTIQUE aux champs que porte le tableur (même ordre, mêmes valeurs) — c'est lui que la vue téléphone envoie aussi", async () => {
    await scenario();
    const duTableur = donnees(); // relevé AVANT l'envoi : l'enregistrement vide la liste
    await act(async () => { form().requestSubmit(); });
    const fd = (entree.mock.calls[0] as unknown as [FormData])[0];
    expect([...fd.entries()].map(([n, v]) => [n, String(v)])).toEqual(duTableur);
    expect(duTableur).toEqual(ATTENDU);
  });

  it("un clic sur « Valider » envoie le formulaire à l'action, une seule fois", async () => {
    await scenario();
    await act(async () => { form().requestSubmit(); });
    expect(entree).toHaveBeenCalledTimes(1);
    const fd = (entree.mock.calls[0] as unknown as [FormData])[0];
    // Champ par champ (happy-dom ajoute le domaine du <select> désactivé, que le navigateur n'envoie pas :
    // c'est `donnees()` qui reproduit l'envoi réel, ci-dessus).
    for (const nom of ["date", "origine", "articleId", "designation", "unite", "quantite", "montant", "devise", "dlc", "fournisseurNom", "fournisseurId", "creerNouveau"]) {
      expect(fd.getAll(nom), nom).toEqual(ATTENDU.filter(([n]) => n === nom).map(([, v]) => v));
    }
    expect(fd.getAll("domaine")).toContain("BOISSON");
  });
});

const deviseDe = (i: number) => lignes()[i].querySelector<HTMLButtonElement>("button[data-devise-ligne]")!;
const devisesEnvoyees = () => donnees().filter(([n]) => n === "devise").map(([, v]) => v);
const total = () => conteneur.querySelector("[data-total-achat]")?.textContent ?? null;

describe("Liste d'achat — devise PAR LIGNE", () => {
  it("un appui bascule la devise DE LA LIGNE (USD ⇄ FC) ; les autres lignes ne bougent pas", () => {
    expect(devisesEnvoyees()).toEqual(["USD", "USD", "USD", "USD"]);
    act(() => deviseDe(1).click());
    expect(devisesEnvoyees()).toEqual(["USD", "CDF", "USD", "USD"]);
    expect(deviseDe(1).textContent).toBe("FC");
    expect(deviseDe(1).getAttribute("aria-label")).toBe("Devise de la ligne 2 : francs (FC) — changer en dollars (USD)");
    expect(cas("Montant FC, ligne 2")).not.toBeNull();
    expect(cas("Prix unitaire FC, ligne 2")).not.toBeNull();
    act(() => deviseDe(1).click());
    expect(devisesEnvoyees()).toEqual(["USD", "USD", "USD", "USD"]);
  });

  it("les nombres TAPÉS ne sont pas convertis : seule leur devise change (et un second appui revient exactement)", async () => {
    await saisir(cas("Quantité, ligne 1"), "2");
    await saisir(cas("Prix unitaire USD, ligne 1"), "3");
    await saisir(cas("Montant USD, ligne 1"), "5000");
    act(() => deviseDe(0).click());
    expect([cas("Prix unitaire FC, ligne 1").value, cas("Montant FC, ligne 1").value]).toEqual(["3", "5000"]);
    act(() => deviseDe(0).click());
    expect([cas("Prix unitaire USD, ligne 1").value, cas("Montant USD, ligne 1").value]).toEqual(["3", "5000"]);
  });

  it("un PU REPRIS DU CATALOGUE (en USD) est converti au taux en passant en FC, et retrouve le prix exact au retour", async () => {
    await choisirOption(champArticle(lignes()[0]), "a2"); // 1,70 $
    await saisir(cas("Quantité, ligne 1"), "2");
    expect(cas("Montant USD, ligne 1").value).toBe("3,4");
    act(() => deviseDe(0).click());
    expect([cas("Prix unitaire FC, ligne 1").value, cas("Montant FC, ligne 1").value]).toEqual(["4760", "9520"]);
    act(() => deviseDe(0).click());
    expect([cas("Prix unitaire USD, ligne 1").value, cas("Montant USD, ligne 1").value]).toEqual(["1,7", "3,4"]);
  });

  it("un montant TAPÉ n'est jamais écrasé par la bascule, même quand le PU du catalogue est converti (double bascule)", async () => {
    await choisirOption(champArticle(lignes()[0]), "a2"); // 1,70 $
    await saisir(cas("Quantité, ligne 1"), "10");
    act(() => deviseDe(0).click());
    expect([cas("Prix unitaire FC, ligne 1").value, cas("Montant FC, ligne 1").value]).toEqual(["4760", "47600"]); // montant encore automatique : il suit
    await saisir(cas("Montant FC, ligne 1"), "45000"); // le ticket dit 45 000 FC
    act(() => deviseDe(0).click());
    expect([cas("Prix unitaire USD, ligne 1").value, cas("Montant USD, ligne 1").value]).toEqual(["1,7", "45000"]);
    act(() => deviseDe(0).click());
    expect([cas("Prix unitaire FC, ligne 1").value, cas("Montant FC, ligne 1").value]).toEqual(["4760", "45000"]);
  });

  it("changement d'article : le PU du catalogue repart du NOUVEL article, dans la devise de la ligne — jamais de l'ancien", async () => {
    // Ligne en FC : le PU du catalogue est repris converti ; la bascule retrouve le prix de CET article.
    act(() => deviseDe(0).click());
    await choisirOption(champArticle(lignes()[0]), "a2");
    expect(cas("Prix unitaire FC, ligne 1").value).toBe("4760");
    await choisirOption(champArticle(lignes()[0]), "a0"); // 1,00 $
    expect(cas("Prix unitaire FC, ligne 1").value).toBe("2800");
    act(() => deviseDe(0).click());
    expect(cas("Prix unitaire USD, ligne 1").value).toBe("1");
    // Article sans prix : le PU de l'ancien article s'efface, et la bascule n'en ressort aucun.
    await choisirOption(champArticle(lignes()[0]), "a9");
    expect(cas("Prix unitaire USD, ligne 1").value).toBe("");
    act(() => deviseDe(0).click());
    expect(cas("Prix unitaire FC, ligne 1").value).toBe("");
    // Un PU TAPÉ reste quand le nouvel article n'a rien à proposer, et n'est jamais converti.
    await saisir(cas("Prix unitaire FC, ligne 1"), "3000");
    await choisirOption(champArticle(lignes()[0]), "a9");
    act(() => deviseDe(0).click());
    expect(cas("Prix unitaire USD, ligne 1").value).toBe("3000");
  });

  it("le défaut du haut vaut pour les NOUVELLES lignes (et les lignes encore vierges) ; une ligne saisie garde SA devise", async () => {
    await saisir(cas("Quantité, ligne 1"), "2");
    act(() => bouton("CDF (FC)").click());
    // Ligne 1 (saisie) reste en USD ; les 3 lignes vides, encore vierges, suivent le défaut.
    expect(devisesEnvoyees()).toEqual(["USD", "CDF", "CDF", "CDF"]);
    act(() => bouton("+ Ligne").click());
    expect(devisesEnvoyees()).toEqual(["USD", "CDF", "CDF", "CDF", "CDF"]);
    // Une ligne passée à la main en USD garde son choix… tant qu'elle n'est pas vierge.
    await saisir(cas("Quantité, ligne 3"), "1");
    act(() => deviseDe(2).click());
    act(() => bouton("USD").click());
    expect(devisesEnvoyees()).toEqual(["USD", "USD", "USD", "USD", "USD"]);
    act(() => bouton("CDF (FC)").click());
    expect(devisesEnvoyees()).toEqual(["USD", "CDF", "USD", "CDF", "CDF"]);
  });

  it("Entrée sur la DERNIÈRE ligne ajoute toujours une ligne, et elle prend la devise par défaut", async () => {
    await saisir(cas("Quantité, ligne 4"), "1");
    act(() => bouton("CDF (FC)").click());
    act(() => cas("Montant USD, ligne 4").focus()); // ligne 4 saisie : elle garde l'USD
    await entree_(cas("Montant USD, ligne 4"));
    expect(lignes()).toHaveLength(5);
    expect(active()).toBe("Montant FC, ligne 5");
    expect(devisesEnvoyees()).toEqual(["CDF", "CDF", "CDF", "USD", "CDF"]);
    expect(entree).not.toHaveBeenCalled();
  });

  it("le sélecteur du haut n'envoie rien : seules les lignes portent une devise", () => {
    act(() => bouton("CDF (FC)").click());
    expect(donnees().filter(([n]) => n === "devise")).toHaveLength(lignes().length);
    expect(bouton("CDF (FC)").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Liste d'achat — total en USD, francs saisis à part", () => {
  it("sans montant : pas de total ; lignes toutes en USD : leur somme", async () => {
    expect(total()).toBeNull();
    await choisirOption(champArticle(lignes()[0]), "a0");
    await saisir(cas("Quantité, ligne 1"), "2");
    await saisir(cas("Montant USD, ligne 1"), "30");
    expect(total()).toBe("Total en USD : 30,00 $");
  });

  it("lignes mêlées : total USD au taux de l'enregistrement (FC ÷ taux) ; les FC saisis se lisent à part, jamais ajoutés tels quels", async () => {
    await choisirOption(champArticle(lignes()[0]), "a0");
    await saisir(cas("Quantité, ligne 1"), "2");
    await saisir(cas("Montant USD, ligne 1"), "30");
    taper(lignes()[1].querySelector<HTMLInputElement>("input[name=designation]")!, "Sel gris");
    act(() => deviseDe(1).click());
    await saisir(cas("Quantité, ligne 2"), "1");
    await saisir(cas("Montant FC, ligne 2"), "28000");
    expect(total()).toBe("Total en USD : 40,00 $dont en USD : 30,00 $en FC : 28 000 FC ≈ 10,00 $");
    expect(total()).not.toContain("28 030");
    // Une ligne sans article ni quantité ne serait pas enregistrée : elle ne compte pas non plus ici.
    await saisir(cas("Montant USD, ligne 3"), "999");
    expect(total()).toContain("Total en USD : 40,00 $");
  });
});

describe("Liste d'achat — sans taux défini", () => {
  it("une ligne en FC : le total USD est inconnu (« — »), les FC restent non convertis, et le refus est annoncé", async () => {
    act(() => racine.render(h(ListeAchatForm, { articles: ARTICLES, fournisseurs: FOURNISSEURS, aujourdhui: "2026-09-30", taux: 0, estDirection: true })));
    await choisirOption(champArticle(lignes()[0]), "a0");
    await saisir(cas("Quantité, ligne 1"), "2");
    await saisir(cas("Montant USD, ligne 1"), "30");
    expect(conteneur.textContent).not.toContain("Taux CDF/USD non défini");
    act(() => deviseDe(0).click());
    expect(total()).toBe("Total en USD : —dont en USD : 0,00 $en FC : 30 FC (taux non défini : non converti)");
    expect(conteneur.textContent).toContain("Taux CDF/USD non défini (Paramètres) : une ligne en FC avec un montant sera refusée.");
  });
});

describe("Liste d'achat — choisir un article en tapant son nom", () => {
  it("« palme huile » (mots dans le désordre, sans majuscule) + Entrée : même article, même unité, même prix suivi, même valeur envoyée", async () => {
    await choisirEnTapant(champArticle(lignes()[0]), "palme huile");
    expect(valeurChoisie(champArticle(lignes()[0]))).toBe("a2");
    expect(champArticle(lignes()[0]).value).toBe("Huile de palme");
    expect(cas("Unité, ligne 1").value).toBe("pièce");
    expect(cas("Prix unitaire USD, ligne 1").value).toBe("1,7"); // prix catalogue suivi
    expect(donnees().filter(([n]) => n === "articleId")[0][1]).toBe("a2");
  });

  it("la liste propose ce qui correspond (sans accent ni casse) ; les 4 lignes partagent UNE liste", async () => {
    await taperChoix(champArticle(lignes()[1]), "EAU minerale");
    expect(libellesOuverts()).toEqual(["Eau minérale 1,5 L"]);
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
  });

  it("taper puis quitter sans choisir ne change pas l'article ; « — libre — » efface le choix et le prix suivi", async () => {
    await choisirOption(champArticle(lignes()[0]), "a0");
    await taperChoix(champArticle(lignes()[0]), "sel");
    await act(async () => champArticle(lignes()[0]).blur());
    expect(valeurChoisie(champArticle(lignes()[0]))).toBe("a0");
    await choisirOption(champArticle(lignes()[0]), "");
    expect(valeurChoisie(champArticle(lignes()[0]))).toBe("");
    expect(cas("Prix unitaire USD, ligne 1").value).toBe("");
    expect(cas("Désignation, ligne 1").readOnly).toBe(false); // ligne libre : on saisit à nouveau
  });

  it("Entrée, liste fermée, descend à l'article de la ligne suivante et n'envoie rien", async () => {
    act(() => champArticle(lignes()[0]).focus());
    const ev = await entree_(champArticle(lignes()[0]));
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(champArticle(lignes()[1]));
    expect(entree).not.toHaveBeenCalled();
  });
});

// ── Anti-doublon d'ARTICLE et DLC (Direction, 2026-10-08) ─────────────────────────────────────────
// Le serveur (mock ici) dit, ligne par ligne, le sort de chaque désignation libre ; l'écran montre le
// choix « Utiliser … » / « Créer quand même » SOUS la rangée et n'envoie rien tant qu'il n'est pas fait.
const TOMATES = { id: "t1", designation: "Tomates", unite: "kg", domaine: "NOURRITURE", prix: "2.00", actif: true };
type LigneVerif = { articleId: string; designation: string; quantite: number };
function analyseTomate() {
  verifier.mockImplementation((async (_d: string, ls: LigneVerif[]) => ({
    avertissements: [],
    lignes: ls.map((l) => (l.quantite > 0 && !l.articleId && l.designation.toLowerCase() === "tomate" ? { article: { type: "choix", candidats: [TOMATES], creationPossible: true } } : l.quantite > 0 && (l.articleId || l.designation) ? { article: { type: l.articleId ? "catalogue" : "nouveau" } } : null)),
  })) as never);
}
const attendreAnalyse = () => act(async () => { await new Promise((r) => setTimeout(r, 650)); });
const envoye = () => (entree.mock.calls.at(-1) as unknown as [FormData])[0];

describe("Liste d'achat — ordinateur : article proche au catalogue (« Tomate » face à « Tomates »)", () => {
  afterEach(() => { verifier.mockImplementation(async () => ({ avertissements: [] })); });

  async function tomateLigne1() {
    analyseTomate();
    taper(cas("Désignation, ligne 1"), "Tomate");
    await saisir(cas("Quantité, ligne 1"), "3");
    await attendreAnalyse();
  }

  it("le choix s'affiche SOUS la rangée : « Utiliser « Tomates » » et « Créer quand même un nouvel article »", async () => {
    await tomateLigne1();
    const choix = lignes()[0].querySelector("[data-choix-article]")!;
    expect(choix.textContent).toContain("Cet article ressemble à « Tomate »");
    expect(choix.querySelector("[data-utiliser='t1']")!.textContent).toContain("Utiliser « Tomates » (kg)");
    expect(choix.querySelector("[data-creer]")!.textContent).toBe("Créer quand même un nouvel article");
  });

  it("tant que rien n'est choisi, l'enregistrement est REFUSÉ à l'écran (rien n'est envoyé)", async () => {
    await tomateLigne1();
    await act(async () => { form().requestSubmit(); });
    expect(entree).not.toHaveBeenCalled();
    expect(conteneur.querySelector("[role=alert]")!.textContent).toContain("1 ligne demande de choisir l'article");
  });

  it("« Utiliser « Tomates » » : la ligne devient l'article du catalogue — l'envoi porte son id, aucune création", async () => {
    await tomateLigne1();
    act(() => lignes()[0].querySelector<HTMLButtonElement>("[data-utiliser='t1']")!.click());
    await attendreAnalyse();
    expect(lignes()[0].querySelector("[data-choix-article]")).toBeNull();
    await act(async () => { form().requestSubmit(); });
    expect(envoye().getAll("articleId")[0]).toBe("t1");
    expect(envoye().getAll("designation")[0]).toBe("Tomates");
    expect(envoye().getAll("creerNouveau")[0]).toBe("");
  });

  it("« Créer quand même » : la ligne part libre avec creerNouveau = 1, et le choix reste révocable", async () => {
    await tomateLigne1();
    act(() => lignes()[0].querySelector<HTMLButtonElement>("[data-creer]")!.click());
    expect(lignes()[0].querySelector("[data-creer-nouveau]")!.textContent).toContain("nouvel article « Tomate » sera créé");
    await act(async () => { form().requestSubmit(); });
    expect(envoye().getAll("articleId")[0]).toBe("");
    expect(envoye().getAll("designation")[0]).toBe("Tomate");
    expect(envoye().getAll("creerNouveau")[0]).toBe("1");
  });

  it("retaper la désignation annule « Créer quand même » (le choix portait sur l'ancien nom)", async () => {
    await tomateLigne1();
    act(() => lignes()[0].querySelector<HTMLButtonElement>("[data-creer]")!.click());
    taper(cas("Désignation, ligne 1"), "Tomate ronde");
    expect(donnees().filter(([n]) => n === "creerNouveau")[0][1]).toBe("");
  });

  it("même article sur DEUX lignes : signalé sur les deux (avertissement seulement, l'envoi passe)", async () => {
    await choisirOption(champArticle(lignes()[0]), "a0");
    await saisir(cas("Quantité, ligne 1"), "2");
    await choisirOption(champArticle(lignes()[2]), "a0");
    await saisir(cas("Quantité, ligne 3"), "2");
    expect(lignes()[0].querySelector("[data-meme-liste]")!.textContent).toContain("figure aussi à la ligne 3");
    expect(lignes()[2].querySelector("[data-meme-liste]")!.textContent).toContain("figure aussi à la ligne 1");
    await act(async () => { form().requestSubmit(); });
    expect(entree).toHaveBeenCalledTimes(1);
  });
});

describe("Liste d'achat — ordinateur : DLC facultative", () => {
  it("une colonne « DLC » par ligne, vide par défaut (facultative), bornée par la date de l'achat", () => {
    const dlc = cas("DLC (facultatif), ligne 1");
    expect(dlc.type).toBe("date");
    expect(dlc.value).toBe("");
    expect(dlc.min).toBe("2026-09-30");
  });

  it("DLC antérieure à la date de l'achat : refus lisible sous la ligne, rien n'est envoyé", async () => {
    await choisirOption(champArticle(lignes()[0]), "a0");
    await saisir(cas("Quantité, ligne 1"), "2");
    taper(cas("DLC (facultatif), ligne 1"), "2026-09-01");
    expect(lignes()[0].querySelector("[data-erreur-dlc]")!.textContent).toBe("La DLC (01/09/2026) est antérieure à la date de l'achat (30/09/2026).");
    await act(async () => { form().requestSubmit(); });
    expect(entree).not.toHaveBeenCalled();
    taper(cas("DLC (facultatif), ligne 1"), "2026-10-20");
    await act(async () => { form().requestSubmit(); });
    expect(envoye().getAll("dlc")[0]).toBe("2026-10-20");
  });
});
