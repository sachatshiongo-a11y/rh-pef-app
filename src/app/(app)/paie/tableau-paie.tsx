"use client";

import { useState } from "react";
import { LIBELLE_STATUT, COULEUR_STATUT } from "@/lib/paie-etats";
import { EmployeeName } from "@/components/employee-name";
import { TelechargerLien } from "@/components/telecharger-lien";
import type { PaymentStatus } from "@prisma/client";
import type { AvertissementPaie, SourceReference } from "@/lib/paie-reference";
import { BadgeReference } from "./avertissements-paie";
import { EtatVide } from "@/components/etat-vide";

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
  /** Échéance de prêt retenue ce mois (jamais inconnue : 0 par défaut en base comme dans le moteur). */
  retenuePretUSD: number;
  // Référence d'heures du mois (paie sur heures planifiées, 2026-09-23) et avertissements.
  sourceReference: SourceReference;
  motifReference: string | null;
  avertissements: AvertissementPaie[];
};

function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

/**
 * Tableau détaillé de la paie du mois, en LECTURE : montants, statut, téléchargement des bulletins. Depuis le
 * lot 8 du plan d'ergonomie (V5) on n'y décide plus rien : valider, payer, rouvrir et annuler un paiement se font
 * dans « À valider » (cases, barre d'actions groupées, date de versement, moyen de paiement). Paie garde la
 * préparation, le calcul, l'aperçu et la clôture du mois.
 */
export function TableauPaie({
  brigade,
  backoffice,
}: {
  brigade: PaieRow[];
  backoffice: PaieRow[];
}) {
  const [filtreStatut, setFiltreStatut] = useState<string>("");
  const filtrer = (rows: PaieRow[]) => (filtreStatut ? rows.filter((r) => r.statutPaiement === filtreStatut) : rows);
  const brigadeAff = filtrer(brigade);
  const backofficeAff = filtrer(backoffice);
  const toutes = [...brigadeAff, ...backofficeAff];

  const STATUTS: PaymentStatus[] = ["PAS_VALIDE", "VALIDE", "PAYE"];

  return (
    <div>
      {/* Filtre par statut (payé / en attente…) */}
      <div className="mb-3 flex items-center gap-2 text-sm">
        <label className="text-muted-foreground">Filtrer par statut :</label>
        <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-xs">
          <option value="">Tous</option>
          {STATUTS.map((s) => (<option key={s} value={s}>{LIBELLE_STATUT[s]}</option>))}
        </select>
        {filtreStatut && <span className="text-xs text-muted-foreground">{toutes.length} ligne(s)</span>}
      </div>

      <Groupe titre="Brigade" rows={brigadeAff} />
      <div className="h-6" />
      <Groupe titre="Backoffice" rows={backofficeAff} />

      {toutes.length === 0 && <EtatVide message="Aucune paie calculée pour ce mois." />}
    </div>
  );
}

function Groupe({ titre, rows }: { titre: string; rows: PaieRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-base font-semibold">
        {titre} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h2>
      <div className="tableau-normal-xl rounded-lg border">
        <table className="w-full text-sm">
          <thead className="en-tete-collante-xl bg-muted text-left">
            <tr>
              <th className="px-2 py-2">Matricule</th>
              <th className="px-2 py-2">Nom</th>
              <th className="px-2 py-2 text-right">Brut $</th>
              <th className="px-2 py-2 text-right">Salaire net $</th>
              <th className="px-2 py-2 text-right">Salaire net CDF</th>
              <th className="px-2 py-2 text-right">Total versé $</th>
              <th className="px-2 py-2">Statut</th>
              <th className="px-2 py-2">Bulletin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-2 py-2 font-mono text-xs">{l.matricule}</td>
                <td className="px-2 py-2">
                  <EmployeeName id={l.employeeId} nom={l.nom} photoUrl={l.photoUrl} />
                  <BadgeReference sourceReference={l.sourceReference} motifReference={l.motifReference} avertissements={l.avertissements} />
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right">{money(l.salBrutUSD)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right">{money(l.salaireNetUSD)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  {l.salaireNetCDF.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} CDF
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right">{money(l.totalVerseUSD)}</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_STATUT[l.statutPaiement]}`}>
                    {LIBELLE_STATUT[l.statutPaiement]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs">
                  <TelechargerLien href={`/paie/bulletin/${l.id}?devise=USD&dl=1`} className="text-primary underline" title="Télécharger le bulletin en USD">$</TelechargerLien>
                  {" · "}
                  <TelechargerLien href={`/paie/bulletin/${l.id}?devise=CDF&dl=1`} className="text-primary underline" title="Télécharger le bulletin en CDF">CDF</TelechargerLien>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
