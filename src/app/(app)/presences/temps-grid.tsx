"use client";

// Grille FUSIONNÉE présences + heures (option A « menu au clic ») : chaque case-jour est une
// mini-carte façon planning (code coloré + heures) ; un clic ouvre un menu unique qui règle
// code ET heures. Écrit dans les mêmes tables qu'avant (Attendance / OvertimeEntry) via les
// actions existantes — la fusion est purement visuelle et réversible (cf. commit).

import { EtatVide } from "@/components/etat-vide";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { saisirPresence, saisirPresencesEnLot } from "./actions";
import { saisirHeures, saisirHeuresEnLot } from "../heures-supp/actions";
import { COULEUR_CODE_HEX } from "./attendance-colors";
import { useJourMobile } from "@/components/jour-mobile";
import {
  calculerHeuresSupp,
  resumerPresences,
  type CodePresence,
  type ParametresPaie,
} from "@/lib/payroll";
import type { AttendanceCode } from "@prisma/client";

const CODES: AttendanceCode[] = ["P", "O", "M", "A", "N", "C", "F", "S"];
const CODES_SET = new Set<string>(CODES);

export type EmployeeRow = {
  id: string;
  matricule: string;
  nom: string;
  photoUrl?: string | null;
  heuresParJour: number;
  heuresHebdo: number;
  salaireHoraire: number;
};

type Cellule = { code: string; heures: number | null };

/** Horaires du jour affichés dans la case (façon planning) : début et fin « HH:MM ».
 *  `reel` = heures issues d'un pointage horodaté (sinon : créneau planifié ou modèle hebdo). */
export type InfoShift = { debut: string | null; fin: string | null; reel: boolean };

// « HH:MM » → minutes depuis minuit (null si non parsable).
function enMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
// minutes depuis minuit → « HH:MM » (modulo 24 h : un shift peut finir après minuit).
function enHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** Durée prévue d'un shift en heures (gère le passage minuit), ou null. */
function dureePrevueH(debut: string | null, fin: string | null): number | null {
  const d = enMinutes(debut);
  const f = enMinutes(fin);
  if (d === null || f === null) return null;
  const delta = f >= d ? f - d : f + 1440 - d;
  return delta / 60;
}

/**
 * Prépare l'affichage horaire d'une case : la plage à montrer, si la journée est en heures
 * supplémentaires (au-delà du shift prévu → ambre) et un libellé pour l'infobulle.
 *  — Réel (pointage) : on montre les heures horodatées telles quelles ; fin absente = « … ».
 *  — Planifié : en heures supp., la fin est RECALCULÉE (début + heures travaillées) pour montrer
 *    l'heure de fin effective ; sinon on montre la plage prévue.
 */
function infoHoraire(
  c: { heures: number | null },
  info: InfoShift | undefined,
  heuresParJourContrat: number
): { horaire: string | null; supp: boolean; titre: string } {
  if (!info) return { horaire: null, supp: false, titre: "" };
  const worked = c.heures;
  const dureePrevue = dureePrevueH(info.debut, info.fin);
  const attendu = dureePrevue ?? heuresParJourContrat;
  const supp = worked !== null && worked > 0 && attendu > 0 && worked > attendu + 0.01;

  let horaire: string | null = null;
  if (info.reel) {
    horaire = info.debut ? `${info.debut}–${info.fin ?? "…"}` : null;
  } else if (supp && info.debut && worked !== null) {
    const dbt = enMinutes(info.debut);
    horaire = dbt !== null ? `${info.debut}–${enHHMM(dbt + worked * 60)}` : info.fin ? `${info.debut}–${info.fin}` : info.debut;
  } else if (info.debut && info.fin) {
    horaire = `${info.debut}–${info.fin}`;
  }

  const titre = horaire
    ? ` ${horaire}${info.reel ? " (pointage réel)" : " (planifié)"}${supp ? " · heures supp." : ""}`
    : "";
  return { horaire, supp, titre };
}
type Scope = "mois" | "ouvrables" | "feries" | "alternes" | "jour" | "periode";

