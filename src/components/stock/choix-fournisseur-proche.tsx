"use client";

// FOURNISSEUR PROCHE — le choix « Utiliser … » / « Créer » quand un nom de fournisseur lu (facture saisie,
// PDF, classeur importé) ne correspond à aucun fournisseur de MÊME NOM mais en ressemble (audit du
// 10/10/2026, constat 7). Même aspect (encadré ambre) et même vocabulaire que `choix-article-proche.tsx`.
// Rien n'est rattaché sans un clic : un rattachement approximatif placerait la facture — et sa dette —
// chez le mauvais fournisseur. Le serveur revérifie toujours : cet écran informe, il ne décide pas.

export type FournisseurProche = { id: string; nom: string };

export function ChoixFournisseurProche({ nom, candidats, onUtiliser, onCreer, desactive = false }: {
  /** Le nom lu (saisi, ou dans le fichier). */
  nom: string;
  candidats: readonly FournisseurProche[];
  onUtiliser: (c: FournisseurProche) => void;
  onCreer: () => void;
  desactive?: boolean;
}) {
  const btn = "rounded-md border border-amber-400 bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50";
  return (
    <div role="group" aria-label={`Fournisseur proche — ${nom}`} data-fournisseur-proche className="space-y-1 rounded-md border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
      <p className="font-medium">
        Aucun fournisseur ne s&apos;appelle exactement « {nom.trim()} » ; {candidats.length > 1 ? "ceux-ci lui ressemblent" : "celui-ci lui ressemble"} : choisissez avant de continuer.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {candidats.map((c) => (
          <button key={c.id} type="button" data-utiliser={c.id} disabled={desactive} onClick={() => onUtiliser(c)} className={btn}>Utiliser « {c.nom} »</button>
        ))}
        <button type="button" data-creer disabled={desactive} onClick={onCreer} className="rounded-md border border-dashed border-amber-500 px-2 py-0.5 text-xs font-medium hover:bg-amber-100 disabled:opacity-50">Créer « {nom.trim()} »</button>
      </div>
    </div>
  );
}
