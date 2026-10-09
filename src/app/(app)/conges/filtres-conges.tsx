"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ETATS, hrefConges, type CleEtat, type ParamsConges, type Regroupement } from "@/lib/conges-liste";

const DELAI_RECHERCHE_MS = 250;
const champCls = "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";
const pastille = (actif: boolean) =>
  `inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-sm ${actif ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`;
const rangee = "-mx-3 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0";

export type PastilleEtat = { cle: CleEtat; n: number };
export type PastilleType = { nom: string; n: number };

/**
 * Les filtres de l'écran Congés — TOUT vit dans l'adresse (`?q=&statut=&quand=&type=&mois=&du=&au=&groupe=`),
 * lien partageable, retour arrière, page repartant à 1 (la taille de page est gardée) :
 *  - recherche INSTANTANÉE (nom / matricule) : l'adresse suit la frappe, sans bouton « Filtrer » ;
 *  - pastilles d'ÉTAT (les anciennes cartes-indicateurs : En attente, En congé aujourd'hui, À venir…) et de TYPE,
 *    avec leurs compteurs ; les compteurs viennent du serveur et portent sur TOUT l'ensemble filtré (pas sur la page) ;
 *  - période : un mois, ou une plage de dates ; regroupement : par état (sections) ou par mois.
 */
export function FiltresConges({ params, etats, etatActif, types, actif, regroupement }: {
  /** Les paramètres d'adresse courants (la page serveur les lit ; les liens ci-dessous en sont dérivés). */
  params: ParamsConges;
  etats: PastilleEtat[];
  etatActif: CleEtat;
  types: PastilleType[];
  /** Au moins un filtre est actif (affiche « Réinitialiser »). */
  actif: boolean;
  regroupement: Regroupement;
}) {
  const router = useRouter();
  const [, demarrer] = useTransition();
  const aller = (change: Partial<Record<keyof ParamsConges, string | undefined>>) => demarrer(() => router.replace(hrefConges(params, change), { scroll: false }));

  // ── Recherche instantanée : l'adresse suit la frappe après une courte pause. ───────────────────────
  const [saisie, setSaisie] = useState(params.q ?? "");
  const [qPrecedent, setQPrecedent] = useState(params.q ?? "");
  // « Réinitialiser » vide l'adresse : le champ se vide aussi (mais jamais pendant la frappe : une réponse en retard n'écrase rien).
  if ((params.q ?? "") !== qPrecedent) {
    setQPrecedent(params.q ?? "");
    if ((params.q ?? "") === "" && saisie !== "") setSaisie("");
  }
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (minuteur.current) clearTimeout(minuteur.current); }, []);
  function taper(valeur: string) {
    setSaisie(valeur);
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => { if (valeur.trim() !== (params.q ?? "")) aller({ q: valeur.trim() || undefined }); }, DELAI_RECHERCHE_MS);
  }

  const libelleEtat = Object.fromEntries(ETATS.map((e) => [e.cle, e])) as Record<CleEtat, (typeof ETATS)[number]>;
  const parMois = regroupement === "mois";
  const reinitialiser = hrefConges({ par: params.par });

  // Téléphone : période et regroupement sont repliés derrière un bouton (ouverts d'office s'ils servent) ; dès `sm`, ils sont en ligne.
  const periodeServie = !!(params.mois || params.du || params.au || parMois);
  const [plusChoisi, setPlusChoisi] = useState<{ base: boolean; ouvert: boolean } | null>(null);
  const plusOuvert = plusChoisi && plusChoisi.base === periodeServie ? plusChoisi.ouvert : periodeServie;

  return (
    <div className="space-y-2.5 rounded-xl border bg-card p-3" data-filtres-conges>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <form role="search" className="min-w-[12rem] flex-1 sm:max-w-xs" onSubmit={(e) => { e.preventDefault(); if (minuteur.current) clearTimeout(minuteur.current); aller({ q: saisie.trim() || undefined }); }}>
          <input
            type="search" name="q" value={saisie} onChange={(e) => taper(e.target.value)} placeholder="Rechercher un nom, un matricule…" aria-label="Recherche (nom / matricule)"
            autoComplete="off" className={`${champCls} w-full text-foreground`}
          />
        </form>
        {actif && <Link href={reinitialiser} className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent">Réinitialiser</Link>}
        <button
          type="button" aria-expanded={plusOuvert} onClick={() => setPlusChoisi({ base: periodeServie, ouvert: !plusOuvert })}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent sm:hidden"
        >
          Période et regroupement <span aria-hidden className={`inline-block transition-transform ${plusOuvert ? "rotate-90" : ""}`}>▸</span>
        </button>

        <div className={`${plusOuvert ? "flex" : "hidden"} w-full flex-wrap items-center gap-2 sm:contents`}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="group" aria-label="Période">
            <input
              key={`mois-${params.mois ?? ""}`} type="month" defaultValue={params.mois ?? ""} aria-label="Filtrer par mois"
              onChange={(e) => aller({ mois: e.target.value || undefined, du: undefined, au: undefined })} className={`${champCls} text-foreground`}
            />
            <span>ou du</span>
            <input
              key={`du-${params.du ?? ""}`} type="date" defaultValue={params.du ?? ""} aria-label="Période : du"
              onChange={(e) => aller({ du: e.target.value || undefined, mois: undefined })} className={`${champCls} text-foreground`}
            />
            <span>au</span>
            <input
              key={`au-${params.au ?? ""}`} type="date" defaultValue={params.au ?? ""} aria-label="Période : au"
              onChange={(e) => aller({ au: e.target.value || undefined, mois: undefined })} className={`${champCls} text-foreground`}
            />
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <div className="flex overflow-hidden rounded-md border text-sm" role="group" aria-label="Regroupement">
              <Link href={hrefConges(params, { groupe: undefined })} aria-current={!parMois ? "true" : undefined} className={`px-3 py-1.5 ${!parMois ? "bg-primary font-medium text-primary-foreground" : "hover:bg-accent"}`}>Par état</Link>
              <Link href={hrefConges(params, { groupe: "mois" })} aria-current={parMois ? "true" : undefined} className={`px-3 py-1.5 ${parMois ? "bg-primary font-medium text-primary-foreground" : "hover:bg-accent"}`}>Par mois</Link>
            </div>
          </div>
        </div>
      </div>

      <div className={rangee} role="group" aria-label="Filtrer par état" data-pastilles="etat">
        {etats.map(({ cle, n }) => {
          const e = libelleEtat[cle];
          return (
            <Link key={cle} href={hrefConges(params, { statut: e.change.statut, quand: e.change.quand })} aria-current={etatActif === cle ? "true" : undefined} className={pastille(etatActif === cle)}>
              {e.libelle} <span className="tabular-nums text-muted-foreground">({n})</span>
            </Link>
          );
        })}
      </div>

      {types.length > 0 && (
        <div className={rangee} role="group" aria-label="Filtrer par type" data-pastilles="type">
          <Link href={hrefConges(params, { type: undefined })} aria-current={!params.type ? "true" : undefined} className={pastille(!params.type)}>Tous types</Link>
          {types.map((t) => (
            <Link key={t.nom} href={hrefConges(params, { type: t.nom })} aria-current={params.type === t.nom ? "true" : undefined} className={pastille(params.type === t.nom)}>
              {t.nom} <span className="tabular-nums text-muted-foreground">({t.n})</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
