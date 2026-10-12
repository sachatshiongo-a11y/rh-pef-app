"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { approuverModifsFiche, refuserModifsFiche } from "./fiche-actions";
import type { RapportFiche } from "@/lib/demandes-fiche";
import { Avatar } from "@/components/avatar";
import { BoutonApprouver, BoutonRefuser } from "@/components/action-buttons";
import { DialogueRefus } from "@/components/dialogue-refus";

export type FicheRow = {
  id: string;
  /** null pour une création : la fiche n'existe pas encore. */
  employeeId: string | null;
  creation?: boolean;
  /** Création qui prend la suite d'une fiche archivée (réembauche). */
  reembauche?: boolean;
  nom: string;
  photoUrl?: string | null;
  lignes: string[]; // « Salaire mensuel : 300,00 $ → 350,00 $ »
  auteurNom: string;
  demandeLe: string;
  motif: string | null;
};

/** Section « Modifications de fiches » : cases + barre d'actions groupées, mêmes boutons de décision que Congés / Acomptes. */
export function FichesInbox({ rows, peutValider }: { rows: FicheRow[]; peutValider: boolean }) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [avis, setAvis] = useState<string | null>(null);
  const [refus, setRefus] = useState<{ ids: string[]; erreur: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function compteRendu(r: RapportFiche, verbe: string) {
    const parts = [`${r.traitees} modification(s) ${verbe}`];
    if (r.echecs.length > 0) parts.push(`${r.echecs.length} non traitée(s) — ${r.echecs.join(" · ")}`);
    parts.push(...r.avertissements);
    setAvis(r.echecs.length > 0 || r.avertissements.length > 0 ? parts.join(" · ") : null);
  }
  function approuver(ids: string[]) {
    if (ids.length === 0) return;
    setAvis(null);
    startTransition(async () => {
      const r = await approuverModifsFiche(ids);
      setSelection(new Set());
      compteRendu(r, "appliquée(s)");
    });
  }
  function confirmerRefus(motif: string) {
    if (!refus) return;
    const { ids } = refus;
    startTransition(async () => {
      const r = await refuserModifsFiche(ids, motif);
      if (r.traitees === 0 && r.echecs.length > 0) { setRefus({ ids, erreur: r.echecs.join(" · ") }); return; }
      setRefus(null);
      setSelection(new Set());
      compteRendu(r, "refusée(s)");
    });
  }

  if (rows.length === 0) {
    return <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Aucune modification ni création de fiche en attente.</div>;
  }

  return (
    <div>
      {avis && <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{avis}</p>}
      {peutValider && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={rows.every((r) => selection.has(r.id))} onChange={(e) => setSelection(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
            Tout sélectionner
          </label>
          {selection.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{selection.size} sélectionnée(s) :</span>
              <BoutonApprouver onClick={() => approuver([...selection])} disabled={isPending} />
              <BoutonRefuser onClick={() => setRefus({ ids: [...selection], erreur: null })} disabled={isPending} />
              {isPending && <span className="text-xs text-muted-foreground">Traitement…</span>}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {rows.map((d) => (
          <div key={d.id} className={`rounded-xl border bg-card ${selection.has(d.id) ? "ring-1 ring-primary" : ""}`}>
            <div className="flex items-start gap-3 p-3">
              {peutValider && <input type="checkbox" className="mt-2" checked={selection.has(d.id)} onChange={() => toggle(d.id)} aria-label={d.creation ? `Sélectionner la nouvelle fiche${d.reembauche ? " (réembauche)" : ""} de ${d.nom}` : `Sélectionner la modification de ${d.nom}`} />}
              <Avatar nom={d.nom} photoUrl={d.photoUrl} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {d.employeeId ? (
                    <Link href={`/employes/${d.employeeId}`} className="font-semibold hover:underline">{d.nom}</Link>
                  ) : (
                    <span className="font-semibold">Nouvelle fiche{d.reembauche ? " (réembauche)" : ""} : {d.nom}</span>
                  )}{" "}
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">À valider</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {d.lignes.map((l) => <li key={l} className="tabular-nums">{l}</li>)}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  Demandée par {d.auteurNom} le {d.demandeLe}{d.motif ? ` — motif : ${d.motif}` : ""}
                </p>
              </div>
              {peutValider && (
                <div className="flex items-center gap-2">
                  <BoutonApprouver onClick={() => approuver([d.id])} disabled={isPending} />
                  <BoutonRefuser onClick={() => setRefus({ ids: [d.id], erreur: null })} disabled={isPending} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {refus && (
        <DialogueRefus
          titre="Refuser la modification de fiche"
          consigne={refus.ids.length > 1 ? `${refus.ids.length} modifications de fiche` : `La modification de la fiche de ${rows.find((r) => r.id === refus.ids[0])?.nom ?? "ce salarié"}.`}
          enCours={isPending}
          erreur={refus.erreur}
          onConfirmer={confirmerRefus}
          onAnnuler={() => setRefus(null)}
        />
      )}
    </div>
  );
}
