"use client";

import { useState, useTransition } from "react";
import { BoutonNeutre } from "@/components/action-buttons";
import { estErreur } from "@/lib/action-lisible";
import { marquerContratsExpires } from "./contrat-actions";

/**
 * « Marquer expiré » — pose EXPIRE en base sur des contrats échus (geste de la Direction,
 * journalisé). Le résultat revient comme une VALEUR : ce qui est passé et, ligne par ligne, ce qui
 * ne l'est pas et pourquoi.
 */
export function BoutonMarquerExpire({ ids, libelle = "Marquer expiré", onFini }: { ids: string[]; libelle?: string; onFini?: () => void }) {
  const [avis, setAvis] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <BoutonNeutre
        type="button"
        disabled={enCours || ids.length === 0}
        onClick={() =>
          demarrer(async () => {
            const r = await marquerContratsExpires(ids);
            if (estErreur(r)) return setAvis(r.erreur);
            setAvis(r.refus.length > 0 ? `${r.traites} marqué(s) expiré(s). Non traité(s) : ${r.refus.map((x) => x.message).join(" · ")}` : null);
            onFini?.();
          })
        }
      >
        {enCours ? "…" : libelle}
      </BoutonNeutre>
      {avis && <span role="status" className="text-xs text-amber-800">{avis}</span>}
    </span>
  );
}
