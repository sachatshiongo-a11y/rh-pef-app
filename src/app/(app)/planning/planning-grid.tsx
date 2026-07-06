"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saisirCreneau, saisirCreneauxEnLot } from "./actions";
import { paletteDe, libelleShift, type ShiftDTO } from "./creneaux";
import { Avatar } from "@/components/avatar";

export type EmployeeRow = { id: string; nom: string; photoUrl?: string | null };

export function PlanningGrid({
  employees,
  isoDates,
  labelsJours,
  creneauMap,
  shifts,
  peutModifier,
  joursMajores,
  isoAujourdhui,
}: {
  employees: EmployeeRow[];
  isoDates: string[];
  labelsJours: string[];
  creneauMap: Record<string, string>; // `${employeeId}_${iso}` -> shiftId
  shifts: ShiftDTO[];
  peutModifier: boolean;
  joursMajores: boolean[];
  isoAujourdhui: string;
}) {
  // Total d'employés planifiés par jour (colonne).
  const totauxJour = isoDates.map(
    (iso) => employees.filter((e) => creneauMap[`${e.id}_${iso}`]).length
  );
  const [isPending, startTransition] = useTransition();
  const tableRef = useRef<HTMLTableElement>(null);
  const parId = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  // Actions groupées : sélection d'employés + affectation d'un shift sur des jours ciblés.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [bulkShift, setBulkShift] = useState<string>(shifts[0]?.id ?? "");
  const [bulkJours, setBulkJours] = useState<Set<number>>(new Set(isoDates.map((_, i) => i)));
  function toggleEmp(id: string) {
    setSelection((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleJour(i: number) {
    setBulkJours((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }
  function appliquerBulk(shiftId: string) {
    const emps = [...selection];
    const jours = [...bulkJours];
    if (emps.length === 0 || jours.length === 0) return;
    const entrees: { employeeId: string; dateIso: string; shiftId: string }[] = [];
    for (const empId of emps)
      for (const ji of jours) {
        const iso = isoDates[ji];
        const sel = tableRef.current?.querySelector<HTMLSelectElement>(`select[data-emp="${empId}"][data-iso="${iso}"]`);
        if (sel) { sel.value = shiftId; couleur(sel, shiftId); }
        entrees.push({ employeeId: empId, dateIso: iso, shiftId });
      }
    startTransition(() => saisirCreneauxEnLot(entrees));
  }

  function couleur(el: HTMLSelectElement, shiftId: string) {
    const s = parId.get(shiftId);
    if (s) {
      const hex = paletteDe(s.couleur).hex;
      el.style.backgroundColor = hex.bg;
      el.style.color = hex.text;
    } else {
      el.style.backgroundColor = "";
      el.style.color = "";
    }
  }

  useEffect(() => {
    tableRef.current?.querySelectorAll<HTMLSelectElement>("select[data-emp]").forEach((s) => couleur(s, s.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creneauMap, shifts]);

  function celluleAt(rowIndex: number, colIndex: number) {
    const emp = employees[rowIndex];
    const iso = isoDates[colIndex];
    if (!emp || !iso) return null;
    return tableRef.current?.querySelector<HTMLSelectElement>(`select[data-emp="${emp.id}"][data-iso="${iso}"]`);
  }

  function handleChange(ev: React.ChangeEvent<HTMLSelectElement>, employeeId: string, iso: string, rowIndex: number, colIndex: number) {
    couleur(ev.target, ev.target.value);
    startTransition(() => saisirCreneau(employeeId, iso, ev.target.value));
    celluleAt(rowIndex + 1, colIndex)?.focus();
  }

  function handleKeyDown(ev: React.KeyboardEvent<HTMLSelectElement>, rowIndex: number, colIndex: number) {
    let cible: HTMLSelectElement | null | undefined;
    if (ev.key === "ArrowRight") cible = celluleAt(rowIndex, colIndex + 1);
    else if (ev.key === "ArrowLeft") cible = celluleAt(rowIndex, colIndex - 1);
    else if (ev.key === "ArrowDown" || ev.key === "Enter") cible = celluleAt(rowIndex + 1, colIndex);
    else if (ev.key === "ArrowUp") cible = celluleAt(rowIndex - 1, colIndex);
    else return;
    if (cible) {
      ev.preventDefault();
      cible.focus();
    }
  }

  return (
    <div>
      {peutModifier && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 text-sm">
          <span className="font-medium">{selection.size} employé(s)</span>
          <span className="text-muted-foreground">→ affecter</span>
          <select value={bulkShift} onChange={(e) => setBulkShift(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
            {shifts.map((s) => (<option key={s.id} value={s.id}>{libelleShift(s.nom, s.heureDebut, s.heureFin)}</option>))}
          </select>
          <span className="text-muted-foreground">sur</span>
          <div className="flex flex-wrap gap-1">
            {labelsJours.map((lbl, i) => (
              <label key={i} className={`cursor-pointer rounded border px-1.5 py-0.5 text-[11px] ${bulkJours.has(i) ? "border-primary bg-primary/10" : ""}`}>
                <input type="checkbox" className="sr-only" checked={bulkJours.has(i)} onChange={() => toggleJour(i)} />
                {lbl}
              </label>
            ))}
          </div>
          <button onClick={() => appliquerBulk(bulkShift)} disabled={isPending || selection.size === 0} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">Affecter</button>
          <button onClick={() => appliquerBulk("")} disabled={isPending || selection.size === 0} className="rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive disabled:opacity-50">Vider</button>
          <button onClick={() => setSelection(new Set())} className="text-xs text-muted-foreground underline">Désélectionner</button>
        </div>
      )}
    <div className="overflow-x-auto rounded-xl border">
      <table ref={tableRef} className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2">
              <span className="flex items-center gap-2">
                {peutModifier && (
                  <input type="checkbox" checked={employees.length > 0 && employees.every((e) => selection.has(e.id))} onChange={(e) => setSelection(e.target.checked ? new Set(employees.map((x) => x.id)) : new Set())} aria-label="Tout sélectionner" />
                )}
                Employé
              </span>
            </th>
            {labelsJours.map((lbl, i) => (
              <th
                key={isoDates[i]}
                className={`px-2 py-2 text-center font-normal ${
                  isoDates[i] === isoAujourdhui ? "bg-primary/10 text-primary" : joursMajores[i] ? "bg-orange-100" : ""
                }`}
              >
                {lbl}
                {isoDates[i] === isoAujourdhui && <span className="ml-1 text-[10px] font-semibold">• auj.</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((e, rowIndex) => (
            <tr key={e.id} className="border-t">
              <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-1.5">
                <span className="flex items-center gap-2">
                  {peutModifier && (
                    <input type="checkbox" checked={selection.has(e.id)} onChange={() => toggleEmp(e.id)} aria-label={`Sélectionner ${e.nom}`} />
                  )}
                  <Link href={`/employes/${e.id}`} className="flex items-center gap-2 hover:text-primary hover:underline">
                    <Avatar nom={e.nom} taille={26} photoUrl={e.photoUrl} />
                    {e.nom}
                  </Link>
                </span>
              </td>
              {isoDates.map((iso, colIndex) => {
                const value = creneauMap[`${e.id}_${iso}`] ?? "";
                return (
                  <td
                    key={iso}
                    className={`p-1 text-center ${
                      iso === isoAujourdhui ? "bg-primary/5" : joursMajores[colIndex] ? "bg-orange-50" : ""
                    }`}
                  >
                    <select
                      disabled={!peutModifier}
                      defaultValue={value}
                      data-emp={e.id}
                      data-iso={iso}
                      onChange={(ev) => handleChange(ev, e.id, iso, rowIndex, colIndex)}
                      onKeyDown={(ev) => handleKeyDown(ev, rowIndex, colIndex)}
                      className="w-full min-w-24 cursor-pointer rounded border border-transparent px-1 py-1 text-center text-xs font-medium hover:border-input focus:border-input disabled:cursor-default disabled:opacity-70"
                    >
                      <option value="">—</option>
                      {shifts.map((s) => (
                        <option key={s.id} value={s.id}>
                          {libelleShift(s.nom, s.heureDebut, s.heureFin)}
                        </option>
                      ))}
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30">
            <td className="sticky left-0 z-10 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Planifiés / jour
            </td>
            {totauxJour.map((n, i) => (
              <td
                key={isoDates[i]}
                className={`px-2 py-1.5 text-center text-xs font-semibold ${
                  isoDates[i] === isoAujourdhui ? "bg-primary/5" : ""
                }`}
              >
                {n}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      {isPending && <p className="p-2 text-xs text-muted-foreground">Enregistrement...</p>}
    </div>
    </div>
  );
}
