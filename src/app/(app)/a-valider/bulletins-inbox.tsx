"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { changerStatutEnLot } from "../paie/actions";
import { Avatar } from "@/components/avatar";
import { TelechargerLien } from "@/components/telecharger-lien";
import type { ModePaiement, PaymentStatus } from "@prisma/client";
import { estErreur } from "@/lib/action-lisible";

export type BulletinRow = {
  id: string;
  employeeId: string;
  matricule: string;
  nom: string;
  photoUrl?: string | null;
  montant: string;
};

const MODES = [
  { value: "ESPECES", label: "Espèces" },
  { value: "VIREMENT", label: "Virement" },
  { value: "MOBILE_MONEY", label: "Mobile Money" },
  { value: "CHEQUE", label: "Chèque" },
  { value: "AUTRE", label: "Autre" },
];

export function BulletinsInbox({
  rows,
  cible,
  actionLabel,
}: {
  rows: BulletinRow[];
  cible: PaymentStatus;
  actionLabel: string;
}) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState("VIREMENT");
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function toggle(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function lancer(ids: string[]) {
    if (ids.length === 0) return;
    setErreur(null);
    startTransition(async () => {
      const r = await changerStatutEnLot(ids, cible, cible === "PAYE" ? (mode as ModePaiement) : null);
      if (estErreur(r)) { setErreur(`Lot annulé (aucune ligne modifiée) : ${r.erreur}`); return; }
      setSelection(new Set());
    });
  }

  return (
    <div>
      {erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rows.every((r) => selection.has(r.id))}
            onChange={(e) => setSelection(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
          />
          Tout sélectionner
        </label>
        {cible === "PAYE" && selection.size > 0 && (
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        )}
        {selection.size > 0 && (
          <>
            <span className="text-xs font-medium">{selection.size} sélectionné(s) :</span>
            <button onClick={() => lancer([...selection])} disabled={isPending} className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-success">
              {actionLabel}
            </button>
            {isPending && <span className="text-xs text-muted-foreground">Traitement…</span>}
          </>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 rounded-xl border bg-card p-3 ${selection.has(r.id) ? "ring-1 ring-primary" : ""}`}>
            <input type="checkbox" checked={selection.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Sélectionner ${r.nom}`} />
            <Avatar nom={r.nom} photoUrl={r.photoUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <Link href={`/employes/${r.employeeId}`} className="font-semibold hover:underline">{r.nom}</Link>{" "}
                <span className="font-mono text-xs text-muted-foreground">{r.matricule}</span>
              </p>
              <p className="text-xs text-muted-foreground">Salaire net : {r.montant}</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <TelechargerLien href={`/paie/bulletin/${r.id}?devise=USD&dl=1`} className="text-primary underline">Bulletin $</TelechargerLien>
              <TelechargerLien href={`/paie/bulletin/${r.id}?devise=CDF&dl=1`} className="text-primary underline">CDF</TelechargerLien>
              <button onClick={() => lancer([r.id])} disabled={isPending} className="rounded-full bg-emerald-500 px-3 py-1.5 font-semibold text-white hover:bg-success">
                {actionLabel}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
