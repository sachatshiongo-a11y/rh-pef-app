// @vitest-environment happy-dom
//
// Écrans des imports après l'audit du 10/10/2026 : l'annulation dit ce qu'elle va faire et propose la
// confirmation « remettre quand même » ; les probables doublons de factures et les fournisseurs proches se
// décident à l'écran ; les lignes « Approché » de l'import de mouvements arrivent décochées.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const annulerImportAction = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ stocksLaisses: [], remisMalgrePosterieur: [] }));
const appliquerFacturesAction = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ resume: { aInserer: 1, doublons: 0, aConfirmer: 0, fournisseursCrees: 0 } }));
const appliquerMouvementsAction = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ resume: { rapprochees: 1, articles: 1, entreesQte: 1, sortiesQte: 0, dejaPresents: 0 } }));
const PREVIEW_FACTURES = {
  factures: [
    { cle: "0", fournisseurNom: "ETS SENEVE", numero: "S1", periode: "oct. 2026", devise: "USD", montant: 100, statut: "A_REGLER", etat: "NOUVELLE", message: null },
    { cle: "1", fournisseurNom: "ETS SENEVE", numero: null, periode: "oct. 2026", devise: "USD", montant: 80, statut: "A_REGLER", etat: "A_CONFIRMER", message: "Une facture du même fournisseur, du même montant existe déjà." },
    { cle: "2", fournisseurNom: "ETS SENEVE", numero: "S0", periode: "oct. 2026", devise: "USD", montant: 5, statut: "A_REGLER", etat: "DOUBLON_NUMERO", message: "déjà une facture n° S0" },
    { cle: "3", fournisseurNom: "Kathy", numero: "K1", periode: "oct. 2026", devise: "USD", montant: 30, statut: "A_REGLER", etat: "NOUVELLE", message: null },
  ],
  fournisseursCrees: ["Kathy"], fournisseursProches: { Kathy: [{ id: "f-kathy", nom: "Maison Kathy" }] }, erreurs: [],
  resume: { aInserer: 2, doublons: 1, aConfirmer: 1, fournisseursCrees: 1, totalUSD: 130, total: { usd: 130, cdf: 0, nbUSD: 2, nbCDF: 0 } },
};
const LIGNES = [
  { ligne: 2, date: "2026-10-02", codeCsv: "1", designationCsv: "Riz", entree: 1, sortie: 0, articleId: "a1", articleNom: "Riz basmati", rapprochement: "nom", entreeDejaPresente: false, sortieDejaPresente: false },
  { ligne: 3, date: "2026-10-02", codeCsv: "2", designationCsv: "Lait", entree: 2, sortie: 0, articleId: "a2", articleNom: "Lait de coco", rapprochement: "flou", entreeDejaPresente: false, sortieDejaPresente: false },
];
vi.mock("./actions", () => ({
  annulerImportAction: (...a: unknown[]) => annulerImportAction(...a),
  analyserFacturesAction: vi.fn(async () => PREVIEW_FACTURES),
  appliquerFacturesAction: (...a: unknown[]) => appliquerFacturesAction(...a),
  analyserMouvementsAction: vi.fn(async () => ({ lignes: LIGNES, resume: { total: 2, rapprochees: 2, inconnues: 0, entreesQte: 3, sortiesQte: 0, articles: 2, sansDate: 0, dejaPresents: 0 }, erreurs: [] })),
  appliquerMouvementsAction: (...a: unknown[]) => appliquerMouvementsAction(...a),
}));

const { BoutonAnnulerImport, texteConfirmationAnnulation } = await import("./annuler-btn");
const { ImportFacturesClient } = await import("./import-factures-client");
const { ImportMouvementsClient } = await import("./import-mouvements-client");

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => { annulerImportAction.mockClear(); appliquerFacturesAction.mockClear(); appliquerMouvementsAction.mockClear(); window.history.replaceState(null, "", "/stock/imports"); });
afterEach(() => { if (racine) act(() => racine.unmount()); conteneur?.remove(); racine = undefined as unknown as Root; });
function monter(el: ReturnType<typeof h>) {
  conteneur = document.createElement("div"); document.body.appendChild(conteneur);
  racine = createRoot(conteneur); act(() => racine.render(el));
}
const clic = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const parLabel = (txt: string) => [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(txt))!;

