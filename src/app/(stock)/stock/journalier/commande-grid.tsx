"use client";

import { Fragment, memo, useCallback, useMemo, useState, useTransition } from "react";
import { qte } from "@/lib/stock";
import { saisirCommandeResto, saisirCommandeLegume } from "./actions";
import { normTexte } from "@/lib/texte";

export type CmdArticle = { id: string; designation: string; categorie: string };
export type CmdJour = { iso: string; label: string };

const inp = "w-14 rounded border border-input bg-background px-1 py-1 text-center text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

/**
 * Saisie des commandes de livraison au restaurant : quantité par article et par jour, groupée par
 * catégorie. Lignes mémoïsées (éditer une cellule ne re-rend que sa ligne) + recherche d'article.
 */
export function CommandeGrid({ articles, jours, commandes, peutModifier }: {
  articles: CmdArticle[];
  jours: CmdJour[];
  commandes: Record<string, number>;
  peutModifier: boolean;
}) {
  const [isPending, start] = useTransition();
  const [q, setQ] = useState("");
  const [totaux, setTotaux] = useState<Record<string, number>>(commandes); // uniquement pour le pied de page

  // Enregistrement (mémoïsé pour ne pas invalider les lignes) : aiguille légume vs article.
  const onWrite = useCallback((articleId: string, iso: string, n: number) => {
    setTotaux((p) => ({ ...p, [`${articleId}_${iso}`]: n }));
    start(() => (articleId.startsWith("legume:") ? saisirCommandeLegume(articleId.slice(7), iso, n) : saisirCommandeResto(articleId, iso, n)));
  }, []);

  const visibles = useMemo(() => {
    const nq = normTexte(q.trim());
    return nq ? articles.filter((a) => normTexte(a.designation).includes(nq) || normTexte(a.categorie).includes(nq)) : articles;
  }, [articles, q]);

  const totauxJour = useMemo(() => jours.map((j) => visibles.reduce((t, a) => t + (totaux[`${a.id}_${j.iso}`] ?? 0), 0)), [jours, visibles, totaux]);

  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un article…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
      <p className="text-xs text-muted-foreground">{visibles.length} / {articles.length} article(s)</p>
      <div className="max-h-[70vh] overflow-auto rounded-lg border [scrollbar-gutter:stable]">
        <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
              <th className="sticky left-0 z-30 bg-muted">Article</th>
              {jours.map((j) => <th key={j.iso} className="!text-right">{j.label}</th>)}
              <th className="!text-right">Total</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
            {visibles.map((a, i) => (
              <Fragment key={a.id}>
                {(i === 0 || visibles[i - 1].categorie !== a.categorie) && (
                  <tr><td colSpan={jours.length + 2} className="sticky left-0 !bg-amber-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">{a.categorie}</td></tr>
                )}
                <LigneCommande a={a} jours={jours} commandes={commandes} peutModifier={peutModifier} onWrite={onWrite} />
              </Fragment>
            ))}
            {visibles.length === 0 && <tr><td colSpan={jours.length + 2} className="px-3 py-6 text-center text-muted-foreground">Aucun article pour cette recherche.</td></tr>}
          </tbody>
          {visibles.length > 0 && (
            <tfoot className="sticky bottom-0">
              <tr className="bg-muted/60 font-semibold [&>td]:px-3 [&>td]:py-2">
                <td className="sticky left-0 z-10 bg-muted/60">Total jour</td>
                {totauxJour.map((t, i) => <td key={i} className="text-right">{t > 0 ? qte(t) : ""}</td>)}
                <td className="text-right">{qte(totauxJour.reduce((x, y) => x + y, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {isPending && <p className="text-xs text-muted-foreground">Enregistrement…</p>}
    </div>
  );
}

// Ligne mémoïsée : état local des 7 valeurs → seule cette ligne se re-rend à la saisie.
const LigneCommande = memo(function LigneCommande({ a, jours, commandes, peutModifier, onWrite }: {
  a: CmdArticle; jours: CmdJour[]; commandes: Record<string, number>; peutModifier: boolean;
  onWrite: (articleId: string, iso: string, n: number) => void;
}) {
  const [rowVals, setRowVals] = useState<number[]>(() => jours.map((j) => commandes[`${a.id}_${j.iso}`] ?? 0));
  const total = rowVals.reduce((x, y) => x + y, 0);
  const write = (i: number, iso: string, raw: string) => {
    const n = Math.max(0, Number(raw.replace(",", ".")) || 0);
    if (n === rowVals[i]) return;
    setRowVals((p) => { const c = [...p]; c[i] = n; return c; });
    onWrite(a.id, iso, n);
  };
  return (
    <tr className="even:bg-muted/25 hover:bg-accent/40">
      <td className="sticky left-0 z-10 bg-background font-medium">{a.designation}</td>
      {jours.map((j, i) => (
        <td key={j.iso} className="text-right">
          <input type="number" min={0} step="1" inputMode="numeric" defaultValue={rowVals[i] || ""} disabled={!peutModifier}
            onBlur={(e) => write(i, j.iso, e.target.value)} placeholder="—" className={inp} />
        </td>
      ))}
      <td className="text-right font-semibold">{total > 0 ? qte(total) : ""}</td>
    </tr>
  );
});
