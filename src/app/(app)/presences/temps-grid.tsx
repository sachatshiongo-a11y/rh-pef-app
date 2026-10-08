"use client";

// Grille FUSIONNÉE présences + heures (option A « menu au clic ») : chaque case-jour est une
// mini-carte façon planning (code coloré + heures) ; un clic ouvre un menu unique qui règle
// code ET heures. Écrit dans les mêmes tables qu'avant (Attendance / OvertimeEntry) via les
// actions existantes — la fusion est purement visuelle et réversible (cf. commit).
//
// Écran de TRAVAIL (refonte du 2026-10-08) : plus de tableau à double défilement. La page défile,
// jamais un conteneur interne ; la barre d'actions groupées et l'en-tête des jours se collent
// ensemble sous l'en-tête de la coquille (`colle-sous-entete`). Trois vues sur les mêmes données :
//  - Semaine (défaut) : lundi → dimanche, 7 grandes cases (code + heures + horaire) ;
//  - Mois : une lettre par case, colonnes étroites calculées, horaire au survol / dans le menu ;
//  - Employé : son mois en calendrier (ordinateur) ou en liste verticale (téléphone).
// Téléphone : jamais de grille, la liste d'UN jour à la fois (cibles de 44 px).

import { EtatVide } from "@/components/etat-vide";
import { Icone } from "@/components/icones";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { saisirPresence, saisirPresencesEnLot } from "./actions";
import { saisirHeures, saisirHeuresEnLot } from "../heures-supp/actions";
import { COULEUR_CODE_HEX, LIBELLE_CODE } from "./attendance-colors";
import { infoHoraire, type InfoShift } from "./horaire-case";
import { CaseCalendrier, CaseMois, CaseSemaine, fmtH, type PropsCase } from "./cases-presences";
import { semaineDuJour, semaineParDefaut, semainesDuMois } from "./semaines";
import { useVuePresences } from "./vue-presences";
import { useJourMobile } from "@/components/jour-mobile";
import { CelluleNombre, type ContexteCase } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import { LIBELLE_PAUSE_PAR_DEFAUT } from "@/lib/pointage-qr";
import { libelleJourLong } from "@/lib/jour-mobile";
import { lireSaisieNombre, versSaisie } from "@/lib/nombre";
import {
  calculerHeuresSupp,
  resumerPresences,
  type CodePresence,
  type ParametresPaie,
} from "@/lib/payroll";
import type { AttendanceCode } from "@prisma/client";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";

export type { InfoShift } from "./horaire-case";

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

type Scope = "jour-affiche" | "semaine" | "mois" | "ouvrables" | "feries" | "alternes" | "jour" | "periode" | "coches";
type Variante = "bureau" | "telephone";
type Direction = "droite" | "gauche" | "bas" | "haut";
type Voisin = (dir: Direction) => [string, number] | null;

const JOURS_COURTS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const INITIALES_JOURS = ["L", "M", "M", "J", "V", "S", "D"];

const CHAMP_LOT = "rounded border border-input bg-background px-2 py-1 text-xs max-lg:h-11 max-lg:text-base";
const BOUTON_FLECHE_JOUR = "flex h-11 w-11 shrink-0 items-center justify-center rounded-md border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40";

