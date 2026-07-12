"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { qte } from "@/lib/stock";
import { saisirCommandeResto } from "./actions";

export type CmdArticle = { id: string; designation: string; categorie: string };
export type CmdJour = { iso: string; label: string };

const inp = "w-14 rounded border border-input bg-background px-1 py-1 text-center text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Saisie des commandes de livraison au restaurant : quantité par article et par jour, groupée par
 * catégorie (comme la fiche commande). Enregistrement au blur ; colonne article et en-tête figés.
 */
export function CommandeGrid({ articles, jours, commandes, peutModifier }: {
  articles: CmdArticle[];
  jours: CmdJour[];
  commandes: Record<string, number>;
  peutModifier: boolean;
}) {
  const [isPending, start] = useTransition();
  const [vals, setVals] = useState<Record<string, number>>(commandes);

  const key = (articleId: string, iso: string) => `${articleId}_${iso}`;
  const write = (articleId: string, iso: string, raw: string) => {
    const n = Math.max(0, Number(raw.replace(",", ".")) || 0);
    setVals((p) => ({ ...p, [key(articleId, iso)]: n }));
    start(() => saisirCommandeResto(articleId, iso, n));
  };
  const totalArticle = (id: string) => jours.reduce((t, j) => t + (vals[key(id, j.iso)] ?? 0), 0);
  const totauxJour = useMemo(() => jours.map((j) => articles.reduce((t, a) => t + (vals[key(a.id, j.iso)] ?? 0), 0)), [jours, articles, vals]);

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border">
      <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-muted text-left shadow-sm">
          <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
            <th className="sticky left-0 z-30 bg-muted">Article</th>
            {jours.map((j) => <th key={j.iso} className="!text-right">{j.label}</th>)}
            <th className="!text-right">Total</th>
          </tr>
        </thead>
        <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
          {articles.map((a, i) => {
            const nouvelleCat = i === 0 || articles[i - 1].categorie !== a.categorie;
            const tot = totalArticle(a.id);
            return (
              <Fragment key={a.id}>
                {nouvelleCat && (
                  <tr>
                    <td colSpan={jours.length + 2} className="sticky left-0 !bg-amber-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">{a.categorie}</td>
                  </tr>
                )}
                <tr className="even:bg-muted/25 hover:bg-accent/40">
                  <td className="sticky left-0 z-10 bg-background font-medium">{a.designation}</td>
                  {jours.map((j) => (
                    <td key={j.iso} className="text-right">
                      <input
                        type="number" min={0} step="1" inputMode="numeric"
                        defaultValue={vals[key(a.id, j.iso)] || ""}
                        disabled={!peutModifier}
                        onBlur={(e) => { if ((Number(e.target.value) || 0) !== (vals[key(a.id, j.iso)] ?? 0)) write(a.id, j.iso, e.target.value); }}
                        placeholder="—"
                        className={`${inp} disabled:opacity-60`}
                      />
                    </td>
                  ))}
                  <td className="text-right font-semibold">{tot > 0 ? qte(tot) : ""}</td>
                </tr>
              </Fragment>
            );
          })}
          {articles.length === 0 && <tr><td colSpan={jours.length + 2} className="px-3 py-6 text-center text-muted-foreground">Aucun article pour ce filtre.</td></tr>}
        </tbody>
        {articles.length > 0 && (
          <tfoot className="sticky bottom-0">
            <tr className="bg-muted/60 font-semibold [&>td]:px-3 [&>td]:py-2">
              <td className="sticky left-0 z-10 bg-muted/60">Total jour</td>
              {totauxJour.map((t, i) => <td key={i} className="text-right">{t > 0 ? qte(t) : ""}</td>)}
              <td className="text-right">{qte(totauxJour.reduce((x, y) => x + y, 0))}</td>
            </tr>
          </tfoot>
        )}
      </table>
      {isPending && <p className="p-2 text-xs text-muted-foreground">Enregistrement…</p>}
    </div>
  );
}