describe("confirm() de l'annulation : dit ce qui va se passer", () => {
  const p = { mouvements: 12, achatsLegumes: 3, articlesCrees: 2, articlesStock: 9, factures: 4, fournisseursCrees: 1 };
  it("mouvements : variation inverse, nombres annoncés", () => {
    const t = texteConfirmationAnnulation("Mouvements du 10/07", "MOUVEMENTS", p);
    expect(t).toContain("12 mouvements");
    expect(t).toContain("9 articles");
    expect(t).toMatch(/une entrée est retirée, une sortie est rendue/);
    expect(t).toMatch(/ne sont pas touchées/);
  });
  it("inventaire : valeur d'avant remise, refus annoncé si des saisies ont suivi", () => {
    const t = texteConfirmationAnnulation("Inventaire", "INVENTAIRE", p);
    expect(t).toMatch(/9 articles sera remis à la valeur d'AVANT|stock de 9 articles sera remis/);
    expect(t).toMatch(/l'annulation sera refusée/);
    expect(t).toContain("2 articles créés");
  });
  it("factures : nombre de factures", () => {
    expect(texteConfirmationAnnulation("Factures", "FACTURES", p)).toContain("4 factures importées seront supprimées");
  });
});

describe("annulation d'un inventaire avec saisies postérieures", () => {
  it("le refus est dit, puis la Direction confirme « remettre quand même » : l'action est relancée avec le drapeau", async () => {
    annulerImportAction
      .mockResolvedValueOnce({ erreur: "STOCK_POSTERIEUR|Annulation refusée : 1 article(s) de cet import ont bougé depuis (« Beurre doux » : sortie de 3 kg du 20/06/2026)." })
      .mockResolvedValueOnce({ stocksLaisses: [], remisMalgrePosterieur: ["« Beurre doux »"] });
    const confirmations: string[] = [];
    window.confirm = (m?: string) => { confirmations.push(String(m)); return true; };
    monter(h(BoutonAnnulerImport, { batchId: "b1", libelle: "Inventaire", type: "INVENTAIRE", portee: { mouvements: 0, achatsLegumes: 0, articlesCrees: 0, articlesStock: 1, factures: 0, fournisseursCrees: 0 } }));
    await clic(parLabel("Annuler cet import"));
    await act(async () => {});
    expect(annulerImportAction).toHaveBeenNthCalledWith(1, "b1", false);
    expect(annulerImportAction).toHaveBeenNthCalledWith(2, "b1", true);
    expect(confirmations[1]).toContain("Beurre doux");
    expect(confirmations[1]).toContain("Remettre quand même la valeur d'avant pour ces articles ?");
  });
  it("refus de la confirmation : l'action n'est pas relancée", async () => {
    annulerImportAction.mockResolvedValueOnce({ erreur: "STOCK_POSTERIEUR|refus détaillé" });
    let n = 0;
    window.confirm = () => ++n === 1;
    monter(h(BoutonAnnulerImport, { batchId: "b1", libelle: "Inventaire", type: "INVENTAIRE" }));
    await clic(parLabel("Annuler cet import"));
    await act(async () => {});
    expect(annulerImportAction).toHaveBeenCalledTimes(1);
    expect(conteneur.textContent).toContain("refus détaillé");
  });
});

describe("import de factures : probables doublons et fournisseurs proches", () => {
  it("les probables doublons arrivent décochés ; le fournisseur proche bloque l'application jusqu'au choix ; la coche part dans `forcer`", async () => {
    monter(h(ImportFacturesClient));
    await clic(parLabel("Analyser"));
    await act(async () => {});
    const appliquer = () => parLabel("Appliquer l'import");
    const caseConfirmer = conteneur.querySelector<HTMLInputElement>("[data-a-confirmer] input[type=checkbox]")!;
    expect(caseConfirmer.checked).toBe(false);
    expect(conteneur.querySelector("[data-fournisseur-proche]")).not.toBeNull();
    expect(appliquer().disabled).toBe(true); // « Kathy » ressemble à « Maison Kathy » : à décider
    await clic(conteneur.querySelector<HTMLButtonElement>("[data-fournisseur-proche] [data-utiliser='f-kathy']")!);
    expect(appliquer().disabled).toBe(false);
    await clic(caseConfirmer);
    expect(appliquer().textContent).toContain("(3)"); // 2 nouvelles + 1 cochée
    await clic(appliquer());
    await act(async () => {});
    const fd = appliquerFacturesAction.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(fd.get("forcer")))).toEqual(["1"]);
    expect(JSON.parse(String(fd.get("choixFournisseurs")))).toEqual({ Kathy: "f-kathy" });
  });
});

describe("import de mouvements : « Approché » jamais coché d'office", () => {
  it("la ligne rapprochée par nom approchant arrive décochée et annoncée ; seule la ligne sûre est envoyée", async () => {
    monter(h(ImportMouvementsClient));
    await clic(parLabel("Analyser"));
    await act(async () => {});
    expect(conteneur.querySelector("[data-flou-decoches]")?.textContent).toContain("1 ligne(s) « Approché »");
    const cases = [...conteneur.querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]")];
    expect(cases.map((c) => c.checked)).toEqual([true, false]);
    await clic(parLabel("Importer la sélection"));
    await act(async () => {});
    const fd = appliquerMouvementsAction.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(fd.get("lignes")))).toEqual([2]);
  });
});
