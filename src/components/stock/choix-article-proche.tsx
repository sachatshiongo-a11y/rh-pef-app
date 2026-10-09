"use client";

// ANTI-DOUBLON D'ARTICLE — le choix « Utiliser … » / « Créer quand même un nouvel article », hors Liste
// d'achat (qui a le sien, `entree/alertes-ligne.tsx`, lié à ses lignes) : « Ajouter un article » de
// l'Inventaire et l'import d'inventaire (2026-10-09). Même règle (lib/article-proche.ts), même aspect
// (encadré ambre), même vocabulaire. Le serveur revérifie toujours : cet écran informe, il ne décide pas.
import Link from "next/link";

export type CandidatProche = { id: string; designation: string; unite?: string | null; actif?: boolean };

export function ChoixArticleProche({ nom, candidats, creationPossible, onUtiliser, hrefUtiliser, onCreer, libelleCreer = "Créer quand même un nouvel article", desactive = false }: {
  /** Le nom tapé (ou lu dans le fichier). */
  nom: string;
  candidats: readonly CandidatProche[];
  /** Faux quand le nom EXACT existe déjà : un second article serait un doublon certain. */
  creationPossible: boolean;
  /** « Utiliser » : soit une action (remplacer), soit un lien (ouvrir la fiche de l'article existant). */
  onUtiliser?: (c: CandidatProche) => void;
  hrefUtiliser?: (c: CandidatProche) => string;
  onCreer?: () => void;
  libelleCreer?: string;
  desactive?: boolean;
}) {
  const btn = "rounded-md border border-amber-400 bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent";
  const libelle = (c: CandidatProche) => `Utiliser « ${c.designation} »${c.unite ? ` (${c.unite})` : ""}${c.actif === false ? " (inactif)" : ""}`;
  return (
    <div role="group" aria-label={`Article proche — ${nom}`} data-choix-article className="space-y-1 rounded-md border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
      <p className="font-medium">
        {creationPossible
          ? `${candidats.length > 1 ? "Ces articles ressemblent" : "Cet article ressemble"} à « ${nom.trim()} » : choisissez avant de créer.`
          : `« ${nom.trim()} » existe déjà au catalogue : utilisez l'article existant${candidats.some((c) => c.actif === false) ? " (réactivez-le s'il est inactif)" : ""}.`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {candidats.map((c) => hrefUtiliser
          ? <Link key={c.id} href={hrefUtiliser(c)} data-utiliser={c.id} className={btn}>{libelle(c)}</Link>
          : <button key={c.id} type="button" data-utiliser={c.id} disabled={desactive} onClick={() => onUtiliser?.(c)} className={btn}>{libelle(c)}</button>)}
        {creationPossible && onCreer && (
          <button type="button" data-creer disabled={desactive} onClick={onCreer} className="rounded-md border border-dashed border-amber-500 px-2 py-0.5 text-xs font-medium hover:bg-amber-100 disabled:opacity-50">{libelleCreer}</button>
        )}
      </div>
    </div>
  );
}
