// @vitest-environment happy-dom
//
// Lignes d'un nouveau bon de commande et d'une nouvelle facture, passées au comportement « Excel »
// (décision de la Direction du 2026-09-24) :
//  - mêmes MONTANTS qu'avant pour une même saisie — la virgule française comprise. L'ancien champ
//    number rendait « 2.5 » (écriture à point) ; les calculs `Number(q) * Number(p)` et les champs
//    envoyés au serveur doivent donc rester ceux d'une saisie à point ;
//  - Entrée descend dans la colonne, n'envoie JAMAIS le formulaire, et sur la dernière ligne en
//    ajoute une et y place le curseur.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const envois = vi.hoisted(() => ({ bc: vi.fn(async () => ({})), facture: vi.fn(async () => ({})) }));
vi.mock("../actions", () => ({
  creerBonCommande: envois.bc,
  modifierBonCommande: envois.bc,
  creerFactureAvecLignes: envois.facture,
  analyserFacturePDF: vi.fn(),
}));
vi.mock("../../factures/actions", () => ({
  creerFactureAvecLignes: envois.facture,
  analyserFacturePDF: vi.fn(),
}));

import { NouveauBonForm } from "./nouveau-client";
import { NouvelleFactureForm } from "../../factures/nouveau/nouveau-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ECRANS = {
  "bon de commande": () => createElement(NouveauBonForm, { articles: [], fournisseurs: [] }),
  "facture": () => createElement(NouvelleFactureForm, { articles: [], fournisseurs: [], bons: [], bcInitial: null }),
};

// Calcul de montant AVANT le passage aux cases partagées, appliqué à ce que rendait le champ number.
const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const montantAvant = (q: string, p: string) => (Number(q) || 0) * (Number(p) || 0);

// Saisie tapée (à la française) → ce que le champ number d'avant rendait pour la même saisie.
const SAISIES: { q: string; p: string; qAvant: string; pAvant: string }[] = [
  { q: "2,5", p: "4", qAvant: "2.5", pAvant: "4" },
  { q: "1 250", p: "0,1", qAvant: "1250", pAvant: "0.1" },
  { q: "3", p: "19,99", qAvant: "3", pAvant: "19.99" },
  { q: "0,333", p: "3", qAvant: "0.333", pAvant: "3" },
];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});
function monter(ecran: () => ReturnType<typeof createElement>) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(ecran()));
}
function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function saisir(el: HTMLInputElement, texte: string) {
  act(() => el.focus());
  taper(el, texte);
  await act(async () => el.blur());
}
async function entree(el: HTMLInputElement, opts: KeyboardEventInit = {}) {
  let ev!: KeyboardEvent;
  await act(async () => {
    ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...opts });
    el.dispatchEvent(ev);
  });
  return ev;
}
const qte = (i: number) => conteneur.querySelector<HTMLInputElement>(`[aria-label="Quantité, ligne ${i}"]`)!;
const pu = (i: number) => conteneur.querySelector<HTMLInputElement>(`[aria-label="Prix unitaire, ligne ${i}"]`)!;
const totalLigne = (i: number) => qte(i).closest("tr")!.querySelectorAll("td")[5].textContent;
const totalGeneral = () => conteneur.querySelector(".text-lg.font-semibold")!.textContent;

beforeEach(() => { envois.bc.mockClear(); envois.facture.mockClear(); });

