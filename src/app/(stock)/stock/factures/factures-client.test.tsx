// @vitest-environment happy-dom
//
// Liste de factures (écran Factures ET onglet Factures de la fiche fournisseur) : la barre d'actions
// groupées respecte EXACTEMENT les droits — la Direction règle, les autres DEMANDENT le paiement
// (jamais de paiement direct, jamais de suppression) —, une facture dont le paiement attend déjà la
// Direction n'est jamais redemandée, la sélection s'exporte, et la présentation « mois plats »
// ouvre le mois le plus récent.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const appels = vi.hoisted(() => ({
  marquerPayee: vi.fn<(id: string, date?: string) => Promise<unknown>>(async () => ({})),
  supprimerFacture: vi.fn<(id: string) => Promise<unknown>>(async () => ({})),
  marquerPayeesEnLot: vi.fn<(ids: string[], date?: string) => Promise<unknown>>(async (ids: string[]) => ({ reglees: ids.length, demandees: ids.length })),
  supprimerFacturesEnLot: vi.fn<(ids: string[]) => Promise<unknown>>(async () => ({})),
}));
vi.mock("./actions", () => appels);
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh }) }));

const { FacturesUI, MAX_EXPORT_SELECTION } = await import("./factures-client");
type Props = Parameters<typeof FacturesUI>[0];
type Row = NonNullable<Props["moisPlats"]>[number]["factures"][number];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, o: Partial<Row> = {}): Row => ({
  id, nom: "SENEVE", fournisseurId: "four-1", numero: `N-${id}`, date: "10/09/2026", echeance: "10/10/2026",
  joursRestants: 9, datePaiement: null, montant: "100", reste: 100, statut: "A_REGLER", documentUrl: null, ...o,
});
const MOIS = [
  { cle: "2026-09", label: "Septembre 2026", factures: [row("a"), row("b", { paiementDemande: true })] },
  { cle: "2026-08", label: "Août 2026", factures: [row("c", { statut: "REGLEE", reste: 0, datePaiement: "20/08/2026" })] },
];

let conteneur: HTMLDivElement;
let racine: Root;
const rendre = (props: Props & { key?: string }) => act(() => racine.render(createElement(FacturesUI, props)));
const clic = (el: Element) => act(() => (el as HTMLElement).click());
const boutons = () => [...conteneur.querySelectorAll("button")];
const bouton = (texte: string) => boutons().find((b) => b.textContent!.includes(texte));
const toutSelectionner = () => clic(conteneur.querySelector('label input[type="checkbox"]')!);

