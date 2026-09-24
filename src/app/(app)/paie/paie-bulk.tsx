"use client";

import { useState, useTransition } from "react";
import { changerStatutEnLot } from "./actions";
import { StatusActions } from "./status-actions";
import { BoutonValider, BoutonNeutre } from "@/components/action-buttons";
import { LIBELLE_STATUT, COULEUR_STATUT } from "@/lib/paie-etats";
import { EmployeeName } from "@/components/employee-name";
import { TelechargerLien } from "@/components/telecharger-lien";
import type { PaymentStatus, ModePaiement } from "@prisma/client";
import { estErreur } from "@/lib/action-lisible";
import type { AvertissementPaie, SourceReference } from "@/lib/paie-reference";
import { BadgeReference } from "./avertissements-paie";
import { lignesAValiderDuLot, messageConfirmationValidation } from "./avertissements-validation";
import { cleSelection, lignesSelectionnees, messageEcartes } from "./selection-paie";

export type PaieRow = {
  id: string;
  employeeId: string;
  matricule: string;
  nom: string;
  photoUrl?: string | null;
  categorie: string;
  salBrutUSD: number;
  salaireNetUSD: number;
  salaireNetCDF: number;
  totalVerseUSD: number;
  statutPaiement: PaymentStatus;
  modePaiementDefaut: ModePaiement;
  // Détail pour l'aperçu léger (HTML) des cartes mobile.
  baseUSD: number;
  hsUSD: number;
  transportUSD: number;
  primesUSD: number;
  allocUSD: number;
  fraisMedUSD: number;
  cnssUSD: number;
  iprUSD: number;
  acompteUSD: number;
  // Référence d'heures du mois (paie sur heures planifiées, 2026-09-23) et avertissements.
  sourceReference: SourceReference;
  motifReference: string | null;
  avertissements: AvertissementPaie[];
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
  // Sélection = SALARIÉS (cleSelection) : les identifiants des lignes changent à chaque recalcul.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  // "" = automatique (suit la fiche de chaque employé) ; sinon on force ce mode pour tout le lot.
  const [modeBulk, setModeBulk] = useState<"" | ModePaiement>("");

  const STATUTS: PaymentStatus[] = ["PAS_VALIDE", "VALIDE", "PAYE"];
  const MODES_PAIEMENT: { valeur: ModePaiement; label: string }[] = [
    { valeur: "ESPECES", label: "Espèces" },
    { valeur: "VIREMENT", label: "Virement bancaire" },
    { valeur: "MOBILE_MONEY", label: "Mobile Money" },
    { valeur: "CHEQUE", label: "Chèque" },
    { valeur: "AUTRE", label: "Autre" },
  ];

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
      rows.forEach((r) => (on ? n.add(cleSelection(r)) : n.delete(cleSelection(r))));
      return n;
    });
  }

  // Lignes AFFICHÉES des salariés sélectionnés (sur toutes les lignes, filtre ignoré).
  const { ids: idsSelection, ecartes } = lignesSelectionnees([...brigade, ...backoffice], selection);

  function lancer(versStatut: PaymentStatus) {
    const ids = idsSelection;
    if (ids.length === 0) return;
    // Validation : montrer les avertissements des lignes qui vont réellement être validées, sans
    // jamais bloquer (« Annuler » ne fait rien, « OK » valide). Sur toutes les lignes, filtre ignoré.
    if (versStatut === "VALIDE") {
      const message = messageConfirmationValidation(lignesAValiderDuLot([...brigade, ...backoffice], new Set(ids)));
      if (message && !window.confirm(message)) return;
    }
    // Au paiement : mode forcé si choisi, sinon null → le serveur suit la fiche de chaque employé.
    const mode = versStatut === "PAYE" ? (modeBulk || null) : null;
    setErreur(null);
    startTransition(async () => {
      const r = await changerStatutEnLot(ids, versStatut, mode);
      if (estErreur(r)) { setErreur(`Lot annulé (aucune ligne modifiée) : ${r.erreur}`); return; }
      setSelection(new Set());
    });
  }

  const n = idsSelection.length;
  const avisEcartes = messageEcartes(ecartes);

  return (
    <div>
      {erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {avisEcartes && (
        <p className="mb-3 text-xs text-muted-foreground">
          {avisEcartes}{" "}
          <button onClick={() => setSelection(new Set())} className="underline">Tout désélectionner</button>
        </p>
      )}
      {/* Barre d'actions groupées */}
      {n > 0 && (
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
          <span className="text-sm font-medium">{n} sélectionné(s) :</span>
          {estAdmin && (
            <>
              <BoutonValider onClick={() => lancer("VALIDE")} disabled={isPending} />
              <span className="inline-flex items-center gap-1">
                <select
                  value={modeBulk}
                  onChange={(e) => setModeBulk(e.target.value as "" | ModePaiement)}
                  title="Moyen de paiement pour le lot"
                  className="rounded border border-input bg-background px-1.5 py-1 text-xs"
                >
                  <option value="">Auto (selon la fiche)</option>
                  {MODES_PAIEMENT.map((m) => (
                    <option key={m.valeur} value={m.valeur}>{m.label}</option>
                  ))}
                </select>
                <BoutonValider onClick={() => lancer("PAYE")} disabled={isPending}>Marquer payé</BoutonValider>
              </span>
              <BoutonNeutre onClick={() => lancer("PAS_VALIDE")} disabled={isPending}>
                ↩ Rouvrir
              </BoutonNeutre>
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
  const tousCoches = rows.every((r) => selection.has(cleSelection(r)));
  return (
    <div>
      <h2 className="mb-2 text-base font-semibold">
        {titre} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h2>
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
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
              <th className="px-3 py-2 text-right">Salaire net $</th>
              <th className="px-3 py-2 text-right">Salaire net CDF</th>
              <th className="px-3 py-2 text-right">Total versé $</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2">Bulletin</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className={`border-t ${selection.has(cleSelection(l)) ? "bg-primary/5" : ""}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selection.has(cleSelection(l))}
                    onChange={() => onToggle(cleSelection(l))}
                    aria-label={`Sélectionner ${l.nom}`}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{l.matricule}</td>
                <td className="px-3 py-2">
                  <EmployeeName id={l.employeeId} nom={l.nom} photoUrl={l.photoUrl} />
                  <BadgeReference sourceReference={l.sourceReference} motifReference={l.motifReference} avertissements={l.avertissements} />
                </td>
                <td className="px-3 py-2 text-right">{money(l.salBrutUSD)}</td>
                <td className="px-3 py-2 text-right">{money(l.salaireNetUSD)}</td>
                <td className="px-3 py-2 text-right">
                  {l.salaireNetCDF.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} CDF
                </td>
                <td className="px-3 py-2 text-right">{money(l.totalVerseUSD)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_STATUT[l.statutPaiement]}`}>
                    {LIBELLE_STATUT[l.statutPaiement]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  <TelechargerLien href={`/paie/bulletin/${l.id}?devise=USD&dl=1`} className="text-primary underline" title="Télécharger le bulletin en USD">$</TelechargerLien>
                  {" · "}
                  <TelechargerLien href={`/paie/bulletin/${l.id}?devise=CDF&dl=1`} className="text-primary underline" title="Télécharger le bulletin en CDF">CDF</TelechargerLien>
                </td>
                <td className="px-3 py-2">
                  <StatusActions
                    payrollLineId={l.id}
                    statut={l.statutPaiement}
                    peutValider={estAdmin}
                    peutPreparer={peutGerer}
                    modePaiementDefaut={l.modePaiementDefaut}
                    avertissements={l.avertissements}
                    nom={l.nom}
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
