// @vitest-environment happy-dom
//
// CONGÉS — « NOUVELLE DEMANDE » dans un panneau latéral (refonte 2026-10-09). Le formulaire change de décor
// (bloc repliable → panneau) mais PAS de contrat : mêmes champs, mêmes noms, mêmes obligations, dans le même
// ordre, mêmes valeurs envoyées à `demanderConge` — ces assertions sont celles figées AVANT la refonte, sur
// l'ancien bloc (commit « fige le contrat du formulaire »), reprises telles quelles.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const A = vi.hoisted(() => ({ envoyes: [] as FormData[], echec: false }));
vi.mock("./actions", () => ({
  demanderConge: vi.fn(async (donnees: FormData) => { A.envoyes.push(donnees); }),
}));

import { NouvelleDemandeConge } from "./nouvelle-demande";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYES = [{ id: "e-aimee", nom: "Aimée Mutita" }, { id: "e-esther", nom: "Esther Nsundi" }];
const TYPES = ["Congé annuel", "Congé maladie"];

let conteneur: HTMLDivElement;
let racine: Root;
function monter(props: { erreur?: string } = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(NouvelleDemandeConge, { employees: EMPLOYES, types: TYPES, feries: ["2026-06-30"], ...props })));
}
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  A.envoyes.length = 0;
});

const bouton = (texte: RegExp) => [...document.querySelectorAll("button")].find((b) => texte.test(b.textContent ?? ""));
/** Le panneau OUVERT (fermé, il reste monté mais masqué : la saisie n'est pas perdue). */
const panneau = () => document.querySelector<HTMLElement>("[data-panneau-lateral]:not([hidden])");
const panneauMonte = () => document.querySelector<HTMLElement>("[data-panneau-lateral]");
const formulaire = () => panneau()!.querySelector("form")!;
function ouvrir() { act(() => bouton(/Nouvelle demande/)!.click()); }
function saisir(el: HTMLInputElement | HTMLSelectElement, valeur: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valeur);
  act(() => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
const champs = () => [...formulaire().querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name], textarea[name]")]
  .map((c) => ({ nom: c.name, balise: c.tagName.toLowerCase(), type: c instanceof HTMLInputElement && c.getAttribute("type") ? c.type : null, requis: c.required }));
const options = (nom: string) => [...formulaire().querySelectorAll<HTMLOptionElement>(`select[name="${nom}"] option`)].map((o) => [o.value, o.textContent]);

describe("Nouvelle demande — le bouton et le panneau", () => {
  it("un bouton primaire en haut ; le panneau est masqué tant qu'on ne l'a pas ouvert", () => {
    monter();
    expect(bouton(/Nouvelle demande/)).toBeTruthy();
    expect(panneau()).toBeNull();
    expect(panneauMonte()?.hidden).toBe(true);
    expect(document.querySelector("details")).toBeNull(); // plus de bloc repliable
  });

  it("s'ouvre en dialogue (voile + panneau), se ferme par Fermer, Annuler, Échap et le voile", () => {
    monter();
    ouvrir();
    expect(panneau()?.getAttribute("role")).toBe("dialog");
    expect(panneau()?.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector("[data-voile-panneau]")).toBeTruthy();
    act(() => bouton(/Fermer/)!.click());
    expect(panneau()).toBeNull();
    ouvrir(); act(() => bouton(/^Annuler$/)!.click());
    expect(panneau()).toBeNull();
    ouvrir(); act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(panneau()).toBeNull();
    ouvrir(); act(() => document.querySelector<HTMLElement>("[data-voile-panneau]")!.click());
    expect(panneau()).toBeNull();
  });

  it("pas de backdrop-filter sur le panneau ni sur le voile (il décroche en PWA iOS)", () => {
    monter(); ouvrir();
    expect(panneau()!.className + document.querySelector("[data-voile-panneau]")!.className).not.toMatch(/backdrop/);
  });

  it("une erreur du serveur (?erreur=) rouvre le panneau avec le message ; Fermer la fait taire", () => {
    monter({ erreur: "La période ne contient aucun jour ouvrable." });
    expect(panneau()).not.toBeNull();
    expect(panneau()!.querySelector('[role="alert"]')?.textContent).toContain("aucun jour ouvrable");
    act(() => bouton(/Fermer/)!.click());
    expect(panneau()).toBeNull();
    ouvrir(); // la même erreur, déjà vue, ne revient pas à la réouverture
    expect(panneau()!.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("Nouvelle demande — saisie gardée, focus", () => {
  it("fermer (Fermer, Échap, voile) ne perd pas la saisie ; elle repart vide une fois la demande enregistrée", async () => {
    monter(); ouvrir();
    saisir(formulaire().querySelector<HTMLInputElement>('input[name="motif"]')!, "Soins");
    saisir(formulaire().querySelector<HTMLInputElement>('input[name="dateDebut"]')!, "2026-06-29");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(panneau()).toBeNull();
    ouvrir();
    expect(formulaire().querySelector<HTMLInputElement>('input[name="motif"]')!.value).toBe("Soins");
    expect(formulaire().querySelector<HTMLInputElement>('input[name="dateDebut"]')!.value).toBe("2026-06-29");
    saisir(formulaire().querySelector<HTMLInputElement>('input[name="dateFin"]')!, "2026-07-04");
    await act(async () => { formulaire().requestSubmit(); });
    expect(panneau()).toBeNull();
    ouvrir();
    expect(formulaire().querySelector<HTMLInputElement>('input[name="motif"]')!.value).toBe("");
  });

  it("le focus va au premier champ à l'ouverture et revient au bouton à la fermeture", () => {
    monter();
    const ouvreur = bouton(/Nouvelle demande/)!;
    act(() => ouvreur.focus());
    ouvrir();
    expect(document.activeElement).toBe(formulaire().querySelector('select[name="employeeId"]'));
    act(() => bouton(/Fermer/)!.click());
    expect(document.activeElement).toBe(ouvreur);
  });

  it("piège de focus : Tab sur le dernier élément revient au premier, Maj+Tab sur le premier va au dernier", () => {
    monter(); ouvrir();
    const focalisables = [...panneau()!.querySelectorAll<HTMLElement>("button, input, select")];
    const premier = focalisables[0], dernier = focalisables[focalisables.length - 1];
    act(() => dernier.focus());
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true })); });
    expect(document.activeElement).toBe(premier);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true })); });
    expect(document.activeElement).toBe(dernier);
  });

  it("le portail n'existe pas au rendu serveur (ouverture directe sur ?erreur=… : pas d'écart d'hydratation)", async () => {
    const { renderToString } = await import("react-dom/server");
    const html = renderToString(h(NouvelleDemandeConge, { employees: EMPLOYES, types: TYPES, feries: [], erreur: "Boum" }));
    expect(html).toContain("Nouvelle demande");
    expect(html).not.toContain("dialog");
    expect(html).not.toContain("Boum");
  });
});