/** Rang du jour dans la semaine (lundi = 0) d'une date AAAA-MM-JJ. */
const rangSemaine = (iso: string) => (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7;

export function TempsGrid({
  employees,
  days,
  attendanceMap,
  hoursMap,
  shiftMap = {},
  peutModifier,
  peutEffacer = false,
  isoDates,
  joursFeries,
  params,
  titre,
}: {
  employees: EmployeeRow[];
  days: number[];
  attendanceMap: Record<string, string>; // `${employeeId}_${day}` -> code
  hoursMap: Record<string, number>; // `${employeeId}_${day}` -> heures
  shiftMap?: Record<string, InfoShift>; // `${employeeId}_${day}` -> shift du jour (réel > planning > modèle)
  peutModifier: boolean;
  /** Direction seulement : vider une présence déjà saisie est une suppression (« Supprimer »,
   *  « Effacer », touche Suppr). Le responsable remplace le code ; le serveur refuse de toute façon. */
  peutEffacer?: boolean;
  isoDates: string[]; // isoDates[day-1] = "YYYY-MM-DD"
  joursFeries: Set<string>;
  params: ParametresPaie;
  /** Titre de la section (« Brigade », « Back-office ») : masqué avec elle quand la vue Employé
   *  ne concerne pas ce groupe. */
  titre?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

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

  // ── Vue, semaine affichée, employé consulté (état partagé de la page) ────
  const isoAuj = jourCourantKinshasaISO();
  const [annee, mois] = (isoDates[0] ?? "2000-01-01").split("-").map(Number);
  const semaines = useMemo(() => (isoDates.length > 0 ? semainesDuMois(annee, mois, days.length) : []), [annee, mois, days.length, isoDates.length]);
  const etatVue = useVuePresences(semaineParDefaut(semaines, isoAuj));
  const { vue, setVue, employeId } = etatVue;
  const semIdx = Math.min(Math.max(etatVue.semaine, 0), Math.max(semaines.length - 1, 0));
  const semaineAffichee = semaines[semIdx];
  const joursSemaine = (semaineAffichee?.jours ?? []).filter((j): j is number => j !== null);
  const empVue = vue === "employe" ? employees.find((e) => e.id === employeId) ?? null : null;

  // ── Menu au clic (popover façon planning) ────────────────────────────────
  const [pop, setPop] = useState<{
    empId: string;
    day: number;
    x: number;
    y: number;
    code: string;
    heures: string;
    horaire: string;
    erreur?: string;
  } | null>(null);

  function ouvrirMenu(ev: React.MouseEvent<HTMLButtonElement>, empId: string, day: number) {
    if (!peutModifier) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const c = cel(empId, day);
    const emp = employees.find((e) => e.id === empId);
    const hs = emp ? infoHoraire(c, shiftMap[`${empId}_${day}`], emp.heuresParJour) : null;
    const largeur = 300;
    const x = Math.min(Math.max(8, r.left), window.innerWidth - largeur - 8);
    const y = r.bottom + 6 > window.innerHeight - 260 ? r.top - 266 : r.bottom + 6;
    // Heures écrites PAR LE PROGRAMME dans le champ : à la française (« 7,5 »), relues par lireSaisieNombre.
    setPop({ empId, day, x, y, code: c.code, heures: c.heures === null ? "" : versSaisie(c.heures), horaire: hs?.titre.trim() ?? "" });
  }

  // ── Écritures (optimistes, mêmes actions serveur qu'avant) ───────────────
  function ecrireCode(empId: string, day: number, code: string) {
    const k = `${empId}_${day}`;
    const avant = cel(empId, day);
    setCellules((c) => ({ ...c, [k]: { ...avant, code } }));
    startTransition(async () => {
      const res = await saisirPresence(empId, isoDates[day - 1], code as AttendanceCode | "");
      if (res?.erreur) {
        // Refus (effacement réservé à la Direction) : rien n'a été écrit, la case revient.
        setCellules((c) => ({ ...c, [k]: avant }));
        setNote(res.erreur);
        return;
      }
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
  // Case « heures » des listes (téléphone, vue Employé) : enregistrée à la sortie de la case —
  // avant, CHAQUE frappe envoyait l'action (et rechargeait /presences, /paie…). Un échec reste
  // affiché sur la case.
  function enregistrerHeuresCase(v: number | null, { ligne: empId, precedente, donnee: iso }: ContexteCase) {
    // Jour FIGÉ à la validation de la case (donnee = date ISO), même si l'on a changé de jour depuis.
    const jour = iso ? isoDates.indexOf(iso) + 1 : jourMobile;
    const k = `${empId}_${jour}`;
    setCellules((c) => ({ ...c, [k]: { ...(c[k] ?? { code: "" }), heures: v } }));
    return saisirHeures(empId, isoDates[jour - 1], v === null ? "" : String(v)).catch((e: unknown) => {
      // Échec : la valeur locale est annulée (les totaux ne comptent pas des heures non
      // enregistrées) ; la case reste en rouge et le message s'affiche sous la liste.
      setCellules((c) => ({ ...c, [k]: { ...(c[k] ?? { code: "" }), heures: precedente } }));
      throw e;
    });
  }
  /** Changer de jour (téléphone) : la case en cours de frappe est d'abord quittée — donc enregistrée. */
  function changerJour(n: number) {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setIdxMobile(n);
  }
  function validerMenu() {
    if (!pop) return;
    // Heures illisibles ou hors 0–24 : le menu reste ouvert et le dit (avant : fermé sans rien écrire).
    const lu = lireSaisieNombre(pop.heures);
    if (!lu.ok || (lu.valeur !== null && (lu.valeur < 0 || lu.valeur > 24))) {
      setPop({ ...pop, erreur: "Heures invalides : un nombre entre 0 et 24 (ex. 7,5)." });
      return;
    }
    const avant = cel(pop.empId, pop.day);
    if (pop.code !== avant.code) ecrireCode(pop.empId, pop.day, pop.code);
    if (lu.valeur !== avant.heures) ecrireHeures(pop.empId, pop.day, lu.valeur === null ? "" : String(lu.valeur));
    setPop(null);
  }
  function effacerMenu() {
    if (!pop) return;
    ecrireCode(pop.empId, pop.day, "");
    ecrireHeures(pop.empId, pop.day, "");
    setPop(null);
  }

  // ── Navigation clavier façon tableur (lettres = codes, flèches = déplacement) ──
  function celluleAt(empId: string, jour: number) {
    return gridRef.current?.querySelector<HTMLButtonElement>(`button[data-emp="${empId}"][data-day="${jour}"]`);
  }
  /** `voisin(direction)` : la case voisine [employé, jour], selon la vue (ligne ± 1 / jour ± 1, ou jour ± 7 en calendrier). */
  function clavier(ev: React.KeyboardEvent<HTMLButtonElement>, empId: string, day: number, voisin: Voisin) {
    const lettre = ev.key.toUpperCase();
    // Cmd/Ctrl/Alt + lettre est un raccourci du navigateur (copier, coller…), jamais un code de présence.
    const raccourci = ev.ctrlKey || ev.metaKey || ev.altKey;
    if (peutModifier && !raccourci && CODES_SET.has(lettre)) {
      ev.preventDefault();
      ecrireCode(empId, day, lettre);
      const suivante = voisin("droite");
      if (suivante) celluleAt(suivante[0], suivante[1])?.focus();
      return;
    }
    if (peutModifier && peutEffacer && (ev.key === "Backspace" || ev.key === "Delete")) {
      ev.preventDefault();
      ecrireCode(empId, day, "");
      ecrireHeures(empId, day, "");
      return;
    }
    const dir: Direction | undefined = ({ ArrowRight: "droite", ArrowLeft: "gauche", ArrowDown: "bas", ArrowUp: "haut" } as Record<string, Direction>)[ev.key];
    if (!dir) return;
    const cible = voisin(dir);
    if (cible) {
      ev.preventDefault();
      celluleAt(cible[0], cible[1])?.focus();
    }
  }

  // ── Jours spéciaux ────────────────────────────────────────────────────────
  const estDimanche = (d: number) => new Date(isoDates[d - 1] + "T00:00:00Z").getUTCDay() === 0;
  const estFerie = (d: number) => joursFeries.has(isoDates[d - 1]);
  const estMajore = (d: number) => estDimanche(d) || estFerie(d);

  // ── Actions groupées (code ET/OU heures en un passage) ───────────────────
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [joursSel, setJoursSel] = useState<Set<number>>(new Set());
  const [bulkCode, setBulkCode] = useState<string>("P");
  const [bulkHeures, setBulkHeures] = useState<string>("");
  const [scopeBureau, setScopeBureau] = useState<Scope | null>(null);
  const [scopeTel, setScopeTel] = useState<Scope | null>(null);
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
  function toggleJour(d: number) {
    setJoursSel((s) => {
      const n = new Set(s);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  }
  // Jours cochés VISIBLES : un jour coché dans une autre semaine ne part jamais en silence.
  const joursVisibles = vue === "semaine" ? joursSemaine : days;
  const joursCoches = joursVisibles.filter((d) => joursSel.has(d));

  /** Les portées proposées, selon la vue et l'appareil (l'ordre est celui du menu). */
  function portees(variante: Variante): Scope[] {
    if (vue === "employe") return ["coches", "mois", "ouvrables", "feries", "alternes", "jour", "periode"];
    if (variante === "telephone") return ["jour-affiche", "semaine", "mois", "ouvrables", "feries", "jour", "periode"];
    if (vue === "semaine") return ["semaine", "mois", "ouvrables", "feries", "alternes", "jour", "periode", "coches"];
    return ["mois", "ouvrables", "feries", "alternes", "jour", "periode", "coches"];
  }
  function porteeChoisie(variante: Variante): Scope {
    const choisie = variante === "bureau" ? scopeBureau : scopeTel;
    return choisie && portees(variante).includes(choisie) ? choisie : portees(variante)[0];
  }
  function libellePortee(s: Scope, variante: Variante): string {
    switch (s) {
      case "jour-affiche": return "ce jour";
      case "semaine": return variante === "telephone" ? "toute la semaine" : "la semaine affichée";
      case "mois": return "tout le mois";
      // Ces portées ne regardent PAS la semaine affichée : elles couvrent le mois entier, et le disent.
      case "ouvrables": return "jours ouvrables du mois (hors dimanche et fériés)";
      case "feries": return "jours fériés du mois";
      case "alternes": return "1 jour sur 2 dans le mois";
      case "jour": return "jours précis du mois";
      case "periode": return "période du mois (du jour… au jour…)";
      case "coches": return `jours cochés (${joursCoches.length})`;
    }
  }
  function joursCibles(scope: Scope, variante: Variante): number[] {
    if (scope === "jour-affiche") return [jourMobile];
    if (scope === "semaine") {
      const s = variante === "telephone" ? semaines[semaineDuJour(semaines, jourMobile)] : semaineAffichee;
      return (s?.jours ?? []).filter((j): j is number => j !== null);
    }
    if (scope === "coches") return joursCoches;
    if (scope === "jour")
      return bulkJour.split(/[,\s]+/).map(Number).filter((j) => Number.isInteger(j) && j >= 1 && j <= days.length);
    if (scope === "ouvrables") return days.filter((d) => !estMajore(d));
    if (scope === "feries") return days.filter((d) => estFerie(d));
    if (scope === "periode") {
      const du = Math.max(1, Number(bulkDu) || 1);
      const au = Math.min(days.length, Number(bulkAu) || days.length);
      return days.filter((d) => d >= du && d <= au && !estMajore(d));
    }
    if (scope === "alternes") {
      const debut = Math.max(1, Number(bulkAlterneDebut) || 1);
      return days.filter((d) => d >= debut && (d - debut) % 2 === 0 && !estMajore(d));
    }
    return [...days];
  }
  /** Employés du lot : les cochés ; en vue Employé, l'employé consulté. */
  const empsDuLot = (): string[] => (vue === "employe" ? (empVue ? [empVue.id] : []) : [...selection]);

  /** Applique le lot : code (sauf « inchangé ») et/ou heures (si renseignées). vider=true efface tout. */
  function appliquerBulk(vider: boolean, variante: Variante) {
    const emps = empsDuLot();
    const cibles = joursCibles(porteeChoisie(variante), variante);
    if (emps.length === 0 || cibles.length === 0) return;
    const code = vider ? "" : bulkCode; // "KEEP" = ne pas changer le code
    // Champ texte (plus de type=number) : une saisie illisible ne doit JAMAIS partir au serveur,
    // qui lirait NaN comme « effacer les heures » sur tous les jours ciblés.
    const luHeures = lireSaisieNombre(bulkHeures);
    if (!vider && (!luHeures.ok || (luHeures.valeur !== null && (luHeures.valeur < 0 || luHeures.valeur > 24)))) {
      setNote("Heures invalides : un nombre entre 0 et 24 (ex. 7,5), ou laisser vide pour ne pas les changer.");
      return;
    }
    const heures = vider || !luHeures.ok || luHeures.valeur === null ? "" : String(luHeures.valeur);
    const faireCode = vider || code !== "KEEP";
    const faireHeures = vider || heures !== "";
    if (!faireCode && !faireHeures) return;

    const avantLot = cellules; // pour revenir en arrière si le serveur refuse le lot
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
        const { ignores, erreur } = await saisirPresencesEnLot(entrees);
        if (erreur) {
          // Lot refusé en entier (il viderait une présence saisie) : rien n'a été écrit.
          setCellules(avantLot);
          setNote(erreur);
          return;
        }
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
  const totauxDe = (id: string) => totaux[id] ?? { p100: 0, p23: 0, np: 0, h: 0, hs: 0, hsVal: 0 };
  /** Somme simple des heures saisies sur les jours de la semaine affichée (lecture, aucun calcul de paie). */
  const heuresDeLaSemaine = (id: string) => joursSemaine.reduce((t, d) => t + (cel(id, d).heures ?? 0), 0);

  // ── Téléphone : un jour à la fois ────────────────────────────────────────
  const idxAuj = isoDates.indexOf(isoAuj);
  const [idxMobile, setIdxMobile] = useJourMobile(idxAuj >= 0 ? idxAuj : 0);
  const jourMobile = days[idxMobile] ?? days[0] ?? 1;

  const couleurDe = (code: string) => COULEUR_CODE_HEX[code as CodePresence];

  function ouvrirEmploye(id: string) {
    setVue("employe", id);
  }

  /** Les propriétés communes d'une case (code, heures, horaire, libellés) pour les trois vues. */
  function propsCase(e: EmployeeRow, d: number, voisin: Voisin): PropsCase {
    const info = shiftMap[`${e.id}_${d}`];
    const c = cel(e.id, d);
    const hs = infoHoraire(c, info, e.heuresParJour);
    const quand = libelleJourLong(isoDates[d - 1]);
    const resume = `${c.code ? LIBELLE_CODE[c.code as CodePresence] : "aucun code"}${c.heures ? `, ${fmtH(c.heures)} h` : ""}`;
    const aide = peutModifier ? ` Clic : menu code + heures. Ou tapez une lettre (P, O, M…)${peutEffacer ? " ; Suppr efface" : ""} ; flèches pour naviguer.` : "";
    return {
      emp: e.id,
      day: d,
      code: c.code,
      heures: c.heures,
      supp: hs.supp,
      horaire: hs.horaire,
      reel: !!info?.reel,
      pauseParDefaut: !!info?.pauseParDefaut,
      couleur: couleurDe(c.code),
      disabled: !peutModifier,
      title: `${e.nom} — ${quand} : ${resume}.${aide}${hs.titre}`.trim(),
      libelle: `${e.nom}, ${quand} : ${resume}${hs.horaire ? `, ${hs.horaire}` : ""}`,
      onClick: (ev) => ouvrirMenu(ev, e.id, d),
      onKeyDown: (ev) => clavier(ev, e.id, d, voisin),
    };
  }

  // ── Barre d'actions groupées (collée sous l'en-tête de la coquille) ──────
  function barreLot(variante: Variante) {
    if (!peutModifier) return null;
    const nbLignes = vue === "employe" ? days.length : employees.length;
    const nbCoche = vue === "employe" ? joursCoches.length : selection.size;
    const portee = porteeChoisie(variante);
    const choisirPortee = variante === "bureau" ? setScopeBureau : setScopeTel;
    const prete = empsDuLot().length > 0 && joursCibles(portee, variante).length > 0;
    return (
      <div
        data-barre-lot={variante}
        className={`flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm ${variante === "bureau" ? "max-lg:hidden" : "lg:hidden"}`}
      >
        <label className="flex items-center gap-2 font-medium max-lg:min-h-11">
          <input
            type="checkbox"
            className="max-lg:h-5 max-lg:w-5"
            checked={nbLignes > 0 && nbCoche === nbLignes}
            ref={(el) => { if (el) el.indeterminate = nbCoche > 0 && nbCoche < nbLignes; }}
            onChange={(e) => {
              if (vue === "employe") setJoursSel(e.target.checked ? new Set(days) : new Set());
              else setSelection(e.target.checked ? new Set(employees.map((x) => x.id)) : new Set());
            }}
            aria-label={vue === "employe" ? "Cocher tous les jours" : "Tout sélectionner"}
          />
          {vue === "employe" ? "Tous les jours" : "Tout sélectionner"}
        </label>
        <span className="text-muted-foreground">
          {vue === "employe" ? `${nbCoche} jour(s) coché(s)` : `${nbCoche} employé(s) sélectionné(s)`}
        </span>
        {nbCoche === 0 && (
          <span className="text-xs text-muted-foreground max-lg:hidden">
            {vue === "employe" ? "Cochez des jours pour saisir en lot." : "Cochez des employés pour saisir en lot."}
          </span>
        )}
        {nbCoche > 0 && (
          <>
            <span className="text-muted-foreground max-lg:hidden">→ code</span>
            <select value={bulkCode} onChange={(e) => setBulkCode(e.target.value)} className={`${CHAMP_LOT} max-lg:w-24`} aria-label="Code à appliquer">
              <option value="KEEP">(inchangé)</option>
              {CODES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <input type="text" inputMode="decimal" autoComplete="off" value={bulkHeures} onChange={(e) => setBulkHeures(e.target.value)} placeholder="Heures (inchangées)" aria-label="Heures à appliquer" className={`w-40 ${CHAMP_LOT} max-lg:min-w-0 max-lg:flex-1`} />
            <span className="text-muted-foreground max-lg:hidden">sur</span>
            <select value={portee} onChange={(e) => choisirPortee(e.target.value as Scope)} className={`${CHAMP_LOT} max-lg:min-w-0 max-lg:basis-full`} aria-label="Jours concernés">
              {portees(variante).map((s) => (<option key={s} value={s}>{libellePortee(s, variante)}</option>))}
            </select>
            {portee === "jour" && (
              <input type="text" value={bulkJour} onChange={(e) => setBulkJour(e.target.value)} placeholder="ex. 3, 5, 12" aria-label="Jours précis" className={`w-24 ${CHAMP_LOT}`} />
            )}
            {portee === "periode" && (
              <span className="flex items-center gap-1 text-xs">du jour
                <input type="text" inputMode="numeric" autoComplete="off" value={bulkDu} onChange={(e) => setBulkDu(e.target.value)} aria-label="Premier jour" className={`w-14 ${CHAMP_LOT}`} />
                au
                <input type="text" inputMode="numeric" autoComplete="off" value={bulkAu} onChange={(e) => setBulkAu(e.target.value)} aria-label="Dernier jour" className={`w-14 ${CHAMP_LOT}`} />
              </span>
            )}
            {portee === "alternes" && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">à partir du jour
                <input type="text" inputMode="numeric" autoComplete="off" value={bulkAlterneDebut} onChange={(e) => setBulkAlterneDebut(e.target.value)} className={`w-14 ${CHAMP_LOT}`} />
              </label>
            )}
            <button
              onClick={() => appliquerBulk(false, variante)}
              disabled={isPending || !prete || (bulkCode === "KEEP" && bulkHeures.trim() === "")}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50 max-lg:min-h-11 max-lg:flex-1 max-lg:text-sm"
            >
              Appliquer
            </button>
            {peutEffacer && <button
              onClick={() => appliquerBulk(true, variante)}
              disabled={isPending || !prete}
              className="rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive disabled:opacity-50 max-lg:min-h-11 max-lg:flex-1 max-lg:text-sm"
              title="Effacer code ET heures des employés sélectionnés sur les jours ciblés"
            >
              Supprimer
            </button>}
            <button onClick={() => { setSelection(new Set()); setJoursSel(new Set()); }} className="text-xs text-muted-foreground underline max-lg:min-h-11">Désélectionner</button>
          </>
        )}
        {isPending && <span className="text-xs text-muted-foreground">Enregistrement…</span>}
      </div>
    );
  }

  // ── Colonnes des vues Semaine / Mois : grille CSS, jamais de défilement interne ──
  // Le nom prend 9,5 à 14 rem ; les jours se partagent le reste (`minmax(0,1fr)`) : la largeur
  // d'une colonne est CALCULÉE, la grille tient dans la page à toute largeur d'ordinateur.
  const colonnes = vue === "mois"
    ? `minmax(9rem,12rem) repeat(${days.length},minmax(0,1fr))`
    : "minmax(9.5rem,14rem) repeat(7,minmax(0,1fr))";

  /** En-tête d'un jour (bouton qui coche le jour pour une action groupée). */
  function enteteJour(d: number | null, iso: string, rang: number, compact: boolean) {
    if (d === null) {
      return (
        <div key={iso} role="columnheader" className="flex flex-col items-center justify-center border-l py-1.5 text-muted-foreground/50" title="Hors de la période de travail affichée">
          <span className="text-[11px] uppercase">{JOURS_COURTS[rang]}</span>
          <span className="text-xs tabular-nums">{Number(iso.slice(8, 10))}</span>
        </div>
      );
    }
    const majore = estMajore(d);
    const auj = iso === isoAuj;
    const coche = joursSel.has(d);
    const nom = `${libelleJourLong(iso)}${estFerie(d) ? " (férié)" : ""}`;
    return (
      <div key={iso} role="columnheader" className={`min-w-0 border-l ${majore ? "bg-orange-100" : ""}`} title={majore ? "Dimanche ou jour férié — heures payées double" : undefined}>
        <button
          type="button" disabled={!peutModifier} onClick={() => toggleJour(d)} aria-pressed={coche}
          aria-label={peutModifier ? `Cocher ${nom} pour une action groupée` : nom}
          title={peutModifier ? "Cliquer pour cocher ce jour (action groupée)" : undefined}
          className={`flex w-full flex-col items-center justify-center leading-none disabled:cursor-default ${compact ? "gap-0.5 py-1" : "gap-1 py-1.5"} ${coche ? "bg-primary/15 ring-2 ring-inset ring-primary" : peutModifier ? "hover:bg-accent/60" : ""}`}
        >
          <span className={`uppercase text-muted-foreground ${compact ? "text-[9px]" : "text-[11px]"}`}>{compact ? INITIALES_JOURS[rang] : JOURS_COURTS[rang]}</span>
          <span className={`inline-flex items-center justify-center rounded-full font-semibold tabular-nums ${compact ? "min-w-4 text-[11px]" : "h-6 min-w-6 px-1 text-sm"} ${auj ? "bg-primary text-primary-foreground" : ""}`}>{d}</span>
          {!compact && estFerie(d) && <span className="text-[9px] uppercase text-orange-700">Férié</span>}
        </button>
      </div>
    );
  }

  /** Nom + sous-ligne de totaux d'un employé (vues Semaine et Mois). */
  function celluleNom(e: EmployeeRow) {
    const t = totauxDe(e.id);
    const detail = `Payés 100 % : ${t.p100} j · payés 2/3 : ${t.p23} j · non payés : ${t.np} j · heures du mois : ${fmtH(t.h)} · heures supp. : ${fmtH(t.hs)} (valorisées ${t.hsVal.toFixed(2)} $)`;
    return (
      <div role="rowheader" className="flex min-w-0 items-center gap-2 px-2 py-1">
        {peutModifier && (
          <input type="checkbox" checked={selection.has(e.id)} onChange={() => toggleEmp(e.id)} aria-label={`Sélectionner ${e.nom}`} className="shrink-0" />
        )}
        <Link href={`/employes/${e.id}`} title={`Ouvrir la fiche de ${e.nom}`} className="shrink-0 rounded-full">
          <Avatar nom={e.nom} taille={28} photoUrl={e.photoUrl} />
        </Link>
        <span className="min-w-0">
          <button type="button" onClick={() => ouvrirEmploye(e.id)} title="Voir son mois" className="block max-w-full truncate text-left text-sm font-medium hover:text-primary hover:underline">{e.nom}</button>
          <span className="block truncate text-[11px] tabular-nums text-muted-foreground" title={detail}>
            {vue === "semaine" ? `${fmtH(heuresDeLaSemaine(e.id))} h · mois ${fmtH(t.h)}` : `${fmtH(t.h)} h`}
            {t.hs > 0 && <span className="font-medium text-amber-700"> · HS {fmtH(t.hs)}</span>}
          </span>
        </span>
      </div>
    );
  }

  // ── Vue Employé : tuiles de totaux + calendrier (ordinateur) / liste (téléphone) ──
  function vueEmploye(e: EmployeeRow) {
    const t = totauxDe(e.id);
    const tuiles: [string, string, string?][] = [
      ["Jours payés 100 %", String(t.p100)],
      ["Jours payés 2/3", String(t.p23)],
      ["Jours non payés", String(t.np)],
      ["Heures du mois", fmtH(t.h)],
      ["Heures supp.", fmtH(t.hs), t.hs > 0 ? "text-amber-700" : undefined],
      ["HS valorisées", `${t.hsVal.toFixed(2)} $`],
    ];
    const rang = employees.findIndex((x) => x.id === e.id);
    const voisinCal = (d: number): Voisin => (dir) => {
      const n = dir === "droite" ? d + 1 : dir === "gauche" ? d - 1 : dir === "bas" ? d + 7 : d - 7;
      return n >= 1 && n <= days.length ? [e.id, n] : null;
    };
    return (
      // key = l'employé : changer d'employé REMONTE tout (cases d'heures comprises) — une case en erreur ou
      // en cours de frappe ne peut pas passer, avec sa valeur, sur l'employé suivant.
      <div key={e.id} className="mt-2 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar nom={e.nom} taille={44} photoUrl={e.photoUrl} />
          <div className="min-w-0">
            <Link href={`/employes/${e.id}`} className="block truncate text-base font-semibold hover:text-primary hover:underline" title="Ouvrir la fiche">{e.nom}</Link>
            <p className="font-mono text-xs text-muted-foreground">{e.matricule}{employees.length > 1 ? ` · ${rang + 1} / ${employees.length}` : ""}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" data-totaux-employe="">
          {tuiles.map(([lib, val, classe]) => (
            <div key={lib} className="rounded-lg border bg-card px-3 py-2">
              <p className="text-[11px] text-muted-foreground">{lib}</p>
              <p className={`text-lg font-semibold tabular-nums ${classe ?? ""}`}>{val}</p>
            </div>
          ))}
        </div>

        {/* Ordinateur : calendrier du mois (lundi → dimanche), une ligne par semaine */}
        <div className="max-lg:hidden" role="table" aria-label={`Calendrier de ${e.nom}`}>
          <div role="row" className="grid grid-cols-7 gap-1.5 pb-1.5">
            {JOURS_COURTS.map((j) => (<div key={j} role="columnheader" className="text-center text-[11px] font-medium uppercase text-muted-foreground">{j}</div>))}
          </div>
          <div className="space-y-1.5">
            {semaines.map((s) => (
              <div key={s.lundi} role="row" className="grid grid-cols-7 gap-1.5">
                {s.jours.map((d, i) =>
                  d === null ? (
                    <div key={s.isos[i]} role="cell" aria-hidden className="rounded-lg border border-dashed bg-muted/20" />
                  ) : (
                    <div key={s.isos[i]} role="cell" className="min-w-0">
                      <CaseCalendrier
                        {...propsCase(e, d, voisinCal(d))}
                        jour={d}
                        ferie={estFerie(d)}
                        majore={estMajore(d)}
                        aujourdhui={s.isos[i] === isoAuj}
                        selectionne={joursSel.has(d)}
                        surCoche={peutModifier ? () => toggleJour(d) : undefined}
                      />
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Téléphone : une ligne par jour, saisie au doigt */}
        <div className="lg:hidden">
          <ZoneTableur>
            <div data-tableur="" className="space-y-2">
              {days.map((d) => {
                const c = cel(e.id, d);
                const coul = couleurDe(c.code);
                const info = shiftMap[`${e.id}_${d}`];
                const hs = infoHoraire(c, info, e.heuresParJour);
                const iso = isoDates[d - 1];
                return (
                  <div key={`${e.id}_${d}`} className={`flex items-center gap-2 rounded-xl border p-2 ${joursSel.has(d) ? "border-primary bg-primary/5" : estMajore(d) ? "bg-orange-50" : "bg-card"}`}>
                    {peutModifier && (
                      <label className="flex h-11 w-11 shrink-0 items-center justify-center">
                        <input type="checkbox" className="h-5 w-5" checked={joursSel.has(d)} onChange={() => toggleJour(d)} aria-label={`Cocher le jour ${libelleJourLong(iso)}`} />
                      </label>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium ${iso === isoAuj ? "text-primary" : ""}`}>
                        {JOURS_COURTS[rangSemaine(iso)]} {d}{estFerie(d) ? " · férié" : estDimanche(d) ? " · dimanche" : ""}
                      </div>
                      {hs.horaire && (
                        <div className={`truncate text-[11px] tabular-nums ${hs.supp ? "font-semibold text-amber-700" : info?.reel ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                          {info?.reel ? "● " : ""}{hs.horaire}{hs.supp ? " · h. supp." : ""}
                          {info?.reel && info.pauseParDefaut ? ` · ${LIBELLE_PAUSE_PAR_DEFAUT}` : ""}
                        </div>
                      )}
                    </div>
                    {peutModifier ? (
                      <>
                        <select
                          value={c.code}
                          onChange={(ev) => ecrireCode(e.id, d, ev.target.value)}
                          className="h-11 w-16 rounded-md border border-input bg-background px-1 text-center text-base font-semibold"
                          style={coul ? { backgroundColor: coul.bg, color: coul.text } : undefined}
                          aria-label={`Code de ${e.nom} — ${libelleJourLong(iso)}`}
                        >
                          {(peutEffacer || !c.code) && <option value="">—</option>}
                          {CODES.map((x) => (<option key={x} value={x}>{x}</option>))}
                        </select>
                        <CelluleNombre
                          ligne={e.id} col={d} donnee={iso} valeur={c.heures} min={0} max={24}
                          onEnregistrer={enregistrerHeuresCase}
                          placeholder="h"
                          className="h-11 w-16 rounded-md border border-input bg-background px-2 text-right text-base font-semibold"
                          aria-label={`Heures de ${e.nom} — ${libelleJourLong(iso)}`}
                        />
                      </>
                    ) : (
                      <span className="text-sm font-semibold">{c.code || "—"} · {c.heures ?? "—"} h</span>
                    )}
                  </div>
                );
              })}
            </div>
          </ZoneTableur>
        </div>
      </div>
    );
  }

  // La vue Employé ne concerne qu'UN groupe : l'autre section disparaît (titre compris).
  if (vue === "employe" && !empVue) return null;

  const entetePhone = vue !== "employe" && (
    <div className="flex items-center gap-2 lg:hidden">
      <button type="button" onClick={() => changerJour(Math.max(0, idxMobile - 1))} disabled={idxMobile <= 0} className={BOUTON_FLECHE_JOUR} aria-label="Jour précédent">
        <Icone nom="chevronGauche" />
      </button>
      <select value={idxMobile} onChange={(e) => changerJour(Number(e.target.value))} aria-label="Jour affiché" className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base font-medium">
        {days.map((d, i) => (
          <option key={d} value={i}>
            {libelleJourLong(isoDates[d - 1])}
            {estFerie(d) ? " · férié" : estDimanche(d) ? " · dimanche" : ""}
            {isoDates[d - 1] === isoAuj ? " · aujourd'hui" : ""}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => changerJour(Math.min(days.length - 1, idxMobile + 1))} disabled={idxMobile >= days.length - 1} className={BOUTON_FLECHE_JOUR} aria-label="Jour suivant">
        <Icone nom="chevronDroit" />
      </button>
      {idxAuj >= 0 && idxMobile !== idxAuj && (
        <button type="button" onClick={() => changerJour(idxAuj)} className="flex h-11 shrink-0 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent">Auj.</button>
      )}
    </div>
  );

  const semaineOuMois = vue === "semaine" || vue === "mois";
  const lignesGrille: { iso: string; d: number | null; rang: number }[] =
    vue === "mois"
      ? days.map((d) => ({ iso: isoDates[d - 1], d, rang: rangSemaine(isoDates[d - 1]) }))
      : (semaineAffichee?.isos ?? []).map((iso, i) => ({ iso, d: semaineAffichee!.jours[i], rang: i }));

  return (
    <section>
      {titre && <h2 className="mb-3 text-base font-semibold">{titre}</h2>}
      <div ref={gridRef}>
        {/* Barre collée : actions groupées + en-tête des jours (ou jour affiché sur téléphone), ensemble sous l'en-tête de la coquille */}
        <div className="sticky colle-sous-entete z-20 flex flex-col gap-2 bg-background max-lg:pb-2">
          {entetePhone}
          {barreLot("telephone")}
          {barreLot("bureau")}
          {semaineOuMois && employees.length > 0 && (
            <div role="row" className="hidden rounded-t-lg border bg-muted lg:grid" style={{ gridTemplateColumns: colonnes }}>
              <div role="columnheader" className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-semibold">
                <span>Employé · {employees.length}</span>
                {vue === "semaine" && semaineAffichee && <span className="truncate font-normal text-muted-foreground">sem. {semIdx + 1}/{semaines.length}</span>}
              </div>
              {lignesGrille.map((l) => enteteJour(l.d, l.iso, l.rang, vue === "mois"))}
            </div>
          )}
        </div>
        {note && <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">{note}</p>}

        {/* ── Vue Employé ── */}
        {empVue && vueEmploye(empVue)}

        {/* ── Téléphone : la liste d'un jour ── */}
        {vue !== "employe" && (
          <div className="lg:hidden">
            <ZoneTableur>
              <div data-tableur="" className="space-y-2">
                {employees.map((emp) => {
                  const c = cel(emp.id, jourMobile);
                  const coul = couleurDe(c.code);
                  const info = shiftMap[`${emp.id}_${jourMobile}`];
                  const hs = infoHoraire(c, info, emp.heuresParJour);
                  return (
                    <div key={emp.id} className={`flex items-center gap-2 rounded-xl border p-2 ${selection.has(emp.id) ? "border-primary bg-primary/5" : "bg-card"}`}>
                      {peutModifier && (
                        <label className="flex h-11 w-11 shrink-0 items-center justify-center">
                          <input type="checkbox" className="h-5 w-5" checked={selection.has(emp.id)} onChange={() => toggleEmp(emp.id)} aria-label={`Sélectionner ${emp.nom}`} />
                        </label>
                      )}
                      <Link href={`/employes/${emp.id}`} aria-label={`Ouvrir la fiche de ${emp.nom}`} className="shrink-0 rounded-full">
                        <Avatar nom={emp.nom} taille={36} photoUrl={emp.photoUrl} />
                      </Link>
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => ouvrirEmploye(emp.id)} className="flex min-h-11 max-w-full items-center truncate text-left font-medium">{emp.nom}</button>
                        <div className="font-mono text-xs text-muted-foreground">{emp.matricule}</div>
                        {hs.horaire && (
                          <div className={`truncate text-[11px] tabular-nums ${hs.supp ? "font-semibold text-amber-700" : info?.reel ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                            {info?.reel ? "● " : ""}{hs.horaire}{hs.supp ? " · h. supp." : ""}
                            {info?.reel && info.pauseParDefaut ? ` · ${LIBELLE_PAUSE_PAR_DEFAUT}` : ""}
                          </div>
                        )}
                      </div>
                      {peutModifier ? (
                        <>
                          <select
                            value={c.code}
                            onChange={(e) => ecrireCode(emp.id, jourMobile, e.target.value)}
                            className="h-11 w-16 rounded-md border border-input bg-background px-1 text-center text-base font-semibold"
                            style={coul ? { backgroundColor: coul.bg, color: coul.text } : undefined}
                            aria-label={`Code de ${emp.nom}`}
                          >
                            {(peutEffacer || !c.code) && <option value="">—</option>}
                            {CODES.map((x) => (<option key={x} value={x}>{x}</option>))}
                          </select>
                          <CelluleNombre
                            key={`${emp.id}_${jourMobile}`} ligne={emp.id} col={0} donnee={isoDates[jourMobile - 1]} valeur={c.heures} min={0} max={24}
                            onEnregistrer={enregistrerHeuresCase}
                            placeholder="h"
                            className="h-11 w-16 rounded-md border border-input bg-background px-2 text-right text-base font-semibold"
                            aria-label={`Heures de ${emp.nom} — ${new Date(isoDates[jourMobile - 1] + "T00:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", timeZone: "UTC" })}`}
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
            </ZoneTableur>
          </div>
        )}

        {/* ── Ordinateur : vues Semaine et Mois (grille CSS dans la page, sans défilement interne) ── */}
        {semaineOuMois && (
          <div className="max-lg:hidden">
            {employees.length === 0 ? (
              <EtatVide message="Aucun employé." />
            ) : (
              <div role="table" aria-label={vue === "mois" ? "Présences du mois" : "Présences de la semaine"} className="rounded-b-lg border border-t-0">
                {employees.map((e, rowIndex) => {
                  const voisin = (d: number): Voisin => (dir) => {
                    const i = joursVisibles.indexOf(d);
                    if (dir === "droite") return joursVisibles[i + 1] ? [e.id, joursVisibles[i + 1]] : null;
                    if (dir === "gauche") return i > 0 ? [e.id, joursVisibles[i - 1]] : null;
                    const autre = employees[rowIndex + (dir === "bas" ? 1 : -1)];
                    return autre ? [autre.id, d] : null;
                  };
                  return (
                    <div
                      key={e.id} role="row" data-ligne-employe={e.id}
                      className={`grid items-stretch border-b last:border-b-0 ${selection.has(e.id) ? "bg-primary/5" : "hover:bg-accent/30"}`}
                      style={{ gridTemplateColumns: colonnes }}
                    >
                      {celluleNom(e)}
                      {lignesGrille.map((l, i) =>
                        l.d === null ? (
                          <div key={l.iso} role="cell" aria-hidden className="border-l bg-muted/30" />
                        ) : (
                          <div
                            key={l.iso} role="cell"
                            className={`min-w-0 border-l p-0.5 ${estMajore(l.d) ? "bg-orange-50" : ""} ${vue === "mois" && l.rang === 0 && i > 0 ? "border-l-foreground/25" : ""}`}
                          >
                            {vue === "mois"
                              ? <CaseMois {...propsCase(e, l.d, voisin(l.d))} />
                              : <CaseSemaine {...propsCase(e, l.d, voisin(l.d))} />}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
            <p className="text-xs text-muted-foreground">
              {libelleJourLong(isoDates[pop.day - 1])}
              {" — "}
              {employees.find((e) => e.id === pop.empId)?.nom}
            </p>
            <p className="mb-2 min-h-4 text-xs tabular-nums text-muted-foreground">{pop.horaire}</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {CODES.map((c) => {
                const coul = COULEUR_CODE_HEX[c as CodePresence];
                const actif = pop.code === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPop((p) => (p ? { ...p, code: actif && peutEffacer ? "" : c } : p))}
                    className={`rounded-md px-2.5 py-1 text-xs font-bold ${actif ? "ring-2 ring-primary" : ""}`}
                    style={{ backgroundColor: coul.bg, color: coul.text }}
                    aria-pressed={actif}
                    title={LIBELLE_CODE[c as CodePresence]}
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
                  type="text" inputMode="decimal" autoComplete="off" autoFocus
                  value={pop.heures}
                  onChange={(e) => setPop((p) => (p ? { ...p, heures: e.target.value, erreur: undefined } : p))}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="0"
                  aria-invalid={pop.erreur ? true : undefined}
                  className={`w-20 rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm tabular-nums ${pop.erreur ? "!border-destructive bg-destructive/10" : ""}`}
                />
                <span className="text-xs text-muted-foreground">h</span>
              </span>
            </label>
            {pop.erreur && <p className="mb-2 text-xs font-medium text-destructive">{pop.erreur}</p>}
            <div className="flex items-center justify-between gap-2">
              {peutEffacer ? (
                <button type="button" onClick={effacerMenu} className="rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10">
                  Effacer
                </button>
              ) : <span />}
              <span className="flex gap-2">
                <button type="button" onClick={() => setPop(null)} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">Annuler</button>
                <button type="button" onClick={validerMenu} className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground">OK</button>
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
