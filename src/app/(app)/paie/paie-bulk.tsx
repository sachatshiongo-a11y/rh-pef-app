"use client";

import { useState, useTransition } from "react";
import { changerStatutEnLot } from "./actions";
import { StatusActions } from "./status-actions";
import { LIBELLE_STATUT, COULEUR_STATUT } from "@/lib/paie-etats";
import { EmployeeName } from "@/components/employee-name";
import type { PaymentStatus, ModePaiement } from "@prisma/client";

export type PaieRow = {
  id: string;
  employeeId: string;
  matricule: string;
  nom: string;
  photoUrl?: string | null;
  categorie: string;
  salBrutUSD: number;
  salNetUSD: number;
  salNetCDF: number;
  statutPaiement: PaymentStatus;
  modePaiementDefaut: ModePaiement;
};

function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

export function PaieBulk({
  brigade,
  backoffice,
  peutGerer,
  estAdmin,
}: {
  brigade: PaieRow[];
  backoffice: PaieRow[];
  peutGerer: boolean;
  estAdmin: boolean;
}) {
  const [filtreStatut, setFiltreStatut] = useState<string>("");
  const filtrer = (rows: PaieRow[]) => (filtreStatut ? rows.filter((r) => r.statutPaiement === filtreStatut) : rows);
  const brigadeAff = filtrer(brigade);
  const backofficeAff = filtrer(backoffice);
  const toutes = [...brigadeAff, ...backofficeAff];
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const STATUTS: PaymentStatus[] = ["PAS_VALIDE", "VALIDE", "PAYE"];

  function toggle(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleGroupe(rows: PaieRow[], on: boolean) {
    setSelection((s) => {
      const n = new Set(s);
      rows.forEach((r) => (on ? n.add(r.id) : n.delete(r.id)));
      return n;
    });
  }

  function lancer(versStatut: PaymentStatus) {
    const ids = [...selection];
    if (ids.length === 0) return;
    startTransition(async () => {
      await changerStatutEnLot(ids, versStatut, null);
      setSelection(new Set());
    });
  }

  const n = selection.size;

  return (
    <div>
      {/* Barre d'actions groupées */}
      {n > 0 && (
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
          <span className="text-sm font-medium">{n} sélectionné(s) :</span>
          {estAdmin && (
            <>
              <button onClick={() => lancer("VALIDE")} disabled={isPending} className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700">
                ✓ Valider
              </button>
              <button onClick={() => lancer("PAYE")} disabled={isPending} className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700">
                ✓ Marquer payé
              </button>
              <button onClick={() => lancer("PAS_VALIDE")} disabled={isPending} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent">
                ↩ Rouvrir
              </button>
            </>
          )}
          <button onClick={() => setSelection(new Set())} className="ml-auto text-xs text-muted-foreground underline">
            Tout désélectionner
          </button>
          {isPending && <span className="text-xs text-muted-foreground">Traitement…</span>}
        </div>
      )}

      {/* Filtre par statut (payé / en attente…) */}
      <div className="mb-3 flex items-center gap-2 text-sm">
        <label className="text-muted-foreground">Filtrer par statut :</label>
        <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-xs">
          <option value="">Tous</option>
          {STATUTS.map((s) => (<option key={s} value={s}>{LIBELLE_STATUT[s]}</option>))}
        </select>
        {filtreStatut && <span className="text-xs text-muted-foreground">{toutes.length} ligne(s)</span>}
      </div>

      <Groupe titre="Brigade" rows={brigadeAff} selection={selection} onToggle={toggle} onToggleGroupe={toggleGroupe} peutGerer={peutGerer} estAdmin={estAdmin} />
      <div className="h-6" />
      <Groupe titre="Backoffice" rows={backofficeAff} selection={selection} onToggle={toggle} onToggleGroupe={toggleGroupe} peutGerer={peutGerer} estAdmin={estAdmin} />

      {toutes.length === 0 && (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          Aucune paie calculée pour ce mois.
        </p>
      )}
    </div>
  );
}

function Groupe({
  titre,
  rows,
  selection,
  onToggle,
  onToggleGroupe,
  peutGerer,
  estAdmin,
}: {
  titre: string;
  rows: PaieRow[];
  selection: Set<string>;
  onToggle: (id: string) => void;
  onToggleGroupe: (rows: PaieRow[], on: boolean) => void;
  peutGerer: boolean;
  estAdmin: boolean;
}) {
  if (rows.length === 0) return null;
  const tousCoches = rows.every((r) => selection.has(r.id));
  return (
    <div>
      <h2 className="mb-2 text-base font-semibold">
        {titre} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={tousCoches}
                  onChange={(e) => onToggleGroupe(rows, e.target.checked)}
                  aria-label={`Tout sélectionner — ${titre}`}
                />
              </th>
              <th className="px-3 py-2">Matricule</th>
              <th className="px-3 py-2">Nom</th>
              <th className="px-3 py-2 text-right">Brut $</th>
              <th className="px-3 py-2 text-right">Net $</th>
              <th className="px-3 py-2 text-right">Net CDF</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2">Bulletin</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className={`border-t ${selection.has(l.id) ? "bg-primary/5" : ""}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selection.has(l.id)}
                    onChange={() => onToggle(l.id)}
                    aria-label={`Sélectionner ${l.nom}`}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{l.matricule}</td>
                <td className="px-3 py-2">
                  <EmployeeName id={l.employeeId} nom={l.nom} photoUrl={l.photoUrl} />
                </td>
                <td className="px-3 py-2 text-right">{money(l.salBrutUSD)}</td>
                <td className="px-3 py-2 text-right">{money(l.salNetUSD)}</td>
                <td className="px-3 py-2 text-right">
                  {l.salNetCDF.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} CDF
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_STATUT[l.statutPaiement]}`}>
                    {LIBELLE_STATUT[l.statutPaiement]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  <a href={`/paie/bulletin/${l.id}?devise=USD&dl=1`} target="_blank" rel="noopener noreferrer" className="text-primary underline" title="Télécharger le bulletin en USD">$</a>
                  {" · "}
                  <a href={`/paie/bulletin/${l.id}?devise=CDF&dl=1`} target="_blank" rel="noopener noreferrer" className="text-primary underline" title="Télécharger le bulletin en CDF">CDF</a>
                </td>
                <td className="px-3 py-2">
                  <StatusActions
                    payrollLineId={l.id}
                    statut={l.statutPaiement}
                    peutValider={estAdmin}
                    peutPreparer={peutGerer}
                    modePaiementDefaut={l.modePaiementDefaut}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
