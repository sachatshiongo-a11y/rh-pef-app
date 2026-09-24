// Formulaires d'achat (bon de commande, facture) : Entrée n'envoie JAMAIS le formulaire.
//
// Le navigateur envoie un formulaire quand on tape Entrée dans un champ texte, une date (et,
// selon le navigateur, une case à cocher ou une liste) : c'est l'« envoi implicite », qui
// « clique » le PREMIER bouton d'envoi du formulaire. Sur la facture, quand l'alerte de doublon
// s'affiche, ce premier bouton était « Enregistrer quand même » : un Entrée dans « Désignation »
// forçait l'enregistrement d'une facture en double, et le stock était compté deux fois.
//
// À poser en `onKeyDown` sur le <form>. Restent libres :
//  - une zone de texte (Entrée y passe à la ligne) ;
//  - un bouton ou un lien qui a le focus (Entrée l'active : c'est un clic au clavier, voulu).
import type { KeyboardEvent } from "react";

const BOUTONS_INPUT = new Set(["submit", "button", "reset", "image"]);

export function empecherEnvoiParEntree(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter") return;
  const cible = e.target as HTMLElement;
  const tag = cible.tagName;
  if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "A") return;
  if (tag === "INPUT" && BOUTONS_INPUT.has((cible as HTMLInputElement).type)) return;
  e.preventDefault();
}