describe("Nouvelle demande — contrat du formulaire (inchangé)", () => {
  it("mêmes champs, mêmes noms, mêmes obligations, dans le même ordre", () => {
    monter(); ouvrir();
    expect(champs()).toEqual([
      { nom: "employeeId", balise: "select", type: null, requis: true },
      { nom: "type", balise: "select", type: null, requis: false },
      { nom: "dateDebut", balise: "input", type: "date", requis: true },
      { nom: "nbJours", balise: "input", type: "text", requis: true },
      { nom: "dateFin", balise: "input", type: "date", requis: true },
      { nom: "remplacantId", balise: "select", type: null, requis: false },
      { nom: "motif", balise: "input", type: null, requis: false },
    ]);
    expect(formulaire().textContent).toContain("Enregistrer la demande");
  });

  it("listes de choix : salariés (par nom), types de congé, remplaçant facultatif", () => {
    monter(); ouvrir();
    expect(options("employeeId")).toEqual([["e-aimee", "Aimée Mutita"], ["e-esther", "Esther Nsundi"]]);
    expect(options("type")).toEqual([["Congé annuel", "Congé annuel"], ["Congé maladie", "Congé maladie"]]);
    expect(options("remplacantId")).toEqual([["", "— Aucun —"], ["e-aimee", "Aimée Mutita"], ["e-esther", "Esther Nsundi"]]);
  });

  it("le décompte en direct des jours ouvrables marche dans le panneau (29/06 → 04/07, 30/06 férié : 5 j)", () => {
    monter(); ouvrir();
    saisir(formulaire().querySelector<HTMLInputElement>('input[name="dateDebut"]')!, "2026-06-29");
    saisir(formulaire().querySelector<HTMLInputElement>('input[name="dateFin"]')!, "2026-07-04");
    expect(formulaire().querySelector<HTMLInputElement>('input[name="nbJours"]')!.value).toBe("5");
  });

  it("l'envoi transmet à `demanderConge` EXACTEMENT les mêmes champs qu'avant, puis ferme le panneau", async () => {
    monter(); ouvrir();
    saisir(formulaire().querySelector<HTMLSelectElement>('select[name="employeeId"]')!, "e-esther");
    saisir(formulaire().querySelector<HTMLSelectElement>('select[name="type"]')!, "Congé maladie");
    saisir(formulaire().querySelector<HTMLInputElement>('input[name="dateDebut"]')!, "2026-06-29");
    saisir(formulaire().querySelector<HTMLInputElement>('input[name="dateFin"]')!, "2026-07-04");
    saisir(formulaire().querySelector<HTMLSelectElement>('select[name="remplacantId"]')!, "e-aimee");
    saisir(formulaire().querySelector<HTMLInputElement>('input[name="motif"]')!, "Soins");
    await act(async () => { formulaire().requestSubmit(); });
    expect(A.envoyes).toHaveLength(1);
    expect(Object.fromEntries(A.envoyes[0].entries())).toEqual({
      employeeId: "e-esther", type: "Congé maladie", dateDebut: "2026-06-29", nbJours: "5", dateFin: "2026-07-04", remplacantId: "e-aimee", motif: "Soins",
    });
    expect(panneau()).toBeNull();
  });
});
