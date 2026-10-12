// @vitest-environment happy-dom
//
// En-tête de ligne de la vue Semaine (cas réel du 12/10/2026 : « 16 h · mois 76 · HS 12 ») : les heures
// supp. affichées étaient celles du MOIS, posées à côté des heures de la SEMAINE. Chaque « HS » dit
// désormais sa période. Calcul : `calculerHeuresSupp`, le même que la paie.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ParametresPaie } from "@/lib/payroll";

vi.mock("../heures-supp/actions", () => ({ saisirHeures: vi.fn(), saisirHeuresEnLot: vi.fn() }));
vi.mock("./actions", () => ({ saisirPresence: vi.fn(), saisirPresencesEnLot: vi.fn() }));

import { TempsGrid } from "./temps-grid";
import { PresencesVueProvider } from "./vue-presences";
import { semainesDuMois } from "./semaines";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const params = {
  tauxChangeCDF: 2300, cnssSalarie: 0.05, cnssPatronalPensions: 0.05, cnssPatronalRisques: 0.015, cnssPatronalFamille: 0.065,
  plafondCnssMensuelCDF: null, iprTranchesAnnuellesCDF: [{ ordre: 1, plafondAnnuelCDF: null, taux: 0.03 }],
  iprPlancherMensuelCDF: 2000, iprPlafondTaux: 0.3, iprReductionFamilleTaux: 0.02, iprReductionFamilleMax: 9, iprBase: 2,
  inppTaux: 0.03, onemTaux: 0.002, hsSeuilHebdoH: 6, hsMajTranche1: 0.3, hsMajTranche2: 0.6, hsMajDimancheFerie: 1.0,
  allocFamilialeParEnfantUSD: 1.5, joursOuvrablesMois: 26, droitsCongesAnnuel: 18,
} as ParametresPaie;
const days = Array.from({ length: 31 }, (_, i) => i + 1);
const isoDates = days.map((d) => `2026-10-${String(d).padStart(2, "0")}`);
const semaines = semainesDuMois(2026, 10, 31);

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T10:00:00Z") });
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => { vi.useRealTimers(); act(() => racine.unmount()); conteneur.remove(); });

describe("vue Semaine : les heures supp. disent leur période", () => {
  it("cas Jeannette : 48 h la semaine du 5 (contrat 36 h → 12 HS), 16 h la semaine affichée (0 HS)", () => {
    // Avant : « 16 h · mois 64 · HS 12 » — les 12 HS sont celles de la semaine PASSÉE, lues comme celles-ci.
    const hoursMap: Record<string, number> = { j_5: 8, j_6: 8, j_7: 8, j_8: 8, j_9: 8, j_10: 8, j_12: 8, j_14: 8 };
    const attendanceMap = Object.fromEntries(Object.keys(hoursMap).map((k) => [k, "P"]));
    act(() => racine.render(createElement(
      PresencesVueProvider,
      { vueInitiale: "semaine", semaineInitiale: 2, employeInitial: null, semaines } as never,
      createElement(TempsGrid, {
        titre: "Brigade", days, isoDates, joursFeries: new Set<string>(), params, shiftMap: {},
        employees: [{ id: "j", matricule: "JB", nom: "Jeannette", heuresParJour: 6, heuresHebdo: 36 }],
        attendanceMap, hoursMap, peutModifier: false, peutEffacer: false,
      }),
    )));
    const ligne = conteneur.querySelector('[role="rowheader"]')!.textContent!.replace(/\s+/g, " ");
    expect(ligne).toContain("sem. 16 h · mois 64 h (HS 12)");
    expect(ligne).not.toContain("sem. 16 h (HS");
  });
});
