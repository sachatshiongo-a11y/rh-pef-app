// @vitest-environment happy-dom
//
// Fiche employé : les fiches PROCHES apparaissent sous le nom pendant la saisie (actives et
// inactives, ordre des mots inversé…), l'envoi est bloqué tant qu'aucun choix n'est fait, et
// « C'est une autre personne » ajoute le seul champ nouveau de l'envoi (`doublonsEcartes`, relu par
// le serveur qui revérifie — doublons.integration.test.ts). Une modification qui ne touche pas
// l'identité ne repose pas la question.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Employee } from "@prisma/client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ reactiverEmploye: vi.fn(async () => {}) }));

import { EmployeeForm } from "./employee-form";
import type { FicheDoublonClient } from "./alerte-doublons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fiche = (id: string, nom: string, extra: Partial<FicheDoublonClient> = {}): FicheDoublonClient => ({
  id, nom, matricule: `${id}-PEF`, telephone: null, dateNaissance: null, actif: true, poste: "Plongeuse", dateEmbauche: "2023-02-01", photoUrl: null, ...extra,
});
const FICHES = [fiche("a", "Martine Mutombo"), fiche("b", "Mutombo Martine", { actif: false }), fiche("c", "Esther Nsundi", { telephone: "0815555222" })];

let conteneur: HTMLDivElement;
let racine: Root;
const action = vi.fn();
function monter(employee?: Employee, peutReactiver = true) {
  action.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(EmployeeForm, { employee, action, joursOuvrablesMois: 26, doublons: { fiches: FICHES, ecartees: [], peutReactiver } })));
}
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const champ = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[name="${nom}"]`)!;
function taper(nom: string, texte: string) {
  const el = champ(nom);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, texte);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const alerte = () => conteneur.querySelector("#alerte-doublons");
const bouton = (texte: RegExp) => [...conteneur.querySelectorAll("button")].find((b) => texte.test(b.textContent ?? ""))!;
/** Envoie le formulaire ; vrai si l'action serveur a été appelée (React l'appelle lui-même, sauf si onSubmit a bloqué). */
function envoyer() {
  const form = conteneur.querySelector("form#fiche-employe") as HTMLFormElement;
  const avant = action.mock.calls.length;
  act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  return action.mock.calls.length > avant;
}

describe("fiches proches pendant la saisie", () => {
  it("le nom tapé à l'envers montre les deux fiches (active et inactive) avec lien, statut, poste et date d'entrée", () => {
    monter();
    expect(alerte()).toBeNull();
    taper("nom", "Mutombo Martine");
    const texte = alerte()!.textContent!;
    expect(texte).toContain("2 fiches proches existent déjà");
    expect(texte).toContain("Martine Mutombo");
    expect(texte).toMatch(/Inactif/);
    expect(texte).toContain("Plongeuse · entré(e) le 01/02/2023");
    expect(alerte()!.querySelector('a[href="/employes/a"]')).not.toBeNull();
    // Réactiver : seulement sur la fiche inactive.
    expect([...alerte()!.querySelectorAll("button")].filter((b) => b.textContent?.includes("Réactiver"))).toHaveLength(1);
  });

  it("le téléphone seul remonte une fiche ; un nom sans rapport, rien", () => {
    monter();
    taper("nom", "Pierre Kalala");
    expect(alerte()).toBeNull();
    taper("telephone", "+243 815 555 222");
    expect(alerte()!.textContent).toContain("même téléphone");
  });

  it("sans choix, l'envoi est bloqué ; « C'est une autre personne » ajoute doublonsEcartes et l'envoi part", () => {
    monter();
    taper("nom", "Mutombo Martine");
    expect(envoyer()).toBe(false);
    expect(alerte()!.className).toContain("border-destructive");
    expect(champ("doublonsEcartes")).toBeNull();
    act(() => bouton(/C'est une autre personne/).click());
    expect(champ("doublonsEcartes").value.split(",").sort()).toEqual(["a", "b"]);
    expect(alerte()!.textContent).toContain("Vous avez indiqué qu'il s'agit d'une autre personne");
    expect(envoyer()).toBe(true);
    expect((action.mock.calls[0][0] as FormData).get("doublonsEcartes")).toBe(champ("doublonsEcartes").value);
  });

  it("« Réactiver » n'est pas proposé à qui ne peut pas réactiver (Responsable RH)", () => {
    monter(undefined, false);
    taper("nom", "Mutombo Martine");
    expect(alerte()!.textContent).not.toContain("Réactiver");
  });

  it("modification : la fiche elle-même n'est jamais proposée, et rien n'apparaît tant que l'identité ne change pas", () => {
    monter({ id: "a", nom: "Martine Mutombo", telephone: null, dateNaissance: null, dateEmbauche: new Date("2023-02-01T00:00:00Z") } as unknown as Employee);
    expect(alerte()).toBeNull();
    taper("salaireMensuel", "500");
    expect(alerte()).toBeNull();
    taper("nom", "Martine Mutombo Kasongo");
    const texte = alerte()!.textContent!;
    expect(texte).toContain("Mutombo Martine");
    expect(alerte()!.querySelector('a[href="/employes/a"]')).toBeNull();
    expect(texte).toContain("enregistrer quand même");
  });
});
