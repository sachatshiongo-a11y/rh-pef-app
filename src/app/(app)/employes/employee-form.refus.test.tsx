// @vitest-environment happy-dom
//
// « Nouvel employé » / « Modifier » : un refus du serveur (matricule en doublon, salaire illisible…) ne vide plus
// le formulaire — l'action était un <form action> brut, que React remet à zéro, et le refus faisait remonter la
// page par redirection (audit du 10/10/2026, ergonomie 2). Le bouton attend aussi la réponse (ergonomie 5).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EmployeeForm, FORMULAIRE_FICHE_EMPLOYE } from "./employee-form";
import { CHAMP_RETOUR_ERREUR } from "@/lib/erreur-formulaire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
function monter(action: (fd: FormData) => unknown) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(EmployeeForm, { action: action as (fd: FormData) => Promise<unknown>, joursOuvrablesMois: 26, postes: ["Cuisinier"] })));
}
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const nom = () => conteneur.querySelector<HTMLInputElement>('input[name="nom"]')!;
function saisir(el: HTMLInputElement, valeur: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valeur);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}
// Événement « submit » direct : les champs obligatoires du formulaire complet (date d'embauche, salaire…) ne sont pas remplis ici.
const envoyer = async () => { await act(async () => { conteneur.querySelector<HTMLFormElement>(`form#${FORMULAIRE_FICHE_EMPLOYE}`)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

describe("EmployeeForm — la saisie survit à un refus", () => {
  it("refus rendu { erreur } : message affiché, nom resté saisi", async () => {
    const action = vi.fn(async (_fd: FormData) => ({ erreur: "Ce matricule existe déjà." }));
    monter(action);
    saisir(nom(), "Aimée Mutita");
    await envoyer();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0][0].get(CHAMP_RETOUR_ERREUR)).toBe("1");
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe("Ce matricule existe déjà.");
    expect(nom().value).toBe("Aimée Mutita");
  });

  it("le refus est affiché en haut ET en bas de la fiche (même texte, un seul role=alert)", async () => {
    monter(vi.fn(async (_fd: FormData) => ({ erreur: "Ce matricule existe déjà." })));
    await envoyer();
    const b = [...conteneur.querySelectorAll<HTMLElement>("[data-refus]")];
    expect(b.map((x) => x.dataset.refus)).toEqual(["haut", "bas"]);
    expect(b.map((x) => x.textContent)).toEqual(["Ce matricule existe déjà.", "Ce matricule existe déjà."]);
    expect(conteneur.querySelectorAll('[role="alert"]')).toHaveLength(1);
    const form = conteneur.querySelector("form")!;
    const tous = [...form.querySelectorAll("*")];
    expect(tous.indexOf(b[0])).toBeLessThan(tous.indexOf(nom())); // le haut précède les champs
    expect(tous.indexOf(b[1])).toBeGreaterThan(tous.indexOf(nom())); // le bas suit : près du bouton d'envoi
  });

  it("les boutons « Enregistrer » (barre et bas de page) sont désactivés pendant l'envoi : un seul envoi", async () => {
    let finir!: () => void;
    const action = vi.fn(() => new Promise<void>((ok) => { finir = ok; }));
    monter(action);
    saisir(nom(), "Aimée Mutita");
    await envoyer();
    const boutons = [...conteneur.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];
    expect(boutons.length).toBe(2);
    expect(boutons.every((b) => b.disabled && b.textContent === "Envoi…")).toBe(true);
    await envoyer();
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { finir(); });
    expect(boutons.every((b) => !b.disabled && b.textContent === "Enregistrer")).toBe(true);
  });

  it("une réussite ne vide pas la fiche (elle redirige vers la liste)", async () => {
    monter(vi.fn(async () => undefined));
    saisir(nom(), "Aimée Mutita");
    await envoyer();
    expect(nom().value).toBe("Aimée Mutita");
  });
});