describe.each(Object.entries(ECRANS))("lignes — %s", (_nom, ecran) => {
  it("plus aucun champ type=number", () => {
    monter(ecran);
    expect(conteneur.querySelectorAll('input[type="number"]')).toHaveLength(0);
  });

  it("une même saisie donne les mêmes montants qu'avant, virgule française comprise", async () => {
    monter(ecran);
    const ajout = [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "+ Ligne")!;
    while (!qte(SAISIES.length)) act(() => ajout.click());
    let totalAvant = 0;
    for (const [k, s] of SAISIES.entries()) {
      await saisir(qte(k + 1), s.q);
      await saisir(pu(k + 1), s.p);
      const avant = montantAvant(s.qAvant, s.pAvant);
      totalAvant += avant;
      expect(totalLigne(k + 1), `${s.q} × ${s.p}`).toBe(`${fmt(avant)} $`);
    }
    expect(totalGeneral()).toBe(`${fmt(totalAvant)} $`);
    // Et le serveur reçoit exactement ce que l'ancien champ number envoyait.
    const fd = new FormData(conteneur.querySelector("form")!);
    expect(fd.getAll("ligne_quantite").slice(0, SAISIES.length)).toEqual(SAISIES.map((s) => s.qAvant));
    expect(fd.getAll("ligne_prix").slice(0, SAISIES.length)).toEqual(SAISIES.map((s) => s.pAvant));
    expect(totalAvant).toBeCloseTo(10 + 125 + 59.97 + 0.999, 9);
  });

  it("Entrée descend dans la même colonne et n'envoie jamais le formulaire", async () => {
    monter(ecran);
    act(() => qte(1).focus());
    const ev = await entree(qte(1));
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(qte(2));
    await entree(qte(2), { shiftKey: true });
    expect(document.activeElement).toBe(qte(1));
    expect(envois.bc).not.toHaveBeenCalled();
    expect(envois.facture).not.toHaveBeenCalled();
  });

  it("Entrée sur la dernière ligne ajoute une ligne et y place le curseur, même colonne", async () => {
    monter(ecran);
    expect(qte(4)).toBeNull(); // 3 lignes vides au départ
    act(() => pu(3).focus());
    taper(pu(3), "7,5");
    const ev = await entree(pu(3));
    expect(ev.defaultPrevented).toBe(true);
    expect(qte(4)).not.toBeNull();
    expect(document.activeElement).toBe(pu(4));
    expect(pu(3).value).toBe("7,5"); // la case quittée est bien validée…
    expect(new FormData(conteneur.querySelector("form")!).getAll("ligne_prix")[2]).toBe("7.5"); // … et part au serveur
    expect(envois.bc).not.toHaveBeenCalled();
    expect(envois.facture).not.toHaveBeenCalled();
  });

  it("une saisie illisible sur la dernière ligne n'ajoute pas de ligne", async () => {
    monter(ecran);
    act(() => qte(3).focus());
    taper(qte(3), "2,5,1");
    await entree(qte(3));
    expect(qte(4)).toBeNull();
    expect(document.activeElement).toBe(qte(3));
  });
});

describe("lignes — bon de commande, prix fixé au catalogue", () => {
  it("le prix d'un article du catalogue est en lecture seule, sauté par Entrée, et envoyé tel quel", async () => {
    monter(() => createElement(NouveauBonForm, {
      articles: [{ id: "a1", designation: "Farine", prix: "12.5", uniteParCarton: null }], fournisseurs: [],
    }));
    const select = qte(2).closest("tr")!.querySelector("select")!;
    await act(async () => {
      select.value = "a1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(pu(2).readOnly).toBe(true);
    expect(pu(2).value).toBe("12,5");
    await saisir(qte(2), "2");
    expect(totalLigne(2)).toBe(`${fmt(25)} $`);
    act(() => pu(1).focus());
    await entree(pu(1));
    expect(document.activeElement).toBe(pu(3)); // ligne 2 sautée
    expect(new FormData(conteneur.querySelector("form")!).getAll("ligne_prix")[1]).toBe("12.5");
  });

  it("Entrée n'ajoute une ligne que depuis la DERNIÈRE ligne (pas quand les cases du dessous sont en lecture seule)", async () => {
    monter(() => createElement(NouveauBonForm, {
      articles: [{ id: "a1", designation: "Farine", prix: "12.5", uniteParCarton: null }], fournisseurs: [],
    }));
    const select = qte(3).closest("tr")!.querySelector("select")!;
    await act(async () => {
      select.value = "a1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => pu(2).focus());
    await entree(pu(2));
    expect(qte(4)).toBeNull();
    expect(document.activeElement).toBe(pu(2));
  });
});
