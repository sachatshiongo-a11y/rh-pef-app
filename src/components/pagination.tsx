"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  appliquerPagination, compteurPage, fenetrePage, hrefPagination, numerosPages, pageApresChangementTaille,
  PAR_DEFAUT, PARAM_PAR, PLUS_PETITE_PAGE, TAILLES_PAGE, type FenetrePage, type ParPage,
} from "@/lib/pagination";

// BARRE DE PAGINATION UNIQUE (décision de la Direction, 2026-10-08) — « 51–100 sur 342 », Précédent /
// numéros / Suivant, et 50 · 100 · Tout par page. Deux façons de la brancher :
//  - page SERVEUR : on passe `chemin` + `params` (les paramètres d'URL courants, sérialisables) et les
//    boutons sont de vrais liens (`?page=`, `?par=`) — ça marche sans JavaScript ;
//  - tableau déjà chargé en entier (filtres en état client) : on passe `onChange`, avec `usePagination`
//    qui tient la page/taille en état et les écrit dans l'URL sans recharger la page.
// Cibles tactiles de 44 px (`min-h-11`), aucun `backdrop-filter`.

const BASE = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm";
const ACTIF = "border-primary bg-primary font-medium text-primary-foreground";
const INACTIF = "hover:bg-accent";

type Cible = { page: number; par: ParPage };

export function Pagination({ total, page, par, chemin, params, onChange, libelle = "ligne(s)", className = "" }: {
  total: number;
  page: number;
  par: ParPage;
  /** Mode lien (page serveur) : chemin de la page et paramètres d'URL courants. */
  chemin?: string;
  params?: Record<string, string | string[] | undefined>;
  /** Mode état (tableau déjà chargé) : appelé avec la page et la taille choisies. */
  onChange?: (page: number, par: ParPage) => void;
  /** Ce que l'on compte, au pluriel : « 51–100 sur 342 articles ». */
  libelle?: string;
  className?: string;
}) {
  const f = fenetrePage(total, page, par);
  // Rien à paginer : moins d'une page, et la taille n'a pas été relevée à la main.
  if (f.total <= PLUS_PETITE_PAGE && par === PAR_DEFAUT) return null;

  const cible = (c: Cible, enfants: ReactNode, opts: { actif?: boolean; inactif?: boolean; label?: string; classe?: string } = {}) => {
    const classe = `${BASE} ${opts.actif ? ACTIF : INACTIF} ${opts.classe ?? ""}`;
    if (opts.inactif) return <span aria-disabled="true" aria-label={opts.label} className={`${BASE} pointer-events-none opacity-40 ${opts.classe ?? ""}`}>{enfants}</span>;
    if (onChange) {
      return <button type="button" onClick={() => { onChange(c.page, c.par); if (typeof window.scrollTo === "function") window.scrollTo({ top: 0 }); }} aria-label={opts.label} aria-current={opts.actif ? "page" : undefined} className={classe}>{enfants}</button>;
    }
    return <Link href={hrefPagination(chemin ?? "", params ?? {}, c.page, c.par)} aria-label={opts.label} aria-current={opts.actif ? "page" : undefined} className={classe}>{enfants}</Link>;
  };

  return (
    <nav aria-label="Pagination" data-pagination="" className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ${className}`}>
      <p data-pagination-compteur="" className="text-muted-foreground max-sm:basis-full" aria-live="polite">
        <span className="font-medium tabular-nums text-foreground">{compteurPage(f)}</span> {libelle}
      </p>

      {f.nbPages > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {cible({ page: f.page - 1, par }, "‹ Précédent", { inactif: f.page <= 1, label: "Page précédente" })}
          <span className="px-1 tabular-nums text-muted-foreground sm:hidden">Page {f.page} / {f.nbPages}</span>
          <span className="flex items-center gap-1.5 max-sm:hidden">
            {numerosPages(f.page, f.nbPages).map((n, i) =>
              n === "…" ? <span key={`e${i}`} aria-hidden className="px-1 text-muted-foreground">…</span>
                : <span key={n}>{cible({ page: n, par }, n, { actif: n === f.page, label: `Page ${n}` })}</span>)}
          </span>
          {cible({ page: f.page + 1, par }, "Suivant ›", { inactif: f.page >= f.nbPages, label: "Page suivante" })}
        </div>
      )}

      <div role="group" aria-label="Lignes par page" className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
        <span className="text-muted-foreground">Par page&nbsp;:</span>
        {TAILLES_PAGE.map((t) => (
          <span key={t}>{cible({ page: pageApresChangementTaille(f.debut, t), par: t }, t === "tout" ? "Tout" : t, { actif: par === t, label: t === "tout" ? "Afficher tout" : `${t} par page` })}</span>
        ))}
      </div>
    </nav>
  );
}

/**
 * Page et taille d'un tableau déjà chargé en entier (filtres en état client). Les valeurs de départ
 * viennent de l'URL (lues par la page serveur) ; chaque changement est RÉÉCRIT dans l'adresse
 * (`history.replaceState` : pas de rechargement, pas d'entrée d'historique) en gardant les autres paramètres.
 * `cleFiltre` résume les filtres/recherche : quand elle change, la page repart à 1 (sans effet de bord).
 */
export function usePagination({ total, pageInit, parInit, cleFiltre }: { total: number; pageInit: number; parInit: ParPage; cleFiltre: string }) {
  const [etat, setEtat] = useState({ page: pageInit, par: parInit, cle: cleFiltre });
  const pageVoulue = etat.cle === cleFiltre ? etat.page : 1;
  const f: FenetrePage = fenetrePage(total, pageVoulue, etat.par);

  useEffect(() => {
    const u = new URL(window.location.href);
    const voulu = appliquerPagination(u.searchParams, f.page, etat.par);
    if (voulu.toString() === u.searchParams.toString()) return;
    window.history.replaceState(null, "", `${u.pathname}${voulu.size ? `?${voulu}` : ""}${u.hash}`);
  }, [f.page, etat.par]);

  const aller = useCallback((page: number, par: ParPage) => setEtat({ page, par, cle: cleFiltre }), [cleFiltre]);
  return { ...f, aller };
}

/**
 * Lien d'une page serveur qui change de filtre (la page repart à 1) mais GARDE la taille de page choisie
 * depuis : la taille changée sans rechargement n'est connue que de l'adresse affichée, pas du rendu serveur.
 * Sans JavaScript, c'est un lien ordinaire (taille de l'adresse d'origine).
 */
export function LienGardantTaille({ href, onClick, ...reste }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...reste}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        const par = new URL(window.location.href).searchParams.get(PARAM_PAR);
        const u = new URL(href, window.location.href);
        if (par) u.searchParams.set(PARAM_PAR, par); else u.searchParams.delete(PARAM_PAR);
        e.currentTarget.href = `${u.pathname}${u.search}${u.hash}`;
      }}
    />
  );
}

/**
 * Champ caché `par` d'un formulaire GET de filtres : au moment de l'envoi, il recopie la taille de page
 * AFFICHÉE dans l'adresse (50 : rien n'est envoyé). Un nouveau filtre repart à la page 1 mais garde la taille.
 */
export function ChampTaillePage() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const champ = ref.current;
    const form = champ?.form;
    if (!champ || !form) return;
    const recopier = () => {
      const par = new URL(window.location.href).searchParams.get(PARAM_PAR);
      champ.disabled = !par;
      if (par) champ.value = par;
    };
    form.addEventListener("submit", recopier);
    return () => form.removeEventListener("submit", recopier);
  }, []);
  return <input ref={ref} type="hidden" name={PARAM_PAR} disabled />;
}
