// @vitest-environment happy-dom
//
// Présences & heures, écran refait le 2026-10-08 : trois vues (Semaine, Mois, Employé) + la liste du
// téléphone, sur les MÊMES actions serveur et les mêmes droits. Ce que l'on verrouille :
//  - plus aucun conteneur à défilement dans la grille (la page défile) ;
//  - la semaine (lundi → dimanche) s'ouvre au jour civil de Kinshasa et se parcourt ‹ › ;
//  - la barre d'actions groupées s'applique à la sélection dans chacune des trois vues
//    (employés cochés × jours de la portée choisie, ou jours cochés) ;
//  - vider une case qui porte un code reste réservé à la Direction (bouton, touche, menu).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ParametresPaie } from "@/lib/payroll";

const m = vi.hoisted(() => ({
  saisirHeures: vi.fn(async () => {}),
  saisirHeuresEnLot: vi.fn(async () => ({ ignores: [] as { employeeId: string; date: string }[] })),
  saisirPresence: vi.fn(async () => ({})),
  saisirPresencesEnLot: vi.fn(async (_e: unknown[]) => ({ ignores: [] as { employeeId: string; date: string }[], erreur: undefined as string | undefined })),
}));
vi.mock("../heures-supp/actions", () => ({ saisirHeures: m.saisirHeures, saisirHeuresEnLot: m.saisirHeuresEnLot }));
vi.mock("./actions", () => ({ saisirPresence: m.saisirPresence, saisirPresencesEnLot: m.saisirPresencesEnLot }));

import { TempsGrid, type EmployeeRow, type InfoShift } from "./temps-grid";
import { BarreVuePresences, PresencesVueProvider, type VuePresences } from "./vue-presences";
import { semainesDuMois } from "./semaines";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Rendus lourds (jusqu'à 62 cases + 31 jours de calendrier) : la machine de développement est souvent
// chargée par d'autres sessions, le délai de 5 s par défaut donnait des faux rouges.
vi.setConfig({ testTimeout: 30_000 });

const params = {
  tauxChangeCDF: 2300, cnssSalarie: 0.05, cnssPatronalPensions: 0.05, cnssPatronalRisques: 0.015, cnssPatronalFamille: 0.065,
  plafondCnssMensuelCDF: null, iprTranchesAnnuellesCDF: [{ ordre: 1, plafondAnnuelCDF: null, taux: 0.03 }],
  iprPlancherMensuelCDF: 2000, iprPlafondTaux: 0.3, iprReductionFamilleTaux: 0.02, iprReductionFamilleMax: 9, iprBase: 2,
  inppTaux: 0.03, onemTaux: 0.002, hsSeuilHebdoH: 6, hsMajTranche1: 0.3, hsMajTranche2: 0.6, hsMajDimancheFerie: 1.0,
  allocFamilialeParEnfantUSD: 1.5, joursOuvrablesMois: 26, droitsCongesAnnuel: 18,
} as ParametresPaie;

// Octobre 2026 : le 1er est un jeudi → 5 semaines, la 2e (rang 1) va du lundi 5 au dimanche 11.
const days = Array.from({ length: 31 }, (_, i) => i + 1);
const isoDates = days.map((d) => `2026-10-${String(d).padStart(2, "0")}`);
const semaines = semainesDuMois(2026, 10, 31);
const emp = (id: string, nom: string): EmployeeRow => ({ id, matricule: id, nom, heuresParJour: 8, heuresHebdo: 48, salaireHoraire: 1 });
const alice = emp("e1", "Alice");
const bruno = emp("e2", "Bruno");
const shiftMap: Record<string, InfoShift> = {
  e1_5: { debut: "10:30", fin: "22:30", reel: false },
  e1_6: { debut: "08:00", fin: "17:00", reel: true },
  e1_7: { debut: "08:00", fin: "16:00", reel: false },
};

let conteneur: HTMLDivElement;
let racine: Root;

function rendre(opts: { vue?: VuePresences; semaine?: number; employe?: string | null; peutEffacer?: boolean; peutModifier?: boolean; deuxGroupes?: boolean } = {}) {
  const grille = (titre: string, employees: EmployeeRow[]) =>
    createElement(TempsGrid, {
      key: titre, titre, employees, days, isoDates, joursFeries: new Set<string>(), params, shiftMap,
      attendanceMap: { e1_5: "P", e1_6: "P", e1_7: "P", e2_5: "O" },
      hoursMap: { e1_5: 12, e1_6: 9, e1_7: 10, e2_5: 0 },
      peutModifier: opts.peutModifier ?? true,
      peutEffacer: opts.peutEffacer ?? false,
    });
  act(() => racine.render(createElement(
    PresencesVueProvider,
    { vueInitiale: opts.vue ?? "semaine", semaineInitiale: opts.semaine ?? 1, employeInitial: opts.employe ?? null, semaines },
    createElement(BarreVuePresences, {
      semaines, semaineAujourdhui: 1,
      employes: [{ id: "e1", nom: "Alice", groupe: "Brigade" }, { id: "e2", nom: "Bruno", groupe: "Back-office" }],
    }),
    opts.deuxGroupes ? [grille("Brigade", [alice]), grille("Back-office", [bruno])] : grille("Brigade", [alice, bruno]),
  )));
}

beforeEach(() => {
  vi.clearAllMocks();
  // « Aujourd'hui » figé au lundi 5 octobre 2026 : jour du téléphone et semaine ouverte ne dépendent pas de l'horloge.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-05T10:00:00Z") });
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  vi.useRealTimers();
  act(() => racine.unmount());
  conteneur.remove();
  window.history.replaceState(null, "", "/");
});

const q = <T extends Element = HTMLElement>(sel: string) => conteneur.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string) => Array.from(conteneur.querySelectorAll<T>(sel));
const barre = () => q('[data-barre-lot="bureau"]')!;
const jourCases = () => qa<HTMLButtonElement>("button[data-emp][data-day]");
const entetesJours = () => qa('[role="columnheader"] button[aria-pressed]');

