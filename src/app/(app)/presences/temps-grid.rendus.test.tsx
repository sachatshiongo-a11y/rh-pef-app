// @vitest-environment happy-dom
//
// Présences & heures, vue mobile (heures du jour par employé) : appels serveur par case.
// Mesuré AVANT le 2026-09-24 avec ce même scénario : taper « 7,5 » = 3 appels à saisirHeures
// (un par frappe — dont « 7, » envoyé tel quel), chacun suivi de 4 revalidatePath
// (/presences, /heures-supp, /employes, /paie).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({
  saisirHeures: vi.fn(async () => {}),
  saisirPresence: vi.fn(async () => ({})),
}));
vi.mock("../heures-supp/actions", () => ({ saisirHeures: m.saisirHeures, saisirHeuresEnLot: vi.fn() }));
vi.mock("./actions", () => ({ saisirPresence: m.saisirPresence, saisirPresencesEnLot: vi.fn() }));
vi.mock("@/lib/payroll", () => ({
  resumerPresences: () => ({ payes100: 0, payes2_3: 0, nonPayes: 0 }),
  calculerHeuresSupp: () => ({ heuresTotalesMois: 0, totalHS: 0, hsValorisee: 0 }),
}));

import { TempsGrid } from "./temps-grid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  m.saisirHeures.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const employe = (id: string, nom: string) => ({ id, matricule: id, nom, heuresParJour: 8, heuresHebdo: 48, salaireHoraire: 1 });
  act(() => racine.render(createElement(TempsGrid, {
    employees: [employe("e1", "Alice"), employe("e2", "Bruno")],
    days: [1, 2],
    attendanceMap: {},
    hoursMap: { e1_1: 8 },
    peutModifier: true,
    isoDates: ["2026-09-01", "2026-09-02"],
    joursFeries: new Set<string>(),
    params: {} as never,
  })));
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const heures = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label^="Heures de ${nom} —"]`)!;

describe("Présences mobile — heures", () => {
  it("taper « 7,5 » puis quitter la case : 1 seul appel, à la sortie, avec 7.5", async () => {
    const c = heures("Alice");
    act(() => c.focus());
    taper(c, "7");
    taper(c, "7,");
    taper(c, "7,5");
    expect(m.saisirHeures).toHaveBeenCalledTimes(0);
    await act(async () => c.blur());
    expect(m.saisirHeures).toHaveBeenCalledTimes(1);
    expect(m.saisirHeures).toHaveBeenCalledWith("e1", "2026-09-01", "7.5");
  });

  it("Entrée passe à l'employé suivant ; plus de 24 h est refusé", async () => {
    const a = heures("Alice");
    act(() => a.focus());
    await act(async () => { a.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(heures("Bruno"));
    const b = heures("Bruno");
    taper(b, "25");
    await act(async () => b.blur());
    expect(m.saisirHeures).not.toHaveBeenCalled();
    expect(b.value).toBe("");
  });

  it("aucun champ type=number dans la grille (menu et actions groupées compris)", () => {
    expect(conteneur.querySelectorAll('input[type="number"]')).toHaveLength(0);
  });

  it("changer de jour avec une frappe en attente l'enregistre sur le jour QUITTÉ", async () => {
    const c = heures("Bruno");
    act(() => c.focus());
    taper(c, "6");
    const suivant = conteneur.querySelector<HTMLButtonElement>('[aria-label="Jour suivant"]')!;
    await act(async () => suivant.click()); // au doigt, le bouton ne prend pas toujours le focus
    expect(m.saisirHeures).toHaveBeenCalledTimes(1);
    expect(m.saisirHeures).toHaveBeenCalledWith("e2", "2026-09-01", "6");
    expect(heures("Bruno").getAttribute("aria-label")).toContain("2");
  });

  it("un échec d'enregistrement annule la valeur locale et reste signalé sous la liste", async () => {
    m.saisirHeures.mockRejectedValueOnce(new Error("Réseau coupé."));
    const c = heures("Bruno");
    act(() => c.focus());
    taper(c, "6");
    await act(async () => c.blur());
    expect(c.getAttribute("aria-invalid")).toBe("true");
    expect(conteneur.querySelector('[role="status"]')!.textContent).toContain("Réseau coupé.");
  });
});
