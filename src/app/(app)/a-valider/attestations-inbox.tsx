"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { BoutonRefuser, BoutonValider } from "@/components/action-buttons";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { ContratViewerButton } from "@/app/(app)/employes/[id]/contrat-viewer";
import { estErreur } from "@/lib/action-lisible";
import { delivrerAttestations, refuserAttestations, type ResultatLotAttestations } from "../attestations/actions";

export type AttestationRow = {
  id: string;
  employeeId: string;
  nom: string;
  photoUrl: string | null;
  typeLibelle: string;
  motif: string | null;
  demandeLe: string;
};

const inputCls = "min-w-0 rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring";

/**
 * Demandes d'attestation — Délivrer / Refuser, à l'unité ou en lot (cases + barre d'actions).
 * Le serveur revérifie l'éligibilité de CHAQUE ligne au moment de délivrer : une demande
 * inéligible est refusée avec son motif, affiché ici ligne par ligne.
 */
export function AttestationsInbox({ rows, peutValider }: { rows: AttestationRow[]; peutValider: boolean }) {
  const sel = useBulkSelection();
  const [motifLot, setMotifLot] = useState("");
  const [refusLigne, setRefusLigne] = useState<{ id: string; motif: string } | null>(null);
  const [avis, setAvis] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function lancer(appel: () => Promise<ResultatLotAttestations | { erreur: string }>, apres?: () => void) {
    setAvis(null);
    demarrer(async () => {
      const r = await appel();
      if (estErreur(r)) return setAvis(r.erreur);
      apres?.();
      setAvis(
        r.refus.length > 0
          ? `${r.traites} traitée(s). ${r.refus.map((x) => `${x.nom} : ${x.message}`).join(" · ")}`
          : null,
      );
    });
  }

  if (rows.length === 0) {
    return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Aucune demande d&apos;attestation en attente.</div>;
  }

  return (
    <div className="space-y-2">
      {avis && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{avis}</p>}
      {peutValider && (
        <BulkBar count={sel.sel.size} total={rows.length} onAll={(on) => sel.setAll(rows.map((r) => r.id), on)}>
          <BoutonValider disabled={enCours} onClick={() => lancer(() => delivrerAttestations(sel.ids), sel.clear)}>Délivrer</BoutonValider>
          <input value={motifLot} onChange={(e) => setMotifLot(e.target.value)} placeholder="Motif du refus" aria-label="Motif du refus" className={`${inputCls} w-40`} />
          <BoutonRefuser
            disabled={enCours || !motifLot.trim()}
            title={motifLot.trim() ? undefined : "Indiquez d'abord le motif du refus"}
            onClick={() => lancer(() => refuserAttestations(sel.ids, motifLot), () => { sel.clear(); setMotifLot(""); })}
          />
        </BulkBar>
      )}
      {rows.map((d) => (
        <div key={d.id} className={`rounded-xl border bg-card p-3 ${sel.sel.has(d.id) ? "ring-1 ring-primary" : ""}`}>
          <div className="flex flex-wrap items-center gap-3">
            {peutValider && <input type="checkbox" checked={sel.sel.has(d.id)} onChange={() => sel.toggle(d.id)} aria-label={`Sélectionner ${d.nom}`} />}
            <Avatar nom={d.nom} photoUrl={d.photoUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <Link href={`/employes/${d.employeeId}`} className="font-semibold hover:underline">{d.nom}</Link>{" "}
                <span className="text-muted-foreground">— {d.typeLibelle}</span>
              </p>
              <p className="text-xs text-muted-foreground">Demandée le {d.demandeLe}{d.motif ? ` · ${d.motif}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ContratViewerButton href={`/attestations/${d.id}/apercu`} titre={`Aperçu — ${d.typeLibelle} · ${d.nom}`} libelle="Aperçu" className="text-xs text-primary underline" />
              {peutValider && (
                <>
                  <BoutonValider disabled={enCours} onClick={() => lancer(() => delivrerAttestations([d.id]))}>Délivrer</BoutonValider>
                  <BoutonRefuser disabled={enCours} onClick={() => setRefusLigne(refusLigne?.id === d.id ? null : { id: d.id, motif: "" })} />
                </>
              )}
            </div>
          </div>
          {refusLigne?.id === d.id && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
              <input
                autoFocus
                value={refusLigne.motif}
                onChange={(e) => setRefusLigne({ id: d.id, motif: e.target.value })}
                placeholder="Motif du refus (communiqué au salarié)"
                className={`${inputCls} w-full sm:w-72`}
              />
              <BoutonRefuser
                disabled={enCours || !refusLigne.motif.trim()}
                onClick={() => lancer(() => refuserAttestations([d.id], refusLigne.motif), () => setRefusLigne(null))}
              >
                Confirmer le refus
              </BoutonRefuser>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
