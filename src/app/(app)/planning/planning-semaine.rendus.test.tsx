// @vitest-environment happy-dom
//
// Planning sur TÉLÉPHONE — actions groupées (décision Direction du 2026-10-08) : cases à cocher sur
// chaque carte salarié, barre `BulkBar` collée sous l'en-tête avec le sélecteur de jour, mêmes actions
// et mêmes paramètres que sur ordinateur (shift × jours cochés → `saisirCreneauxEnLot`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const appels = vi.hoisted(() => ({
  saisirCreneau: vi.fn(async () => ({})),
  saisirCreneauxEnLot: vi.fn(async (_e: { employeeId: string; dateIso: string; shiftId: string }[]) => ({}) as { erreur?: string }),
}));
vi.mock("./actions", () => appels);

import { PlanningSemaine } from "./planning-semaine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIBELLES = ["Lun 05", "Mar 06", "Mer 07", "Jeu 08", "Ven 09", "Sam 10", "Dim 11"];
const JOURS = LIBELLES.map((label, i) => ({ iso: `2026-10-${String(5 + i).padStart(2, "0")}`, label, dow: (i + 1) % 7, ferie: false, dimanche: i === 6, aujourdhui: i === 2 }));
const SHIFTS = [
  { id: "matin", nom: "Matin", heureDebut: "07:00", heureFin: "15:00", couleur: "indigo", ordre: 1, systeme: false, actif: true },
  { id: "soir", nom: "Soir", heureDebut: "15:00", heureFin: "23:00", couleur: "orange", ordre: 2, systeme: false, actif: true },
];
const GROUPES = [
  { titre: "Brigade", employees: [{ id: "e1", nom: "Ana Kabila", heuresHebdo: 48 }, { id: "e2", nom: "Ben Mbala", heuresHebdo: 48 }] },
  { titre: "Backoffice", employees: [{ id: "e3", nom: "Céline Tshala", heuresHebdo: 40 }] },
];

let conteneur: HTMLDivElement;
let racine: Root;
function monter(peutModifier = true) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(PlanningSemaine, {
    groupes: GROUPES, jours: JOURS, creneauMap: {}, absences: [], shifts: SHIFTS, besoins: [], peutModifier,
  })));
}
beforeEach(() => { appels.saisirCreneauxEnLot.mockClear(); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

/** La partie TÉLÉPHONE (happy-dom ne lit pas `lg:hidden` : les deux rendus coexistent, on s'y limite). */
const mobile = () => conteneur.querySelector<HTMLElement>("div.lg\\:hidden")!;
const bouton = (texte: string) => [...mobile().querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(texte));
const cocher = (nom: string) => act(() => mobile().querySelector<HTMLInputElement>(`input[aria-label="Sélectionner ${nom}"]`)!.click());

describe("planning sur téléphone — actions groupées", () => {
  it("une case par salarié (cible de 44 px) et la barre BulkBar collée AVEC le sélecteur de jour, sans flou", () => {
    monter();
    const cases = mobile().querySelectorAll('input[type="checkbox"][aria-label^="Sélectionner "]');
    expect(cases.length).toBe(3);
    for (const c of cases) expect(c.closest("label")!.className).toMatch(/\bmin-h-11\b.*\bw-11\b/);
    const barre = mobile().querySelector("[data-actions-groupees-mobile]")!;
    const colle = barre.closest(".sticky")!;
    expect(colle.className).toContain("colle-sous-entete");
    expect(colle.querySelector('select option[value="0"]')?.textContent).toBe("Lun 05"); // le sélecteur de jour est dans la même barre collée
    expect(colle.className).not.toMatch(/backdrop/);
    expect(mobile().textContent).toContain("0 sélectionné(s)");
    expect(bouton("Affecter")).toBeUndefined(); // actions seulement à la sélection
  });

  it("« Affecter » : shift choisi × jours cochés (tous par défaut), exactement comme sur ordinateur", async () => {
    monter();
    cocher("Ana Kabila");
    cocher("Céline Tshala");
    expect(mobile().textContent).toContain("2 sélectionné(s)");
    const choixShift = mobile().querySelector<HTMLSelectElement>('select[aria-label="Shift à affecter"]')!;
    act(() => { choixShift.value = "soir"; choixShift.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(bouton("Jours : tous (7)")).toBeTruthy();
    for (const b of ["Affecter", "Vider", "Jours"]) expect(bouton(b)!.className).toMatch(/\bmin-h-11\b/);
    await act(async () => { bouton("Affecter")!.click(); });
    const entrees = appels.saisirCreneauxEnLot.mock.calls[0]![0];
    expect(entrees).toHaveLength(14);
    expect(new Set(entrees.map((e) => e.employeeId))).toEqual(new Set(["e1", "e3"]));
    expect(new Set(entrees.map((e) => e.dateIso))).toEqual(new Set(JOURS.map((j) => j.iso)));
    expect(entrees.every((e) => e.shiftId === "soir")).toBe(true);
  });

  it("« Vider » demande confirmation en NOMMANT les jours (repliés sur téléphone) ; refusée : rien n'est envoyé", async () => {
    const confirmer = vi.fn(() => false);
    (window as unknown as { confirm: (m: string) => boolean }).confirm = confirmer;
    monter();
    cocher("Ana Kabila");
    await act(async () => { bouton("Vider")!.click(); });
    expect(confirmer).toHaveBeenCalledWith("Vider le planning de 1 salarié(s) — jours : tous (7) ?");
    expect(appels.saisirCreneauxEnLot).not.toHaveBeenCalled();
  });

  it("« Vider » sur « Ce jour seulement » (le jour affiché) : shift vide, un seul jour", async () => {
    (window as unknown as { confirm: (m: string) => boolean }).confirm = vi.fn(() => true);
    monter();
    act(() => mobile().querySelector<HTMLInputElement>("[data-actions-groupees-mobile] label input")!.click()); // Tout sélectionner
    expect(mobile().textContent).toContain("3 sélectionné(s)");
    act(() => bouton("Jours")!.click());
    act(() => bouton("Ce jour seulement")!.click());
    expect(bouton("Jours : Mer 07")).toBeTruthy(); // aujourd'hui = jour affiché par défaut
    await act(async () => { bouton("Vider")!.click(); });
    expect(appels.saisirCreneauxEnLot).toHaveBeenCalledWith([
      { employeeId: "e1", dateIso: "2026-10-07", shiftId: "" },
      { employeeId: "e2", dateIso: "2026-10-07", shiftId: "" },
      { employeeId: "e3", dateIso: "2026-10-07", shiftId: "" },
    ]);
  });

  it("aucun jour coché : Affecter et Vider désactivés (rien n'est envoyé)", () => {
    monter();
    cocher("Ben Mbala");
    act(() => bouton("Jours")!.click());
    for (const b of [...mobile().querySelectorAll<HTMLButtonElement>("button[aria-pressed='true']")]) act(() => b.click());
    expect(bouton("Jours : aucun")).toBeTruthy();
    expect(bouton("Affecter")!.disabled).toBe(true);
    expect(bouton("Vider")!.disabled).toBe(true);
  });

  it("sans droit de modifier : ni cases ni barre d'actions", () => {
    monter(false);
    expect(mobile().querySelector('input[type="checkbox"]')).toBeNull();
    expect(mobile().querySelector("[data-actions-groupees-mobile]")).toBeNull();
  });
});
