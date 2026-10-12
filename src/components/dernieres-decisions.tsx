/** Une demande déjà traitée, mise en phrases par l'écran qui l'affiche. */
export type DecisionVue = {
  id: string;
  /** Ce qui était demandé (une ligne). */
  resume: string;
  /** Qui, quand, par qui décidé (une ligne, en petit). */
  detail: string;
  statut: string;
  /** Motif du refus : toujours montré à l'auteur, c'est ce qui lui dit pourquoi. */
  motifRefus: string | null;
};

const STATUT_DECISION: Record<string, { texte: string; cls: string }> = {
  VALIDEE: { texte: "Approuvée", cls: "bg-emerald-100 text-emerald-800" },
  REFUSEE: { texte: "Refusée", cls: "bg-red-100 text-red-800" },
  ANNULEE: { texte: "Retirée", cls: "bg-muted text-muted-foreground" },
};

/**
 * Les dernières demandes traitées — un seul dessin pour « À valider » RH, Stock et Exploitation
 * (plan d'ergonomie, V1). La Direction y relit ses décisions ; les autres rôles y lisent la réponse à
 * LEURS demandes (statut, motif du refus). Aucun bouton : c'est de la lecture.
 */
export function DernieresDecisions({ titre, decisions }: { titre: string; decisions: DecisionVue[] }) {
  if (decisions.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{titre}</h2>
      <ul className="divide-y rounded-lg border text-sm">
        {decisions.map((d) => (
          <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{d.resume}</p>
              <p className="text-xs text-muted-foreground">{d.detail}</p>
              {d.motifRefus && <p className="text-xs text-red-800">Motif : {d.motifRefus}</p>}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_DECISION[d.statut]?.cls ?? ""}`}>{STATUT_DECISION[d.statut]?.texte ?? d.statut}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
