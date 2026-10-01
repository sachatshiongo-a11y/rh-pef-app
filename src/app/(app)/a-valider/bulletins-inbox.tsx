"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { changerStatutEnLot } from "../paie/actions";
import { Avatar } from "@/components/avatar";
import { TelechargerLien } from "@/components/telecharger-lien";
import { BoutonValider } from "@/components/action-buttons";
import type { ModePaiement, PaymentStatus } from "@prisma/client";
import { estErreur } from "@/lib/action-lisible";
import type { AvertissementPaie } from "@/lib/paie-reference";
import { lignesAValiderDuLot, messageConfirmationValidation } from "../paie/avertissements-validation";
import { cleSelection, lignesSelectionnees, messageEcartes } from "../paie/selection-paie";

export type BulletinRow = {
  id: string;
  employeeId: string;
  matricule: string;
  nom: string;
  photoUrl?: string | null;
  montant: string;
  statutPaiement: PaymentStatus;
  // Rappelés avant de valider, comme sur l'écran Paie (jamais bloquants).
  avertissements: AvertissementPaie[];
  /** Montants affichés (paie-jeton.ts) : renvoyés à la validation. */
  jeton?: string;
};

// "" = automatique : le moyen de paiement de la fiche de chaque salarié (comme l'écran Paie). Jusqu'au
// 2026-10-01 un lot payé d'ici enregistrait « Virement » pour tous, quelle que soit la fiche.
const MODES = [
  { value: "", label: "Auto (selon la fiche)" },
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
  lectureSeule,
}: {
  rows: BulletinRow[];
  cible: PaymentStatus;
  actionLabel: string;
  /** Lecture seule (la RH devant les bulletins que la Direction n'a pas validés) : ce libellé
   *  remplace les cases et les boutons. Le serveur refuse de toute façon (paie-etats.ts). */
  lectureSeule?: string;
}) {
  // Sélection = SALARIÉS (cleSelection) : les identifiants des lignes changent à chaque recalcul.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const { ids: idsSelection, ecartes } = lignesSelectionnees(rows, selection);
  const avisEcartes = messageEcartes(ecartes);
  const [mode, setMode] = useState("");
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function toggle(cle: string) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(cle) ? n.delete(cle) : n.add(cle);
      return n;
    });
  }
  function lancer(ids: string[]) {
    if (ids.length === 0) return;
    // Validation (une ligne ou le lot) : mêmes avertissements et même boîte que l'écran Paie, sur les
    // lignes qui vont réellement être validées. Rien à signaler → validation directe, sans boîte.
    if (cible === "VALIDE") {
      const message = messageConfirmationValidation(lignesAValiderDuLot(rows, new Set(ids)));
      if (message && !window.confirm(message)) return;
    }
    setErreur(null);
    startTransition(async () => {
      const jetons = Object.fromEntries(rows.filter((x) => ids.includes(x.id) && x.jeton).map((x) => [x.id, x.jeton!]));
      const r = await changerStatutEnLot(ids, cible, cible === "PAYE" ? ((mode || null) as ModePaiement | null) : null, jetons);
      if (estErreur(r)) { setErreur(`Lot annulé (aucune ligne modifiée) : ${r.erreur}`); return; }
      setSelection(new Set());
    });
  }

  return (
    <div>
      {erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {avisEcartes && (
        <p className="mb-3 text-xs text-muted-foreground">
          {avisEcartes}{" "}
          <button onClick={() => setSelection(new Set())} className="underline">Tout désélectionner</button>
        </p>
      )}
      {!lectureSeule && (
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rows.every((r) => selection.has(cleSelection(r)))}
            onChange={(e) => setSelection(e.target.checked ? new Set(rows.map(cleSelection)) : new Set())}
          />
          Tout sélectionner
        </label>
        {cible === "PAYE" && idsSelection.length > 0 && (
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        )}
        {idsSelection.length > 0 && (
          <>
            <span className="text-xs font-medium">{idsSelection.length} sélectionné(s) :</span>
            <BoutonValider onClick={() => lancer(idsSelection)} disabled={isPending}>{actionLabel}</BoutonValider>
            {isPending && <span className="text-xs text-muted-foreground">Traitement…</span>}
          </>
        )}
      </div>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 rounded-xl border bg-card p-3 ${selection.has(cleSelection(r)) ? "ring-1 ring-primary" : ""}`}>
            {!lectureSeule && <input type="checkbox" checked={selection.has(cleSelection(r))} onChange={() => toggle(cleSelection(r))} aria-label={`Sélectionner ${r.nom}`} />}
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
              {lectureSeule ? (
                <span className="text-muted-foreground">{lectureSeule}</span>
              ) : (
                <BoutonValider onClick={() => lancer([r.id])} disabled={isPending}>{actionLabel}</BoutonValider>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
