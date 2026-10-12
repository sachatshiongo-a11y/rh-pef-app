// @vitest-environment happy-dom
//
// « À valider » : échanges de shift et changements de shift avec cases à cocher et décisions GROUPÉES
// (audit du 10/10/2026, ergonomie 7) ; une demande refusée est nommée à l'écran.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({
  appCh: vi.fn<(ids: string[]) => Promise<{ traitees: number; echecs: string[] }>>(async (ids) => ({ traitees: ids.length, echecs: [] })),
  refCh: vi.fn<(ids: string[]) => Promise<{ traitees: number; echecs: string[] }>>(async (ids) => ({ traitees: ids.length, echecs: [] })),
  appEc: vi.fn<(ids: string[]) => Promise<{ traitees: number; echecs: string[] }>>(async (ids) => ({ traitees: ids.length, echecs: [] })),
  refEc: vi.fn<(ids: string[]) => Promise<{ traitees: number; echecs: string[] }>>(async (ids) => ({ traitees: ids.length, echecs: [] })),
}));
vi.mock("../planning/decisions-lot-actions", () => ({
  approuverChangementsEnLot: m.appCh, refuserChangementsEnLot: m.refCh, approuverEchangesEnLot: m.appEc, refuserEchangesEnLot: m.refEc,
}));

import { ShiftsInbox, type LigneShift } from "./shifts-inbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROWS: LigneShift[] = [
  { id: "c1", nom: "Aimée Mutita", photoUrl: null, detail: "lundi 12 octobre · Matin → Soir" },
  { id: "c2", nom: "Esther Nsundi", photoUrl: null, detail: "mardi 13 octobre · → Soir" },
];
let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.clearAllMocks(); });
function monter(props: Partial<Parameters<typeof ShiftsInbox>[0]> = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(ShiftsInbox, { type: "changement", rows: ROWS, peutPlanning: true, ...props })));
}
const boutons = (texte: RegExp) => [...conteneur.querySelectorAll("button")].filter((b) => texte.test(b.textContent ?? ""));
const cases = () => [...conteneur.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]')];

describe("ShiftsInbox", () => {
  it("une case par demande ; la barre propose Approuver / Refuser pour la sélection", async () => {
    monter();
    expect(cases().map((c) => c.getAttribute("aria-label"))).toEqual(["Sélectionner la demande de Aimée Mutita", "Sélectionner la demande de Esther Nsundi"]);
    act(() => cases()[0].click());
    act(() => cases()[1].click());
    await act(async () => boutons(/Approuver \(2\)/)[0].click());
    expect(m.appCh).toHaveBeenCalledWith(["c1", "c2"]);
    expect(conteneur.querySelector('[role="status"]')?.textContent).toBe("2 changement(s) approuvé(s).");
    expect(cases().some((c) => c.checked)).toBe(false);
  });

  it("les échanges passent par les actions d'échange, pas par celles des changements", async () => {
    monter({ type: "echange", rows: [{ id: "x1", nom: "Aimée ↔ Esther", photoUrl: null, detail: "…", accordCollegue: true }] });
    expect(conteneur.textContent).toContain("Collègue : accepté");
    act(() => cases()[0].click());
    await act(async () => boutons(/Refuser \(1\)/)[0].click());
    expect(m.refEc).toHaveBeenCalledWith(["x1"]);
    expect(m.refCh).not.toHaveBeenCalled();
  });

  it("une demande non traitée (verrou de paie…) est NOMMÉE avec sa raison", async () => {
    m.appCh.mockResolvedValueOnce({ traitees: 1, echecs: ["Esther Nsundi : la paie d'octobre est validée."] });
    monter();
    act(() => cases()[0].click());
    act(() => cases()[1].click());
    await act(async () => boutons(/Approuver \(2\)/)[0].click());
    expect(conteneur.querySelector('[role="status"]')?.textContent).toBe("1 changement(s) approuvé(s), 1 non traité(s) — Esther Nsundi : la paie d'octobre est validée.");
  });

  it("le bouton d'une ligne décide cette seule demande", async () => {
    monter();
    const approuver = [...conteneur.querySelectorAll("li")][1].querySelector("button")!;
    await act(async () => approuver.click());
    expect(m.appCh).toHaveBeenCalledWith(["c2"]);
  });

  it("sans droit de planning : ni cases ni boutons, la demande reste « En attente »", () => {
    monter({ peutPlanning: false });
    expect(cases()).toHaveLength(0);
    expect(conteneur.textContent).toContain("En attente");
    expect(boutons(/Approuver|Refuser/)).toHaveLength(0);
  });

  it("aucune demande : le message vide", () => {
    monter({ rows: [], type: "echange" });
    expect(conteneur.textContent).toContain("Aucun échange de shift en attente.");
  });
});
