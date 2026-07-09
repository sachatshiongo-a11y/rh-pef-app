"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { saisirPresence, saisirPresencesEnLot } from "./actions";
import { COULEUR_CODE_HEX } from "./attendance-colors";
import { useJourMobile } from "@/components/jour-mobile";
import type { AttendanceCode } from "@prisma/client";
import type { CodePresence } from "@/lib/payroll";

const CODES: AttendanceCode[] = ["P", "O", "M", "A", "N", "C", "F", "S"];
const CODES_SET = new Set<string>(CODES);

export type EmployeeRow = {
  id: string;
  matricule: string;
  nom: string;
  photoUrl?: string | null;
};

export type ResumeParEmploye = Record<
  string,
  { payes100: number; payes2_3: number; nonPayes: number; totalPresence: number }
>;

function appliquerCouleur(el: HTMLSelectElement, code: string) {
  const couleur = COULEUR_CODE_HEX[code as CodePresence];
  if (couleur) {
    el.style.backgroundColor = couleur.bg;
    el.style.color = couleur.text;
  } else {
    el.style.backgroundColor = "";
    el.style.color = "";
  }
}

export function AttendanceGrid({
  employees,
  days,
  attendanceMap,
  resumes,
  peutModifier,
  isoDates,
  joursFeries,
}: {
  employees: EmployeeRow[];
  days: number[];
  attendanceMap: Record<string, string>; // key `${employeeId}_${day}` -> code
  resumes: ResumeParEmploye;
  peutModifier: boolean;
  isoDates: string[]; // isoDates[day-1] = "YYYY-MM-DD"
  joursFeries: Set<string>;
}) {
  const [isPending, startTransition] = useTransition();
  const tableRef = useRef<HTMLTableElement>(null);

  // Sélection d'employés pour les actions groupées.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [bulkCode, setBulkCode] = useState<string>("P");
  const [bulkScope, setBulkScope] = useState<"mois" | "ouvrables" | "feries" | "alternes" | "jour">(
    "mois"
  );
  const [bulkJour, setBulkJour] = useState<string>("1");
  const [bulkAlterneDebut, setBulkAlterneDebut] = useState<string>("1");

  // Vue mobile « jour par jour » : index du jour PARTAGÉ entre les grilles de la page (un seul
  // sélecteur), + miroir local des saisies pour afficher la valeur à jour quand on change de jour.
  const isoAuj = new Date().toISOString().slice(0, 10);
  const idxAuj = isoDates.indexOf(isoAuj);
  const [idxMobile, setIdxMobile] = useJourMobile(idxAuj >= 0 ? idxAuj : 0);
  const jourMobile = days[idxMobile] ?? days[0] ?? 1;
  const [editsMobile, setEditsMobile] = useState<Record<string, string>>({});
  const codeDe = (empId: string, day: number) =>
    editsMobile[`${empId}_${day}`] ?? attendanceMap[`${empId}_${day}`] ?? "";
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
    if (bulkScope === "jour") {
      // Accepte plusieurs jours précis, ex. « 3, 5, 12 ».
      return bulkJour
        .split(/[,\s]+/)
        .map(Number)
        .filter((j) => Number.isInteger(j) && j >= 1 && j <= days.length);
    }
    if (bulkScope === "ouvrables")
      // Jours ouvrables : ni dimanche, ni jour férié.
      return days.filter((d) => !estDimanche(d) && !estFerie(d));
    if (bulkScope === "feries") return days.filter((d) => estFerie(d));
    if (bulkScope === "alternes") {
      // Un jour sur deux à partir du jour choisi (N, N+2, N+4…), en sautant les dimanches.
      const debut = Math.max(1, Number(bulkAlterneDebut) || 1);
      return days.filter((d) => d >= debut && (d - debut) % 2 === 0 && !estDimanche(d));
    }
    return [...days];
  }
  function appliquerBulk(code: AttendanceCode | "") {
    const emps = [...selection];
    const cibles = joursCibles();
    if (emps.length === 0 || cibles.length === 0) return;
    const entrees: { employeeId: string; date: string; code: AttendanceCode | "" }[] = [];
    for (const empId of emps) {
      for (const jour of cibles) {
        const select = tableRef.current?.querySelector<HTMLSelectElement>(
          `select[data-emp="${empId}"][data-day="${jour}"]`
        );
        if (select) {
          select.value = code;
          appliquerCouleur(select, code);
        }
        entrees.push({ employeeId: empId, date: isoDates[jour - 1], code });
      }
    }
    startTransition(() => saisirPresencesEnLot(entrees));
  }

  // Colore chaque case selon son code initial au premier rendu.
  useEffect(() => {
    const selects = tableRef.current?.querySelectorAll<HTMLSelectElement>("select[data-emp]");
    selects?.forEach((select) => appliquerCouleur(select, select.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceMap]);

  function estMajore(day: number) {
    const iso = isoDates[day - 1];
    const estDimanche = new Date(iso + "T00:00:00Z").getUTCDay() === 0;
    return estDimanche || joursFeries.has(iso);
  }

  function handleChange(employeeId: string, day: number, value: string) {
    const date = isoDates[day - 1];
    startTransition(() => {
      saisirPresence(employeeId, date, value as AttendanceCode | "");
    });
  }

  function celluleAt(rowIndex: number, colIndex: number) {
    const emp = employees[rowIndex];
    const jour = days[colIndex];
    if (!emp || !jour) return null;
    return tableRef.current?.querySelector<HTMLSelectElement>(
      `select[data-emp="${emp.id}"][data-day="${jour}"]`
    );
  }

  function handleSelect(
    ev: React.ChangeEvent<HTMLSelectElement>,
    employeeId: string,
    day: number,
    rowIndex: number,
    colIndex: number
  ) {
    const valeur = ev.target.value;
    appliquerCouleur(ev.target, valeur);
    handleChange(employeeId, day, valeur);
    // Avance automatiquement au jour suivant pour une saisie fluide, comme un tableur.
    celluleAt(rowIndex, colIndex + 1)?.focus();
  }

  /** Navigation façon tableur : flèches pour se déplacer entre les cases. */
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

  /** Colle un bloc copié depuis un tableur (Excel, Google Sheets...) sur plusieurs jours/employés. */
  function handlePaste(ev: React.ClipboardEvent<HTMLSelectElement>, rowIndex: number, colIndex: number) {
    ev.preventDefault();
    const texte = ev.clipboardData.getData("text");

    const lignes = texte.replace(/\r/g, "").split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
    const entrees: { employeeId: string; date: string; code: AttendanceCode | "" }[] = [];

    lignes.forEach((ligne, ligneOffset) => {
      const cellules = ligne.split("\t");
      cellules.forEach((cellule, colOffset) => {
        const cible = employees[rowIndex + ligneOffset];
        const jour = days[colIndex + colOffset];
        if (!cible || !jour) return;

        const valeur = cellule.trim().toUpperCase();
        if (valeur !== "" && !CODES_SET.has(valeur)) return;

        const select = celluleAt(rowIndex + ligneOffset, colIndex + colOffset);
        if (select) {
          select.value = valeur;
          appliquerCouleur(select, valeur);
        }

        entrees.push({ employeeId: cible.id, date: isoDates[jour - 1], code: valeur as AttendanceCode | "" });
      });
    });

    if (entrees.length > 0) {
      startTransition(() => {
        saisirPresencesEnLot(entrees);
      });
    }
  }

  return (
    <div>
      {/* Mobile : saisie « jour par jour » (même enregistrement que la grille). */}
      <div className="lg:hidden">
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={() => setIdxMobile(Math.max(0, idxMobile - 1))} className="rounded-md border px-3 py-2 text-sm" aria-label="Jour précédent">◀</button>
          <select value={idxMobile} onChange={(e) => setIdxMobile(Number(e.target.value))} className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium">
            {days.map((d, i) => (
              <option key={d} value={i}>
                {new Date(isoDates[d - 1] + "T00:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
                {estFerie(d) ? " · férié" : estDimanche(d) ? " · dimanche" : ""}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setIdxMobile(Math.min(days.length - 1, idxMobile + 1))} className="rounded-md border px-3 py-2 text-sm" aria-label="Jour suivant">▶</button>
        </div>
        <div className="space-y-2">
          {employees.map((emp) => (
            <div key={emp.id} className="flex items-center gap-3 rounded-xl border bg-card p-2.5">
              <Avatar nom={emp.nom} taille={36} photoUrl={emp.photoUrl} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{emp.nom}</div>
                <div className="font-mono text-xs text-muted-foreground">{emp.matricule}</div>
              </div>
              {peutModifier ? (
                <select
                  value={codeDe(emp.id, jourMobile)}
                  onChange={(e) => onMobileChange(emp.id, e.target.value)}
                  className="w-20 rounded-md border border-input bg-background px-2 py-2 text-center text-sm font-semibold"
                  style={COULEUR_CODE_HEX[codeDe(emp.id, jourMobile) as CodePresence] ? { backgroundColor: COULEUR_CODE_HEX[codeDe(emp.id, jourMobile) as CodePresence].bg, color: COULEUR_CODE_HEX[codeDe(emp.id, jourMobile) as CodePresence].text } : undefined}
                >
                  <option value="">—</option>
                  {CODES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              ) : (
                <span className="w-10 text-center font-semibold">{codeDe(emp.id, jourMobile) || "—"}</span>
              )}
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
          <span className="text-muted-foreground">→ appliquer</span>
          <select value={bulkCode} onChange={(e) => setBulkCode(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
            {CODES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
          <span className="text-muted-foreground">sur</span>
          <select
            value={bulkScope}
            onChange={(e) =>
              setBulkScope(e.target.value as "mois" | "ouvrables" | "feries" | "alternes" | "jour")
            }
            className="rounded border border-input bg-background px-2 py-1 text-xs"
          >
            <option value="mois">tout le mois</option>
            <option value="ouvrables">jours ouvrables (hors dimanche et fériés)</option>
            <option value="feries">jours fériés uniquement</option>
            <option value="alternes">1 jour sur 2</option>
            <option value="jour">jours précis</option>
          </select>
          {bulkScope === "jour" && (
            <input
              type="text"
              value={bulkJour}
              onChange={(e) => setBulkJour(e.target.value)}
              placeholder="ex. 3, 5, 12"
              className="w-24 rounded border border-input bg-background px-2 py-1 text-xs"
            />
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
          <button
            onClick={() => appliquerBulk(bulkCode as AttendanceCode)}
            disabled={isPending || selection.size === 0}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Appliquer
          </button>
          <button
            onClick={() => appliquerBulk("")}
            disabled={isPending || selection.size === 0}
            className="rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive disabled:opacity-50"
            title="Effacer les présences des employés sélectionnés sur les jours ciblés"
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
        <thead className="sticky top-0 z-10 bg-muted text-left">
          <tr>
            <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2">
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
                className={`w-10 px-1 py-2 text-center ${estMajore(d) ? "bg-orange-100" : ""}`}
                title={estMajore(d) ? "Dimanche ou jour férié" : undefined}
              >
                {d}
              </th>
            ))}
            <th className="px-2 py-2 text-center">P</th>
            <th className="px-2 py-2 text-center">2/3</th>
            <th className="px-2 py-2 text-center">NP</th>
            <th className="px-2 py-2 text-center">Total</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e, rowIndex) => {
            const resume = resumes[e.id] ?? { payes100: 0, payes2_3: 0, nonPayes: 0, totalPresence: 0 };
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
                  const value = attendanceMap[key] ?? "";
                  return (
                    <td
                      key={d}
                      className={`p-0.5 text-center ${estMajore(d) ? "bg-orange-50" : ""}`}
                    >
                      <select
                        disabled={!peutModifier}
                        defaultValue={value}
                        data-emp={e.id}
                        data-day={d}
                        onChange={(ev) => handleSelect(ev, e.id, d, rowIndex, colIndex)}
                        onKeyDown={(ev) => handleKeyDown(ev, rowIndex, colIndex)}
                        onPaste={(ev) => handlePaste(ev, rowIndex, colIndex)}
                        title="Tapez une lettre (P, O, M, A, N, C, F, S) ou choisissez dans la liste. Flèches pour naviguer."
                        className="w-9 cursor-pointer rounded border border-transparent bg-transparent text-center text-xs font-medium hover:border-input focus:border-input disabled:cursor-default disabled:opacity-60"
                      >
                        <option value=""></option>
                        {CODES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center font-medium">{resume.payes100}</td>
                <td className="px-2 py-1.5 text-center font-medium">{resume.payes2_3}</td>
                <td className="px-2 py-1.5 text-center font-medium">{resume.nonPayes}</td>
                <td className="px-2 py-1.5 text-center font-medium">{resume.totalPresence}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
        {isPending && <p className="p-2 text-xs text-muted-foreground">Enregistrement...</p>}
      </div>
      </div>
    </div>
  );
}
