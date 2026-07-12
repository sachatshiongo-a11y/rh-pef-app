"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/avatar";
import { useJourMobile } from "@/components/jour-mobile";
import { saisirModele } from "./actions";
import { paletteDe, dureeShift, type ShiftDTO } from "./creneaux";

const COUCHES = [
  { v: 0, l: "Chaque semaine" },
  { v: 1, l: "Semaine A" },
  { v: 2, l: "Semaine B" },
];

const money = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
const fmtH = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1).replace(".", ",")}h`);
// 52/12 semaines par mois (précis) pour l'estimation mensuelle, cohérent avec le calcul de paie.
const SEMAINES_PAR_MOIS = 52 / 12;

// Lundi → dimanche ; v = jourSemaine (0=dim … 6=sam).
const JOURS = [
  { v: 1, l: "Lundi", court: "Lun" },
  { v: 2, l: "Mardi", court: "Mar" },
  { v: 3, l: "Mercredi", court: "Mer" },
  { v: 4, l: "Jeudi", court: "Jeu" },
  { v: 5, l: "Vendredi", court: "Ven" },
  { v: 6, l: "Samedi", court: "Sam" },
  { v: 0, l: "Dimanche", court: "Dim" },
];

// Colonnes fixes → alignement en-tête / lignes. 7 jours + 3 colonnes de synthèse.
const COLS = "190px repeat(7, 118px) 74px 102px 102px";
const gridStyle = { display: "grid", gridTemplateColumns: COLS } as const;
const LARGEUR = 190 + 7 * 118 + 74 + 102 + 102;

export type ModeleEmployee = { id: string; nom: string; photoUrl?: string | null };

/**
 * Éditeur du modèle hebdomadaire par employé, en cartes de shift (cohérent avec les vues Semaine /
 * Mois) : pour chaque jour de la semaine, le shift/rôle habituel. Gère les rôles variables et les
 * couches bi-hebdomadaires (A/B). Alimente la génération automatique.
 */
export function ModeleGrid({
  employees, shifts, modeleMap, tauxDefautParEmp, peutModifier,
}: {
  employees: ModeleEmployee[];
  shifts: ShiftDTO[];
  modeleMap: Record<string, string>; // `${employeeId}_${jour}_${semaine}` -> shiftId
  tauxDefautParEmp: Record<string, number>;
  peutModifier: boolean;
}) {
  const [isPending, start] = useTransition();
  const [couche, setCouche] = useState(0);
  const parId = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  // Édition optimiste (clé `${empId}_${jour}_${couche}` -> shiftId, "" = repos).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const cle = (empId: string, jour: number, c: number) => `${empId}_${jour}_${c}`;
  const brut = (empId: string, jour: number, c: number) => {
    const k = cle(empId, jour, c);
    return edits[k] !== undefined ? edits[k] : modeleMap[k] ?? "";
  };
  // Shift affiché : couche courante, sinon repli « chaque semaine » si vide (comme la génération).
  const shiftJour = (empId: string, jour: number): string => {
    const v = brut(empId, jour, couche);
    if (v) return v;
    return couche !== 0 ? brut(empId, jour, 0) : "";
  };

  const setModele = (empId: string, jour: number, shiftId: string) => {
    setEdits((x) => ({ ...x, [cle(empId, jour, couche)]: shiftId }));
    start(() => saisirModele(empId, jour, shiftId, couche));
    setMenu(null);
  };

  // ---- Menu contextuel ----
  const [menu, setMenu] = useState<{ empId: string; jour: number; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ouvrirMenu = (e: React.MouseEvent, empId: string, jour: number) => {
    if (!peutModifier) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const MENU_H = 300, MENU_W = 224;
    const y = window.innerHeight - r.bottom < MENU_H && r.top > MENU_H ? r.top - MENU_H - 4 : r.bottom + 4;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 12));
    setMenu({ empId, jour, x, y: Math.max(8, y) });
  };
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  const totalSemaine = (empId: string): { heures: number; montant: number } => {
    const tauxDefaut = tauxDefautParEmp[empId] ?? 0;
    let heures = 0, montant = 0;
    for (const j of JOURS) {
      const s = parId.get(shiftJour(empId, j.v));
      if (!s) continue;
      const h = dureeShift(s);
      heures += h;
      montant += h * (s.tauxHoraireUSD ?? tauxDefaut);
    }
    return { heures: Math.round(heures * 100) / 100, montant };
  };

  const [idxMobile, setIdxMobile] = useJourMobile(0);

  const selecteurCouche = (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Couche :</span>
      <div className="flex overflow-hidden rounded-md border">
        {COUCHES.map((c) => (
          <button key={c.v} onClick={() => setCouche(c.v)} className={`px-3 py-1.5 ${couche === c.v ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{c.l}</button>
        ))}
      </div>
      {couche !== 0 && <span className="text-xs text-muted-foreground">Bi-hebdomadaire : ne s&apos;applique qu&apos;aux semaines {couche === 1 ? "A" : "B"} (repli sur « chaque semaine » si vide).</span>}
    </div>
  );

  // Carte d'un jour.
  const carte = (empId: string, jour: number) => {
    const s = parId.get(shiftJour(empId, jour));
    const base = "flex w-full flex-col justify-center rounded-lg px-2 py-1.5 text-left text-xs min-h-[44px] transition";
    const clic = peutModifier ? "cursor-pointer" : "cursor-default";
    if (s) {
      const pal = paletteDe(s.couleur);
      return (
        <button type="button" disabled={!peutModifier} onClick={(ev) => ouvrirMenu(ev, empId, jour)} style={{ backgroundColor: pal.hex.bg, color: pal.hex.text }} className={`${base} ${clic} font-medium hover:brightness-95`}>
          <span className="truncate font-semibold">{s.nom}</span>
          {s.heureDebut && s.heureFin && <span className="opacity-80">{s.heureDebut}–{s.heureFin}</span>}
        </button>
      );
    }
    return (
      <button type="button" disabled={!peutModifier} onClick={(ev) => ouvrirMenu(ev, empId, jour)} className={`${base} ${clic} items-center justify-center border border-dashed text-muted-foreground/50 hover:border-primary/40 hover:text-primary`}>
        {peutModifier ? "＋" : "—"}
      </button>
    );
  };

  return (
    <div>
      {selecteurCouche}

      {/* ---------- BUREAU ---------- */}
      <div className="hidden max-h-[74vh] overflow-auto rounded-2xl border bg-card lg:block">
        <div style={{ minWidth: LARGEUR }}>
          <div style={gridStyle} className="sticky top-0 z-10 border-b bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <div className="sticky left-0 z-[2] border-r bg-muted px-3 py-2">Employé</div>
            {JOURS.map((j) => <div key={j.v} className={`border-l px-1 py-2 text-center ${j.v === 0 ? "text-orange-700" : ""}`}>{j.court}</div>)}
            <div className="border-l px-1 py-2 text-right">H/sem</div>
            <div className="border-l px-1 py-2 text-right">Rémun.</div>
            <div className="border-l px-1 py-2 text-right">Estim./mois</div>
          </div>
          {employees.map((e) => {
            const t = totalSemaine(e.id);
            return (
              <div key={e.id} style={gridStyle} className="border-b last:border-0 hover:bg-accent/20">
                <div className="sticky left-0 z-[1] flex items-center gap-2 border-r bg-card px-3 py-1.5">
                  <Avatar nom={e.nom} taille={30} photoUrl={e.photoUrl} />
                  <Link href={`/employes/${e.id}`} className="min-w-0 truncate text-sm font-medium hover:text-primary hover:underline">{e.nom}</Link>
                </div>
                {JOURS.map((j) => <div key={j.v} className={`border-l p-1 ${j.v === 0 ? "bg-orange-50/40" : ""}`}>{carte(e.id, j.v)}</div>)}
                <div className="flex items-center justify-end border-l px-1 text-xs font-semibold tabular-nums">{fmtH(t.heures)}</div>
                <div className="flex items-center justify-end border-l px-1 text-xs font-medium tabular-nums">{money(t.montant)}</div>
                <div className="flex items-center justify-end border-l px-1 text-[11px] tabular-nums text-muted-foreground">{money(t.montant * SEMAINES_PAR_MOIS)}</div>
              </div>
            );
          })}
          {employees.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun employé actif.</div>}
        </div>
      </div>

      {/* ---------- MOBILE : jour par jour ---------- */}
      <div className="lg:hidden">
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={() => setIdxMobile(Math.max(0, idxMobile - 1))} className="rounded-md border px-3 py-2 text-sm" aria-label="Jour précédent">◀</button>
          <select value={idxMobile} onChange={(ev) => setIdxMobile(Number(ev.target.value))} className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium">
            {JOURS.map((j, i) => <option key={j.v} value={i}>{j.l}</option>)}
          </select>
          <button type="button" onClick={() => setIdxMobile(Math.min(JOURS.length - 1, idxMobile + 1))} className="rounded-md border px-3 py-2 text-sm" aria-label="Jour suivant">▶</button>
        </div>
        <div className="space-y-2">
          {employees.map((e) => {
            const t = totalSemaine(e.id);
            return (
              <div key={e.id} className="flex items-center gap-3 rounded-xl border bg-card p-2.5">
                <Avatar nom={e.nom} taille={34} photoUrl={e.photoUrl} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.nom}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">{fmtH(t.heures)}/sem · {money(t.montant)}</div>
                </div>
                <div className="w-32 shrink-0">{carte(e.id, JOURS[idxMobile].v)}</div>
              </div>
            );
          })}
          {employees.length === 0 && <p className="rounded-lg border p-4 text-center text-sm text-muted-foreground">Aucun employé actif.</p>}
        </div>
      </div>

      {isPending && <p className="mt-2 text-xs text-muted-foreground">Enregistrement…</p>}

      {/* ---------- Menu ---------- */}
      {menu && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div ref={menuRef} role="menu" aria-label="Choisir un shift" className="fixed z-50 max-h-72 w-56 overflow-auto rounded-xl border bg-card p-1 shadow-xl" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => setModele(menu.empId, menu.jour, "")} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
              <span className="h-3 w-3 rounded-full border border-dashed" /> Repos (vider)
            </button>
            {shifts.map((s) => (
              <button key={s.id} onClick={() => setModele(menu.empId, menu.jour, s.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: paletteDe(s.couleur).hex.text }} />
                <span className="min-w-0"><span className="font-medium">{s.nom}</span>{s.heureDebut && s.heureFin && <span className="ml-1 text-xs text-muted-foreground">{s.heureDebut}–{s.heureFin}</span>}</span>
              </button>
            ))}
          </div>
        </>, document.body)}
    </div>
  );
}
