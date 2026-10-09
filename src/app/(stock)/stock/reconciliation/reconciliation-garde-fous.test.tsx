// @vitest-environment happy-dom
//
// Réconciliation — ce qui protège un comptage tapé (relecture du 2026-10-09) : confirmation avant d'effacer,
// garde de départ (le nom d'un article est un lien vers sa fiche), explication manquante sur une ligne masquée,
// valeurs conservées après un refus du serveur.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { calculerLignes } from "@/lib/validations-stock/comptage";
import { ecartDeComptage } from "@/lib/comptage-tolerance";

const appliquer = vi.fn<(fd: FormData) => Promise<unknown>>(async () => ({ applique: true, nbEcarts: 0 }));
vi.mock("./actions", () => ({ appliquerComptage: (fd: FormData) => appliquer(fd) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import { ReconciliationForm } from "./reconciliation-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "a1", code: "1", designation: "Tomate", categorie: "Légumes", theorique: 10, domaine: "NOURRITURE" },
  { id: "a2", code: "2", designation: "Oignon", categorie: "Légumes", theorique: 5, domaine: "NOURRITURE" },
  { id: "a3", code: "3", designation: "Primus", categorie: "Bières", theorique: 20, domaine: "BOISSON" },
];
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
  act(() => racine.render(createElement(ReconciliationForm, { articles, estDirection: true, ...props } as never)));
}
const confirmer = vi.fn((m?: string) => { void m; return true; });
beforeEach(() => { window.history.replaceState(null, "", "/stock/reconciliation"); appliquer.mockClear(); confirmer.mockClear(); confirmer.mockReturnValue(true); vi.stubGlobal("confirm", confirmer); });
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
const pilule = (label: string) => [...conteneur.querySelectorAll<HTMLElement>("[data-pilules-domaine] button, [data-pilules-domaine] span[aria-current]")].find((b) => b.textContent!.startsWith(label))!;
const choisir = (label: string) => act(() => { pilule(label).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const bouton = (texte: string) => [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.startsWith(texte))!;
const envoyer = async () => { await act(async () => { conteneur.querySelector("form")!.requestSubmit(); }); };
const barre = () => conteneur.querySelector("[data-barre-comptage]")!;

describe("Réinitialiser demande confirmation quand des quantités sont tapées", () => {
  it("avec des quantités : message chiffré, tous domaines ; refus = rien n'est effacé", async () => {
    monter();
    await compter("Tomate", "9");
    await compter("Primus", "18");
    confirmer.mockReturnValue(false);
    await act(async () => bouton("Réinitialiser").click());
    expect(confirmer).toHaveBeenCalledWith("Effacer les 2 quantités comptées (tous domaines) ?");
    expect(physique("Tomate").value).toBe("9");
    expect(physique("Primus").value).toBe("18");
  });

  it("confirmé : tout est effacé ; au singulier, le message s'accorde", async () => {
    monter();
    await compter("Tomate", "9");
    await act(async () => bouton("Réinitialiser").click());
    expect(confirmer).toHaveBeenCalledWith("Effacer la quantité comptée (tous domaines) ?");
    expect(physique("Tomate").value).toBe("");
  });

  it("rien de tapé : pas de confirmation à demander", async () => {
    monter();
    await act(async () => bouton("Réinitialiser").click());
    expect(confirmer).not.toHaveBeenCalled();
  });
});

describe("Garde de départ : le nom d'un article ouvre sa fiche et ferait perdre le comptage", () => {
  const lien = () => conteneur.querySelector<HTMLAnchorElement>('a[href="/stock/catalogue/a1"]')!;
  const cliquer = (el: Element, init: MouseEventInit = {}) => {
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    act(() => { el.dispatchEvent(ev); });
    return ev;
  };

  it("avec des quantités tapées, un clic sur un lien interne demande confirmation ; refus = on reste", async () => {
    monter();
    await compter("Tomate", "9");
    confirmer.mockReturnValue(false);
    const ev = cliquer(lien());
    expect(confirmer).toHaveBeenCalledTimes(1);
    expect(confirmer.mock.calls[0][0]).toContain("perdues");
    expect(ev.defaultPrevented).toBe(true);
  });

  it("confirmé : le lien suit son cours", async () => {
    monter();
    await compter("Tomate", "9");
    const ev = cliquer(lien());
    expect(confirmer).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("sans quantité tapée, le lien est libre (aucune confirmation)", () => {
    monter();
    const ev = cliquer(lien());
    expect(confirmer).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("un téléchargement, un clic avec Ctrl/Cmd ou une ancre de page ne quittent pas l'écran : pas de confirmation", async () => {
    monter();
    await compter("Tomate", "9");
    cliquer(lien(), { ctrlKey: true });
    cliquer(lien(), { metaKey: true });
    const dl = document.createElement("a"); dl.href = "/stock/reconciliation/fiche/excel?domaine=AUTRE"; dl.setAttribute("data-telechargement", ""); conteneur.appendChild(dl);
    cliquer(dl);
    const ancre = document.createElement("a"); ancre.href = "#haut"; conteneur.appendChild(ancre);
    cliquer(ancre);
    expect(confirmer).not.toHaveBeenCalled();
  });

  it("fermer ou recharger l'onglet est retenu seulement s'il y a des quantités tapées", async () => {
    monter();
    const avant = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(avant);
    expect(avant.defaultPrevented).toBe(false);
    await compter("Tomate", "9");
    const apres = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(apres);
    expect(apres.defaultPrevented).toBe(true);
    await act(async () => bouton("Réinitialiser").click()); // efface : la garde tombe
    const fin = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(fin);
    expect(fin.defaultPrevented).toBe(false);
  });

  it("démonté, l'écran ne garde aucun écouteur : un lien libre après coup", async () => {
    monter();
    await compter("Tomate", "9");
    act(() => racine.unmount());
    const a = document.createElement("a"); a.href = "/stock"; document.body.appendChild(a);
    const ev = cliquer(a);
    expect(confirmer).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    a.remove();
    racine = createRoot(conteneur); // pour l'afterEach
  });
});

describe("Explication manquante sur une ligne masquée", () => {
  it("rien n'est envoyé ; le message nomme l'article ET son domaine ; « Aller à la ligne » ramène à la case", async () => {
    monter();
    await compter("Oignon", "2"); // -60 %, explication à fournir
    choisir("Boissons"); // la ligne et son champ d'explication sont masqués
    await envoyer();
    expect(appliquer).not.toHaveBeenCalled();
    expect(barre().textContent).toContain("une explication est requise pour : Oignon (Nourriture)");
    await act(async () => bouton("Aller à la ligne").click());
    expect(pilule("Nourriture").getAttribute("aria-current")).toBe("true");
    const expl = conteneur.querySelector<HTMLInputElement>('input[data-explication="a2"]')!;
    expect(expl.closest("[hidden]")).toBeNull();
    expect(document.activeElement).toBe(expl);
  });

  it("plusieurs articles manquants : tous nommés avec leur domaine, le bouton mène au premier", async () => {
    monter();
    await compter("Oignon", "2");
    await compter("Primus", "5");
    choisir("Autre");
    await envoyer();
    const t = barre().textContent!;
    expect(t).toContain("Oignon (Nourriture)");
    expect(t).toContain("Primus (Boissons)");
  });

  it("le bouton change aussi de PAGE (et lève la recherche qui masquerait la ligne)", async () => {
    monter({ domaineInit: "BOISSON" }, BEAUCOUP);
    choisir("Nourriture");
    await compter("Plat 110", "1"); // page 3 de 50
    choisir("Boissons");
    taper(conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')!, "jus");
    await envoyer();
    await act(async () => bouton("Aller à la ligne").click());
    expect(pilule("Nourriture").getAttribute("aria-current")).toBe("true");
    expect(conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')!.value).toBe("");
    expect(conteneur.querySelector("[data-pagination-compteur]")!.textContent).toContain("101–120 sur 120");
    expect(document.activeElement).toBe(conteneur.querySelector('input[data-explication="n109"]'));
  });

  it("une explication fournie (même sur une ligne masquée) ne bloque rien", async () => {
    monter();
    await compter("Oignon", "2");
    taper(conteneur.querySelector<HTMLInputElement>('input[data-explication="a2"]')!, "Casse");
    choisir("Boissons");
    await envoyer();
    expect(appliquer).toHaveBeenCalledTimes(1);
  });
});

describe("Valeurs conservées après un refus du serveur", () => {
  it("le serveur refuse : les cases, les écarts, l'explication et le libellé restent ; le message s'affiche", async () => {
    monter();
    appliquer.mockResolvedValueOnce({ erreur: "Service indisponible." });
    // React 19 réinitialise un formulaire non contrôlé à la fin d'une `action` : l'écran n'en utilise donc pas (onSubmit).
    let remises = 0;
    conteneur.querySelector("form")!.addEventListener("reset", () => { remises++; });
    await compter("Tomate", "9,5");
    await compter("Oignon", "2");
    taper(conteneur.querySelector<HTMLInputElement>('input[data-explication="a2"]')!, "Casse");
    taper(conteneur.querySelector<HTMLInputElement>('input[name="origine"]')!, "Fin de mois");
    await envoyer();
    expect(appliquer).toHaveBeenCalledTimes(1);
    expect(remises).toBe(0);
    expect(barre().textContent).toContain("Service indisponible.");
    expect(physique("Tomate").value).toBe("9,5");
    expect(physique("Oignon").value).toBe("2");
    expect(conteneur.querySelector<HTMLInputElement>('input[data-explication="a2"]')!.value).toBe("Casse");
    expect(conteneur.querySelector<HTMLInputElement>('input[name="origine"]')!.value).toBe("Fin de mois");
    expect(conteneur.querySelector("[data-compte-saisis]")!.textContent).toBe("2 comptés");
    // et le renvoi repart avec les mêmes valeurs
    await envoyer();
    const fd = appliquer.mock.calls[1][0];
    expect(fd.getAll("recon_physique")).toEqual(["9,5", "2", ""]);
  });
});

describe("Tolérance : une seule définition côté écran, identique à celle du serveur", () => {
  it("ecartDeComptage = calculerLignes sur une grille de cas (dont théorique 0 et écart nul)", () => {
    const cas: [number, number][] = [[10, 10], [10, 9], [10, 8.9], [10, 11.1], [0, 0], [0, 3], [5, 0], [-2, -1], [100, 90.0001], [3, 3.0001]];
    for (const [t, p] of cas) {
      const serveur = calculerLignes([{ articleId: "x", physique: p, explication: "" }], new Map([["x", t]]), new Map())[0];
      const ecran = ecartDeComptage(t, p);
      expect({ cas: [t, p], ...ecran }).toEqual({ cas: [t, p], ecart: serveur.ecart, pct: serveur.pct, horsTol: serveur.horsTol });
    }
  });
});
