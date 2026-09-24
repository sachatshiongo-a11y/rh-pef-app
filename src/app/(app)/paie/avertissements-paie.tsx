// Badge « référence » et avertissements d'une ligne de paie — présentation seule, sans état
// (utilisable côté serveur comme côté client).
import type { AvertissementPaie, SourceReference } from "@/lib/paie-reference";
import { LIBELLE_SOURCE_REFERENCE } from "@/lib/paie-reference-libelles";

// Même pastille que les badges de statut de l'écran Paie (COULEUR_STATUT « Pas validé »).
const PASTILLE = "ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800";

/** Rien quand tout va bien ; le libellé du repli si le mois est retombé sur le contrat ;
 *  « ⚠ n » s'il reste d'autres avertissements. Le détail est dans l'infobulle (title) — sur
 *  mobile, où il n'y a pas de survol, la liste complète est affichée par `ListeAvertissements`. */
export function BadgeReference({ sourceReference, motifReference, avertissements }: {
  sourceReference: SourceReference;
  motifReference: string | null;
  avertissements: AvertissementPaie[];
}) {
  // Le repli a déjà son badge : son avertissement n'est pas recompté dans « ⚠ n ».
  const autres = avertissements.filter((a) => a.code !== "REPLI_CONTRAT");
  return (
    <>
      {sourceReference === "CONTRAT_REPLI" && (
        <span title={motifReference ?? undefined} className={PASTILLE}>
          {LIBELLE_SOURCE_REFERENCE.CONTRAT_REPLI}
        </span>
      )}
      {autres.length > 0 && (
        <span title={autres.map((a) => a.message).join("\n")} className={PASTILLE}>
          ⚠ {autres.length}
        </span>
      )}
    </>
  );
}

/** Liste complète des avertissements d'une ligne (repli compris), en clair. Rien s'il n'y en a pas.
 *  `break-words` : une longue liste de dates passe à la ligne au lieu d'élargir la page. */
export function ListeAvertissements({ avertissements, className = "" }: { avertissements: AvertissementPaie[]; className?: string }) {
  if (avertissements.length === 0) return null;
  return (
    <ul className={`space-y-1 break-words rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 ${className}`}>
      {avertissements.map((a, i) => <li key={i}>{a.message}</li>)}
    </ul>
  );
}
