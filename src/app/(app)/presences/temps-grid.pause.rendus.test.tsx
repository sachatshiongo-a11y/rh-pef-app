// @vitest-environment happy-dom
//
// Présences & heures — la pause PAR DÉFAUT (décision d'argent de la Direction du 2026-09-29 : « la
// paie ne doit pas être affectée »). Une journée pointée 8 h → 17 h, close avec la pause par défaut,
// vaut 9 h (départ − arrivée) : la case le dit, dit pourquoi (« pause par défaut 30 min (non
// déduite) », « p* »), et le total du mois (colonne H, VRAI moteur `calculerHeuresSupp`) est juste.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ParametresPaie } from "@/lib/payroll";
import { heuresPayables } from "@/lib/pointage-jour";

vi.mock("../heures-supp/actions", () => ({ saisirHeures: vi.fn(), saisirHeuresEnLot: vi.fn() }));
vi.mock("./actions", () => ({ saisirPresence: vi.fn(), saisirPresencesEnLot: vi.fn() }));

import { TempsGrid, type InfoShift } from "./temps-grid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const params = {
  tauxChangeCDF: 2300, cnssSalarie: 0.05, cnssPatronalPensions: 0.05, cnssPatronalRisques: 0.015, cnssPatronalFamille: 0.065,
  plafondCnssMensuelCDF: null, iprTranchesAnnuellesCDF: [{ ordre: 1, plafondAnnuelCDF: null, taux: 0.03 }],
  iprPlancherMensuelCDF: 2000, iprPlafondTaux: 0.3, iprReductionFamilleTaux: 0.02, iprReductionFamilleMax: 9, iprBase: 2,
  inppTaux: 0.03, onemTaux: 0.002, hsSeuilHebdoH: 6, hsMajTranche1: 0.3, hsMajTranche2: 0.6, hsMajDimancheFerie: 1.0,
  allocFamilialeParEnfantUSD: 1.5, joursOuvrablesMois: 26, droitsCongesAnnuel: 18,
} as ParametresPaie;

// Mardi 1er et mercredi 2 septembre 2026 (pas de dimanche, pas de férié).
// Jour 1 : pointé 8 h → 17 h (Kinshasa), pause par défaut. Jour 2 : pointé 8 h → 17 h, pause SAISIE 45 min.
const jour1 = heuresPayables({
  heureDebut: new Date("2026-09-01T07:00:00Z"), heureFin: new Date("2026-09-01T16:00:00Z"), pauseMinutes: 0, pauseParDefaut: true,
});
const jour2 = heuresPayables({
  heureDebut: new Date("2026-09-02T07:00:00Z"), heureFin: new Date("2026-09-02T16:00:00Z"), pauseMinutes: 45, pauseParDefaut: false,
});
const shiftMap: Record<string, InfoShift> = {
  e1_1: { debut: "08:00", fin: "17:00", reel: true, pauseParDefaut: true },
  e1_2: { debut: "08:00", fin: "17:00", reel: true, pauseParDefaut: false },
};

let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;
function rendre() {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r = createRoot(c);
  conteneur = c;
  racine = r;
  act(() => r.render(createElement(TempsGrid, {
    employees: [{ id: "e1", matricule: "e1", nom: "Alice", heuresParJour: 9, heuresHebdo: 54, salaireHoraire: 1 }],
    days: [1, 2],
    attendanceMap: { e1_1: "P", e1_2: "P" },
    hoursMap: { e1_1: jour1, e1_2: jour2 },
    shiftMap,
    peutModifier: true,
    isoDates: ["2026-09-01", "2026-09-02"],
    joursFeries: new Set<string>(),
    params,
  })));
}
afterEach(() => {
  const r = racine;
  if (r) act(() => r.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const caseDu = (jour: number) => conteneur!.querySelector<HTMLButtonElement>(`button[data-emp="e1"][data-day="${jour}"]`)!;

describe("Présences & heures — pause par défaut NON déduite", () => {
  it("les heures écrites par le moteur : 9 h pour la pause par défaut, 8,25 h pour 45 min saisies", () => {
    expect(jour1).toBe(9);
    expect(jour2).toBe(8.25);
  });

  it("la case de la pause par défaut : 9 h, « p* », et l'infobulle dit « pause par défaut 30 min (non déduite) »", () => {
    rendre();
    const c = caseDu(1);
    expect(c.textContent).toContain("9 h");
    expect(c.textContent).toContain("p*");
    expect(c.title).toContain("pause par défaut 30 min (non déduite)");
  });

  it("la case d'une pause SAISIE : ses heures, ni « p* » ni « non déduite »", () => {
    rendre();
    const c = caseDu(2);
    expect(c.textContent).toContain("8,25 h");
    expect(c.textContent).not.toContain("p*");
    expect(c.title).not.toContain("non déduite");
  });

  it("le total du mois (colonne H) = 9 + 8,25 = 17,25 h", () => {
    rendre();
    // La grille n'est plus un <table> (écran refait le 2026-10-08) : la ligne de l'employé porte le total.
    const ligne = caseDu(1).closest('[role="row"]')!;
    expect(ligne.textContent).toContain("17,25 h");
  });
});
