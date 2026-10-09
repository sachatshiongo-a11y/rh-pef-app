// @vitest-environment happy-dom
//
// Réconciliation — domaines par pilules (2026-10-09). Changer de domaine MASQUE les lignes des autres domaines :
// rien n'est rechargé, le comptage déjà tapé reste dans le formulaire et part avec lui.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { lireComptesSaisis } from "@/lib/validations-stock/comptage";

const appliquer = vi.fn(async (fd: FormData) => { void fd; return { applique: true, nbEcarts: 0 }; });
vi.mock("./actions", () => ({ appliquerComptage: (fd: FormData) => appliquer(fd) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import { ReconciliationForm } from "./reconciliation-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "a1", code: "1", designation: "Tomate", categorie: "Légumes", theorique: 10, domaine: "NOURRITURE" },
  { id: "a2", code: "2", designation: "Oignon", categorie: "Légumes", theorique: 5, domaine: "NOURRITURE" },
  { id: "a3", code: "3", designation: "Primus", categorie: "Bières", theorique: 20, domaine: "BOISSON" },
  { id: "a4", code: "4", designation: "Sac poubelle", categorie: "Entretien", theorique: 8, domaine: "AUTRE" },
];
// 120 articles de nourriture + 1 boisson : de quoi paginer.
const BEAUCOUP = [
  ...Array.from({ length: 120 }, (_, i) => ({ id: `n${i}`, code: String(i + 1), designation: `Plat ${String(i + 1).padStart(3, "0")}`, categorie: "Plats", theorique: 10, domaine: "NOURRITURE" })),
  { id: "b1", code: "900", designation: "Jus", categorie: "Jus", theorique: 3, domaine: "BOISSON" },
];

let conteneur: HTMLDivElement;
let racine: Root;
function monter(props: Record<string, unknown> = {}, articles: unknown = ARTICLES) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(ReconciliationForm, { articles, ...props } as never)));
}
beforeEach(() => { window.history.replaceState(null, "", "/stock/reconciliation"); appliquer.mockClear(); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.unstubAllGlobals(); });

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const physique = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="Quantité physique — ${nom}"]`)!;
async function compter(nom: string, valeur: string) {
  const el = physique(nom);
  act(() => el.focus());
  taper(el, valeur);
  await act(async () => el.blur());
}
const pilules = () => conteneur.querySelector("[data-pilules-domaine]")!;
const pilule = (label: string) => [...pilules().querySelectorAll<HTMLElement>("button, span[aria-current]")].find((b) => b.textContent!.startsWith(label))!;
const choisir = (label: string) => act(() => { pilule(label).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const affichees = () => [...conteneur.querySelectorAll<HTMLInputElement>('input[name="recon_physique"]')].filter((i) => !i.closest("[hidden]")).map((i) => i.getAttribute("aria-label")!.replace("Quantité physique — ", ""));
const formulaire = () => conteneur.querySelector("form")!;
const compteur = () => conteneur.querySelector("[data-pagination-compteur]")?.textContent ?? "";

describe("Réconciliation — pilules de domaine", () => {
  it("les mêmes pilules que l'Inventaire, avec le nombre d'articles de chaque domaine ; plus de « Charger »", () => {
    monter();
    expect(pilules().textContent).toBe("Tous4Nourriture2Boissons1Autre1");
    expect(pilule("Tous").getAttribute("aria-current")).toBe("true");
    expect(conteneur.querySelector("select")).toBeNull();
    expect([...conteneur.querySelectorAll("button")].some((b) => b.textContent === "Charger")).toBe(false);
  });

  it("démarre sur le domaine de l'adresse (?domaine=)", () => {
    monter({ domaineInit: "BOISSON" });
    expect(pilule("Boissons").getAttribute("aria-current")).toBe("true");
    expect(affichees()).toEqual(["Primus"]);
    expect(conteneur.textContent).toContain("1 / 1 article(s)");
  });

  it("changer de domaine filtre sur place : lignes, compteur et adresse", () => {
    monter();
    choisir("Nourriture");
    expect(affichees()).toEqual(["Tomate", "Oignon"]);
    expect(conteneur.textContent).toContain("2 / 2 article(s)");
    expect(window.location.search).toBe("?domaine=NOURRITURE");
    choisir("Tous");
    expect(affichees()).toHaveLength(4);
    expect(conteneur.textContent).toContain("4 / 4 article(s)");
    expect(window.location.search).toBe("");
  });

  it("la recherche s'applique dans le domaine choisi", () => {
    monter();
    choisir("Boissons");
    taper(conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')!, "o"); // Tomate/Oignon sont d'un autre domaine
    expect(affichees()).toEqual([]);
    taper(conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')!, "prim");
    expect(affichees()).toEqual(["Primus"]);
    expect(conteneur.textContent).toContain("1 / 1 article(s)");
  });

  it("le comptage tapé survit au changement de domaine : même champ (pas rechargé), même valeur, part avec le formulaire", async () => {
    monter();
    const tomate = physique("Tomate");
    await compter("Tomate", "9,5");
    choisir("Boissons");
    expect(tomate.closest("tr")!.hidden).toBe(true); // masquée, pas démontée
    expect(physique("Tomate")).toBe(tomate);
    await compter("Primus", "18");
    choisir("Tous");
    expect(physique("Tomate").value).toBe("9,5");
    const fd = new FormData(formulaire());
    expect(fd.getAll("recon_articleId")).toEqual(["a1", "a2", "a3", "a4"]); // tous les domaines partent, pas seulement l'affiché
    expect(fd.getAll("recon_physique")).toEqual(["9,5", "", "18", ""]);
  });

  it("la barre du bas compte les quantités tapées, y compris celles d'un autre domaine", async () => {
    monter();
    const nb = () => conteneur.querySelector("[data-compte-saisis]")!.textContent;
    expect(nb()).toBe("0 compté");
    await compter("Tomate", "9");
    await compter("Primus", "18");
    expect(nb()).toBe("2 comptés");
    choisir("Boissons");
    expect(nb()).toBe("2 comptés (dont 1 hors du domaine affiché)");
    choisir("Nourriture");
    expect(nb()).toBe("2 comptés (dont 1 hors du domaine affiché)");
    await compter("Tomate", "");
    expect(nb()).toBe("1 compté (dont 1 hors du domaine affiché)");
  });

  it("Réinitialiser remet le comptage à zéro, domaine et recherche gardés", async () => {
    vi.stubGlobal("confirm", () => true); // la confirmation est testée dans reconciliation-garde-fous
    monter({ estDirection: true });
    await compter("Tomate", "9");
    choisir("Nourriture");
    await act(async () => { [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Réinitialiser")!.click(); });
    expect(physique("Tomate").value).toBe("");
    expect(conteneur.querySelector("[data-compte-saisis]")!.textContent).toBe("0 compté");
    expect(pilule("Nourriture").getAttribute("aria-current")).toBe("true");
  });

  it("changer de domaine ramène à la page 1 et retire ?page= de l'adresse", () => {
    monter({ domaineInit: "NOURRITURE", pageInit: 3 }, BEAUCOUP);
    expect(compteur()).toContain("101–120 sur 120");
    choisir("Boissons");
    expect(compteur()).toBe("");  // un seul article : plus de barre de pagination
    expect(window.location.search).toBe("?domaine=BOISSON");
    choisir("Nourriture");
    expect(compteur()).toContain("1–50 sur 120");
    expect(window.location.search).toBe("?domaine=NOURRITURE");
  });

  it("Entrée descend à l'article suivant DU DOMAINE affiché, jamais dans un autre", async () => {
    monter();
    choisir("Nourriture");
    const o = physique("Oignon"); // dernier de la nourriture ; Primus (boisson) est masqué
    act(() => o.focus());
    await act(async () => { o.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(document.activeElement).not.toBe(physique("Primus"));
  });
});

describe("Réconciliation — champ `domaine` envoyé", () => {
  const envoyer = async () => { await act(async () => { formulaire().requestSubmit(); }); };

  it("tout ce qui est compté est dans le domaine affiché : il désigne la fiche", async () => {
    monter();
    choisir("Boissons");
    await compter("Primus", "18");
    await envoyer();
    const lu = lireComptesSaisis(appliquer.mock.calls[0][0]);
    expect(lu.domaine).toBe("BOISSON");
    expect(lu.comptes).toEqual([{ articleId: "a3", physique: 18, explication: "" }]);
  });

  it("des quantités tapées dans un autre domaine : pas de domaine, le comptage est général", async () => {
    monter();
    await compter("Tomate", "9");
    choisir("Boissons");
    await compter("Primus", "18");
    await envoyer();
    const lu = lireComptesSaisis(appliquer.mock.calls[0][0]);
    expect(lu.domaine).toBeNull();
    expect(lu.comptes.map((c) => c.articleId)).toEqual(["a1", "a3"]);
  });

  it("après l'envoi, le comptage et le compteur repartent à zéro", async () => {
    monter({ estDirection: true });
    await compter("Tomate", "9");
    await envoyer();
    expect(physique("Tomate").value).toBe("");
    expect(conteneur.querySelector("[data-compte-saisis]")!.textContent).toBe("0 compté");
    expect(conteneur.querySelector("[data-barre-comptage]")!.textContent).toContain("Comptage"); // le message reste dans la barre, visible où que l'on soit
  });
});

describe("Réconciliation — téléphone", () => {
  it("la barre du bas est collée en bas de la zone qui défile, sans backdrop-filter ni fond translucide", () => {
    monter();
    const barre = conteneur.querySelector<HTMLElement>("[data-barre-comptage]")!;
    expect(barre.className).toMatch(/\bsticky\b/);
    expect(barre.className).toMatch(/\bbottom-0\b/);
    expect(barre.className).toMatch(/\bbg-background\b/);
    expect(barre.outerHTML).not.toMatch(/backdrop|bg-background\/|bg-white\//);
    expect(barre.querySelector('input[name="origine"]')).not.toBeNull();
    expect(barre.querySelector("button:not([type])")!.textContent).toBe("Soumettre le comptage");
  });

  it("le compteur d'une pilule passe sous son nom sur téléphone (les quatre pilules tiennent sur une ligne)", () => {
    monter();
    const contenu = pilule("Nourriture").querySelector("span")!;
    expect(contenu.className).toContain("flex-col");
    expect(contenu.className).toContain("sm:flex-row");
  });
});
