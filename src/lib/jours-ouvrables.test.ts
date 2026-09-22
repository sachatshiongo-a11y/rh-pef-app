import { describe, it, expect } from "vitest";
import {
  compterJoursOuvrables,
  finApresJoursOuvrables,
  recalculerChampsConge,
  CHAMPS_CONGE_VIDES,
  type ChampsConge,
} from "./jours-ouvrables";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe("compterJoursOuvrables — dimanches et fériés exclus (déplacé depuis payroll.ts)", () => {
  // Lundi 29 juin → dimanche 5 juillet 2026 : 7 jours calendaires, 1 dimanche.
  it("exclut les dimanches", () => {
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"))).toBe(6);
  });
  it("exclut aussi les jours fériés fournis (Date ou AAAA-MM-JJ)", () => {
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"), [d("2026-06-30")])).toBe(5);
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"), ["2026-06-30"])).toBe(5);
  });
  it("un férié tombant un dimanche n'est pas déduit deux fois", () => {
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"), [d("2026-07-05")])).toBe(6);
  });
  it("fin avant début → 0", () => {
    expect(compterJoursOuvrables(d("2026-07-05"), d("2026-06-29"))).toBe(0);
  });
});

describe("finApresJoursOuvrables — la date de fin pour N jours ouvrables à partir du début", () => {
  it("1 jour un lundi → ce lundi (début inclus)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 1))).toBe("2026-06-29");
  });
  it("6 jours un lundi → le samedi (le samedi est ouvrable)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 6))).toBe("2026-07-04");
  });
  it("7 jours un lundi → le lundi suivant (le dimanche est sauté)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 7))).toBe("2026-07-06");
  });
  it("début un dimanche, 1 jour → le lundi (le dimanche ne compte pas)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-28"), 1))).toBe("2026-06-29");
  });
  it("férié en plein milieu → la fin recule d'un jour", () => {
    // 29 juin → 6 jours = 4 juillet sans férié ; avec le 30 juin férié, 6 jours = 6 juillet (lundi).
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 6, ["2026-06-30"]))).toBe("2026-07-06");
  });
  it("férié LE jour de début → non compté, la fin ne tombe jamais sur un férié", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-30"), 1, ["2026-06-30"]))).toBe("2026-07-01");
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 2, ["2026-06-30"]))).toBe("2026-07-01");
  });
  it("0 jour, jour négatif ou non entier → null", () => {
    expect(finApresJoursOuvrables(d("2026-06-29"), 0)).toBeNull();
    expect(finApresJoursOuvrables(d("2026-06-29"), -3)).toBeNull();
    expect(finApresJoursOuvrables(d("2026-06-29"), 1.5)).toBeNull();
  });
  it("aller-retour : compter(début, fin(début, n)) === n, sur 200 tirages avec fériés", () => {
    const feries = ["2026-06-30", "2026-08-01", "2026-12-25", "2027-01-01"];
    let graine = 42;
    const alea = (max: number) => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine % max; };
    for (let i = 0; i < 200; i++) {
      const debut = new Date(Date.UTC(2026, alea(12), 1 + alea(28)));
      const n = 1 + alea(40);
      const fin = finApresJoursOuvrables(debut, n, feries)!;
      expect(compterJoursOuvrables(debut, fin, feries), `${iso(debut)} + ${n} j`).toBe(n);
    }
  });
});

describe("recalculerChampsConge — le dernier champ touché entre jours et fin a raison", () => {
  const feries = new Set(["2026-06-30"]);
  const depuis = (e: Partial<ChampsConge>): ChampsConge => ({ ...CHAMPS_CONGE_VIDES, ...e });

  it("je tape les jours → la fin se calcule", () => {
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29" }), "jours", "6", feries);
    expect(e).toEqual({ debut: "2026-06-29", jours: "6", fin: "2026-07-06", dernierTouche: "jours" });
  });
  it("je touche la fin → les jours se recalculent", () => {
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29", jours: "6", fin: "2026-07-06", dernierTouche: "jours" }), "fin", "2026-07-04", feries);
    expect(e).toEqual({ debut: "2026-06-29", jours: "5", fin: "2026-07-04", dernierTouche: "fin" });
  });
  it("je change le début après avoir tapé des jours → la fin suit", () => {
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29", jours: "6", fin: "2026-07-06", dernierTouche: "jours" }), "debut", "2026-07-06", feries);
    expect(e.fin).toBe("2026-07-11");
    expect(e.jours).toBe("6");
  });
  it("je change le début après avoir tapé une fin → les jours se recalculent", () => {
    // Mercredi 1er juillet → samedi 4 juillet : 4 jours ouvrables (aucun dimanche, le 30 juin
    // férié est hors de ce nouvel intervalle). La valeur d'origine de la tâche (« 3 ») ne
    // correspond pas à ce calcul ; corrigée ici après vérification par exécution.
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29", jours: "5", fin: "2026-07-04", dernierTouche: "fin" }), "debut", "2026-07-01", feries);
    expect(e.jours).toBe("4");
    expect(e.fin).toBe("2026-07-04");
  });
  it("je change le début sans rien d'autre → rien ne se calcule", () => {
    const e = recalculerChampsConge(CHAMPS_CONGE_VIDES, "debut", "2026-06-29", feries);
    expect(e).toEqual({ debut: "2026-06-29", jours: "", fin: "", dernierTouche: null });
  });
  it("jours vides ou 0 → la fin s'efface", () => {
    const base = depuis({ debut: "2026-06-29", jours: "6", fin: "2026-07-06", dernierTouche: "jours" });
    expect(recalculerChampsConge(base, "jours", "", feries).fin).toBe("");
    expect(recalculerChampsConge(base, "jours", "0", feries).fin).toBe("");
  });
  it("fin avant début → les jours s'effacent (le formulaire ne s'enverra pas)", () => {
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29" }), "fin", "2026-06-20", feries);
    expect(e.jours).toBe("");
    expect(e.fin).toBe("2026-06-20");
  });
  it("jours tapés sans début → rien ne se calcule, la valeur est gardée", () => {
    const e = recalculerChampsConge(CHAMPS_CONGE_VIDES, "jours", "4", feries);
    expect(e).toEqual({ debut: "", jours: "4", fin: "", dernierTouche: "jours" });
  });
});
