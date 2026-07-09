"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { saisirHeures, saisirHeuresEnLot } from "./actions";
import { numeroSemaineDuMois, type DetailSemaineHS } from "@/lib/payroll";

export type EmployeeRow = {
  id: string;
  nom: string;
  heuresParJour: number;
  photoUrl?: string | null;
};

export type ResumeHS = {
  heuresTotalesMois: number;
  totalHS: number;
  hs30: number;
  hs60: number;
  hs100: number;
  hsValorisee: number;
};

// Couleurs de valorisation : 30% (ambre clair), 60% (orange). Le 100% (dimanche/férié) reprend
// le même orange que la surbrillance des jours fériés/dimanches de l'onglet Présences.
const COULEUR_30 = "bg-amber-100";
const COULEUR_60 = "bg-orange-200";
const COULEUR_100 = "bg-orange-300";

export function HoursGrid({
  employees,
  days,
  hoursMap,
  resumes,
  semainesParEmploye,
  peutModifier,
  isoDates,
  joursFeries,
}: {
  employees: EmployeeRow[];
  days: number[];
  hoursMap: Record<string, number>; // key `${employeeId}_${day}` -> heures
  resumes: Record<string, ResumeHS>;
  semainesParEmploye: Record<string, DetailSemaineHS[]>;
  peutModifier: boolean;
  isoDates: string[];
  joursFeries: Set<string>;
}) {
  const [isPending, startTransition] = useTransition();
  const tableRef = useRef<HTMLTableElement>(null);

  // Sélection d'employés pour les actions groupées (appliquer / supprimer sur des jours).
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [bulkScope, setBulkScope] = useState<"mois" | "ouvrables" | "feries" | "alternes" | "jour">(
    "jour"
  );
  const [bulkJour, setBulkJour] = useState<string>("");
  const [bulkAlterneDebut, setBulkAlterneDebut] = useState<string>("1");
  const [bulkHeures, setBulkHeures] = useState<string>("");

  // Vue mobile « jour par jour » : jour choisi (défaut = aujourd'hui) + miroir des saisies.
  const isoAuj = new Date().toISOString().slice(0, 10);
  const idxAuj = isoDates.indexOf(isoAuj);
  const [jourMobile, setJourMobile] = useState<number>(idxAuj >= 0 ? days[idxAuj] : days[0] ?? 1);
  const [editsMobile, setEditsMobile] = useState<Record<string, string>>({});
  const heureDe = (empId: string, day: number) => {
    const k = `${empId}_${day}`;
    return editsMobile[k] ?? (hoursMap[k] ? String(hoursMap[k]) : "");
  };
  const onMobileChange = (empId: string, value: string) => {
    setEditsMobile((x) => ({ ...x, [`${empId}_${jourMobile}`]: value }));
    handleChange(empId, jourMobile, value);
  };

  function toggleEmp(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  const estDimanche = (d: number) =>
    new Date(isoDates[d - 1] + "T00:00:00Z").getUTCDay() === 0;
  const estFerie = (d: number) => joursFeries.has(isoDates[d - 1]);

  function joursCibles(): number[] {
    if (bulkScope === "jour")
      return bulkJour
        .split(/[,\s]+/)
        .map(Number)
        .filter((j) => Number.isInteger(j) && j >= 1 && j <= days.length);
    if (bulkScope === "ouvrables")
      return days.filter((d) => !estDimanche(d) && !estFerie(d));
    if (bulkScope === "feries") return days.filter((d) => estFerie(d));
    if (bulkScope === "alternes") {
      const debut = Math.max(1, Number(bulkAlterneDebut) || 1);
      return days.filter((d) => d >= debut && (d - debut) % 2 === 0 && !estDimanche(d));
    }
    return [...days];
  }
  function appliquerBulk(heures: string) {
    const emps = [...selection];
    const cibles = joursCibles();
    if (emps.length === 0 || cibles.length === 0) return;
    const entrees: { employeeId: string; date: string; heures: string }[] = [];
    for (const empId of emps) {
      for (const jour of cibles) {
        const input = tableRef.current?.querySelector<HTMLInputElement>(
          `input[data-emp="${empId}"][data-day="${jour}"]`
        );
        if (input) input.value = heures === "" ? "" : heures;
        entrees.push({ employeeId: empId, date: isoDates[jour - 1], heures });
      }
    }
    startTransition(() => saisirHeuresEnLot(entrees));
  }

  function handleChange(employeeId: string, day: number, value: string) {
    const date = isoDates[day - 1];
    startTransition(() => {
      saisirHeures(employeeId, date, value);
    });
  }

  function estSpecial(day: number) {
    const iso = isoDates[day - 1];
    const estDimanche = new Date(iso + "T00:00:00Z").getUTCDay() === 0;
    return estDimanche || joursFeries.has(iso);
  }

  function celluleAt(rowIndex: number, colIndex: number) {
    const emp = employees[rowIndex];
    const jour = days[colIndex];
    if (!emp || !jour) return null;
    return tableRef.current?.querySelector<HTMLInputElement>(
      `input[data-emp="${emp.id}"][data-day="${jour}"]`
    );
  }

  /** Navigation façon tableur : flèches pour se déplacer entre les cases. */
  function handleKeyDown(ev: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    let cible: HTMLInputElement | null | undefined;
    if (ev.key === "ArrowRight") cible = celluleAt(rowIndex, colIndex + 1);
    else if (ev.key === "ArrowLeft") cible = celluleAt(rowIndex, colIndex - 1);
    else if (ev.key === "ArrowDown" || ev.key === "Enter") cible = celluleAt(rowIndex + 1, colIndex);
    else if (ev.key === "ArrowUp") cible = celluleAt(rowIndex - 1, colIndex);
    else return;

    if (cible) {
      ev.preventDefault();
      cible.focus();
      cible.select();
    }
  }

  /** Couleur de la case : surbrillance dimanche/férié (comme Présences) avec accent renforcé si
   * dépassement (100%), sinon selon la tranche hebdomadaire atteinte (30% ou 60%). */
  function couleurCase(employeeId: string, day: number, heures: number, heuresParJourContrat: number) {
    if (estSpecial(day)) {
      return heures > heuresParJourContrat ? COULEUR_100 : "bg-orange-50";
    }
    const semaine = numeroSemaineDuMois(new Date(isoDates[day - 1] + "T00:00:00Z"));
    const detail = semainesParEmploye[employeeId]?.find((s) => s.semaine === semaine);
    if (!detail) return "";
    if (detail.hs60 > 0) return COULEUR_60;
    if (detail.hs30 > 0) return COULEUR_30;
    return "";
  }

  /** Colle un bloc copié depuis un tableur (Excel, Google Sheets...) sur plusieurs jours/employés. */
  function handlePaste(ev: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    ev.preventDefault();
    const texte = ev.clipboardData.getData("text");

    const lignes = texte.replace(/\r/g, "").split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
    const entrees: { employeeId: string; date: string; heures: string }[] = [];

    lignes.forEach((ligne, ligneOffset) => {
      const cellules = ligne.split("\t");
      cellules.forEach((cellule, colOffset) => {
        const cible = employees[rowIndex + ligneOffset];
        const jour = days[colIndex + colOffset];
        if (!cible || !jour) return;

        const brut = cellule.trim().replace(",", ".");
        if (brut !== "" && Number.isNaN(Number(brut))) return;

        const input = tableRef.current?.querySelector<HTMLInputElement>(
          `input[data-emp="${cible.id}"][data-day="${jour}"]`
        );
        if (input) input.value = brut;

        entrees.push({ employeeId: cible.id, date: isoDates[jour - 1], heures: brut });
      });
    });

    if (entrees.length > 0) {
      startTransition(() => {
        saisirHeuresEnLot(entrees);
      });
    }
  }

  return (
    <div>
      {/* Mobile : saisie « jour par jour » (mêmes heures enregistrées que la grille). */}
      <div className="lg:hidden">
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={() => setJourMobile((j) => Math.max(days[0], j - 1))} className="rounded-md border px-3 py-2 text-sm" aria-label="Jour précédent">◀</button>
          <select value={jourMobile} onChange={(e) => setJourMobile(Number(e.target.value))} className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium">
            {days.map((d) => (
              <option key={d} value={d}>
                {new Date(isoDates[d - 1] + "T00:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
                {estFerie(d) ? " · férié" : estDimanche(d) ? " · dimanche" : ""}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setJourMobile((j) => Math.min(days[days.length - 1], j + 1))} className="rounded-md border px-3 py-2 text-sm" aria-label="Jour suivant">▶</button>
        </div>
        <div className="space-y-2">
          {employees.map((emp) => (
            <div key={emp.id} className="flex items-center gap-3 rounded-xl border bg-card p-2.5">
              <Avatar nom={emp.nom} taille={36} photoUrl={emp.photoUrl} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{emp.nom}</div>
                <div className="text-xs text-muted-foreground">{emp.heuresParJour} h/jour (contrat)</div>
              </div>
              {peutModifier ? (
                <input
                  type="number" step="0.5" min="0" inputMode="decimal"
                  value={heureDe(emp.id, jourMobile)}
                  onChange={(e) => onMobileChange(emp.id, e.target.value)}
                  placeholder="0"
                  className="w-20 rounded-md border border-input bg-background px-2 py-2 text-right text-sm font-semibold"
                />
              ) : (
                <span className="w-14 text-right font-semibold tabular-nums">{heureDe(emp.id, jourMobile) || "—"}</span>
              )}
              <span className="text-xs text-muted-foreground">h</span>
            </div>
          ))}
          {employees.length === 0 && <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun employé.</p>}
        </div>
        {isPending && <p className="mt-2 text-xs text-muted-foreground">Enregistrement…</p>}
      </div>

      {/* Ordinateur : grille complète + actions groupées. */}
      <div className="hidden lg:block">
      {peutModifier && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm">
          <span className="font-medium">{selection.size} employé(s) sélectionné(s)</span>
          <span className="text-muted-foreground">→ sur</span>
          <select
            value={bulkScope}
            onChange={(e) =>
              setBulkScope(e.target.value as "mois" | "ouvrables" | "feries" | "alternes" | "jour")
            }
            className="rounded border border-input bg-background px-2 py-1 text-xs"
          >
            <option value="jour">jours précis</option>
            <option value="ouvrables">jours ouvrables (hors dimanche et fériés)</option>
            <option value="feries">jours fériés uniquement</option>
            <option value="alternes">1 jour sur 2</option>
            <option value="mois">tout le mois</option>
          </select>
          {bulkScope === "jour" && (
            <input type="text" value={bulkJour} onChange={(e) => setBulkJour(e.target.value)} placeholder="ex. 3, 5, 12" className="w-24 rounded border border-input bg-background px-2 py-1 text-xs" />
          )}
          {bulkScope === "alternes" && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              à partir du jour
              <input
                type="number"
                min="1"
                max={days.length}
                value={bulkAlterneDebut}
                onChange={(e) => setBulkAlterneDebut(e.target.value)}
                className="w-14 rounded border border-input bg-background px-2 py-1 text-xs"
              />
            </label>
          )}
          <span className="text-muted-foreground">heures</span>
          <input type="number" step="0.5" min="0" max="24" value={bulkHeures} onChange={(e) => setBulkHeures(e.target.value)} placeholder="ex. 8" className="w-16 rounded border border-input bg-background px-2 py-1 text-xs" />
          <button
            onClick={() => appliquerBulk(bulkHeures)}
            disabled={isPending || selection.size === 0 || bulkHeures === ""}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Appliquer
          </button>
          <button
            onClick={() => appliquerBulk("")}
            disabled={isPending || selection.size === 0}
            className="rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive disabled:opacity-50"
            title="Effacer les heures des employés sélectionnés sur les jours ciblés"
          >
            Supprimer
          </button>
          <button onClick={() => setSelection(new Set())} className="text-xs text-muted-foreground underline">
            Désélectionner
          </button>
          {isPending && <span className="text-xs text-muted-foreground">Enregistrement…</span>}
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
      <table ref={tableRef} className="text-sm">
        <thead className="sticky top-0 z-20 bg-muted text-left">
          <tr>
            <th className="sticky left-0 z-30 bg-muted px-3 py-2">
              <span className="flex items-center gap-2">
                {peutModifier && (
                  <input
                    type="checkbox"
                    checked={employees.length > 0 && employees.every((e) => selection.has(e.id))}
                    onChange={(e) => setSelection(e.target.checked ? new Set(employees.map((x) => x.id)) : new Set())}
                    aria-label="Tout sélectionner"
                  />
                )}
                Employé
              </span>
            </th>
            {days.map((d) => (
              <th
                key={d}
                className={`w-11 px-1 py-2 text-center ${estSpecial(d) ? "bg-orange-100" : ""}`}
                title={estSpecial(d) ? "Dimanche ou jour férié — majoration 100%" : undefined}
              >
                {d}
              </th>
            ))}
            <th className="px-2 py-2 text-center">H.totales</th>
            <th className="px-2 py-2 text-center">HS 30%</th>
            <th className="px-2 py-2 text-center">HS 60%</th>
            <th className="px-2 py-2 text-center">HS 100%</th>
            <th className="px-2 py-2 text-center">HS valorisées $</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e, rowIndex) => {
            const resume = resumes[e.id] ?? {
              heuresTotalesMois: 0,
              totalHS: 0,
              hs30: 0,
              hs60: 0,
              hs100: 0,
              hsValorisee: 0,
            };
            return (
              <tr key={e.id} className="border-t">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    {peutModifier && (
                      <input
                        type="checkbox"
                        checked={selection.has(e.id)}
                        onChange={() => toggleEmp(e.id)}
                        aria-label={`Sélectionner ${e.nom}`}
                      />
                    )}
                    <Avatar nom={e.nom} taille={24} photoUrl={e.photoUrl} />
                    <Link href={`/employes/${e.id}`} className="hover:text-primary hover:underline">
                      {e.nom}
                    </Link>
                  </span>
                </td>
                {days.map((d, colIndex) => {
                  const key = `${e.id}_${d}`;
                  const value = hoursMap[key] ?? "";
                  return (
                    <td
                      key={d}
                      className={`p-0.5 text-center ${couleurCase(e.id, d, Number(value) || 0, e.heuresParJour)}`}
                    >
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="24"
                        disabled={!peutModifier}
                        defaultValue={value === 0 ? "" : value}
                        data-emp={e.id}
                        data-day={d}
                        onBlur={(ev) => handleChange(e.id, d, ev.target.value)}
                        onKeyDown={(ev) => handleKeyDown(ev, rowIndex, colIndex)}
                        onPaste={(ev) => handlePaste(ev, rowIndex, colIndex)}
                        className="w-11 rounded border border-transparent bg-transparent text-center text-xs hover:border-input disabled:opacity-60"
                      />
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center font-medium">{resume.heuresTotalesMois}</td>
                <td className="px-2 py-1.5 text-center">{resume.hs30}</td>
                <td className="px-2 py-1.5 text-center">{resume.hs60}</td>
                <td className="px-2 py-1.5 text-center">{resume.hs100}</td>
                <td className="px-2 py-1.5 text-center font-medium">
                  {resume.hsValorisee.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-3 border-t p-2 text-xs">
        <span className={`rounded px-2 py-0.5 ${COULEUR_30}`}>Heures supp. à 30%</span>
        <span className={`rounded px-2 py-0.5 ${COULEUR_60}`}>Heures supp. à 60%</span>
        <span className={`rounded px-2 py-0.5 ${COULEUR_100}`}>Heures supp. à 100%</span>
        <span className="rounded bg-orange-100 px-2 py-0.5">Colonne = dimanche ou jour férié</span>
      </div>
      {isPending && <p className="p-2 text-xs text-muted-foreground">Enregistrement...</p>}
      </div>
      </div>
    </div>
  );
}
