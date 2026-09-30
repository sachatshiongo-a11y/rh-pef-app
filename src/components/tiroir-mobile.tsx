"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";

/**
 * Tiroir latéral des espaces (téléphone et tablette, sous `lg`) — UN SEUL mécanisme pour les
 * quatre coquilles (salarié, RH, Stock, Exploitation) : le crochet `useTiroir`, le voile
 * `VoileTiroir` et le panneau `Tiroir`. Sur ordinateur (`lg`), le panneau est ouvert en permanence
 * à gauche : rien de tout cela ne s'applique.
 *
 * Ce qui a été corrigé (PWA iOS, 2026-09-29) : faire défiler le tiroir faisait défiler la PAGE
 * derrière lui. Le tiroir ne défilait pas seul (un panneau qui ne déborde pas ou arrive au bout
 * chaîne le geste à la page) et la page n'était pas verrouillée. Désormais :
 *   - le tiroir est le SEUL conteneur qui défile (`overflow-y-auto overscroll-contain`, hauteur
 *     `100dvh`, marges de sécurité) ; ses menus ne sont plus des défileurs imbriqués sur téléphone ;
 *   - la page derrière est figée pendant l'ouverture (`use-lock-body-scroll`) et sa position exacte
 *     est rendue à la fermeture ;
 *   - le voile ne défile pas (`touch-none`) et un appui dessus ferme ;
 *   - rien ne reste bloqué : navigation (lien du tiroir, touche retour), Échap, rotation de
 *     l'appareil ou passage à la largeur « ordinateur » ferment le tiroir et relâchent la page.
 */
export function useTiroir() {
  const pathname = usePathname() ?? "";
  // Le tiroir est ouvert « sur une page » : dès que le chemin change, il est fermé de fait, sans
  // effet à synchroniser (lien du tiroir, retour arrière, navigation programmatique).
  const [ouvertSur, setOuvertSur] = useState<string | null>(null);
  const ouvert = ouvertSur === pathname;
  const ouvrir = useCallback(() => setOuvertSur(pathname), [pathname]);
  const fermer = useCallback(() => setOuvertSur(null), []);

  useLockBodyScroll(ouvert);

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => { if (e.key === "Escape") fermer(); };
    const large = window.matchMedia("(min-width: 1024px)");
    const surLargeur = () => { if (large.matches) fermer(); };
    window.addEventListener("keydown", surTouche);
    window.addEventListener("popstate", fermer);
    window.addEventListener("orientationchange", fermer);
    large.addEventListener("change", surLargeur);
    return () => {
      window.removeEventListener("keydown", surTouche);
      window.removeEventListener("popstate", fermer);
      window.removeEventListener("orientationchange", fermer);
      large.removeEventListener("change", surLargeur);
    };
  }, [ouvert, fermer]);

  return { ouvert, ouvrir, fermer };
}

/**
 * Voile sombre derrière le tiroir (téléphone). À rendre HORS du conteneur `overflow-hidden` de la
 * coquille : certains navigateurs mobiles (Safari iOS) recadrent un descendant `position: fixed`
 * aux bornes d'un ancêtre `overflow: hidden`, et le voile ne couvrait pas tout l'écran.
 * `touch-none` : un glissement sur le voile ne fait défiler rien ; un appui ferme le menu.
 * Ni flou ni `backdrop-filter` : sur un élément fixe, il décroche en PWA iOS.
 */
export function VoileTiroir({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  if (!ouvert) return null;
  return <div data-voile-tiroir className="fixed inset-0 z-40 touch-none overscroll-contain bg-black/40 lg:hidden" onClick={onFermer} aria-hidden />;
}

/**
 * Le panneau du tiroir : coulissant sur téléphone, statique sur ordinateur. `className` apporte ce
 * qui est propre à l'espace (largeur, fond sur ordinateur) ; le reste — position, défilement propre,
 * hauteur `dvh`, marges de sécurité (encoche, barre d'accueil, paysage) — est commun.
 */
export function Tiroir({ id, ouvert, className = "", children }: { id: string; ouvert: boolean; className?: string; children: React.ReactNode }) {
  return (
    <aside
      id={id}
      aria-label="Menu"
      className={`fixed inset-y-0 left-0 z-50 flex max-w-[85%] flex-col overflow-y-auto overscroll-contain border-r bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-2xl transition-transform duration-200 ease-out max-lg:h-dvh lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:shadow-none ${
        ouvert ? "translate-x-0" : "-translate-x-full"
      } ${className}`}
    >
      {children}
    </aside>
  );
}
