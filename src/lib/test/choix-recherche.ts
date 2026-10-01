// Gestes de test pour le champ de choix avec recherche (components/choix-recherche.tsx), sous
// happy-dom : ouvrir, taper, appuyer sur une touche, choisir une option par son id. Les écrans
// migrés les emploient pour prouver « on peut choisir un article en tapant son nom ».
import { act } from "react";

export const champsChoix = (racine: ParentNode = document) => [...racine.querySelectorAll<HTMLInputElement>('input[role="combobox"]')];
/** Champ de choix par son libellé accessible (aria-label). */
export const champChoix = (racine: ParentNode, etiquette: string) =>
  champsChoix(racine).find((c) => c.getAttribute("aria-label") === etiquette) as HTMLInputElement;
/** Champ de choix d'un formulaire par le `name` de son champ caché (les lignes : index dans la liste). */
export const champsParNom = (racine: ParentNode, name: string) =>
  [...racine.querySelectorAll<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)]
    .map((h) => h.previousElementSibling as HTMLInputElement)
    .filter((c) => c?.getAttribute("role") === "combobox");
export const valeurChoisie = (champ: HTMLInputElement) => (champ.nextElementSibling as HTMLInputElement | null)?.value;

export const optionsOuvertes = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
export const libellesOuverts = () => optionsOuvertes().map((o) => o.querySelector("span")?.textContent ?? o.textContent ?? "");
export const listeOuverte = () => document.querySelector<HTMLElement>('[role="listbox"]');

export async function ouvrirChoix(champ: HTMLInputElement) {
  await act(async () => { champ.focus(); champ.click(); });
}
/** Tape du texte dans le champ (il s'ouvre et filtre). */
export async function taperChoix(champ: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    champ.focus();
    setter.call(champ, texte);
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
export async function toucheChoix(champ: HTMLInputElement, key: string, opts: KeyboardEventInit = {}) {
  let ev!: KeyboardEvent;
  await act(async () => {
    ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
    champ.dispatchEvent(ev);
  });
  return ev;
}
/** Ouvre la liste et clique l'option portant cet id (valeur soumise) : le geste de la souris ou du doigt. */
export async function choisirOption(champ: HTMLInputElement, id: string) {
  await ouvrirChoix(champ);
  const option = optionsOuvertes().find((o) => o.dataset.choixId === id);
  if (!option) throw new Error(`Option « ${id} » absente de la liste : ${libellesOuverts().join(" | ")}`);
  await act(async () => { option.click(); });
}
/** Tape le nom, puis Entrée : le geste du clavier. */
export async function choisirEnTapant(champ: HTMLInputElement, texte: string) {
  await taperChoix(champ, texte);
  await toucheChoix(champ, "Enter");
}
