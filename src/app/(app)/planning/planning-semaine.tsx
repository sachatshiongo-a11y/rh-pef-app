"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Avatar, initiales } from "@/components/avatar";
import { EtatVide } from "@/components/etat-vide";
import { useJourMobile } from "@/components/jour-mobile";
import { saisirCreneau, saisirCreneauxEnLot } from "./actions";
import { paletteDe, dureeShift, type ShiftDTO } from "./creneaux";
import {
  grouperSalaries,
  pivoterParShift,
  type BesoinPeriode,
  type CreneauPeriode,
  type CritereGroupe,
  type SalarieAClasser,
} from "./lecture-shift";

export type SemaineEmployee = { id: string; nom: string; photoUrl?: string | null; heuresHebdo: number };
export type SemaineJour = { iso: string; label: string; dow: number; ferie: boolean; dimanche: boolean; aujourdhui: boolean };
export type SemaineGroupe = { titre: string; employees: SemaineEmployee[] };
export type BesoinAgrege = { shiftId: string; jourSemaine: number; nombreRequis: number };

/** Données propres à la vue semaine « enrichie » (§3-§5 de la conception 2026-08-17) : densité
 *  réglable, lecture Par shift, regroupement des lignes. Absent → comportement d'origine, inchangé
 *  (vue mois, hors périmètre du chantier). */
export type SemaineOutils = {
  /** Liste plate des salariés, poste + catégorie inclus, pour le regroupement des lignes (§5). */
  employees: SalarieAClasser[];
  /** Créneaux bruts de la période, pour le pivot « Par shift » (§4) — `creneauMap` les a déjà agrégés
   *  par cellule et perdu l'info « qui d'autre ce jour-là » nécessaire au pivot. */
  creneaux: CreneauPeriode[];
  /** Besoins à la granularité poste : `besoins` les a déjà agrégés tous postes confondus. */
  besoinsPoste: BesoinPeriode[];
};

type Densite = "confort" | "compact" | "tres-compact";
type Lecture = "personne" | "shift";

/** Un cran de densité : tailles CSS RÉELLES, jamais de zoom/scale (conception §2.3 — le menu de shift
 *  est positionné en coordonnées absolues via un portail ; une mise à l'échelle le décalerait). */
type DensiteCfg = {
  label: string;
  colJour: number;
  cellMinH: string; // classe min-h-[Xpx] de la carte de shift : le facteur dominant de la hauteur de ligne
  padCell: string; // padding de la cellule jour, autour de la carte
  caseTexte: string; // taille du texte dans la carte de shift
  avatarTaille: number; // 0 = pas d'avatar, initiales seules (cran « très compact »)
  padRow: string; // padding vertical de la cellule « collaborateur »
  texteNom: string;
  texteMeta: string;
};
const DENSITES: Record<Densite, DensiteCfg> = {
  confort: { label: "Confort", colJour: 132, cellMinH: "min-h-[34px]", padCell: "p-1", caseTexte: "text-xs", avatarTaille: 30, padRow: "py-1.5", texteNom: "text-sm", texteMeta: "text-[10px]" },
  compact: { label: "Compact", colJour: 112, cellMinH: "min-h-[26px]", padCell: "p-0.5", caseTexte: "text-[11px]", avatarTaille: 22, padRow: "py-1", texteNom: "text-xs", texteMeta: "text-[9px]" },
  "tres-compact": { label: "Très compact", colJour: 96, cellMinH: "min-h-[20px]", padCell: "p-0.5", caseTexte: "text-[10px]", avatarTaille: 0, padRow: "py-0.5", texteNom: "text-[11px]", texteMeta: "text-[9px]" },
};
// Sizing historique — vue mois et tout appelant sans `outils` (hors périmètre, cf. conception §7) :
// identique pixel pour pixel à avant ce chantier, jamais piloté par la densité.
const DENSITE_LEGACY: DensiteCfg = { label: "", colJour: 132, cellMinH: "min-h-[46px]", padCell: "p-1", caseTexte: "text-xs", avatarTaille: 30, padRow: "py-1.5", texteNom: "text-sm", texteMeta: "text-[10px]" };

/** Un réglage d'affichage mémorisé dans le navigateur (densité, lecture, regroupement) : rendu avec sa
 *  valeur par défaut au premier rendu (identique client/serveur, pas d'hydratation cassée), puis
 *  corrigé depuis `localStorage` une fois monté — même motif que `NoteRepliable` (Atelier Dominique). */