beforeEach(() => {
  for (const f of Object.values(appels)) f.mockClear();
  refresh.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe("présentation « mois plats » (fiche fournisseur)", () => {
  it("un accordéon par mois, le plus récent ouvert seul ; une case par facture + « Tout sélectionner »", () => {
    rendre({ moisPlats: MOIS, sansFournisseur: true, estDirection: true });
    const details = [...conteneur.querySelectorAll("details")];
    expect(details.map((d) => d.querySelector(".capitalize")!.textContent)).toEqual(["Septembre 2026", "Août 2026"]);
    expect(details.map((d) => d.open)).toEqual([true, false]);
    expect(conteneur.querySelectorAll('input[type="checkbox"]')).toHaveLength(3 + 1);
  });
  it("sansFournisseur : le nom du fournisseur n'est pas répété ; sinon il est cliquable vers sa fiche", () => {
    rendre({ moisPlats: MOIS, sansFournisseur: true, estDirection: true });
    expect(conteneur.querySelector('a[href="/stock/fournisseurs/four-1"]')).toBeNull();
    expect(conteneur.textContent).not.toContain("SENEVE");
    rendre({ moisPlats: MOIS, estDirection: true });
    expect(conteneur.querySelector('a[href="/stock/fournisseurs/four-1"]')).not.toBeNull();
  });
  it("le lien Détail porte le retour vers la fiche", () => {
    rendre({ moisPlats: MOIS, sansFournisseur: true, suffixeRetour: "?retour=%2Fstock%2Ffournisseurs%2Ffour-1%3Fonglet%3Dfactures", estDirection: true });
    expect(conteneur.querySelector('a[href="/stock/factures/a?retour=%2Fstock%2Ffournisseurs%2Ffour-1%3Fonglet%3Dfactures"]')).not.toBeNull();
  });
});

describe("droits de la barre d'actions groupées", () => {
  it("hors Direction : « Demander le paiement », jamais « Marquer payées » ni « Supprimer »", () => {
    rendre({ moisPlats: MOIS, estDirection: false });
    toutSelectionner();
    const t = conteneur.textContent!;
    // 3 sélectionnées : 1 réglée et 1 déjà demandée sont exclues → 1 seule à demander.
    expect(bouton("Demander le paiement")!.textContent).toContain("(1)");
    expect(t).not.toContain("Marquer payées");
    expect(boutons().some((b) => b.textContent!.includes("Supprimer"))).toBe(false);
    expect(t).toContain("1 déjà en attente de la Direction");
  });
  it("hors Direction : la demande part avec les seules factures à régler et non déjà demandées", async () => {
    rendre({ moisPlats: MOIS, estDirection: false });
    toutSelectionner();
    clic(bouton("Demander le paiement")!);
    await act(async () => { bouton("Envoyer la demande")!.click(); });
    expect(appels.marquerPayeesEnLot).toHaveBeenCalledTimes(1);
    expect(appels.marquerPayeesEnLot.mock.calls[0][0]).toEqual(["a"]);
    expect(appels.supprimerFacturesEnLot).not.toHaveBeenCalled();
    expect(appels.marquerPayee).not.toHaveBeenCalled();
  });
  it("Direction : « Marquer payées » et « Supprimer » ; mêmes exclusions", () => {
    rendre({ moisPlats: MOIS, estDirection: true });
    toutSelectionner();
    expect(bouton("Marquer payées")!.textContent).toContain("(1)");
    expect(bouton("Supprimer")!.textContent).toContain("(3)");
    expect(conteneur.textContent).not.toContain("Demander le paiement");
  });
  it("la liste actualise l'écran après un geste réussi (l'action ne revalide pas forcément la fiche)", async () => {
    rendre({ moisPlats: MOIS, estDirection: true });
    toutSelectionner();
    clic(bouton("Marquer payées")!);
    await act(async () => { bouton("Confirmer")!.click(); });
    expect(appels.marquerPayeesEnLot).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });
});

describe("export de la sélection", () => {
  it("un lien d'export portant les identifiants cochés, ouvert à tous les rôles de l'espace", () => {
    for (const estDirection of [true, false]) {
      rendre({ moisPlats: MOIS, estDirection, key: String(estDirection) }); // une liste neuve par rôle : la sélection ne se reporte pas
      clic(conteneur.querySelectorAll('input[type="checkbox"]')[1]); // « a »
      clic(conteneur.querySelectorAll('input[type="checkbox"]')[3]); // « c »
      const lien = [...conteneur.querySelectorAll("a")].find((a) => a.textContent!.includes("Exporter ("))!;
      expect(lien.getAttribute("href")).toBe("/stock/factures/export?ids=a,c");
      expect(lien.textContent).toContain("(2)");
    }
  });
  it("au-delà du plafond, le bouton le dit au lieu de fabriquer une adresse démesurée", () => {
    const beaucoup = Array.from({ length: MAX_EXPORT_SELECTION + 1 }, (_, i) => row(`f${i}`));
    rendre({ moisPlats: [{ cle: "2026-09", label: "Septembre 2026", factures: beaucoup }], estDirection: true });
    toutSelectionner();
    expect([...conteneur.querySelectorAll("a")].some((a) => a.textContent!.includes("Exporter ("))).toBe(false);
    expect(conteneur.textContent).toContain(`Export : ${MAX_EXPORT_SELECTION} factures au plus`);
  });
});

describe("sélection et filtre", () => {
  it("rien n'est compté, supprimé ni exporté qui ne soit plus à l'écran après un changement de liste", () => {
    rendre({ moisPlats: MOIS, estDirection: true });
    toutSelectionner();
    expect(conteneur.textContent).toContain("3 sélectionné(s)");
    // Le filtre change : « c » (payée) disparaît de l'écran, sa case cochée ne doit plus compter.
    rendre({ moisPlats: [MOIS[0]], estDirection: true });
    expect(conteneur.textContent).toContain("2 sélectionné(s)");
    expect(bouton("Supprimer")!.textContent).toContain("(2)");
    expect([...conteneur.querySelectorAll("a")].find((a) => a.textContent!.includes("Exporter ("))!.getAttribute("href")).toBe("/stock/factures/export?ids=a,b");
  });
  it("la pastille « Paiement demandé » reste sur sa facture, sans bouton de paiement pour elle", () => {
    rendre({ moisPlats: MOIS, estDirection: false });
    const lignes = [...conteneur.querySelectorAll("li")];
    const demandee = lignes.find((l) => l.textContent!.includes("N-b"))!;
    expect(demandee.textContent).toContain("Paiement demandé — en attente de la Direction");
    expect(demandee.textContent).not.toContain("Demander le paiement");
    expect(lignes.find((l) => l.textContent!.includes("N-a"))!.textContent).toContain("Demander le paiement");
  });
});
