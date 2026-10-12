"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonApprouver, BoutonNeutre, BoutonRefuser } from "@/components/action-buttons";
import { Avatar } from "@/components/avatar";
import {
  approuverChangementsEnLot, refuserChangementsEnLot, approuverEchangesEnLot, refuserEchangesEnLot,
  type RapportLotShifts,
} from "../planning/decisions-lot-actions";
import { EtatVide } from "@/components/etat-vide";

/** Une demande en attente, déjà mise en phrases par le serveur. */
export type LigneShift = {
  id: string;
  /** Le ou les salariés concernés (le nom mène à sa fiche) : un pour un changement, deux pour un échange. */
  salaries: { id: string; nom: string }[];
  photoUrl: string | null;
  /** Détail de la demande (jour, shifts, motif). */
  detail: string;
  /** Échanges seulement : le collègue a-t-il déjà accepté ? */
  accordCollegue?: boolean;
};

const ACTIONS = {
  echange: { approuver: approuverEchangesEnLot, refuser: refuserEchangesEnLot, mot: "échange(s)", vide: "Aucun échange de shift en attente." },
  changement: { approuver: approuverChangementsEnLot, refuser: refuserChangementsEnLot, mot: "changement(s)", vide: "Aucune demande de changement de shift." },
} as const;

/**
 * Échanges de shift entre salariés ET changements de shift (écran « À valider ») : cases à cocher par ligne,
 * barre d'actions groupées (Approuver / Refuser), et boutons par ligne qui lisent la réponse — une demande
 * refusée par le verrou de paie est NOMMÉE à l'écran au lieu de rester « en attente » sans un mot.
 */
export function ShiftsInbox({ type, rows, peutPlanning }: { type: "echange" | "changement"; rows: LigneShift[]; peutPlanning: boolean }) {
  const a = ACTIONS[type];
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();
  const [note, setNote] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  function decider(fn: (ids: string[]) => Promise<RapportLotShifts>, cibles: string[], verbe: string) {
    if (cibles.length === 0) return;
    setNote(null);
    demarrer(async () => {
      try {
        const r = await fn(cibles);
        clear();
        setNote(r.echecs.length > 0
          ? { ok: false, texte: `${r.traitees} ${a.mot} ${verbe}${r.echecs.length > 0 ? `, ${r.echecs.length} non traité(s) — ${r.echecs.join(" · ")}` : "."}` }
          : { ok: true, texte: `${r.traitees} ${a.mot} ${verbe}.` });
      } catch {
        setNote({ ok: false, texte: "La décision n'a pas abouti. Réessayez." });
      }
    });
  }

  if (rows.length === 0) {
    return <EtatVide message={a.vide} />;
  }

  return (
    <div className="space-y-2">
      {note && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${note.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>{note.texte}</p>
      )}
      {peutPlanning && (
        <BulkBar count={sel.size} total={rows.length} onAll={(on) => setAll(rows.map((r) => r.id), on)}>
          <BoutonApprouver disabled={enCours} onClick={() => decider(a.approuver, ids, "approuvé(s)")}>Approuver ({ids.length})</BoutonApprouver>
          <BoutonRefuser disabled={enCours} onClick={() => decider(a.refuser, ids, "refusé(s)")}>Refuser ({ids.length})</BoutonRefuser>
          <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
        </BulkBar>
      )}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={`flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 ${sel.has(r.id) ? "ring-1 ring-primary" : ""}`}>
            {peutPlanning && (
              <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Sélectionner la demande de ${r.salaries.map((e) => e.nom).join(" et ")}`} className="shrink-0" />
            )}
            <Avatar nom={r.salaries[0]?.nom ?? "?"} taille={32} photoUrl={r.photoUrl} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {r.salaries.map((e, i) => (
                  <span key={e.id}>{i > 0 && " ↔ "}<Link href={`/employes/${e.id}`} className="text-primary hover:underline">{e.nom}</Link></span>
                ))}
              </p>
              <p className="text-xs text-muted-foreground">{r.detail}</p>
              {r.accordCollegue !== undefined && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Collègue : {r.accordCollegue ? <b className="text-emerald-700">accepté</b> : "en attente"}
                </p>
              )}
            </div>
            {peutPlanning ? (
              <span className="flex shrink-0 gap-2">
                <BoutonApprouver
                  disabled={enCours}
                  onClick={() => decider(a.approuver, [r.id], "approuvé(s)")}
                  title={r.accordCollegue === undefined ? undefined : r.accordCollegue ? "Approuver — l'échange sera appliqué" : "Approuver — appliqué dès l'accord du collègue"}
                />
                <BoutonRefuser disabled={enCours} onClick={() => decider(a.refuser, [r.id], "refusé(s)")} />
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">En attente</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