function usePersisted<T extends string>(cle: string, defaut: T): [T, (v: T) => void] {
  const [valeur, setValeur] = useState<T>(defaut);
  useEffect(() => {
    try {
      const stocke = window.localStorage.getItem(cle);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture d'un réglage persistant (localStorage), pas un miroir de props/état dérivable au rendu
      if (stocke) setValeur(stocke as T);
    } catch {
      // navigateur sans stockage : le réglage vaut pour la session
    }
  }, [cle]);
  const setPersiste = (v: T) => {
    setValeur(v);
    try { window.localStorage.setItem(cle, v); } catch { /* sans stockage, sans conséquence */ }
  };
  return [valeur, setPersiste];
}

/** Hauteur qui consomme l'espace réellement disponible sous l'en-tête de page (§3), au lieu d'un
 *  plafond figé en % d'écran. Mesurée via le DOM (position réelle du conteneur), jamais par un
 *  zoom/scale. Recalculée au redimensionnement et quand un <details> au-dessus (Réglages & légende)
 *  s'ouvre ou se ferme — cet événement ne bulle pas, on l'intercepte donc en phase de capture. */
function useHauteurDisponible(ref: React.RefObject<HTMLElement | null>, actif: boolean, margeBasse = 16): number | null {
  const [hauteur, setHauteur] = useState<number | null>(null);
  useEffect(() => {
    if (!actif) return;
    const calculer = () => {
      const top = ref.current?.getBoundingClientRect().top;
      if (top == null) return;
      // Plancher à 320px : jamais une grille écrasée au point d'être inutilisable. `calculer` est
      // appelée depuis des listeners (resize, toggle), pas au corps de l'effet : la règle ne s'applique
      // pas ici (elle ne vise que le set-state exécuté en ligne droite au montage).
      setHauteur(Math.max(320, window.innerHeight - top - margeBasse));
    };
    calculer();
    window.addEventListener("resize", calculer);
    document.addEventListener("toggle", calculer, true);
    return () => {
      window.removeEventListener("resize", calculer);
      document.removeEventListener("toggle", calculer, true);
    };
  }, [ref, actif, margeBasse]);
  return hauteur;
}

