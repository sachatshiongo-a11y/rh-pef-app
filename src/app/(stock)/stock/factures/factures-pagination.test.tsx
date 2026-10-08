// @vitest-environment happy-dom
//
// Factures — pagination (2026-10-08) : 50 / 100 / Tout factures par page sur la liste groupée (année → mois,
// ou fournisseur). La liste entière est chargée : les groupes gardent leur compteur et leur « dû » sur TOUT le
// filtre et ne montrent que les lignes de la page ; la sélection suit la page, un lien prend tout le filtre.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const appels = vi.hoisted(() => ({
  marquerPayee: vi.fn(async () => ({})),
  supprimerFacture: vi.fn(async () => ({})),
  marquerPayeesEnLot: vi.fn<(ids: string[], date?: string, devise?: string) => Promise<unknown>>(async (ids: string[]) => ({ reglees: ids.length, demandees: ids.length })),
  supprimerFacturesEnLot: vi.fn<(ids: string[]) => Promise<unknown>>(async () => ({})),
}));
vi.mock("./actions", () => appels);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const { FacturesUI } = await import("./factures-client");
type Props = Parameters<typeof FacturesUI>[0];
type Row = NonNullable<Props["moisPlats"]>[number]["factures"][number];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (n: number): Row => ({
  id: `f${String(n).padStart(3, "0")}`, nom: "SENEVE", fournisseurId: "four-1", numero: `N-${n}`, date: "10/09/2026", echeance: "10/10/2026",
  joursRestants: 9, datePaiement: null, montant: "100", reste: 100, statut: "A_REGLER", documentUrl: null,
});
// 120 factures : Septembre 2026 = f001..f040, Août = f041..f080, Juillet = f081..f120 (40 par mois, 100 $ dus chacune).
const MOIS = [["2026-09", "Septembre 2026", 0], ["2026-08", "Août 2026", 40], ["2026-07", "Juillet 2026", 80]] as const;
const ANNEES = [{ annee: 2026, mois: MOIS.map(([cle, label, d]) => ({ cle, label, factures: Array.from({ length: 40 }, (_, i) => row(d + i + 1)) })) }];

let conteneur: HTMLDivElement;
let racine: Root;
function monter(props: Partial<Props> = {}) {
  conteneur = document.createElement("div"); document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(FacturesUI, { annees: ANNEES, estDirection: true, paginer: true, ...props })));
}
beforeEach(() => { for (const f of Object.values(appels)) f.mockClear(); window.history.replaceState(null, "", "/stock/factures"); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const clic = (el: Element) => act(() => (el as HTMLElement).click());
const cartes = () => conteneur.querySelectorAll("li input[type=checkbox]").length;
const bouton = (label: string) => conteneur.querySelector<HTMLButtonElement>(`nav[data-pagination] button[aria-label="${label}"]`)!;
const caseTout = () => conteneur.querySelector<HTMLInputElement>('label input[type="checkbox"]')!;
const texte = () => conteneur.textContent ?? "";

describe("Factures paginées", () => {
  it("page 1 : 50 factures (septembre en entier + 10 d'août), compteur 1–50 sur 120", () => {
    monter();
    expect(cartes()).toBe(50);
    expect(conteneur.querySelector("[data-pagination-compteur]")!.textContent).toContain("1–50 sur 120");
  });

  it("les groupes gardent leurs chiffres sur TOUT le filtre et disent ce qui est affiché", () => {
    monter();
    expect(texte()).toContain("2026 · 120 facture(s) · 50 affichée(s)"); // l'année : 120 au total, 50 sur la page
    expect(texte()).toContain("Septembre 2026 · 40"); // mois entier sur la page : aucune mention
    expect(texte()).not.toMatch(/Septembre 2026 · 40 · /);
    expect(texte()).toContain("Août 2026 · 40 · 10 affichée(s)"); // coupé : le dit
    expect(texte()).toMatch(/dû 4[\s\u202f\u00a0]000,00 \$/); // 40 × 100 $ : le dû du mois entier, pas des 10 lignes affichées
    expect(texte()).toMatch(/dû 12[\s\u202f\u00a0]000,00 \$/); // et celui de l'année entière
    expect(texte()).not.toContain("Juillet 2026"); // aucune ligne sur la page : le groupe disparaît
  });

  it("page 3 : les 20 dernières ; l'URL porte ?page=3", () => {
    monter({ pageInit: 3 });
    expect(cartes()).toBe(20);
    expect(texte()).toContain("Juillet 2026 · 40 · 20 affichée(s)");
    expect(texte()).not.toContain("Septembre 2026");
  });

  it("100 par page, Tout ; la taille va dans l'URL", () => {
    monter();
    clic(bouton("100 par page"));
    expect(cartes()).toBe(100);
    expect(window.location.search).toBe("?par=100");
    clic(bouton("Afficher tout"));
    expect(cartes()).toBe(120);
    expect(texte()).not.toContain("affichée(s)");
  });

  it("« Tout sélectionner » coche la page (50), un lien prend les 120 du filtre, « Marquer payées » les reçoit", () => {
    monter();
    clic(caseTout());
    expect(texte()).toContain("50 sélectionné(s)");
    const proposer = conteneur.querySelector<HTMLButtonElement>('[data-tout-le-filtre="proposer"]')!;
    expect(proposer.textContent).toBe("Sélectionner les 120 factures du filtre");
    clic(proposer);
    expect(texte()).toContain("120 sélectionné(s)");
    clic([...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes("Marquer payées"))!);
    expect(texte()).toContain("(120)");
  });

  it("sans `paginer` (fiche d'un fournisseur) : tout s'affiche, aucune barre", () => {
    monter({ paginer: false });
    expect(cartes()).toBe(120);
    expect(conteneur.querySelector("nav[data-pagination]")).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("présentation par fournisseur : mêmes règles", () => {
    const groupes = [{ titre: "SENEVE", factures: Array.from({ length: 70 }, (_, i) => row(i + 1)) }, { titre: "AUTRE", factures: Array.from({ length: 10 }, (_, i) => row(100 + i)) }];
    monter({ annees: undefined, groupes });
    expect(cartes()).toBe(50);
    expect(texte()).toContain("SENEVE · 70 facture(s) · 50 affichée(s)");
    expect(texte()).not.toContain("AUTRE");
    clic(bouton("Page suivante"));
    expect(cartes()).toBe(30);
    expect(texte()).toContain("SENEVE · 70 facture(s) · 20 affichée(s)");
    expect(texte()).toContain("AUTRE · 10 facture(s)");
  });
});
