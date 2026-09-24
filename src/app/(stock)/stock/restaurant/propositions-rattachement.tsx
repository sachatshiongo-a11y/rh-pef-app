"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useBulkSelection, BulkBar } from "@/components/bulk-bar";
import { BoutonNeutre, BoutonValider } from "@/components/action-buttons";
import { estErreur } from "@/lib/action-lisible";
import type { Proposition } from "@/lib/fiches/rattachement-resto";
import { accepterPropositions } from "./actions";

/**
 * Propositions de rattachement (noms identiques) : rien n'est rattaché tant que la Direction n'a pas
 * coché la ligne et cliqué « Rattacher » — actions groupées, comme partout dans l'application.
 */
export function PropositionsRattachement({ propositions }: { propositions: Proposition[] }) {
  const [isPending, start] = useTransition();
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();

  if (propositions.length === 0) return null;

  const accepter = () => {
    setMessage(null);
    start(async () => {
      const r = await accepterPropositions(ids);
      if (estErreur(r)) { setMessage({ texte: r.erreur, erreur: true }); return; }
      setMessage({ texte: `${r.n} article(s) rattaché(s)${r.ignores > 0 ? ` · ${r.ignores} ignoré(s) (déjà rattaché ou renommé entre-temps)` : ""}.`, erreur: false });
      clear();
    });
  };

  return (
    <section className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
      <h2 className="text-sm font-semibold text-sky-900">Propositions de rattachement au catalogue ({propositions.length})</h2>
      <p className="text-xs text-sky-900">
        Même désignation que l&apos;article du catalogue (sans tenir compte des majuscules ni des espaces). Rien n&apos;est rattaché sans votre validation.
      </p>
      {message && <p className={`text-xs ${message.erreur ? "text-destructive" : "text-emerald-800"}`}>{message.texte}</p>}
      <BulkBar count={sel.size} total={propositions.length} onAll={(on) => setAll(propositions.map((p) => p.articleRestoId), on)}>
        {/* Un rattachement est une DÉCISION : bouton de la famille unique (action-buttons). */}
        <BoutonValider disabled={isPending} onClick={accepter}>Rattacher ({sel.size})</BoutonValider>
        <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
      </BulkBar>
      <ul className="divide-y rounded-md border bg-card text-sm">
        {propositions.map((p) => (
          <li key={p.articleRestoId} className={`flex min-w-0 items-center gap-2 px-3 py-1.5 ${sel.has(p.articleRestoId) ? "bg-primary/10" : ""}`}>
            <input type="checkbox" checked={sel.has(p.articleRestoId)} onChange={() => toggle(p.articleRestoId)} aria-label={`Rattacher ${p.designationResto}`} className="shrink-0" />
            <span className="min-w-0 truncate">{p.designationResto}</span>
            <span className="shrink-0 text-muted-foreground" aria-hidden>→</span>
            <Link href={`/stock/catalogue/${p.articleStockId}`} className="min-w-0 truncate text-primary hover:underline">{p.designationCatalogue}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