function clic(el: Element) {
  act(() => (el as HTMLElement).click());
}
function choisir(el: HTMLSelectElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, valeur);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const boutonDe = (zone: Element, texte: string) => Array.from(zone.querySelectorAll("button")).find((b) => b.textContent?.trim() === texte)!;
const cocher = (nom: string) => clic(q(`input[aria-label="Sélectionner ${nom}"]`)!);

describe("aucun défilement interne", () => {
  it.each<VuePresences>(["semaine", "mois", "employe"])("vue %s : aucun conteneur à défilement dans la grille (la page défile)", (vue) => {
    rendre({ vue, employe: "e1" });
    // (les onglets Semaine / Mois / Employé ont leur propre défilement sur téléphone : ils sont hors des sections)
    expect(q('section [class*="overflow-"]'), "un conteneur overflow-* a réapparu dans la grille").toBeNull();
    expect(q("section")).not.toBeNull();
  });

  it("la barre d'actions et l'en-tête des jours sont collés ENSEMBLE sous l'en-tête de la coquille", () => {
    rendre();
    const collant = q(".colle-sous-entete")!;
    expect(collant.className).toContain("sticky");
    expect(collant.contains(barre())).toBe(true);
    expect(collant.querySelector('[role="columnheader"]')).not.toBeNull();
    expect(collant.className).not.toMatch(/backdrop|\bbg-\w+\/\d+/); // pas de flou ni de fond translucide sur un collant
  });
});

