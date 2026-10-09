"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";

const FOCALISABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const jamais = () => () => {};
/** Faux sur le serveur ET pendant l'hydratation, vrai ensuite : le portail n'est monté qu'après le montage (pas de différence serveur / client). */
const useApresMontage = () => useSyncExternalStore(jamais, () => true, () => false);

/**
 * Panneau latéral d'un formulaire (« Nouvelle demande de congé »…) : un volet à DROITE sur ordinateur et
 * en plein écran sur téléphone (sous `sm`), au lieu d'un bloc repliable qui pousse la liste. Même
 * mécanique que le tiroir des espaces (`tiroir-mobile.tsx`) : la page derrière est figée pendant
 * l'ouverture (`use-lock-body-scroll`, position rendue à la fermeture), le panneau est le SEUL conteneur
 * qui défile (`overscroll-contain`, hauteur `dvh`, marges de sécurité), Échap et un appui sur le voile
 * ferment. Ni flou ni `backdrop-filter` (il décroche sur un élément fixe en PWA iOS).
 * Rendu par un portail dans <body> (la coquille de l'app est `overflow-hidden`, et sur iOS/PWA un
 * `position: fixed` qui en descend peut être recadré à ses bornes — même piège que `bouton-signer.tsx`),
 * monté APRÈS le montage : la page ouverte directement sur `?erreur=…` s'hydrate sans écart.
 *
 * Le CONTENU reste monté quand le panneau est fermé (simplement masqué) : fermer par Échap, par le voile
 * ou par erreur ne fait jamais perdre une saisie ; c'est à l'appelant de réinitialiser son formulaire
 * (`key`) une fois l'enregistrement réussi.
 * Accessibilité : le focus va au premier champ (`data-autofocus`, sinon le premier élément focalisable) à
 * l'ouverture, Tab et Maj+Tab restent dans le panneau, et le focus revient à l'élément qui l'a ouvert à la fermeture.
 */
export function PanneauLateral({ ouvert, onFermer, titre, children }: { ouvert: boolean; onFermer: () => void; titre: string; children: ReactNode }) {
  const idTitre = useId();
  const monte = useApresMontage();
  const panneau = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLElement | null>(null);
  useLockBodyScroll(ouvert);

  // Focus : initial à l'ouverture, rendu à l'élément qui avait le focus à la fermeture.
  useEffect(() => {
    if (!ouvert || !monte) return;
    declencheur.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const zone = panneau.current;
    const premier = zone?.querySelector<HTMLElement>("[data-autofocus]") ?? zone?.querySelector<HTMLElement>(FOCALISABLES);
    premier?.focus();
    return () => { declencheur.current?.focus?.(); };
  }, [ouvert, monte]);

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onFermer(); return; }
      if (e.key !== "Tab") return;
      // Piège de focus : le Tab du dernier élément revient au premier, le Maj+Tab du premier va au dernier.
      const liste = [...(panneau.current?.querySelectorAll<HTMLElement>(FOCALISABLES) ?? [])];
      if (liste.length === 0) return;
      const premier = liste[0];
      const dernier = liste[liste.length - 1];
      const actif = document.activeElement;
      if (!panneau.current?.contains(actif)) { e.preventDefault(); premier.focus(); }
      else if (e.shiftKey && actif === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && actif === dernier) { e.preventDefault(); premier.focus(); }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [ouvert, onFermer]);

  if (!monte) return null;
  return createPortal(
    <>
      {ouvert && <div data-voile-panneau className="fixed inset-0 z-40 touch-none overscroll-contain bg-black/40" onClick={onFermer} aria-hidden />}
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        hidden={!ouvert}
        data-panneau-lateral
        data-ouvert={ouvert}
        className={`${ouvert ? "flex" : "hidden"} fixed inset-y-0 right-0 z-50 w-full flex-col overflow-y-auto overscroll-contain border-l bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pr-[max(1rem,env(safe-area-inset-right))] shadow-2xl max-sm:h-dvh sm:max-w-md sm:p-5`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={idTitre} className="text-base font-semibold">{titre}</h2>
          <button type="button" onClick={onFermer} className="inline-flex min-h-9 shrink-0 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent">
            Fermer ✕
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}
