"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { saisirModele } from "./actions";
import { libelleShift, dureeShift, type ShiftDTO } from "./creneaux";

const COUCHES = [
  { v: 0, l: "Chaque semaine" },
  { v: 1, l: "Semaine A" },
  { v: 2, l: "Semaine B" },
];

const money = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
// Nombre moyen de semaines par mois (52 / 12) pour l'estimation mensuelle.
const SEMAINES_PAR_MOIS = 52 / 12;

const JOURS = [
  { v: 1, l: "Lundi" },
  { v: 2, l: "Mardi" },
  { v: 3, l: "Mercredi" },
  { v: 4, l: "Jeudi" },
  { v: 5, l: "Vendredi" },
  { v: 6, l: "Samedi" },
  { v: 0, l: "Dimanche" },
];

export type ModeleEmployee = { id: string; nom: string; photoUrl?: string | null };

/**
 * Éditeur du modèle hebdomadaire par employé : pour chaque jour de la semaine, le shift/rôle
 * habituel. Gère les rôles variables (ex. serveuse lun/mer/ven, assistante admin mar/jeu) et les
 * rythmes fixes (un jour sur deux = ne remplir que certains jours). Alimente la génération auto.
 */
export function ModeleGrid({
  employees,
  shifts,
  modeleMap,
  tauxDefautParEmp,
  peutModifier,
}: {
  employees: ModeleEmployee[];
  shifts: ShiftDTO[];
  modeleMap: Record<string, string>; // `${employeeId}_${jour}_${semaine}` -> shiftId
  tauxDefautParEmp: Record<string, number>; // taux horaire par défaut de l'employé
  peutModifier: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [couche, setCouche] = useState(0); // 0 = chaque semaine, 1 = A, 2 = B
  const shiftParId = new Map(shifts.map((s) => [s.id, s]));

  // Shift affiché pour un jour dans la couche courante : la couche A/B sinon repli « chaque semaine ».
  const shiftJour = (employeeId: string, jour: number): string =>
    modeleMap[`${employeeId}_${jour}_${couche}`] ?? (couche !== 0 ? modeleMap[`${employeeId}_${jour}_0`] ?? "" : "");

  /** Heures + rémunération hebdomadaires théoriques d'un employé pour la couche affichée. */
  function totalSemaine(employeeId: string): { heures: number; montant: number } {
    const tauxDefaut = tauxDefautParEmp[employeeId] ?? 0;
    let heures = 0;
    let montant = 0;
    for (const j of [1, 2, 3, 4, 5, 6, 0]) {
      const shiftId = shiftJour(employeeId, j);
      if (!shiftId) continue;
      const s = shiftParId.get(shiftId);
      if (!s) continue;
      const h = dureeShift(s);
      heures += h;
      montant += h * (s.tauxHoraireUSD ?? tauxDefaut);
    }
    return { heures: Math.round(heures * 100) / 100, montant };
  }

  return (
    <div>
    <div className="mb-3 flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Couche :</span>
      <div className="flex overflow-hidden rounded-md border">
        {COUCHES.map((c) => (
          <button
            key={c.v}
            onClick={() => setCouche(c.v)}
            className={`px-3 py-1.5 ${couche === c.v ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {c.l}
          </button>
        ))}
      </div>
      {couche !== 0 && (
        <span className="text-xs text-muted-foreground">
          Bi-hebdomadaire : ce que vous mettez ici ne s&apos;applique qu&apos;aux semaines {couche === 1 ? "A" : "B"} (repli sur « chaque semaine » si vide).
        </span>
      )}
    </div>
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2">Employé</th>
            {JOURS.map((j) => (
              <th key={j.v} className={`px-2 py-2 text-center font-normal ${j.v === 0 ? "bg-orange-100" : ""}`}>
                {j.l}
              </th>
            ))}
            <th className="px-2 py-2 text-right">H/sem</th>
            <th className="px-2 py-2 text-right">Rémun./sem</th>
            <th className="px-2 py-2 text-right">Estim./mois</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id} className="border-t">
              <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-1.5">
                <Link href={`/employes/${e.id}`} className="flex items-center gap-2 hover:text-primary hover:underline">
                  <Avatar nom={e.nom} taille={26} photoUrl={e.photoUrl} />
                  {e.nom}
                </Link>
              </td>
              {JOURS.map((j) => {
                const value = shiftJour(e.id, j.v);
                return (
                  <td key={j.v} className={`p-1 text-center ${j.v === 0 ? "bg-orange-50" : ""}`}>
                    <select
                      key={`${e.id}_${j.v}_${couche}`}
                      disabled={!peutModifier}
                      defaultValue={value}
                      onChange={(ev) => startTransition(() => saisirModele(e.id, j.v, ev.target.value, couche))}
                      className="w-full min-w-24 cursor-pointer rounded border border-transparent px-1 py-1 text-center text-xs hover:border-input focus:border-input disabled:opacity-70"
                    >
                      <option value="">— repos —</option>
                      {shifts.map((s) => (
                        <option key={s.id} value={s.id}>
                          {libelleShift(s.nom, s.heureDebut, s.heureFin)}
                        </option>
                      ))}
                    </select>
                  </td>
                );
              })}
              {(() => {
                const t = totalSemaine(e.id);
                return (
                  <>
                    <td className="px-2 py-1.5 text-right font-medium">{t.heures} h</td>
                    <td className="px-2 py-1.5 text-right font-medium">{money(t.montant)}</td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">{money(t.montant * SEMAINES_PAR_MOIS)}</td>
                  </>
                );
              })()}
            </tr>
          ))}
          {employees.length === 0 && (
            <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">Aucun employé actif.</td></tr>
          )}
        </tbody>
      </table>
      {isPending && <p className="p-2 text-xs text-muted-foreground">Enregistrement…</p>}
    </div>
    </div>
  );
}