describe("vue Semaine", () => {
  it("affiche lundi 5 → dimanche 11, avec code, heures et horaire dans la case", () => {
    rendre();
    expect(entetesJours().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Cocher lundi 5 octobre pour une action groupée", "Cocher mardi 6 octobre pour une action groupée",
      "Cocher mercredi 7 octobre pour une action groupée", "Cocher jeudi 8 octobre pour une action groupée",
      "Cocher vendredi 9 octobre pour une action groupée", "Cocher samedi 10 octobre pour une action groupée",
      "Cocher dimanche 11 octobre pour une action groupée",
    ]);
    expect(jourCases()).toHaveLength(14); // 2 employés × 7 jours
    const lundi = q('button[data-emp="e1"][data-day="5"]')!;
    expect(lundi.textContent).toContain("P");
    expect(lundi.textContent).toContain("12 h");
    expect(lundi.textContent).toContain("10:30–22:30");
    // 12 h pour un shift de 12 h : pas d'heures supp. ; 9 h réelles sur 8:00–17:00 : pas non plus.
    expect(lundi.innerHTML).not.toContain("bg-amber-100");
  });

  it("les heures au-delà du shift prévu sont en ambre, avec la fin effective", () => {
    rendre();
    const mercredi = q('button[data-emp="e1"][data-day="7"]')!; // 10 h sur un shift de 8 h
    expect(mercredi.querySelector(".bg-amber-100")?.textContent).toBe("10 h");
    expect(mercredi.textContent).toContain("08:00–18:00");
    expect(q('button[data-emp="e1"][data-day="6"]')!.querySelector(".bg-amber-100")).toBeNull();
  });

  it("‹ › parcourent les semaines ; « Cette semaine » ramène à celle d'aujourd'hui ; bornes respectées", () => {
    rendre({ semaine: 0 });
    expect(q('[aria-label="Semaine précédente"]')!.hasAttribute("disabled")).toBe(true);
    // La semaine à cheval sur deux périodes garde ses jours d'avant en grisé, non saisissables.
    expect(qa('[role="columnheader"]').filter((h) => /^(lun|mar|mer|jeu|ven|sam|dim)\./i.test(h.textContent ?? ""))).toHaveLength(7);
    expect(entetesJours().map((b) => b.getAttribute("aria-label"))[0]).toContain("jeudi 1 octobre");
    expect(jourCases()).toHaveLength(8); // 2 employés × 4 jours (1 → 4 octobre)
    clic(q('[aria-label="Semaine suivante"]')!);
    expect(entetesJours()[0].getAttribute("aria-label")).toContain("lundi 5 octobre");
    expect(q("[data-selecteur-semaine]")!.textContent).toContain("5 → 11 octobre 2026");
    clic(q('[aria-label="Semaine suivante"]')!);
    expect(entetesJours()[0].getAttribute("aria-label")).toContain("lundi 12 octobre");
    clic(boutonDe(q("[data-selecteur-semaine]")!, "Cette semaine"));
    expect(entetesJours()[0].getAttribute("aria-label")).toContain("lundi 5 octobre");
    expect(boutonDe(q("[data-selecteur-semaine]")!, "Cette semaine")).toBeUndefined(); // déjà dessus
  });

  it("la dernière semaine du mois : suivante désactivée", () => {
    rendre({ semaine: 4 });
    expect(q('[aria-label="Semaine suivante"]')!.hasAttribute("disabled")).toBe(true);
    expect(jourCases()).toHaveLength(12); // 26 → 31 octobre, deux employés
  });

  it("la vue se recopie dans l'adresse (?sem=, ?vue=) sans recharger", () => {
    rendre();
    clic(q('[aria-label="Semaine suivante"]')!);
    expect(window.location.search).toContain("sem=2026-10-12");
    clic(qa("a").find((a) => a.textContent === "Mois")!);
    expect(window.location.search).toContain("vue=mois");
  });

  it("actions groupées : employé coché × semaine affichée (code + heures)", async () => {
    rendre();
    expect(barre().textContent).toContain("0 employé(s) sélectionné(s)");
    cocher("Alice");
    expect(barre().textContent).toContain("1 employé(s) sélectionné(s)");
    taper(barre().querySelector<HTMLInputElement>('input[aria-label="Heures à appliquer"]')!, "7,5");
    await act(async () => boutonDe(barre(), "Appliquer").click());
    const entrees = m.saisirPresencesEnLot.mock.calls[0][0] as { employeeId: string; date: string; code: string }[];
    expect(entrees).toHaveLength(7);
    expect(entrees.every((e) => e.employeeId === "e1" && e.code === "P")).toBe(true);
    expect(entrees.map((e) => e.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(m.saisirHeuresEnLot).toHaveBeenCalledTimes(1);
    expect((m.saisirHeuresEnLot.mock.calls[0] as unknown[])[0]).toHaveLength(7);
    expect(q('button[data-emp="e1"][data-day="7"]')!.textContent).toContain("7,5 h"); // affichage optimiste
  });

  it("actions groupées : employés × jours cochés dans l'en-tête", async () => {
    rendre();
    cocher("Alice");
    cocher("Bruno");
    clic(entetesJours()[2]); // mercredi 7
    clic(entetesJours()[3]); // jeudi 8
    const portee = barre().querySelector<HTMLSelectElement>('select[aria-label="Jours concernés"]')!;
    expect(Array.from(portee.options).map((o) => o.textContent)).toContain("jours cochés (2)");
    choisir(portee, "coches");
    await act(async () => boutonDe(barre(), "Appliquer").click());
    const entrees = m.saisirPresencesEnLot.mock.calls[0][0] as { employeeId: string; date: string }[];
    expect(entrees.map((e) => `${e.employeeId}:${e.date}`).sort()).toEqual([
      "e1:2026-10-07", "e1:2026-10-08", "e2:2026-10-07", "e2:2026-10-08",
    ]);
  });

  it("un jour coché dans une autre semaine ne part jamais en silence", async () => {
    rendre();
    cocher("Alice");
    clic(entetesJours()[0]); // lundi 5 coché…
    clic(q('[aria-label="Semaine suivante"]')!); // … puis on change de semaine
    const portee = barre().querySelector<HTMLSelectElement>('select[aria-label="Jours concernés"]')!;
    expect(Array.from(portee.options).map((o) => o.textContent)).toContain("jours cochés (0)");
    choisir(portee, "coches");
    expect(boutonDe(barre(), "Appliquer").hasAttribute("disabled")).toBe(true);
  });

  it("« Tout sélectionner » coche tous les employés de la section", () => {
    rendre();
    clic(barre().querySelector('input[aria-label="Tout sélectionner"]')!);
    expect(barre().textContent).toContain("2 employé(s) sélectionné(s)");
  });

  it("le nom est un bouton vers la vue Employé, l'avatar mène à la fiche", () => {
    rendre();
    const ligne = q('[data-ligne-employe="e1"]')!;
    expect(ligne.querySelector('a[href="/employes/e1"]')).not.toBeNull();
    clic(boutonDe(ligne, "Alice"));
    expect(q("[data-totaux-employe]")).not.toBeNull();
    expect(window.location.search).toContain("emp=e1");
  });

  it("lecture seule (ni ADMIN ni MANAGER) : ni barre d'actions, ni cases à cocher, cases désactivées", () => {
    rendre({ peutModifier: false });
    expect(q("[data-barre-lot]")).toBeNull();
    expect(q('input[aria-label^="Sélectionner"]')).toBeNull();
    expect(jourCases().every((b) => b.disabled)).toBe(true);
  });
});

describe("vue Mois", () => {
  it("31 colonnes calculées, une case = un code, sans horaire dans la case mais dans l'infobulle", () => {
    rendre({ vue: "mois" });
    expect(entetesJours()).toHaveLength(31);
    expect(jourCases()).toHaveLength(62);
    const ligne = q('[data-ligne-employe="e1"]') as HTMLElement;
    expect(ligne.style.gridTemplateColumns).toMatch(/repeat\(31,\s*minmax\(0,\s*1fr\)\)/);
    const c = q('button[data-emp="e1"][data-day="5"]')!;
    expect(c.textContent?.trim()).toBe("P"); // la lettre, rien d'autre
    expect(c.getAttribute("title")).toContain("10:30–22:30");
    expect(c.getAttribute("aria-label")).toContain("10:30–22:30");
    // heures 12 sur un shift de 12 h : pas de point ambre ; la case sans code reste vide
    expect(q('button[data-emp="e2"][data-day="9"]')!.textContent?.trim()).toBe("");
  });

  it("le menu au clic rappelle l'horaire (au toucher)", () => {
    rendre({ vue: "mois" });
    clic(q('button[data-emp="e1"][data-day="6"]')!);
    const menu = q('[role="dialog"]')!;
    expect(menu.textContent).toContain("08:00–17:00");
    expect(menu.textContent).toContain("pointage réel");
  });

  it("actions groupées : employé coché × tout le mois par défaut", async () => {
    rendre({ vue: "mois" });
    cocher("Bruno");
    await act(async () => boutonDe(barre(), "Appliquer").click());
    const entrees = m.saisirPresencesEnLot.mock.calls[0][0] as { employeeId: string; date: string }[];
    expect(entrees).toHaveLength(31);
    expect(entrees.every((e) => e.employeeId === "e2")).toBe(true);
  });

  it("actions groupées : jours cochés d'un en-tête étroit", async () => {
    rendre({ vue: "mois" });
    cocher("Alice");
    clic(entetesJours()[11]); // le 12
    choisir(barre().querySelector<HTMLSelectElement>('select[aria-label="Jours concernés"]')!, "coches");
    await act(async () => boutonDe(barre(), "Appliquer").click());
    const entrees = m.saisirPresencesEnLot.mock.calls[0][0] as { date: string }[];
    expect(entrees.map((e) => e.date)).toEqual(["2026-10-12"]);
  });
});

describe("vue Employé", () => {
  it("son mois en calendrier + ses totaux ; l'autre groupe disparaît avec son titre", () => {
    rendre({ vue: "employe", employe: "e1", deuxGroupes: true });
    expect(qa("h2").map((h) => h.textContent)).toEqual(["Brigade"]);
    expect(q("[data-totaux-employe]")!.textContent).toContain("Heures du mois");
    expect(q("[data-totaux-employe]")!.textContent).toContain("31"); // 12 h + 9 h + 10 h
    expect(jourCases()).toHaveLength(31);
    expect(q('[role="table"][aria-label="Calendrier de Alice"]')).not.toBeNull();
  });

  it("‹ › passent à l'employé voisin (d'un groupe à l'autre)", () => {
    rendre({ vue: "employe", employe: "e1", deuxGroupes: true });
    clic(q('[aria-label="Employé suivant"]')!);
    expect(qa("h2").map((h) => h.textContent)).toEqual(["Back-office"]);
    expect(q('[aria-label="Employé précédent"]')!.hasAttribute("disabled")).toBe(false);
    expect(q('[aria-label="Employé suivant"]')!.hasAttribute("disabled")).toBe(true);
  });

  it("actions groupées : jours cochés du calendrier pour l'employé consulté", async () => {
    rendre({ vue: "employe", employe: "e1" });
    expect(barre().textContent).toContain("0 jour(s) coché(s)");
    clic(q('input[aria-label="Cocher le jour 3"]')!);
    clic(q('input[aria-label="Cocher le jour 4"]')!);
    expect(barre().textContent).toContain("2 jour(s) coché(s)");
    choisir(barre().querySelector<HTMLSelectElement>('select[aria-label="Code à appliquer"]')!, "O");
    await act(async () => boutonDe(barre(), "Appliquer").click());
    const entrees = m.saisirPresencesEnLot.mock.calls[0][0] as { employeeId: string; date: string; code: string }[];
    expect(entrees).toEqual([
      { employeeId: "e1", date: "2026-10-03", code: "O" },
      { employeeId: "e1", date: "2026-10-04", code: "O" },
    ]);
  });

  it("téléphone : une liste verticale, un jour par ligne, cibles de 44 px", () => {
    rendre({ vue: "employe", employe: "e1" });
    const liste = q('.lg\\:hidden [data-tableur]')!;
    expect(liste.children).toHaveLength(31);
    const selectCode = liste.querySelector<HTMLSelectElement>('select[aria-label^="Code de Alice"]')!;
    expect(selectCode.className).toContain("h-11");
  });
});

describe("téléphone : la liste d'un jour", () => {
  it("cases à cocher par employé, cibles de 44 px, barre d'actions (ce jour par défaut)", async () => {
    rendre();
    const liste = q('.lg\\:hidden [data-tableur]')!;
    expect(liste.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(liste.querySelector<HTMLSelectElement>('select[aria-label="Code de Alice"]')!.className).toContain("h-11");
    expect(q<HTMLButtonElement>('[aria-label="Jour suivant"]')!.className).toContain("h-11");

    const bar = q('[data-barre-lot="telephone"]')!;
    cocher("Bruno");
    const portee = bar.querySelector<HTMLSelectElement>('select[aria-label="Jours concernés"]')!;
    expect(portee.value).toBe("jour-affiche");
    await act(async () => boutonDe(bar, "Appliquer").click());
    const entrees = m.saisirPresencesEnLot.mock.calls[0][0] as { employeeId: string; date: string }[];
    expect(entrees).toHaveLength(1);
    expect(entrees[0].employeeId).toBe("e2");
  });

  it("l'horaire du jour et le nom (vers la vue Employé) restent dans la ligne", () => {
    rendre();
    const liste = q('.lg\\:hidden [data-tableur]')!;
    expect(liste.querySelector('a[href="/employes/e1"]')).not.toBeNull();
  });
});

describe("droits de vidage — inchangés (depuis le 2026-10-01, seule la Direction vide un code saisi)", () => {
  it("MANAGER : ni « Supprimer », ni « Effacer » dans le menu, la touche Suppr ne fait rien", () => {
    rendre({ peutEffacer: false });
    clic(q('button[data-emp="e1"][data-day="5"]')!);
    cocher("Alice");
    expect(boutonDe(barre(), "Supprimer")).toBeUndefined();
    expect(boutonDe(q('[role="dialog"]')!, "Effacer")).toBeUndefined();
    act(() => { q('button[data-emp="e1"][data-day="5"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })); });
    expect(m.saisirPresence).not.toHaveBeenCalled();
  });

  it("MANAGER : une lettre REMPLACE le code, et la liste du téléphone n'offre pas « — » sur une case déjà codée", () => {
    rendre({ peutEffacer: false });
    act(() => { q('button[data-emp="e1"][data-day="5"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true })); });
    expect(m.saisirPresence).toHaveBeenCalledWith("e1", "2026-10-05", "M");
    const select = q<HTMLSelectElement>('select[aria-label="Code de Alice"]')!;
    expect(Array.from(select.options).map((o) => o.value)).not.toContain("");
  });

  it("Direction : « Supprimer » dans la barre, « Effacer » dans le menu, Suppr vide la case", async () => {
    rendre({ peutEffacer: true });
    cocher("Alice");
    expect(boutonDe(barre(), "Supprimer")).toBeDefined();
    await act(async () => boutonDe(barre(), "Supprimer").click());
    const entrees = m.saisirPresencesEnLot.mock.calls[0][0] as { code: string }[];
    expect(entrees).toHaveLength(7);
    expect(entrees.every((e) => e.code === "")).toBe(true);

    clic(q('button[data-emp="e1"][data-day="6"]')!);
    expect(boutonDe(q('[role="dialog"]')!, "Effacer")).toBeDefined();
    clic(boutonDe(q('[role="dialog"]')!, "Annuler"));
    act(() => { q('button[data-emp="e1"][data-day="6"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })); });
    expect(m.saisirPresence).toHaveBeenCalledWith("e1", "2026-10-06", "");
  });

  it("un lot refusé par le serveur annule l'affichage optimiste et le dit", async () => {
    m.saisirPresencesEnLot.mockResolvedValueOnce({ ignores: [], erreur: "Supprimer est réservé à la Direction." });
    rendre({ peutEffacer: false });
    cocher("Bruno");
    choisir(barre().querySelector<HTMLSelectElement>('select[aria-label="Code à appliquer"]')!, "N");
    await act(async () => boutonDe(barre(), "Appliquer").click());
    expect(conteneur.textContent).toContain("Supprimer est réservé à la Direction.");
    expect(q('button[data-emp="e2"][data-day="5"]')!.textContent).toContain("O"); // la case est revenue
  });
});

describe("flèches du clavier", () => {
  it("→ passe au jour suivant de la semaine, ↓ à l'employé suivant", () => {
    rendre();
    const dep = q<HTMLButtonElement>('button[data-emp="e1"][data-day="5"]')!;
    act(() => dep.focus());
    act(() => { dep.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(q('button[data-emp="e1"][data-day="6"]'));
    act(() => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(q('button[data-emp="e2"][data-day="6"]'));
  });
});
