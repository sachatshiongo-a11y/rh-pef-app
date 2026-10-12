"use client";

import Link from "next/link";
import { useState } from "react";
import { ChoixRecherche } from "@/components/choix-recherche";
import type { OptionChoix } from "@/lib/recherche-options";

/**
 * Un article du catalogue proposé au rattachement : `designation` est le nom AFFICHÉ (contenance
 * comprise, `libelleArticle`) ; `recherche` : nom court, contenance sous toutes ses écritures…
 */
export type OptionCatalogue = { id: string; designation: string; unite: string; recherche?: (string | null)[] };

/** Les options du champ de recherche, à calculer UNE fois par écran (liste partagée par toutes les lignes). */
export const optionsCatalogue = (catalogue: readonly OptionCatalogue[]): OptionChoix[] =>
  catalogue.map((a) => ({ id: a.id, libelle: a.designation, recherche: a.recherche, detail: a.unite || "unité ?" }));

/** Un article du catalogue déjà rattaché (nom affiché, contenance comprise). */
export type ArticleRattache = { id: string; designation: string; unite: string | null };

/**
 * « Articles du catalogue » d'une ligne du restaurant : UN OU PLUSIEURS (plusieurs marques de beurre
 * pour un « Beurre »). Chaque article rattaché mène à sa fiche catalogue et se détache d'un clic ;
 * « Ajouter » ouvre le choix d'article au clavier (taper le nom, ↑ ↓, Entrée), le même que partout.
 * Les livraisons de n'importe lequel alimentent le stock de la ligne.
 */
export function ChoixArticleCatalogue({
  rattaches, options, onAjouter, onRetirer, nomLigne,
}: {
  rattaches: ArticleRattache[];
  options: OptionChoix[];
  onAjouter: (articleStockIds: string[]) => void;
  onRetirer: (articleStockIds: string[]) => void;
  nomLigne: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div className="min-w-0 space-y-1 text-xs">
      {rattaches.length === 0 && <p className="text-muted-foreground">Non rattaché</p>}
      {rattaches.length > 0 && (
        <ul className="space-y-0.5">
          {rattaches.map((a) => (
            <li key={a.id} className="flex min-w-0 items-center gap-1" data-article-rattache={a.id}>
              <Link href={`/stock/catalogue/${a.id}`} className="min-w-0 truncate text-primary hover:underline">{a.designation}</Link>
              <span className="shrink-0 text-muted-foreground">({a.unite || "unité ?"})</span>
              <button
                type="button"
                onClick={() => { if (confirm(`Détacher « ${a.designation} » de « ${nomLigne} » ? Ses livraisons n'alimenteront plus le stock du restaurant, et il ne comptera plus dans la disponibilité des plats.`)) onRetirer([a.id]); }}
                className="shrink-0 rounded border px-1 text-destructive hover:bg-destructive/10"
                aria-label={`Détacher ${a.designation} de ${nomLigne}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {ouvert ? (
        <div className="min-w-48 space-y-1">
          <ChoixRecherche
            options={options} value="" placeholder="Taper le nom de l'article" aria-label={`Article du catalogue à rattacher à ${nomLigne}`}
            className="w-full rounded border border-input bg-background px-1.5 py-1 text-xs"
            onChange={(id) => { if (id) { onAjouter([id]); setOuvert(false); } }}
          />
          <button type="button" onClick={() => setOuvert(false)} className="text-xs underline">Annuler</button>
        </div>
      ) : (
        <button type="button" onClick={() => setOuvert(true)} className="rounded border px-1.5 py-0.5 hover:bg-accent">
          {rattaches.length === 0 ? "Rattacher" : "+ Ajouter une marque"}
        </button>
      )}
    </div>
  );
}
