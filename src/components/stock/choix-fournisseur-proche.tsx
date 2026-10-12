"use client";

// ANTI-DOUBLON DE FOURNISSEUR — le choix « Utiliser … » / « Créer quand même », même aspect (encadré ambre) et
// même vocabulaire que `ChoixArticleProche`. Le serveur revérifie toujours : cet écran informe, il ne décide pas.
import Link from "next/link";

export type CandidatFournisseurProche = { id: string; nom: string };

export function ChoixFournisseurProche({ nom, candidats, creationPossible, onUtiliser, hrefUtiliser, onCreer, desactive = false, libelleCreer = "Créer quand même un nouveau fournisseur" }: {
  /** Le nom tapé. */
  nom: string;
  candidats: readonly CandidatFournisseurProche[];
  /** Faux quand le nom EXACT existe déjà : un second fournisseur serait un doublon certain. */
  creationPossible: boolean;
  /** « Utiliser » : une action (remplacer le nom saisi), ou un lien (ouvrir la fiche du fournisseur existant). */
  onUtiliser?: (c: CandidatFournisseurProche) => void;
  hrefUtiliser?: (c: CandidatFournisseurProche) => string;
  onCreer?: () => void;
  desactive?: boolean;
  libelleCreer?: string;
}) {
  const btn = "rounded-md border border-amber-400 bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent";
  return (
    <div role="group" aria-label={`Fournisseur proche — ${nom}`} data-choix-fournisseur className="space-y-1 rounded-md border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
      <p className="font-medium">
        {creationPossible
          ? `${candidats.length > 1 ? "Ces fournisseurs ressemblent" : "Ce fournisseur ressemble"} à « ${nom.trim()} » : choisissez avant de créer.`
          : `« ${nom.trim()} » existe déjà dans les fournisseurs : utilisez le fournisseur existant.`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {candidats.map((c) => hrefUtiliser
          ? <Link key={c.id} href={hrefUtiliser(c)} data-utiliser={c.id} className={btn}>Utiliser « {c.nom} »</Link>
          : <button key={c.id} type="button" data-utiliser={c.id} disabled={desactive} onClick={() => onUtiliser?.(c)} className={btn}>Utiliser « {c.nom} »</button>)}
        {creationPossible && onCreer && (
          <button type="button" data-creer disabled={desactive} onClick={onCreer} className="rounded-md border border-dashed border-amber-500 px-2 py-0.5 text-xs font-medium hover:bg-amber-100 disabled:opacity-50">{libelleCreer}</button>
        )}
      </div>
    </div>
  );
}