const fmtH = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export function TempsGrid({
  employees,
  days,
  attendanceMap,
  hoursMap,
  shiftMap = {},
  peutModifier,
  isoDates,
  joursFeries,
  params,
}: {
  employees: EmployeeRow[];
  days: number[];
  attendanceMap: Record<string, string>; // `${employeeId}_${day}` -> code
  hoursMap: Record<string, number>; // `${employeeId}_${day}` -> heures
  shiftMap?: Record<string, InfoShift>; // `${employeeId}_${day}` -> shift du jour (réel > planning > modèle)
  peutModifier: boolean;
  isoDates: string[]; // isoDates[day-1] = "YYYY-MM-DD"
  joursFeries: Set<string>;
  params: ParametresPaie;
}) {
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  // État local des cases (optimiste) — source d'affichage et de calcul des totaux en direct.
  const [cellules, setCellules] = useState<Record<string, Cellule>>(() => {
    const init: Record<string, Cellule> = {};
    for (const e of employees)
      for (const d of days) {
        const k = `${e.id}_${d}`;
        init[k] = { code: attendanceMap[k] ?? "", heures: hoursMap[k] ?? null };
      }
    return init;
  });
  const cel = (empId: string, d: number): Cellule =>
    cellules[`${empId}_${d}`] ?? { code: "", heures: null };

  // Re-synchronise l'état local quand le serveur renvoie des données fraîches (revalidation
  // après saisie ou import IVMS) — la vérité serveur inclut alors nos écritures.
  useEffect(() => {
    const init: Record<string, Cellule> = {};
    for (const e of employees)
      for (const d of days) {
        const k = `${e.id}_${d}`;
        init[k] = { code: attendanceMap[k] ?? "", heures: hoursMap[k] ?? null };
      }
    setCellules(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceMap, hoursMap]);

  // ── Menu au clic (popover façon planning) ────────────────────────────────
  const [pop, setPop] = useState<{
    empId: string;
    day: number;
    x: number;
    y: number;
    code: string;
    heures: string;
  } | null>(null);

  function ouvrirMenu(ev: React.MouseEvent<HTMLButtonElement>, empId: string, day: number) {
    if (!peutModifier) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const c = cel(empId, day);
    const largeur = 300;
    const x = Math.min(Math.max(8, r.left), window.innerWidth - largeur - 8);
    const y = r.bottom + 6 > window.innerHeight - 220 ? r.top - 226 : r.bottom + 6;
    setPop({ empId, day, x, y, code: c.code, heures: c.heures === null ? "" : String(c.heures) });
  }

  // ── Écritures (optimistes, mêmes actions serveur qu'avant) ───────────────
  function ecrireCode(empId: string, day: number, code: string) {
    const k = `${empId}_${day}`;
    const avant = cel(empId, day);
    setCellules((c) => ({ ...c, [k]: { ...avant, code } }));
    startTransition(async () => {
      const res = await saisirPresence(empId, isoDates[day - 1], code as AttendanceCode | "");
      if (res?.ignore) {
        setCellules((c) => ({ ...c, [k]: { ...c[k], code: "" } }));
        setNote(res.ignore);
      }
    });
  }
  function ecrireHeures(empId: string, day: number, heures: string) {
    const k = `${empId}_${day}`;
    const val = heures === "" ? null : Number(heures.replace(",", "."));
    if (val !== null && (Number.isNaN(val) || val < 0 || val > 24)) return;
    setCellules((c) => ({ ...c, [k]: { ...c[k], heures: val } }));
    startTransition(() => {
      saisirHeures(empId, isoDates[day - 1], heures.replace(",", "."));
    });
  }
  function validerMenu() {
    if (!pop) return;
    const avant = cel(pop.empId, pop.day);
    if (pop.code !== avant.code) ecrireCode(pop.empId, pop.day, pop.code);
    const heuresAvant = avant.heures === null ? "" : String(avant.heures);
    if (pop.heures.trim() !== heuresAvant) ecrireHeures(pop.empId, pop.day, pop.heures.trim());
    setPop(null);
  }
  function effacerMenu() {
    if (!pop) return;
    ecrireCode(pop.empId, pop.day, "");
    ecrireHeures(pop.empId, pop.day, "");
    setPop(null);
  }

  // ── Navigation clavier façon tableur (lettres = codes, flèches = déplacement) ──
  function celluleAt(rowIndex: number, colIndex: number) {
    const emp = employees[rowIndex];
    const jour = days[colIndex];
    if (!emp || !jour) return null;
    return gridRef.current?.querySelector<HTMLButtonElement>(
      `button[data-emp="${emp.id}"][data-day="${jour}"]`
    );
  }
  function clavier(ev: React.KeyboardEvent<HTMLButtonElement>, empId: string, day: number, rowIndex: number, colIndex: number) {
    const lettre = ev.key.toUpperCase();
    if (peutModifier && CODES_SET.has(lettre)) {
      ev.preventDefault();
      ecrireCode(empId, day, lettre);
      celluleAt(rowIndex, colIndex + 1)?.focus();
      return;
    }
    if (peutModifier && (ev.key === "Backspace" || ev.key === "Delete")) {
      ev.preventDefault();
      ecrireCode(empId, day, "");
      ecrireHeures(empId, day, "");
      return;
    }
    let cible: HTMLButtonElement | null | undefined;
    if (ev.key === "ArrowRight") cible = celluleAt(rowIndex, colIndex + 1);
    else if (ev.key === "ArrowLeft") cible = celluleAt(rowIndex, colIndex - 1);
    else if (ev.key === "ArrowDown") cible = celluleAt(rowIndex + 1, colIndex);
    else if (ev.key === "ArrowUp") cible = celluleAt(rowIndex - 1, colIndex);
    else return;
    if (cible) {
      ev.preventDefault();
      cible.focus();
    }
  }

  // ── Jours spéciaux ────────────────────────────────────────────────────────
  const estDimanche = (d: number) => new Date(isoDates[d - 1] + "T00:00:00Z").getUTCDay() === 0;
  const estFerie = (d: number) => joursFeries.has(isoDates[d - 1]);
  const estMajore = (d: number) => estDimanche(d) || estFerie(d);

  // ── Actions groupées (code ET/OU heures en un passage) ───────────────────
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [bulkCode, setBulkCode] = useState<string>("P");
  const [bulkHeures, setBulkHeures] = useState<string>("");
  const [bulkScope, setBulkScope] = useState<Scope>("mois");
  const [bulkJour, setBulkJour] = useState<string>("1");
  const [bulkAlterneDebut, setBulkAlterneDebut] = useState<string>("1");
  const [bulkDu, setBulkDu] = useState<string>("1");
  const [bulkAu, setBulkAu] = useState<string>("1");

  function toggleEmp(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function joursCibles(): number[] {
    if (bulkScope === "jour")
      return bulkJour.split(/[,\s]+/).map(Number).filter((j) => Number.isInteger(j) && j >= 1 && j <= days.length);
    if (bulkScope === "ouvrables") return days.filter((d) => !estMajore(d));
    if (bulkScope === "feries") return days.filter((d) => estFerie(d));
    if (bulkScope === "periode") {
      const du = Math.max(1, Number(bulkDu) || 1);
      const au = Math.min(days.length, Number(bulkAu) || days.length);
      return days.filter((d) => d >= du && d <= au && !estMajore(d));
    }
    if (bulkScope === "alternes") {
      const debut = Math.max(1, Number(bulkAlterneDebut) || 1);
      return days.filter((d) => d >= debut && (d - debut) % 2 === 0 && !estMajore(d));
    }
    return [...days];
  }
  /** Applique le lot : code (sauf « inchangé ») et/ou heures (si renseignées). vider=true efface tout. */
  function appliquerBulk(vider: boolean) {
    const emps = [...selection];
    const cibles = joursCibles();
    if (emps.length === 0 || cibles.length === 0) return;
    const code = vider ? "" : bulkCode; // "KEEP" = ne pas changer le code
    const heures = vider ? "" : bulkHeures.trim().replace(",", ".");
    const faireCode = vider || code !== "KEEP";
    const faireHeures = vider || heures !== "";
    if (!faireCode && !faireHeures) return;

    setCellules((c) => {
      const n = { ...c };
      for (const empId of emps)
        for (const d of cibles) {
          const k = `${empId}_${d}`;
          n[k] = {
            code: faireCode ? code : n[k]?.code ?? "",
            heures: faireHeures ? (heures === "" ? null : Number(heures)) : n[k]?.heures ?? null,
          };
        }
      return n;
    });

    setNote(null);
    startTransition(async () => {
      let nbIgnores = 0;
      if (faireCode) {
        const entrees = emps.flatMap((empId) =>
          cibles.map((d) => ({ employeeId: empId, date: isoDates[d - 1], code: code as AttendanceCode | "" }))
        );
        const { ignores } = await saisirPresencesEnLot(entrees);
        nbIgnores += ignores.length;
        if (ignores.length > 0)
          setCellules((c) => {
            const n = { ...c };
            for (const ig of ignores) {
              const d = isoDates.indexOf(ig.date) + 1;
              const k = `${ig.employeeId}_${d}`;
              n[k] = { ...n[k], code: "" };
            }
            return n;
          });
      }
      if (faireHeures) {
        const entrees = emps.flatMap((empId) =>
          cibles.map((d) => ({ employeeId: empId, date: isoDates[d - 1], heures }))
        );
        const { ignores } = await saisirHeuresEnLot(entrees);
        nbIgnores += ignores.length;
        if (ignores.length > 0)
          setCellules((c) => {
            const n = { ...c };
            for (const ig of ignores) {
              const d = isoDates.indexOf(ig.date) + 1;
              const k = `${ig.employeeId}_${d}`;
              n[k] = { ...n[k], heures: null };
            }
            return n;
          });
      }
      if (nbIgnores > 0)
        setNote(`${nbIgnores} case(s) ignorée(s) : congé approuvé, jour de repos selon le modèle hebdo, ou congé (C/S) sur un dimanche/férié. La saisie case par case reste possible pour un travail exceptionnel.`);
    });
  }

  // ── Totaux vivants (présences + heures supp) calculés depuis l'état local ──
  const totaux = useMemo(() => {
    const t: Record<string, { p100: number; p23: number; np: number; h: number; hs: number; hsVal: number }> = {};
    for (const e of employees) {
      const codes: CodePresence[] = [];
      const jours: { date: Date; heuresTravaillees: number }[] = [];
      for (const d of days) {
        const c = cel(e.id, d);
        if (c.code) codes.push(c.code as CodePresence);
        if (c.heures !== null && c.heures > 0)
          jours.push({ date: new Date(isoDates[d - 1] + "T00:00:00Z"), heuresTravaillees: c.heures });
      }
      const r = resumerPresences(codes);
      const hs = calculerHeuresSupp({
        jours,
        heuresParJourContrat: e.heuresParJour,
        heuresHebdoContrat: e.heuresHebdo,
        salaireHoraire: e.salaireHoraire,
        joursFeries,
        params,
      });
      t[e.id] = { p100: r.payes100, p23: r.payes2_3, np: r.nonPayes, h: hs.heuresTotalesMois, hs: hs.totalHS, hsVal: hs.hsValorisee };
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellules, employees]);

  // ── Vue mobile jour par jour (code + heures côte à côte) ─────────────────
  const isoAuj = new Date().toISOString().slice(0, 10);
  const idxAuj = isoDates.indexOf(isoAuj);
  const [idxMobile, setIdxMobile] = useJourMobile(idxAuj >= 0 ? idxAuj : 0);
  const jourMobile = days[idxMobile] ?? days[0] ?? 1;

  const couleurDe = (code: string) => COULEUR_CODE_HEX[code as CodePresence];

  return (
    <div>
      {/* ── Mobile : jour par jour ── */}
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
          {employees.map((emp) => {
            const c = cel(emp.id, jourMobile);
            const coul = couleurDe(c.code);
            const info = shiftMap[`${emp.id}_${jourMobile}`];
            const hs = infoHoraire(c, info, emp.heuresParJour);
            return (
              <div key={emp.id} className="flex items-center gap-3 rounded-xl border bg-card p-2.5">
                <Avatar nom={emp.nom} taille={36} photoUrl={emp.photoUrl} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{emp.nom}</div>
                  <div className="font-mono text-xs text-muted-foreground">{emp.matricule}</div>
                  {hs.horaire && (
                    <div className={`truncate text-[11px] tabular-nums ${hs.supp ? "font-semibold text-amber-700" : info?.reel ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                      {info?.reel ? "● " : ""}{hs.horaire}{hs.supp ? " · h. supp." : ""}
                    </div>
                  )}
                </div>
                {peutModifier ? (
                  <>
                    <select
                      value={c.code}
                      onChange={(e) => ecrireCode(emp.id, jourMobile, e.target.value)}
                      className="w-16 rounded-md border border-input bg-background px-1 py-2 text-center text-sm font-semibold"
                      style={coul ? { backgroundColor: coul.bg, color: coul.text } : undefined}
                      aria-label={`Code de ${emp.nom}`}
                    >
                      <option value="">—</option>
                      {CODES.map((x) => (<option key={x} value={x}>{x}</option>))}
                    </select>
                    <input
                      type="number" step="0.5" min="0" max="24" inputMode="decimal"
                      value={c.heures === null ? "" : c.heures}
                      onChange={(e) => ecrireHeures(emp.id, jourMobile, e.target.value)}
                      placeholder="h"
                      className="w-16 rounded-md border border-input bg-background px-2 py-2 text-right text-sm font-semibold"
                      aria-label={`Heures de ${emp.nom}`}
                    />
                  </>
                ) : (
                  <span className="text-sm font-semibold">{c.code || "—"} · {c.heures ?? "—"} h</span>
                )}
              </div>
            );
          })}
          {employees.length === 0 && <EtatVide message="Aucun employé." />}
        </div>
        {isPending && <p className="mt-2 text-xs text-muted-foreground">Enregistrement…</p>}
      </div>

      {/* ── Ordinateur : grille complète ── */}
      <div className="hidden lg:block">
        {peutModifier && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm">
            <span className="font-medium">{selection.size} employé(s) sélectionné(s)</span>
            <span className="text-muted-foreground">→ code</span>
            <select value={bulkCode} onChange={(e) => setBulkCode(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
              <option value="KEEP">(inchangé)</option>
              {CODES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <span className="text-muted-foreground">heures</span>
            <input type="number" step="0.5" min="0" max="24" value={bulkHeures} onChange={(e) => setBulkHeures(e.target.value)} placeholder="(inchangées)" className="w-24 rounded border border-input bg-background px-2 py-1 text-xs" />
            <span className="text-muted-foreground">sur</span>
            <select value={bulkScope} onChange={(e) => setBulkScope(e.target.value as Scope)} className="rounded border border-input bg-background px-2 py-1 text-xs">
              <option value="mois">tout le mois</option>
              <option value="ouvrables">jours ouvrables (hors dimanche et fériés)</option>
              <option value="feries">jours fériés uniquement</option>
              <option value="alternes">1 jour sur 2</option>
              <option value="jour">jours précis</option>
              <option value="periode">période (du jour… au jour…)</option>
            </select>
            {bulkScope === "jour" && (
              <input type="text" value={bulkJour} onChange={(e) => setBulkJour(e.target.value)} placeholder="ex. 3, 5, 12" className="w-24 rounded border border-input bg-background px-2 py-1 text-xs" />
            )}
            {bulkScope === "periode" && (
              <span className="flex items-center gap-1 text-xs">du jour
                <input type="number" min={1} max={days.length} value={bulkDu} onChange={(e) => setBulkDu(e.target.value)} className="w-14 rounded border border-input bg-background px-2 py-1 text-xs" />
                au
                <input type="number" min={1} max={days.length} value={bulkAu} onChange={(e) => setBulkAu(e.target.value)} className="w-14 rounded border border-input bg-background px-2 py-1 text-xs" />
              </span>
            )}
            {bulkScope === "alternes" && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">à partir du jour
                <input type="number" min="1" max={days.length} value={bulkAlterneDebut} onChange={(e) => setBulkAlterneDebut(e.target.value)} className="w-14 rounded border border-input bg-background px-2 py-1 text-xs" />
              </label>
            )}
            <button
              onClick={() => appliquerBulk(false)}
              disabled={isPending || selection.size === 0 || (bulkCode === "KEEP" && bulkHeures.trim() === "")}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Appliquer
            </button>
            <button
              onClick={() => appliquerBulk(true)}
              disabled={isPending || selection.size === 0}
              className="rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive disabled:opacity-50"
              title="Effacer code ET heures des employés sélectionnés sur les jours ciblés"
            >
              Supprimer
            </button>
            <button onClick={() => setSelection(new Set())} className="text-xs text-muted-foreground underline">Désélectionner</button>
            {isPending && <span className="text-xs text-muted-foreground">Enregistrement…</span>}
          </div>
        )}
        {note && <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">{note}</p>}

        <div className="max-h-[70vh] overflow-auto rounded-lg border">
          <table ref={gridRef} className="text-sm">
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
                  <th key={d} className={`px-1 py-2 text-center ${estMajore(d) ? "bg-orange-100" : ""}`} title={estMajore(d) ? "Dimanche ou jour férié" : undefined}>
                    {d}
                  </th>
                ))}
                <th className="px-2 py-2 text-center" title="Jours payés 100%">P</th>
                <th className="px-2 py-2 text-center" title="Jours payés aux 2/3 (maladie)">2/3</th>
                <th className="px-2 py-2 text-center" title="Jours non payés">NP</th>
                <th className="px-2 py-2 text-center" title="Heures travaillées du mois">H</th>
                <th className="px-2 py-2 text-center" title="Heures supplémentaires (30+60+100)">HS</th>
                <th className="px-2 py-2 text-center" title="Valorisation des heures supp.">HS $</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e, rowIndex) => {
                const t = totaux[e.id] ?? { p100: 0, p23: 0, np: 0, h: 0, hs: 0, hsVal: 0 };
                return (
                  <tr key={e.id} className="border-t">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-1">
                      <span className="flex items-center gap-2">
                        {peutModifier && (
                          <input type="checkbox" checked={selection.has(e.id)} onChange={() => toggleEmp(e.id)} aria-label={`Sélectionner ${e.nom}`} />
                        )}
                        <Avatar nom={e.nom} taille={24} photoUrl={e.photoUrl} />
                        <Link href={`/employes/${e.id}`} className="hover:text-primary hover:underline">{e.nom}</Link>
                      </span>
                    </td>
                    {days.map((d, colIndex) => {
                      const info = shiftMap[`${e.id}_${d}`];
                      const c = cel(e.id, d);
                      const hs = infoHoraire(c, info, e.heuresParJour);
                      const coul = couleurDe(c.code);
                      return (
                        <td key={d} className={`p-0.5 text-center ${estMajore(d) ? "bg-orange-50" : ""}`}>
                          <button
                            type="button"
                            data-emp={e.id}
                            data-day={d}
                            disabled={!peutModifier}
                            onClick={(ev) => ouvrirMenu(ev, e.id, d)}
                            onKeyDown={(ev) => clavier(ev, e.id, d, rowIndex, colIndex)}
                            title={`${peutModifier ? "Clic : menu code + heures. Ou tapez une lettre (P, O, M…) ; Suppr efface ; flèches pour naviguer." : ""}${hs.titre}` || undefined}
                            className="flex h-10 w-[4.6rem] flex-col items-center justify-center rounded-md border border-transparent leading-none hover:border-input focus:border-primary focus:outline-none disabled:cursor-default"
                            style={coul ? { backgroundColor: coul.bg, color: coul.text } : undefined}
                          >
                            <span className="text-[11px] font-bold">
                              {c.code || "·"}
                              {c.heures !== null && c.heures > 0 && (
                                <span className={`ml-1 text-[9px] font-semibold tabular-nums ${hs.supp ? "text-amber-700" : "font-normal opacity-80"}`}>
                                  {fmtH(c.heures)} h
                                </span>
                              )}
                            </span>
                            {hs.horaire ? (
                              <span className={`mt-0.5 text-[8px] tabular-nums ${hs.supp ? "font-semibold text-amber-700" : info?.reel ? "font-semibold" : "opacity-60"}`}>
                                {info?.reel ? "● " : ""}{hs.horaire}
                              </span>
                            ) : (
                              <span className="mt-0.5 text-[8px] opacity-40">—</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-center font-medium tabular-nums">{t.p100}</td>
                    <td className="px-2 py-1 text-center tabular-nums">{t.p23}</td>
                    <td className="px-2 py-1 text-center tabular-nums">{t.np}</td>
                    <td className="px-2 py-1 text-center font-medium tabular-nums">{fmtH(t.h)}</td>
                    <td className="px-2 py-1 text-center tabular-nums">{fmtH(t.hs)}</td>
                    <td className="px-2 py-1 text-center font-medium tabular-nums">{t.hsVal.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {isPending && <p className="p-2 text-xs text-muted-foreground">Enregistrement…</p>}
        </div>
      </div>

      {/* ── Menu au clic (code + heures) ── */}
      {pop && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPop(null)} />
          <div
            className="fixed z-50 w-[300px] rounded-xl border bg-card p-4 shadow-xl"
            style={{ left: pop.x, top: Math.max(8, pop.y) }}
            role="dialog"
            aria-label="Saisir le code et les heures du jour"
            onKeyDown={(e) => {
              if (e.key === "Escape") setPop(null);
              if (e.key === "Enter") validerMenu();
            }}
          >
            <p className="mb-2 text-xs text-muted-foreground">
              {new Date(isoDates[pop.day - 1] + "T00:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
              {" — "}
              {employees.find((e) => e.id === pop.empId)?.nom}
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {CODES.map((c) => {
                const coul = COULEUR_CODE_HEX[c as CodePresence];
                const actif = pop.code === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPop((p) => (p ? { ...p, code: actif ? "" : c } : p))}
                    className={`rounded-md px-2.5 py-1 text-xs font-bold ${actif ? "ring-2 ring-primary" : ""}`}
                    style={{ backgroundColor: coul.bg, color: coul.text }}
                    aria-pressed={actif}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <label className="mb-3 flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Heures travaillées</span>
              <span className="flex items-center gap-1">
                <input
                  type="number" step="0.5" min="0" max="24" inputMode="decimal" autoFocus
                  value={pop.heures}
                  onChange={(e) => setPop((p) => (p ? { ...p, heures: e.target.value } : p))}
                  placeholder="0"
                  className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm tabular-nums"
                />
                <span className="text-xs text-muted-foreground">h</span>
              </span>
            </label>
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={effacerMenu} className="rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10">
                Effacer
              </button>
              <span className="flex gap-2">
                <button type="button" onClick={() => setPop(null)} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">Annuler</button>
                <button type="button" onClick={validerMenu} className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground">OK</button>
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
