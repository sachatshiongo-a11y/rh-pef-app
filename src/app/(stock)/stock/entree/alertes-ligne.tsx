"use client";

// Liste d'achat — ce qu'une ligne a à signaler (anti-doublon d'article et DLC, Direction 2026-10-08),
// UN SEUL composant pour les deux vues : sous la rangée du tableur (ordinateur) et dans la carte du
// récapitulatif (téléphone, cibles de 44 px). Les choix faits ici partent avec la ligne
// (`creerNouveau`, ou la ligne devenue article du catalogue) ; le serveur revérifie.
import type { ArticleCandidat } from "@/lib/achats-doublons";
import type { EtatLigne, Ligne } from "@/lib/liste-achat-saisie";

type Props = {
  ligne: Ligne;
  etat: EtatLigne;
  /** « à la ligne 3 », « sur une autre carte » : où sont les autres lignes du même article. */
  autres: (indices: number[]) => string;
  onUtiliser: (c: ArticleCandidat) => void;
  onCreer: (oui: boolean) => void;
  /** Téléphone : boutons et case de 44 px. */
  tactile?: boolean;
  /** Pour nommer le groupe de choix (« ligne 2 », « Farine »). */
  nom: string;
};

/** Rien à signaler pour cette ligne ? (le tableur n'ajoute alors rien sous la rangée). */
export function aSignaler(l: Ligne, e: EtatLigne): boolean {
  const d = e.analyse?.article;
  return e.memesLignes.length > 0 || !!e.erreurDlc || (!l.articleId && (d?.type === "choix" || d?.type === "auto"));
}

export function AlertesLigne({ ligne, etat, autres, onUtiliser, onCreer, tactile = false, nom }: Props) {
  if (!aSignaler(ligne, etat)) return null;
  const d = etat.analyse?.article;
  const btn = tactile ? "min-h-11 px-3 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <div data-alertes-ligne className={`space-y-1.5 ${tactile ? "text-sm" : "text-xs"}`}>
      {!ligne.articleId && d?.type === "auto" && (
        <p data-rattache className="text-muted-foreground">→ Rattachée à l&apos;article existant <b className="text-foreground">« {d.article.designation} »</b>{d.article.actif ? "" : " (inactif)"} (même nom) : aucun nouvel article ne sera créé.</p>
      )}

      {!ligne.articleId && d?.type === "choix" && (ligne.creerNouveau && d.creationPossible ? (
        <p data-creer-nouveau className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
          Un <b>nouvel article</b> « {ligne.designation.trim()} » sera créé, bien qu&apos;il ressemble à {d.candidats.map((c) => `« ${c.designation} »`).join(", ")}.{" "}
          <button type="button" onClick={() => onCreer(false)} className={`font-semibold underline ${tactile ? "min-h-11" : ""}`}>Revenir au choix</button>
        </p>
      ) : (
        <div role="group" aria-label={`Article proche au catalogue — ${nom}`} data-choix-article className="space-y-1 rounded-md border border-amber-400 bg-amber-50 px-2 py-1.5 text-amber-900">
          <p className="font-medium">
            {d.creationPossible
              ? `${d.candidats.length > 1 ? "Ces articles ressemblent" : "Cet article ressemble"} à « ${ligne.designation.trim()} » : choisissez avant d'enregistrer.`
              : "Ce nom existe déjà plusieurs fois au catalogue : choisissez l'article avant d'enregistrer."}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {d.candidats.map((c) => (
              <button key={c.id} type="button" data-utiliser={c.id} onClick={() => onUtiliser(c)} className={`rounded-md border border-amber-400 bg-background font-medium text-foreground hover:bg-accent ${btn}`}>
                Utiliser « {c.designation} »{c.unite ? ` (${c.unite})` : ""}{c.actif ? "" : " — inactif"}
              </button>
            ))}
            {d.creationPossible && (
              <button type="button" data-creer onClick={() => onCreer(true)} className={`rounded-md border border-dashed border-amber-500 font-medium hover:bg-amber-100 ${btn}`}>
                Créer quand même un nouvel article
              </button>
            )}
          </div>
        </div>
      ))}

      {etat.memesLignes.length > 0 && (
        <p data-meme-liste className="text-amber-800">Cet article figure aussi {autres(etat.memesLignes)} de cette liste : vérifiez que ce n&apos;est pas le même achat saisi deux fois.</p>
      )}

      {etat.erreurDlc && <p data-erreur-dlc role="alert" className="text-destructive">{etat.erreurDlc}</p>}
    </div>
  );
}
