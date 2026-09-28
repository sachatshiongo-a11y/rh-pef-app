"use client";

import { useState } from "react";
import { LIBELLE_TYPE_CONTRAT, libelleTypeContrat } from "@/lib/contrats-classement";

const inputCls =
  "rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const TYPES = ["CDD", "CDI", "STAGE", "JOURNALIER", "INTERIM"];

/**
 * Type du nouveau contrat + clôture PROPOSÉE du contrat en cours (spec 2026-09-28, §3.4).
 *
 * La case est cochée par défaut quand le TYPE change (un CDD devient CDI : l'ancien est transformé),
 * décochée sinon (un second CDD peut coexister le temps d'un recouvrement). Dès que la Direction
 * touche la case, son choix l'emporte : on ne la recoche pas dans son dos en changeant le type.
 * Rien n'est clôturé sans que la case soit cochée à l'envoi.
 */
export function ChampsNouveauContrat({
  courant,
}: {
  courant: { id: string; type: string; debutTexte: string } | null;
}) {
  const [type, setType] = useState("CDD");
  const [choixManuel, setChoixManuel] = useState<boolean | null>(null);
  const cocheParDefaut = courant !== null && type !== courant.type;
  const coche = choixManuel ?? cocheParDefaut;

  return (
    <>
      <label className="flex flex-col text-xs text-muted-foreground">
        Type
        <select name="type" value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
          {TYPES.map((t) => (
            <option key={t} value={t}>{LIBELLE_TYPE_CONTRAT[t]}</option>
          ))}
        </select>
      </label>
      {courant && (
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border bg-background p-2 text-xs sm:col-span-2 md:col-span-4">
          <input type="hidden" name="cloturerContratId" value={courant.id} />
          <label className="flex items-start gap-2">
            <input type="checkbox" name="cloturer" checked={coche} onChange={(e) => setChoixManuel(e.target.checked)} className="mt-0.5" />
            <span>
              Clôturer le contrat en cours (il passera en Transformé ou Résilié, à choisir)
              <span className="block text-muted-foreground">
                {libelleTypeContrat(courant.type)} depuis le {courant.debutTexte}
              </span>
            </span>
          </label>
          {coche && (
            <label className="flex flex-wrap items-center gap-2 pl-6">
              Il passera en
              <select name="statutCloture" defaultValue="TRANSFORME" className={inputCls}>
                <option value="TRANSFORME">Transformé</option>
                <option value="RESILIE">Résilié</option>
              </select>
            </label>
          )}
        </div>
      )}
    </>
  );
}