// Largeurs fixes → les blocs empilés (couverture, totaux, employés) gardent leurs colonnes alignées.
const COL_EMP = 190;
const gridCols = (n: number, w: number) => ({ display: "grid", gridTemplateColumns: `${COL_EMP}px repeat(${n}, ${w}px)` });
const fmtH = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1).replace(".", ",")}h`);

export function PlanningSemaine({
  groupes, jours, creneauMap, absences, shifts, besoins, peutModifier,
  autoSet = [], colJour = 132, afficherContrat = true, outils,
}: {
  groupes: SemaineGroupe[]; // toujours utilisé tel quel sur mobile (§3 : rien n'y change) ; sert aussi de secours desktop hors `outils`
  jours: SemaineJour[];
  creneauMap: Record<string, string>; // `${empId}_${iso}` -> shiftId
  absences: string[]; // clés `${empId}_${iso}` en congé approuvé
  shifts: ShiftDTO[];
  besoins: BesoinAgrege[];
  peutModifier: boolean;
  autoSet?: string[]; // clés `${empId}_${iso}` posées par la génération automatique (✨)
  colJour?: number; // largeur d'une colonne jour (réduite en vue mois) — ignorée sur desktop quand `outils` est fourni (la densité pilote alors la largeur)
  afficherContrat?: boolean; // afficher le ratio heures/contrat (semaine) ou juste les heures (mois)
  outils?: SemaineOutils; // active densité/lecture/regroupement (vue semaine desktop uniquement) — cf. SemaineOutils
}) {
  const [isPending, start] = useTransition();
  const parId = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);
  const absSet = useMemo(() => new Set(absences), [absences]);
  const autoKeys = useMemo(() => new Set(autoSet), [autoSet]);
  const [couvOuverte, setCouvOuverte] = useState(false); // détail de couverture par shift, replié par défaut

  // ---- Outils desktop de la vue semaine (§3-§5) : sans effet quand `outils` est absent (vue mois). ----
  const [densite, setDensite] = usePersisted<Densite>("planning:densite", "compact");
  const [lecture, setLecture] = usePersisted<Lecture>("planning:lecture", "personne");
  const [groupement, setGroupement] = usePersisted<CritereGroupe>("planning:groupement", "categorie");
  const tailleCfg = outils ? DENSITES[densite] : DENSITE_LEGACY;
  const colJourEffectif = outils ? tailleCfg.colJour : colJour;
  // Regroupement desktop : recalculé côté client depuis la liste plate (§5). Le mobile, lui, garde
  // toujours `groupes` tel que fourni par le serveur — jamais affecté par ce choix (§3, hors périmètre).
  const groupesDesktop = useMemo(
    () => (outils ? grouperSalaries(outils.employees, groupement) : groupes),
    [outils, groupement, groupes],
  );
  const allEmps = useMemo(() => groupesDesktop.flatMap((g) => g.employees), [groupesDesktop]);
  // Pivot « Par shift » (§4) : lecture seule, calculé uniquement quand sollicité.
  const lignesShift = useMemo(
    () => (outils && lecture === "shift" ? pivoterParShift({ jours, creneaux: outils.creneaux, employees: outils.employees, besoins: outils.besoinsPoste, absences: absSet, shifts }) : []),
    [outils, lecture, jours, absSet, shifts],
  );
  // §3 : la grille consomme l'espace réellement disponible sous l'en-tête de page au lieu d'un
  // plafond figé (max-h-[74vh]) — seulement pour la vue semaine (`outils` fourni) ; le mois n'y touche pas.
  const conteneurRef = useRef<HTMLDivElement>(null);
  const hauteurDispo = useHauteurDisponible(conteneurRef, Boolean(outils));

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

  const largeur = COL_EMP + jours.length * colJourEffectif;

  return (
    <div>
      {/* ---------- BUREAU ---------- */}
      <div className="hidden lg:block">
        {/* Outils de la vue semaine (§3-§5) : lecture, regroupement (masqué en lecture « Par shift »,
            sans objet — les lignes sont déjà des shifts), densité. Absents en vue mois. */}
        {outils && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <select value={lecture} onChange={(e) => setLecture(e.target.value as Lecture)} aria-label="Lecture du planning" className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring">
              <option value="personne">Lecture : Par personne</option>
              <option value="shift">Lecture : Par shift</option>
            </select>
            {lecture === "personne" && (
              <select value={groupement} onChange={(e) => setGroupement(e.target.value as CritereGroupe)} aria-label="Regrouper les lignes par" className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring">
                <option value="categorie">Grouper : Catégorie</option>
                <option value="poste">Grouper : Poste</option>
                <option value="aucun">Grouper : Aucun</option>
              </select>
            )}
            <select value={densite} onChange={(e) => setDensite(e.target.value as Densite)} aria-label="Densité d'affichage" className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring">
              <option value="confort">Densité : {DENSITES.confort.label}</option>
              <option value="compact">Densité : {DENSITES.compact.label}</option>
              <option value="tres-compact">Densité : {DENSITES["tres-compact"].label}</option>
            </select>
          </div>
        )}

        {peutModifier && lecture === "personne" && sel.size > 0 && (
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

        {/* §3 : plus de plafond figé (max-h-[74vh]) en vue semaine — la hauteur consomme l'espace
            réellement disponible sous l'en-tête de page (mesurée en DOM, cf. useHauteurDisponible). La
            vue mois (`outils` absent) garde son plafond d'origine, à l'identique. */}
        <div
          ref={conteneurRef}
          style={outils ? { maxHeight: hauteurDispo ?? undefined } : undefined}
          className={`overflow-auto rounded-2xl border bg-card [scrollbar-gutter:stable] ${outils ? "" : "max-h-[74vh]"}`}
        >
          <div style={{ minWidth: largeur }}>
            {/* Bandeau récap — clic sur le titre = déplier/replier le détail par shift */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
              <button type="button" onClick={() => setCouvOuverte((o) => !o)} className="flex items-center gap-1.5 text-sm font-semibold hover:text-primary" aria-expanded={couvOuverte}>
                <span aria-hidden className={`text-xs transition-transform ${couvOuverte ? "rotate-90" : ""}`}>▸</span>
                Couverture des besoins
              </button>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
                {/* Pastilles par shift affichées seulement quand le détail est déplié (épure l'en-tête). */}
                {couvOuverte && shiftsCouverture.map((s) => (
                  <span key={s.id} className={`rounded-full px-2 py-0.5 uppercase tracking-wide ${paletteDe(s.couleur).classe}`}>{s.nom} : {requisSemaineParShift(s.id)}</span>
                ))}
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 tabular-nums">{fmtH(heuresSemaine)}</span>
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 tabular-nums">👤 {allEmps.length}</span>
              </div>
            </div>

            {/* Lignes de couverture par shift (repliables) */}
            {couvOuverte && shiftsCouverture.map((s) => (
              <div key={s.id} style={gridCols(jours.length, colJourEffectif)} className="border-b">
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
            <div style={gridCols(jours.length, colJourEffectif)} className="border-b bg-muted/30">
              <div className="sticky left-0 z-[1] border-r bg-card px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total / jour</div>
              {jours.map((j, i) => (
                <div key={j.iso} className={`border-l px-1 py-1.5 text-center ${j.aujourdhui ? "bg-primary/10" : ""}`}>
                  <div className="text-xs font-semibold tabular-nums">{fmtH(totJour[i].heures)}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">👤 {totJour[i].personnes}</div>
                </div>
              ))}
            </div>

            {/* En-tête jours */}
            <div style={gridCols(jours.length, colJourEffectif)} className="sticky top-0 z-10 border-b bg-card">
              <div className="sticky left-0 z-[2] flex items-center gap-2 border-r bg-card px-3 py-2">
                {peutModifier && lecture === "personne" && <input type="checkbox" checked={allEmps.length > 0 && allEmps.every((e) => sel.has(e.id))} onChange={(e) => setSel(e.target.checked ? new Set(allEmps.map((x) => x.id)) : new Set())} aria-label="Tout sélectionner" />}
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{lecture === "shift" ? "Shift · poste" : "Collaborateurs"}</span>
              </div>
              {jours.map((j) => (
                <div key={j.iso} className={`border-l px-1 py-2 text-center text-xs font-semibold uppercase tracking-wide ${j.aujourdhui ? "bg-primary/10 text-primary" : j.ferie ? "text-purple-700" : j.dimanche ? "text-orange-700" : "text-muted-foreground"}`}>
                  {j.label}{j.aujourdhui && <span className="ml-1 text-[9px]">•</span>}
                </div>
              ))}
            </div>

            {/* Lignes : « Par personne » (groupes, éditable) ou « Par shift » (pivot, lecture seule — §4) */}
            {lecture === "personne" ? (
              groupesDesktop.map((g) => (
                <div key={g.titre}>
                  <div className="border-b bg-muted/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.titre} · {g.employees.length}</div>
                  {g.employees.map((e) => {
                    const hp = heuresEmp(e.id);
                    const sous = hp < e.heuresHebdo;
                    return (
                      <div key={e.id} style={gridCols(jours.length, colJourEffectif)} className={`border-b last:border-0 ${sel.has(e.id) ? "bg-primary/5" : "hover:bg-accent/20"}`}>
                        <div className={`sticky left-0 z-[1] flex items-center gap-2 border-r bg-card px-3 ${tailleCfg.padRow}`}>
                          {peutModifier && <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggleEmp(e.id)} className="shrink-0" aria-label={`Sélectionner ${e.nom}`} />}
                          {tailleCfg.avatarTaille > 0 ? (
                            <Avatar nom={e.nom} taille={tailleCfg.avatarTaille} photoUrl={e.photoUrl} />
                          ) : (
                            // Très compact (§3) : pas d'avatar, initiales seules.
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground" aria-hidden title={e.nom}>{initiales(e.nom)}</span>
                          )}
                          <span className="min-w-0">
                            <Link href={`/employes/${e.id}`} className={`block truncate ${tailleCfg.texteNom} font-medium hover:text-primary hover:underline`}>{e.nom}</Link>
                            <span className={`block ${tailleCfg.texteMeta} tabular-nums ${afficherContrat && sous ? "text-muted-foreground" : "text-emerald-700"}`}>{afficherContrat ? `${fmtH(hp)} / ${fmtH(e.heuresHebdo)}` : fmtH(hp)}</span>
                          </span>
                        </div>
                        {jours.map((j) => (
                          <div key={j.iso} className={`border-l ${tailleCfg.padCell} ${j.aujourdhui ? "bg-primary/5" : ""}`}>
                            {celluleCarte(e.id, j, tailleCfg)}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {g.employees.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">Aucun employé.</div>}
                </div>
              ))
            ) : lignesShift.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">Aucun shift ni besoin déclaré cette semaine.</div>
            ) : (
              lignesShift.map((ligne) => {
                const s = parId.get(ligne.shiftId);
                const pal = paletteDe(s?.couleur ?? "indigo");
                return (
                  <div key={`${ligne.shiftId}|${ligne.poste}`} style={gridCols(jours.length, colJourEffectif)} className="border-b last:border-0">
                    <div className={`sticky left-0 z-[1] flex items-center gap-2 border-r bg-card px-3 ${tailleCfg.padRow}`}>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: pal.hex.text }} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">{s?.nom ?? ligne.shiftId}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{ligne.poste}</span>
                      </span>
                    </div>
                    {jours.map((j, i) => {
                      const c = ligne.jours[i];
                      // Même convention de couleur que le panneau « Couverture des besoins » ci-dessus :
                      // complet en vert, incomplet en orange. Pas une seconde convention pour la même info.
                      const complet = c.requis != null && c.personnes.length >= c.requis;
                      return (
                        <div key={j.iso} className={`flex flex-col items-center justify-center gap-0.5 border-l px-1 ${tailleCfg.padRow} text-center ${j.aujourdhui ? "bg-primary/5" : ""}`}>
                          {c.personnes.length === 0 && c.requis === null ? (
                            <span className="text-[11px] text-muted-foreground/40">—</span>
                          ) : (
                            <>
                              {c.personnes.length > 0 && (
                                <span className={`max-w-full truncate ${tailleCfg.caseTexte}`} title={c.personnes.map((p) => p.nom).join(", ")}>
                                  {densite === "tres-compact" ? c.personnes.map((p) => initiales(p.nom)).join(" ") : c.personnes.map((p) => p.nom).join(", ")}
                                </span>
                              )}
                              {c.requis != null && (
                                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${complet ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"}`}>{c.personnes.length}/{c.requis}</span>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
        {isPending && <p className="mt-2 text-xs text-muted-foreground">Enregistrement…</p>}
        {outils && lecture === "shift" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Lecture seule : cette vue montre qui tient chaque shift, elle ne se modifie pas ici — la
            saisie reste dans la lecture <span className="font-medium">Par personne</span>.
          </p>
        )}
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

  // Rendu d'une cellule : carte de shift, ou Absence / Férié / Repos. `cfg` pilote la taille (§3) :
  // le mobile ne le passe jamais, donc reste toujours sur `DENSITE_LEGACY` — inchangé quel que soit
  // le réglage choisi côté desktop.
  function celluleCarte(empId: string, j: SemaineJour, cfg: DensiteCfg = DENSITE_LEGACY) {
    const sid = shiftDe(empId, j.iso);
    const s = parId.get(sid);
    const enConge = absSet.has(`${empId}_${j.iso}`);
    const base = `flex w-full flex-col justify-center rounded-lg px-2 py-1.5 text-left ${cfg.caseTexte} ${cfg.cellMinH} transition`;
    const clic = peutModifier ? "cursor-pointer" : "cursor-default";

    if (s) {
      const pal = paletteDe(s.couleur);
      // ✨ si posé par la génération auto — sauf si l'utilisateur vient de le modifier localement.
      const auto = autoKeys.has(`${empId}_${j.iso}`) && !(`${empId}_${j.iso}` in edits);
      const aHoraire = Boolean(s.heureDebut && s.heureFin);
      // Épuration : la COULEUR porte le rôle (voir légende), les HORAIRES sont le texte principal ;
      // le nom du shift revient au survol (title). Sans horaires, on affiche le nom (rien d'autre).
      return (
        <button type="button" disabled={!peutModifier} onClick={(ev) => ouvrirMenu(ev, empId, j.iso)} style={{ backgroundColor: pal.hex.bg, color: pal.hex.text }}
          title={`${s.nom}${aHoraire ? ` · ${s.heureDebut}–${s.heureFin}` : ""}${auto ? " (généré automatiquement)" : ""}`}
          className={`${base} ${clic} relative items-center justify-center text-center font-semibold hover:brightness-95`}>
          {aHoraire ? <span className="tabular-nums">{s.heureDebut}–{s.heureFin}</span> : <span className="truncate">{s.nom}</span>}
          {auto && <span aria-hidden title="Généré automatiquement" className="absolute right-1 top-1 text-[9px] opacity-60">✨</span>}
        </button>
      );
    }
    if (enConge) return <div className={`${base} items-center justify-center bg-amber-50 text-center font-medium text-amber-700`}>Congé</div>;
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
