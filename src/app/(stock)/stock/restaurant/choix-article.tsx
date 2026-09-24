"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { normTexte } from "@/lib/texte";

export type OptionCatalogue = { id: string; designation: string; unite: string };

const inp = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";

/**
 * « Article du catalogue » d'une ligne du restaurant : liste déroulante AVEC RECHERCHE (20 résultats
 * au plus, pour ne pas charger 300 options par ligne). Le nom rattaché mène à la fiche catalogue.
 */
export function ChoixArticleCatalogue({
  articleStockId, designation, catalogue, onChoisir,
}: {
  articleStockId: string | null;
  designation: string | null;
  catalogue: OptionCatalogue[];
  onChoisir: (articleStockId: string | null) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState("");
  const resultats = useMemo(() => {
    const n = normTexte(q.trim());
    return (n ? catalogue.filter((a) => normTexte(a.designation).includes(n)) : catalogue).slice(0, 20);
  }, [q, catalogue]);
  const fermer = () => { setOuvert(false); setQ(""); };

  if (!ouvert) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
        {articleStockId ? (
          <Link href={`/stock/catalogue/${articleStockId}`} className="min-w-0 truncate text-primary hover:underline">{designation}</Link>
        ) : (
          <span className="text-muted-foreground">Non rattaché</span>
        )}
        <button type="button" onClick={() => setOuvert(true)} className="rounded border px-1.5 py-0.5 hover:bg-accent">
          {articleStockId ? "Changer" : "Rattacher"}
        </button>
        {articleStockId && (
          <button
            type="button"
            onClick={() => { if (confirm(`Détacher « ${designation} » ? Son comptage ne comptera plus dans la disponibilité des plats.`)) onChoisir(null); }}
            className="rounded border px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
          >
            Détacher
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-48 space-y-1">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un article…" className={inp} aria-label="Rechercher un article du catalogue" />
      <ul className="max-h-48 overflow-auto rounded border bg-card text-xs">
        {resultats.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => { onChoisir(a.id); fermer(); }} className="w-full px-2 py-1 text-left hover:bg-accent">
              {a.designation} <span className="text-muted-foreground">({a.unite || "unité ?"})</span>
            </button>
          </li>
        ))}
        {resultats.length === 0 && <li className="px-2 py-1 text-muted-foreground">Aucun article.</li>}
      </ul>
      <button type="button" onClick={fermer} className="text-xs underline">Annuler</button>
    </div>
  );
}
