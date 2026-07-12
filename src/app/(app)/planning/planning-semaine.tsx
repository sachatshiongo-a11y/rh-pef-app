"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/avatar";
import { EtatVide } from "@/components/etat-vide";
import { useJourMobile } from "@/components/jour-mobile";
import { saisirCreneau, saisirCreneauxEnLot } from "./actions";
import { paletteDe, dureeShift, type ShiftDTO } from "./creneaux";

export type SemaineEmployee = { id: string; nom: string; photoUrl?: string | null; heuresHebdo: number };
export type SemaineJour = { iso: string; label: string; dow: number; ferie: boolean; dimanche: boolean; aujourdhui: boolean };
export type SemaineGroupe = { titre: string; employees: SemaineEmployee[] };
export type BesoinAgrege = { shiftId: string; jourSemaine: number; nombreRequis: number };

// Largeurs fixes → les blocs empilés (couverture, totaux, employés) gardent leurs colonnes alignées.
const COL_EMP = 190;
const gridCols = (n: number, w: number) => ({ display: "grid", gridTemplateColumns: `${COL_EMP}px repeat(${n}, ${w}px)` });
const fmtH = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1).replace(".", ",")}h`);

export function PlanningSemaine({
  groupes, jours, creneauMap, absences, shifts, besoins, peutModifier,
  autoSet = [], colJour = 132, afficherContrat = true,
}: {
  groupes: SemaineGroupe[];
  jours: SemaineJour[];
  creneauMap: Record<string, string>; // `${empId}_${iso}` -> shiftId
  absences: string[]; // clés `${empId}_${iso}` en congé approuvé
  shifts: ShiftDTO[];
  besoins: BesoinAgrege[];
  peutModifier: boolean;
  autoSet?: string[]; // clés `${empId}_${iso}` posées par la génération automatique (✨)
  colJour?: number; // largeur d'une colonne jour (réduite en vue mois)
  afficherContrat?: boolean; // afficher le ratio heures/contrat (semaine) ou juste les heures (mois)
}) {
  const [isPending, start] = useTransition();
  const parId = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);
  const absSet = useMemo(() => new Set(absences), [absences]);
  const autoKeys = useMemo(() => new Set(autoSet), [autoSet]);
  const allEmps = useMemo(() => groupes.flatMap((g) => g.employees), [groupes]);
  const [couvOuverte, setCouvOuverte] = useState(false); // détail de couverture par shift, replié par défaut

  // Édition optimiste : on garde les changements localement en attendant la revalidation serveur.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const shiftDe = (empId: string, iso: string) => edits[`${empId}_${iso}`] ?? creneauMap[`${empId}_${iso}`] ?? "";
  const dureeDe = (empId: string, iso: string) => { const s = parId.get(shiftDe(empId, iso)); return s ? dureeShift(s) : 0; };

  const setCreneau = (empId: string, iso: string, shiftId: string) => {
    setEdits((x) => ({ ...x, [`${empId}_${iso}`]: shiftId }));
    start(() => saisirCreneau(empId, iso, shiftId));
    setMenu(null);
  };

  // ---- Menu contextuel (clic sur une cellule) ----
  const [menu, setMenu] = useState<{ empId: string; iso: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ouvrirMenu = (e: React.MouseEvent, empId: string, iso: string) => {
    if (!peutModifier) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const MENU_H = 300, MENU_W = 224; // hauteur/largeur approximatives du menu
    // Ouvre vers le bas ; bascule vers le haut si la place manque (dernières lignes) ; borne à l'écran.
    const y = window.innerHeight - r.bottom < MENU_H && r.top > MENU_H ? r.top - MENU_H - 4 : r.bottom + 4;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 12));
    setMenu({ empId, iso, x, y: Math.max(8, y) });
  };
  // Accessibilité : Échap ferme le menu ; à l'ouverture, le focus va sur le 1er choix.
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  // ---- Actions groupées ----
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkShift, setBulkShift] = useState(shifts[0]?.id ?? "");
  const [bulkJours, setBulkJours] = useState<Set<number>>(new Set(jours.map((_, i) => i)));
  const toggleEmp = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const appliquerBulk = (shiftId: string) => {
    const entrees: { employeeId: string; dateIso: string; shiftId: string }[] = [];
    const patch: Record<string, string> = {};
    for (const empId of sel) for (const ji of bulkJours) {
      const iso = jours[ji]?.iso; if (!iso) continue;
      entrees.push({ employeeId: empId, dateIso: iso, shiftId });
      patch[`${empId}_${iso}`] = shiftId;
    }
    if (entrees.length === 0) return;
    setEdits((x) => ({ ...x, ...patch }));
    start(() => saisirCreneauxEnLot(entrees));
  };

  // ---- Agrégats ----
  const requis = useMemo(() => {
    const m = new Map<string, number>(); // `${shiftId}_${dow}` -> requis
    for (const b of besoins) m.set(`${b.shiftId}_${b.jourSemaine}`, (m.get(`${b.shiftId}_${b.jourSemaine}`) ?? 0) + b.nombreRequis);
    return m;
  }, [besoins]);
  const shiftsCouverture = useMemo(() => {
    const ids = new Set(besoins.map((b) => b.shiftId));
    return shifts.filter((s) => ids.has(s.id));
  }, [besoins, shifts]);
  const affectesShiftJour = (shiftId: string, iso: string) => allEmps.filter((e) => shiftDe(e.id, iso) === shiftId).length;

  const totJour = jours.map((j) => {
    let heures = 0, personnes = 0;
    for (const e of allEmps) { const d = dureeDe(e.id, j.iso); if (shiftDe(e.id, j.iso)) { personnes++; heures += d; } }
    return { heures, personnes };
  });
  const heuresSemaine = totJour.reduce((t, j) => t + j.heures, 0);
  const requisSemaineParShift = (shiftId: string) => jours.reduce((t, j) => t + (requis.get(`${shiftId}_${j.dow}`) ?? 0), 0);
  const heuresEmp = (empId: string) => jours.reduce((t, j) => t + dureeDe(empId, j.iso), 0);

  // ---- Vue mobile jour par jour ----
  const idxAuj = Math.max(0, jours.findIndex((j) => j.aujourdhui));
  const [idxMobile, setIdxMobile] = useJourMobile(idxAuj);

  const largeur = COL_EMP + jours.length * colJour;

  return (
    <div>
      {/* ---------- BUREAU ---------- */}
      <div className="hidden lg:block">
        {peutModifier && sel.size > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 text-sm shadow-sm">
            <span className="font-medium">{sel.size} employé(s)</span>
            <span className="text-muted-foreground">→ affecter</span>
            <select value={bulkShift} onChange={(e) => setBulkShift(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
              {shifts.map((s) => <option key={s.id} value={s.id}>{s.nom}{s.heureDebut ? ` ${s.heureDebut}` : ""}</option>)}
            </select>
            <span className="text-muted-foreground">sur</span>
            <div className="flex flex-wrap gap-1">
              {jours.map((j, i) => (
                <button key={j.iso} type="button" onClick={() => setBulkJours((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                  className={`rounded border px-1.5 py-0.5 text-[11px] ${bulkJours.has(i) ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{j.label}</button>
              ))}
            </div>
            <button onClick={() => appliquerBulk(bulkShift)} disabled={isPending} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">Affecter</button>
            <button onClick={() => appliquerBulk("")} disabled={isPending} className="rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive disabled:opacity-50">Vider</button>
            <button onClick={() => setSel(new Set())} className="text-xs text-muted-foreground underline">Désélectionner</button>
          </div>
        )}

        <div className="max-h-[74vh] overflow-auto rounded-2xl border bg-card">
          <div style={{ minWidth: largeur }}>
            {/* Bandeau récap — clic sur le titre = déplier/replier le détail par shift */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
              <button type="button" onClick={() => setCouvOuverte((o) => !o)} className="flex items-center gap-1.5 text-sm font-semibold hover:text-primary" aria-expanded={couvOuverte}>
                <span aria-hidden className={`text-xs transition-transform ${couvOuverte ? "rotate-90" : ""}`}>▸</span>
                Couverture des besoins
              </button>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
                {shiftsCouverture.map((s) => (
                  <span key={s.id} className={`rounded-full px-2 py-0.5 uppercase tracking-wide ${paletteDe(s.couleur).classe}`}>{s.nom} : {requisSemaineParShift(s.id)}</span>
                ))}
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 tabular-nums">{fmtH(heuresSemaine)}</span>
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 tabular-nums">👤 {allEmps.length}</span>
              </div>
            </div>

            {/* Lignes de couverture par shift (repliables) */}
            {couvOuverte && shiftsCouverture.map((s) => (
              <div key={s.id} style={gridCols(jours.length, colJour)} className="border-b">
                <div className="sticky left-0 z-[1] flex items-center gap-2 border-r bg-card px-3 py-1.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full`} style={{ backgroundColor: paletteDe(s.couleur).hex.text }} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{s.nom}</span>
                    {s.heureDebut && s.heureFin && <span className="block text-[10px] text-muted-foreground">{s.heureDebut}–{s.heureFin}</span>}
                  </span>
                </div>
                {jours.map((j) => {
                  const req = requis.get(`${s.id}_${j.dow}`) ?? 0;
                  const cov = affectesShiftJour(s.id, j.iso);
                  const complet = cov >= req;
                  return (
                    <div key={j.iso} className={`flex items-center justify-center border-l px-1 py-1.5 ${j.aujourdhui ? "bg-primary/5" : ""}`}>
                      {req === 0 ? <span className="text-[11px] text-muted-foreground/40">—</span> : (
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ${complet ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"}`}>{cov}/{req}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Ligne totaux jour */}
            <div style={gridCols(jours.length, colJour)} className="border-b bg-muted/30">
              <div className="sticky left-0 z-[1] border-r bg-card px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total / jour</div>
              {jours.map((j, i) => (
                <div key={j.iso} className={`border-l px-1 py-1.5 text-center ${j.aujourdhui ? "bg-primary/10" : ""}`}>
                  <div className="text-xs font-semibold tabular-nums">{fmtH(totJour[i].heures)}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">👤 {totJour[i].personnes}</div>
                </div>
              ))}
            </div>

            {/* En-tête jours */}
            <div style={gridCols(jours.length, colJour)} className="sticky top-0 z-10 border-b bg-card">
              <div className="sticky left-0 z-[2] flex items-center gap-2 border-r bg-card px-3 py-2">
                {peutModifier && <input type="checkbox" checked={allEmps.length > 0 && allEmps.every((e) => sel.has(e.id))} onChange={(e) => setSel(e.target.checked ? new Set(allEmps.map((x) => x.id)) : new Set())} aria-label="Tout sélectionner" />}
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collaborateurs</span>
              </div>
              {jours.map((j) => (
                <div key={j.iso} className={`border-l px-1 py-2 text-center text-xs font-semibold uppercase tracking-wide ${j.aujourdhui ? "bg-primary/10 text-primary" : j.ferie ? "text-purple-700" : j.dimanche ? "text-orange-700" : "text-muted-foreground"}`}>
                  {j.label}{j.aujourdhui && <span className="ml-1 text-[9px]">•</span>}
                </div>
              ))}
            </div>

            {/* Groupes d'employés */}
            {groupes.map((g) => (
              <div key={g.titre}>
                <div className="border-b bg-muted/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.titre} · {g.employees.length}</div>
                {g.employees.map((e) => {
                  const hp = heuresEmp(e.id);
                  const sous = hp < e.heuresHebdo;
                  return (
                    <div key={e.id} style={gridCols(jours.length, colJour)} className={`border-b last:border-0 ${sel.has(e.id) ? "bg-primary/5" : "hover:bg-accent/20"}`}>
                      <div className="sticky left-0 z-[1] flex items-center gap-2 border-r bg-card px-3 py-1.5">
                        {peutModifier && <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggleEmp(e.id)} className="shrink-0" aria-label={`Sélectionner ${e.nom}`} />}
                        <Avatar nom={e.nom} taille={30} photoUrl={e.photoUrl} />
                        <span className="min-w-0">
                          <Link href={`/employes/${e.id}`} className="block truncate text-sm font-medium hover:text-primary hover:underline">{e.nom}</Link>
                          <span className={`block text-[10px] tabular-nums ${afficherContrat && sous ? "text-muted-foreground" : "text-emerald-700"}`}>{afficherContrat ? `${fmtH(hp)} / ${fmtH(e.heuresHebdo)}` : fmtH(hp)}</span>
                        </span>
                      </div>
                      {jours.map((j) => (
                        <div key={j.iso} className={`border-l p-1 ${j.aujourdhui ? "bg-primary/5" : ""}`}>
                          {celluleCarte(e.id, j)}
                        </div>
                      ))}
                    </div>
                  );
                })}
                {g.employees.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">Aucun employé.</div>}
              </div>
            ))}
          </div>
        </div>
        {isPending && <p className="mt-2 text-xs text-muted-foreground">Enregistrement…</p>}
      </div>

      {/* ---------- MOBILE : jour par jour ---------- */}
      <div className="lg:hidden">
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={() => setIdxMobile(Math.max(0, idxMobile - 1))} className="rounded-md border px-3 py-2 text-sm" aria-label="Jour précédent">◀</button>
          <select value={idxMobile} onChange={(e) => setIdxMobile(Number(e.target.value))} className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium">
            {jours.map((j, i) => <option key={j.iso} value={i}>{j.label}{j.ferie ? " · férié" : j.dimanche ? " · dimanche" : ""}</option>)}
          </select>
          <button type="button" onClick={() => setIdxMobile(Math.min(jours.length - 1, idxMobile + 1))} className="rounded-md border px-3 py-2 text-sm" aria-label="Jour suivant">▶</button>
        </div>
        {groupes.map((g) => (
          <div key={g.titre} className="mb-4">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.titre}</p>
            <div className="space-y-2">
              {g.employees.map((e) => {
                const j = jours[idxMobile];
                return (
                  <div key={e.id} className="flex items-center gap-3 rounded-xl border bg-card p-2.5">
                    <Avatar nom={e.nom} taille={34} photoUrl={e.photoUrl} />
                    <div className="min-w-0 flex-1 truncate text-sm font-medium">{e.nom}</div>
                    <div>{celluleCarte(e.id, j)}</div>
                  </div>
                );
              })}
              {g.employees.length === 0 && <EtatVide message="Aucun employé." />}
            </div>
          </div>
        ))}
        {isPending && <p className="mt-2 text-xs text-muted-foreground">Enregistrement…</p>}
      </div>

      {/* ---------- Menu contextuel ---------- */}
      {menu && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div ref={menuRef} role="menu" aria-label="Choisir un shift" className="fixed z-50 max-h-72 w-56 overflow-auto rounded-xl border bg-card p-1 shadow-xl" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => setCreneau(menu.empId, menu.iso, "")} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
              <span className="h-3 w-3 rounded-full border border-dashed" /> Repos (vider)
            </button>
            {shifts.map((s) => (
              <button key={s.id} onClick={() => setCreneau(menu.empId, menu.iso, s.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: paletteDe(s.couleur).hex.text }} />
                <span className="min-w-0"><span className="font-medium">{s.nom}</span>{s.heureDebut && s.heureFin && <span className="ml-1 text-xs text-muted-foreground">{s.heureDebut}–{s.heureFin}</span>}</span>
              </button>
            ))}
          </div>
        </>, document.body)}
    </div>
  );

  // Rendu d'une cellule : carte de shift, ou Absence / Férié / Repos.
  function celluleCarte(empId: string, j: SemaineJour) {
    const sid = shiftDe(empId, j.iso);
    const s = parId.get(sid);
    const enConge = absSet.has(`${empId}_${j.iso}`);
    const base = "flex w-full flex-col justify-center rounded-lg px-2 py-1.5 text-left text-xs min-h-[46px] transition";
    const clic = peutModifier ? "cursor-pointer" : "cursor-default";

    if (s) {
      const pal = paletteDe(s.couleur);
      // ✨ si posé par la génération auto — sauf si l'utilisateur vient de le modifier localement.
      const auto = autoKeys.has(`${empId}_${j.iso}`) && !(`${empId}_${j.iso}` in edits);
      return (
        <button type="button" disabled={!peutModifier} onClick={(ev) => ouvrirMenu(ev, empId, j.iso)} style={{ backgroundColor: pal.hex.bg, color: pal.hex.text }}
          className={`${base} ${clic} relative font-medium hover:brightness-95`}>
          <span className="flex items-center gap-1"><span className="truncate font-semibold">{s.nom}</span>{auto && <span title="Généré automatiquement" className="shrink-0 opacity-70">✨</span>}</span>
          {s.heureDebut && s.heureFin && <span className="opacity-80">{s.heureDebut}–{s.heureFin}</span>}
        </button>
      );
    }
    if (enConge) return <div className={`${base} items-center justify-center bg-amber-50 text-center font-medium text-amber-700`}>Absence</div>;
    if (j.ferie) return (
      <button type="button" disabled={!peutModifier} onClick={(ev) => ouvrirMenu(ev, empId, j.iso)} className={`${base} ${clic} items-center justify-center bg-purple-50 text-center font-medium text-purple-700 hover:bg-purple-100`}>Jour férié</button>
    );
    // Repos / vide → placeholder cliquable.
    return (
      <button type="button" disabled={!peutModifier} onClick={(ev) => ouvrirMenu(ev, empId, j.iso)}
        className={`${base} ${clic} items-center justify-center border border-dashed text-muted-foreground/50 hover:border-primary/40 hover:text-primary ${j.dimanche ? "bg-orange-50/40" : ""}`}>
        {peutModifier ? "＋" : "—"}
      </button>
    );
  }
}
