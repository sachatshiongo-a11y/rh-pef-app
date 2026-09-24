"use client";

import { useCallback, useState } from "react";
import { definirBesoin } from "./actions";
import { CelluleNombre, type ContexteCase } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";

// Colonnes lundi→dimanche ; valeur = jourSemaine (0=dim … 6=sam).
const COLONNES: { label: string; dow: number }[] = [
  { label: "Lun", dow: 1 },
  { label: "Mar", dow: 2 },
  { label: "Mer", dow: 3 },
  { label: "Jeu", dow: 4 },
  { label: "Ven", dow: 5 },
  { label: "Sam", dow: 6 },
  { label: "Dim", dow: 0 },
];

type BesoinDTO = { shiftId: string; poste: string; jourSemaine: number; nombreRequis: number };

export function BesoinsManager({
  shifts,
  postes,
  besoins,
}: {
  shifts: { id: string; nom: string }[];
  postes: string[];
  besoins: BesoinDTO[];
}) {
  const [enCours, setEnCours] = useState(0);
  const [vals, setVals] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const b of besoins) m[`${b.shiftId}_${b.poste}_${b.jourSemaine}`] = b.nombreRequis;
    return m;
  });

  // Enregistré à la sortie de la case (tableur partagé) — avant : une action serveur, et un
  // rechargement de tout /planning, à CHAQUE frappe. Ligne de case = « shiftId|poste ».
  const enregistrer = useCallback(async (v: number | null, { ligne, col }: ContexteCase) => {
    const sep = ligne.indexOf("|");
    const shiftId = ligne.slice(0, sep), poste = ligne.slice(sep + 1), dow = COLONNES[col].dow;
    setEnCours((n) => n + 1);
    try {
      await definirBesoin(shiftId, poste, dow, v ?? 0);
      setVals((p) => ({ ...p, [`${shiftId}_${poste}_${dow}`]: v ?? 0 }));
    } finally {
      setEnCours((n) => n - 1);
    }
  }, []);

  if (shifts.length === 0 || postes.length === 0) return null;

  return (
    <details className="rounded-xl border bg-card p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Effectifs requis par shift {enCours > 0 && <span className="text-xs text-muted-foreground">· enregistrement…</span>}
      </summary>
      <p className="mt-1 text-xs text-muted-foreground">
        Nombre de personnes à planifier par poste et par jour, pour chaque shift. La génération
        automatique remplit chaque shift jusqu&apos;à ce nombre (en priorité), en équilibrant les
        salariés disponibles. Laisser vide ou 0 = pas de besoin.
      </p>
      <div className="mt-3 space-y-5">
        {shifts.map((s) => (
          <div key={s.id}>
            <div className="mb-1 text-sm font-semibold">{s.nom}</div>
            <ZoneTableur>
            <div className="max-h-[70vh] overflow-auto">
              <table data-tableur="" className="text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium">Poste</th>
                    {COLONNES.map((c) => (
                      <th key={c.dow} className="w-12 px-1 py-1 text-center font-medium">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {postes.map((p) => (
                    <tr key={p} className="border-t">
                      <td className="whitespace-nowrap px-2 py-1">{p}</td>
                      {COLONNES.map((c) => (
                        <td key={c.dow} className="px-1 py-1 text-center">
                          <CelluleNombre
                            ligne={`${s.id}|${p}`}
                            col={COLONNES.indexOf(c)}
                            valeur={vals[`${s.id}_${p}_${c.dow}`] ?? null}
                            onEnregistrer={enregistrer}
                            min={0}
                            entier
                            placeholder="0"
                            aria-label={`${s.nom} — ${p} — ${c.label}`}
                            className="w-11 rounded border border-input bg-background px-1 py-1 text-center outline-none focus:ring-2 focus:ring-ring"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </ZoneTableur>
          </div>
        ))}
      </div>
    </details>
  );
}
