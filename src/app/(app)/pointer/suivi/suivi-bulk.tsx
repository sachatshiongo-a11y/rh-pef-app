"use client";

// Le tableau du Suivi + la vérification en lot (§3 de la conception). Purement présentational et
// interactif : tout le formatage (heures, motifs lisibles) est fait CÔTÉ SERVEUR par page.tsx, ce
// composant ne fait que cocher/décocher et appeler `marquerVerifies`. Actions groupées : cases +
// barre (préférence de la Direction, comme `paie-bulk.tsx`), jamais de couleur peinte à la main —
// `BoutonValider` de `@/components/action-buttons`.

import { useState, useTransition } from "react";
import { marquerVerifies } from "./actions";
import { BoutonValider } from "@/components/action-buttons";
import { EmployeeName } from "@/components/employee-name";
import { estErreur } from "@/lib/action-lisible";

export type LigneSuivi = {
  employeeId: string;
  nom: string;
  photoUrl: string | null;
  pointageId: string | null;
  arriveeLabel: string;
  departLabel: string;
  pauseLabel: string;
  heuresLabel: string;
  statut: "TERMINE" | "EN_COURS" | "ABSENT";
  sourceLabel: string | null;
  badgeArrivee: string | null; // "À vérifier · à 2,3 km", ou null
  badgeDepart: string | null;
  aVerifier: boolean; // au moins un scan A_VERIFIER pas encore vérifié → coche activée
};

const BADGE_STATUT: Record<LigneSuivi["statut"], string> = {
  TERMINE: "bg-emerald-100 text-emerald-800",
  EN_COURS: "bg-amber-100 text-amber-800",
  ABSENT: "bg-muted text-muted-foreground",
};
const LABEL_STATUT: Record<LigneSuivi["statut"], string> = { TERMINE: "Terminé", EN_COURS: "En cours", ABSENT: "Pas pointé" };

function BadgeAVerifier({ texte }: { texte: string }) {
  return (
    <span className="mt-0.5 block w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
      {texte}
    </span>
  );
}

export function SuiviBulk({ lignes }: { lignes: LigneSuivi[] }) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const verifiables = lignes.filter((l) => l.pointageId && l.aVerifier);
  const tousCoches = verifiables.length > 0 && verifiables.every((l) => selection.has(l.pointageId!));

  function toggle(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleTout(on: boolean) {
    setSelection(on ? new Set(verifiables.map((l) => l.pointageId!)) : new Set());
  }

  function valider() {
    const ids = [...selection];
    if (ids.length === 0) return;
    setErreur(null);
    startTransition(async () => {
      const r = await marquerVerifies(ids);
      if (estErreur(r)) {
        setErreur(r.erreur);
        return;
      }
      setSelection(new Set());
    });
  }

  const n = selection.size;

  return (
    <div>
      {erreur && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {erreur}
        </p>
      )}

      {n > 0 && (
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
          <span className="text-sm font-medium">{n} sélectionné(s) :</span>
          <BoutonValider onClick={valider} disabled={isPending}>
            Marquer vérifié
          </BoutonValider>
          <button onClick={() => setSelection(new Set())} className="ml-auto text-xs text-muted-foreground underline">
            Tout désélectionner
          </button>
          {isPending && <span className="text-xs text-muted-foreground">Traitement…</span>}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
              <th className="w-8">
                <input
                  type="checkbox"
                  checked={tousCoches}
                  disabled={verifiables.length === 0}
                  onChange={(e) => toggleTout(e.target.checked)}
                  aria-label="Tout sélectionner — à vérifier"
                />
              </th>
              <th>Employé</th>
              <th>Arrivée</th>
              <th>Départ</th>
              <th className="text-right">Pause</th>
              <th className="text-right">Heures</th>
              <th>Source</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr
                key={l.employeeId}
                className={`border-t align-top ${l.pointageId && selection.has(l.pointageId) ? "bg-primary/5" : ""}`}
              >
                <td className="px-3 py-2">
                  {l.pointageId && l.aVerifier && (
                    <input
                      type="checkbox"
                      checked={selection.has(l.pointageId)}
                      onChange={() => toggle(l.pointageId!)}
                      aria-label={`Sélectionner ${l.nom}`}
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <EmployeeName id={l.employeeId} nom={l.nom} photoUrl={l.photoUrl} taille={26} />
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {l.arriveeLabel}
                  {l.badgeArrivee && <BadgeAVerifier texte={l.badgeArrivee} />}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  <span className={l.departLabel === "départ scanné, pause non saisie" ? "italic text-muted-foreground" : ""}>
                    {l.departLabel}
                  </span>
                  {l.badgeDepart && <BadgeAVerifier texte={l.badgeDepart} />}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.pauseLabel}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{l.heuresLabel}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{l.sourceLabel ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STATUT[l.statut]}`}>
                    {LABEL_STATUT[l.statut]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
