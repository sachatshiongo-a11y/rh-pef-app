// @vitest-environment happy-dom
//
// Bon de commande et facture : Entrée dans un champ texte, une date ou une liste n'envoie JAMAIS
// le formulaire ; seul un clic sur un bouton l'enregistre. Sur la facture, quand l'alerte de
// doublon est affichée, « Enregistrer quand même » ne doit jamais recevoir d'envoi implicite :
// un Entrée dans « Désignation » enregistrait une facture en double (stock compté deux fois).
//
// happy-dom n'implémente pas l'envoi implicite du navigateur : `entreeNavigateur` le reproduit
// (norme HTML) — si la touche n'est pas annulée, le PREMIER bouton d'envoi du formulaire est cliqué.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const envois = vi.hoisted(() => ({
  bc: vi.fn(async (_fd: FormData): Promise<unknown> => ({ erreur: "refus de test" })),
  facture: vi.fn(async (_fd: FormData): Promise<unknown> => ({ erreur: "refus de test" })),
}));
vi.mock("../actions", () => ({ creerBonCommande: envois.bc, modifierBonCommande: envois.bc }));
vi.mock("../../factures/actions", () => ({ creerFactureAvecLignes: envois.facture, analyserFacturePDF: vi.fn() }));

import { NouveauBonForm } from "./nouveau-client";
import { NouvelleFactureForm } from "../../factures/nouveau/nouveau-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FOURNISSEURS = [{ id: "f1", nom: "Marché central", delaiJours: 30 }];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});
beforeEach(() => {
  envois.bc.mockClear();
  envois.facture.mockClear();
  envois.facture.mockImplementation(async () => ({ erreur: "refus de test" }));
});

function monter(el: ReturnType<typeof createElement>) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(el));
}

/** Entrée tapée dans `el`, avec l'envoi implicite que ferait un navigateur. */
async function entreeNavigateur(el: HTMLElement) {
  await act(async () => {
    el.focus();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    if (ev.defaultPrevented) return;
    const defaut = el.closest("form")?.querySelector<HTMLButtonElement>('button:not([type]), button[type="submit"], input[type="submit"]');
    if (defaut && !defaut.disabled) defaut.click();
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function cliquer(b: HTMLElement) {
  await act(async () => b.click());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte))!;
const champ = <T extends HTMLElement>(sel: string) => conteneur.querySelector<T>(sel)!;
const designation = () => champ<HTMLInputElement>('input[name="ligne_designation"]');

describe("bon de commande — Entrée n'envoie jamais", () => {
  const cas: [string, () => HTMLElement][] = [
    ["la désignation", designation],
    ["le délai de paiement", () => champ('input[name="delaiPaiement"]')],
    ["le mode de paiement", () => champ('input[name="modePaiement"]')],
    ["le fournisseur (liste)", () => champ('select[name="fournisseurId"]')],
    ["l'article (liste)", () => champ("tbody select")],
  ];
  it.each(cas)("Entrée dans %s n'appelle pas l'action", async (_nom, el) => {
    monter(createElement(NouveauBonForm, { articles: [], fournisseurs: FOURNISSEURS }));
    await entreeNavigateur(el());
    expect(envois.bc).not.toHaveBeenCalled();
  });

  it("le clic sur « Créer le bon de commande » envoie bien", async () => {
    monter(createElement(NouveauBonForm, { articles: [], fournisseurs: FOURNISSEURS }));
    await cliquer(bouton("Créer le bon de commande"));
    expect(envois.bc).toHaveBeenCalledTimes(1);
  });

  it("Entrée dans la note (zone de texte) reste un retour à la ligne", async () => {
    monter(createElement(NouveauBonForm, { articles: [], fournisseurs: FOURNISSEURS }));
    const note = champ<HTMLTextAreaElement>('textarea[name="commentaire"]');
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => { note.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("facture — Entrée n'envoie jamais", () => {
  const facture = () => createElement(NouvelleFactureForm, { articles: [], fournisseurs: FOURNISSEURS, bons: [], bcInitial: null });
  const cas: [string, () => HTMLElement][] = [
    ["la désignation", designation],
    ["la date", () => champ('input[name="date"]')],
    ["le fournisseur (liste)", () => [...conteneur.querySelectorAll("select")].find((x) => x.textContent?.includes("— catalogue —"))!],
    ["le nom du fournisseur", () => champ('input[name="fournisseurNom"]')],
    ["le n° de facture", () => champ('input[name="numero"]')],
  ];

  /** Facture montée avec le fournisseur (seul champ obligatoire) rempli : envoyable. */
  function monterFactureValide() {
    monter(facture());
    act(() => {
      const nom = champ<HTMLInputElement>('input[name="fournisseurNom"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nom, "Marché central");
      nom.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it.each(cas)("Entrée dans %s n'appelle pas l'action", async (_nom, el) => {
    monterFactureValide();
    await entreeNavigateur(el());
    expect(envois.facture).not.toHaveBeenCalled();
  });

  describe("alerte de doublon affichée", () => {
    async function afficherDoublon() {
      envois.facture.mockImplementation(async () => ({ erreur: "DOUBLON_POSSIBLE|Farine déjà entrée le 20/09." }));
      monterFactureValide();
      await cliquer(bouton("Enregistrer la facture"));
      expect(envois.facture).toHaveBeenCalledTimes(1);
      expect(envois.facture.mock.calls[0][0].get("forcerDoublons")).toBeNull();
      expect(conteneur.textContent).toContain("Achat peut-être déjà saisi");
      envois.facture.mockClear();
    }

    it("« Enregistrer quand même » n'est pas un bouton d'envoi (jamais le bouton par défaut)", async () => {
      await afficherDoublon();
      const forcer = bouton("Enregistrer quand même");
      expect(forcer.getAttribute("type")).toBe("button");
      const defaut = champ('button:not([type]), button[type="submit"], input[type="submit"]');
      expect(defaut.textContent).toContain("Enregistrer la facture");
    });

    it.each(cas)("Entrée dans %s n'appelle pas l'action", async (_nom, el) => {
      await afficherDoublon();
      await entreeNavigateur(el());
      expect(envois.facture).not.toHaveBeenCalled();
    });

    it("le CLIC sur « Enregistrer quand même » force bien l'enregistrement", async () => {
      await afficherDoublon();
      await cliquer(bouton("Enregistrer quand même"));
      expect(envois.facture).toHaveBeenCalledTimes(1);
      const fd = envois.facture.mock.calls[0][0];
      expect(fd.get("forcerDoublons")).toBe("1");
      expect(fd.get("fournisseurNom")).toBe("Marché central");
    });
  });
});
