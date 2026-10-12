"use client";

import { useEffect, useRef, type FormEvent } from "react";

/**
 * Rend un refus de formulaire VISIBLE (Direction, 2026-10-12 : « le refus doit être visible près du bouton
 * d'envoi ET en haut »). Le message est affiché deux fois (`ErreurAction` `emplacement="haut"` et `"bas"`,
 * tous deux marqués `data-refus`) ; ce hook décide où regarder quand un refus arrive :
 *
 *  - un des deux bandeaux est déjà à l'écran → on ne bouge pas la page ;
 *  - sinon la page défile jusqu'au bandeau le PLUS PROCHE du bouton qui vient d'envoyer (celui du bas pour un
 *    long formulaire envoyé par son bouton final, celui du haut pour la barre d'envoi fixe du sommaire).
 *
 * Pas de déplacement du focus : le clavier reste sur le bouton, et le lecteur d'écran n'entend le refus qu'UNE
 * fois (le bandeau du haut porte `role="alert"`, celui du bas est masqué aux lecteurs d'écran).
 *
 * Usage : `const noterEnvoi = useRefusVisible(erreur)` puis `noterEnvoi(e)` dans le `onSubmit` du formulaire.
 */
export function useRefusVisible(erreur: string | null | undefined): (e: FormEvent<HTMLFormElement>) => void {
  const envoi = useRef<{ form: HTMLFormElement; declencheur: Element | null } | null>(null);
  const noterEnvoi = (e: FormEvent<HTMLFormElement>) => {
    const sousmetteur = (e.nativeEvent as { submitter?: Element | null } | undefined)?.submitter ?? null;
    envoi.current = { form: e.currentTarget, declencheur: sousmetteur ?? (typeof document !== "undefined" ? document.activeElement : null) };
  };
  useEffect(() => {
    if (!erreur || !envoi.current) return;
    const { form, declencheur } = envoi.current;
    const bandeaux = [...form.querySelectorAll<HTMLElement>("[data-refus]")];
    if (bandeaux.length === 0) return;
    const hauteurEcran = window.innerHeight || document.documentElement.clientHeight;
    const visible = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < hauteurEcran; };
    if (bandeaux.some(visible)) return;
    const ref = declencheur?.getBoundingClientRect();
    const distance = (el: HTMLElement) => (ref ? Math.abs(el.getBoundingClientRect().top - ref.top) : 0);
    const proche = bandeaux.reduce((a, b) => (distance(b) < distance(a) ? b : a));
    proche.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [erreur]);
  return noterEnvoi;
}
