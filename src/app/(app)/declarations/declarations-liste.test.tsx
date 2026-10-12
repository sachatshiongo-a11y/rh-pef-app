// @vitest-environment happy-dom
//
// Déclarations : cases à cocher par organisme, actions groupées « Marquer déclaré » / « Marquer payé » avec
// confirmation (marquer fige le montant, un paiement ne s'annule pas), cartes sur téléphone (audit du 10/10/2026,
// ergonomie 7 et 8).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({ lot: vi.fn<(...a: unknown[]) => Promise<unknown>>(async (types) => ({ traitees: (types as string[]).length, echecs: [] })) }));
vi.mock("./actions", () => ({ marquerDeclarationsEnLot: m.lot }));

import { DeclarationsListe, type LigneDeclarationEcran } from "./declarations-liste";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const L = (type: LigneDeclarationEcran["type"], statut: LigneDeclarationEcran["statut"], plus: Partial<LigneDeclarationEcran> = {}): LigneDeclarationEcran => ({
  type, libelle: type, detail: `Détail ${type}`, montantUSD: 100, montantCDF: 280000, recalculUSD: 100, figeLe: null, ecartAvecFige: false, echeance: "15/11/2026", echeanceAValider: false, statut, ...plus,
});
const LIGNES = [L("CNSS", "A_DECLARER"), L("IPR", "DECLARE", { figeLe: "03/11/2026" }), L("INPP", "PAYE", { figeLe: "03/11/2026" }), L("ONEM", "A_DECLARER")];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
function monter(props: Partial<Parameters<typeof DeclarationsListe>[0]> = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(DeclarationsListe, { lignes: LIGNES, mois: 10, annee: 2026, periode: "octobre 2026", provisoire: false, estAdmin: true, totalUSD: 400, totalCDF: 1120000, ...props })));
}
const casesTableau = () => [...conteneur.querySelectorAll<HTMLInputElement>('table tbody input[type="checkbox"]')];
const barre = () => conteneur.querySelector<HTMLElement>(".sticky")!;
const bouton = (zone: ParentNode, re: RegExp) => [...zone.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""))!;

describe("DeclarationsListe — actions groupées", () => {
  it("une case par organisme ; les boutons de la barre ne comptent que ce qui est possible", () => {
    monter();
    expect(casesTableau()).toHaveLength(4);
    for (const c of casesTableau()) act(() => c.click()); // tout cocher
    expect(bouton(barre(), /Marquer déclaré/).textContent).toBe("Marquer déclaré (2)"); // CNSS et ONEM seulement
    expect(bouton(barre(), /Marquer payé/).textContent).toContain("Marquer payé (3)"); // CNSS, IPR (déclaré), ONEM — INPP déjà payé
  });

  it("confirmation avant d'écrire ; refusée = rien n'est envoyé", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    monter();
    act(() => casesTableau()[0].click());
    await act(async () => bouton(barre(), /Marquer payé/).click());
    expect(m.lot).not.toHaveBeenCalled();
    expect((window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("ne pourra plus être annulé");
  });

  it("confirmée : une seule requête pour tout le lot, puis le bilan", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    monter();
    act(() => casesTableau()[0].click());
    act(() => casesTableau()[3].click());
    await act(async () => bouton(barre(), /Marquer déclaré/).click());
    expect(m.lot).toHaveBeenCalledTimes(1);
    expect(m.lot).toHaveBeenCalledWith(["CNSS", "ONEM"], 10, 2026, "DECLARE");
    expect(conteneur.querySelector('[role="status"]')?.textContent).toBe("2 déclaration(s) marquée(s) déclarée(s).");
  });

  it("un organisme refusé est nommé avec sa raison", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    m.lot.mockResolvedValueOnce({ traitees: 1, echecs: ["ONEM : Cette déclaration est déjà marquée payée."] });
    monter();
    act(() => casesTableau()[0].click());
    act(() => casesTableau()[3].click());
    await act(async () => bouton(barre(), /Marquer payé/).click());
    expect(conteneur.querySelector('[role="status"]')?.textContent).toContain("ONEM : Cette déclaration est déjà marquée payée.");
  });

  it("paie provisoire : on ne déclare pas, on le dit sur la ligne", () => {
    monter({ provisoire: true });
    expect(conteneur.textContent).toContain("Validez la paie d'abord");
    act(() => casesTableau()[0].click());
    expect(bouton(barre(), /Marquer déclaré/).textContent).toBe("Marquer déclaré (0)");
    expect((bouton(barre(), /Marquer déclaré/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hors Direction : ni cases ni actions, mais les montants et les cartes du téléphone restent", () => {
    monter({ estAdmin: false });
    expect(casesTableau()).toHaveLength(0);
    expect(conteneur.querySelector(".sticky")).toBeNull();
    expect(conteneur.querySelectorAll(".lg\\:hidden > div").length).toBeGreaterThanOrEqual(4);
  });

  it("le montant figé et l'écart de recalcul restent dits", () => {
    monter({ lignes: [L("IPR", "DECLARE", { figeLe: "03/11/2026", ecartAvecFige: true, recalculUSD: 120 })] });
    expect(conteneur.textContent).toContain("figé au marquage du 03/11/2026");
    expect(conteneur.textContent).toContain("différent du montant déclaré");
  });
});
