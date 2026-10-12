"use client";

import { useState } from "react";
import { TelechargerLien } from "@/components/telecharger-lien";

/** Un mois de paie déjà calculé, autre que le mois courant (le libellé est préparé côté serveur). */
export type MoisPasse = { mois: number; annee: number; libelle: string };

const LIEN = "block rounded px-3 py-2 text-sm hover:bg-accent";
const TITRE = "px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * Section « Mois passé » du menu Exporter de la Paie : on choisit un mois déjà calculé, puis on
 * télécharge ses bulletins (un PDF ou un ZIP, en $ ou en CDF) et son livre de paie. Ce sont les MÊMES
 * routes que pour le mois courant, avec `?mois=&annee=` : un bulletin validé ou payé ressort tel qu'il
 * a été figé (instantané, taux de sa validation), jamais recalculé avec les paramètres du jour.
 */
export function ExportMoisPasse({ mois }: { mois: MoisPasse[] }) {
  const [choix, setChoix] = useState(mois.length > 0 ? `${mois[0].annee}-${mois[0].mois}` : "");
  if (mois.length === 0) return null;
  const [annee, m] = choix.split("-").map(Number);
  const q = `mois=${m}&annee=${annee}`;

  return (
    <>
      <p className={TITRE}>Un mois passé</p>
      <div className="px-3 pb-1">
        <select
          value={choix}
          onChange={(e) => setChoix(e.target.value)}
          aria-label="Mois à exporter"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm capitalize"
        >
          {mois.map((x) => (
            <option key={`${x.annee}-${x.mois}`} value={`${x.annee}-${x.mois}`}>{x.libelle}</option>
          ))}
        </select>
      </div>
      <TelechargerLien href={`/paie/bulletins-pdf?${q}&devise=USD`} className={LIEN}>Bulletins PDF ($)</TelechargerLien>
      <TelechargerLien href={`/paie/bulletins-pdf?${q}&devise=CDF`} className={LIEN}>Bulletins PDF (CDF)</TelechargerLien>
      <TelechargerLien href={`/paie/bulletins-zip?${q}&devise=USD`} className={LIEN}>Bulletins séparés ZIP ($)</TelechargerLien>
      <TelechargerLien href={`/paie/bulletins-zip?${q}&devise=CDF`} className={LIEN}>Bulletins séparés ZIP (CDF)</TelechargerLien>
      <TelechargerLien href={`/paie/export?${q}`} className={LIEN}>Livre de paie (Excel)</TelechargerLien>
      <TelechargerLien href={`/paie/export-pdf?${q}`} className={LIEN}>Livre de paie (PDF)</TelechargerLien>
    </>
  );
}
