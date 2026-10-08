// @vitest-environment happy-dom
//
// Écrans des demandes à valider : la file (actions groupées Valider / Refuser avec motif, bilan des
// demandes non traitées, date de paiement corrigible, vue du demandeur) et l'Inventaire en lecture
// hors Direction. Ce que ces tests ne voient pas : le rendu réel à 375 px (vérifié à l'œil).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ApercuDemande } from "@/lib/validations-stock/apercu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = vi.hoisted(() => ({
  valider: vi.fn(async (_ids: string[], _dates?: Record<string, string>, _versions?: Record<string, string>, _motifs?: Record<string, unknown>): Promise<unknown> => ({ traitees: [], echecs: [] })),
  refuser: vi.fn(async (_ids: string[], _motif: string, _versions?: Record<string, string>): Promise<unknown> => ({ traitees: [], echecs: [] })),
  retirer: vi.fn(async (_id: string): Promise<unknown> => undefined),
}));
vi.mock("./actions", () => ({ validerDemandes: A.valider, refuserDemandes: A.refuser, retirerMaDemande: A.retirer }));
vi.mock("../catalogue/actions", () => ({
  creerArticle: vi.fn(), modifierArticle: vi.fn(), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(),
  basculerActifArticles: vi.fn(), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(), corrigerStocksNegatifs: vi.fn(),
}));

const { DemandesAValider } = await import("./demandes-client");
const { CatalogueTable } = await import("../catalogue/catalogue-table");

const base = { version: "2026-09-30T08:00:00.000Z", statut: "EN_ATTENTE", auteurId: "u1", auteurNom: "Jean", creeLe: "2026-09-30T08:00:00.000Z", decideurNom: null, decideLe: null, motifRefus: null, illisible: false, alertes: [], paiement: null, comptage: null, article: null, mouvement: null };
const DEMANDES: ApercuDemande[] = [
  { ...base, id: "p1", nature: "PAIEMENT_FACTURE", resume: "Payer la facture n° 12 de SENEVE le 29/09/2026 — 100,00 $",
    paiement: { mode: "SOLDE", date: "2026-09-29", total: 100, reglement: null, lotFrancs: null, factures: [{ id: "f1", nom: "SENEVE", numero: "12", resteDemande: 100, resteActuel: 100, reglee: false }] } },
  { ...base, id: "r1", nature: "RECONCILIATION", resume: "Inventaire — 1 écart(s)",
    comptage: { origine: "Inventaire", nbLignes: 3, valeurTotale: -4, lignes: [{ articleId: "a1", designation: "Riz", unite: "Kg", explication: "casse", theorique: "10", physique: "8", ecart: "-2", valeur: -4, actuel: "10", final: "8", etat: "inchange", raison: null }] } },
  { ...base, id: "m1", nature: "MODIF_ARTICLE", resume: "« Riz » : Prix unitaire USD 2 → 3", alertes: ["« Riz » — Prix unitaire USD a changé depuis la proposition."],
    article: { articles: [{ id: "a1", designation: "Riz", changements: [{ libelle: "Prix unitaire USD", avant: "2", apres: "3", actuel: "2,5" }] }] } },
];

let conteneur: HTMLDivElement;
let racine: Root;
function monter(el: ReturnType<typeof h>) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(el));
}
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.clearAllMocks(); });
const boutons = (texte: string) => [...conteneur.querySelectorAll("button")].filter((b) => b.textContent?.includes(texte));
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const taper = (el: HTMLInputElement, texte: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, texte);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("File de la Direction", () => {
  it("regroupe par nature, montre l'avant/après, les écarts et l'alerte de conflit", () => {
    monter(h(DemandesAValider, { demandes: DEMANDES, estDirection: true }));
    const t = conteneur.textContent!;
    expect(t).toContain("Paiements de factures (1)");
    expect(t).toContain("Réconciliations du stock (1)");
    expect(t).toContain("Modifications d'articles (1)");
    expect(t).toContain("(aujourd'hui : 2,5)");
    expect(t).toMatch(/ne peut plus être validée telle quelle/);
    expect(t).toContain("(4,00 $)"); // valeur d'écart négative : parenthèses, jamais « − »
  });

  it("actions groupées : Valider envoie la sélection (et la date de paiement) ; le bilan nomme la demande non traitée", async () => {
    A.valider.mockResolvedValueOnce({ traitees: ["p1"], echecs: [{ id: "m1", erreur: "Prix changé — rien n'a été écrit" }] });
    monter(h(DemandesAValider, { demandes: DEMANDES, estDirection: true }));
    const cases = [...conteneur.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]')];
    expect(cases).toHaveLength(3);
    await clic(cases[0]); await clic(cases[2]);
    await clic(boutons("Valider (2)")[0]);
    expect(A.valider).toHaveBeenCalledWith(["p1", "m1"], { p1: "2026-09-29" }, { p1: "2026-09-30T08:00:00.000Z", m1: "2026-09-30T08:00:00.000Z" }, {}); // la version VUE part avec la décision
    expect(conteneur.textContent).toContain("1 demande validée.");
    expect(conteneur.textContent).toContain("« « Riz » : Prix unitaire USD 2 → 3 » : Prix changé — rien n'a été écrit");
  });

  it("refus groupé : motif obligatoire, un seul motif pour la sélection", async () => {
    monter(h(DemandesAValider, { demandes: DEMANDES, estDirection: true }));
    await clic(conteneur.querySelector('label input[type="checkbox"]')!); // tout sélectionner
    await clic(boutons("Refuser (3)")[0]);
    const confirmer = boutons("Confirmer le refus (3)")[0];
    expect(confirmer.disabled).toBe(true);
    taper(conteneur.querySelector<HTMLInputElement>('input[aria-label="Motif du refus"]')!, "Recompter");
    expect(boutons("Confirmer le refus (3)")[0].disabled).toBe(false);
    await clic(boutons("Confirmer le refus (3)")[0]);
    expect(A.refuser).toHaveBeenCalledWith(["p1", "r1", "m1"], "Recompter", { p1: "2026-09-30T08:00:00.000Z", r1: "2026-09-30T08:00:00.000Z", m1: "2026-09-30T08:00:00.000Z" });
  });
});

describe("Vue du demandeur", () => {
  it("ni case ni Valider : ses demandes, « En attente de la Direction », et Retirer", async () => {
    monter(h(DemandesAValider, { demandes: DEMANDES.slice(0, 1), estDirection: false }));
    expect(conteneur.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(boutons("Valider")).toHaveLength(0);
    expect(conteneur.textContent).toContain("En attente de la Direction");
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
    await clic(boutons("Retirer ma demande")[0]);
    expect(A.retirer).toHaveBeenCalledWith("p1");
  });
});

describe("Ancienne demande de SORTIE manuelle : motif obligatoire pour la valider (2026-10-07)", () => {
  const sortie: ApercuDemande = { ...base, id: "s1", nature: "MOUVEMENT_MANUEL", resume: "Sortie manuelle « Sortie / consommation » : Riz 3 Kg",
    mouvement: { type: "SORTIE", origine: "Sortie / consommation", date: "2026-10-05T00:00:00.000Z", saisisDepuis: [], lignes: [{ articleId: "a1", designation: "Riz", unite: "Kg", quantite: "3", actuel: "10", apres: "7", valeur: -6 }] } };
  const entree: ApercuDemande = { ...sortie, id: "e1", resume: "Entrée manuelle « Correction » : Riz 3 Kg", mouvement: { ...sortie.mouvement!, type: "ENTREE", origine: "Correction", saisisDepuis: ["Riz"] } };

  it("« Valider » reste grisé tant que le motif (et la raison d'une perte) manque ; puis le motif part avec la décision", async () => {
    monter(h(DemandesAValider, { demandes: [sortie, entree], estDirection: true }));
    const select = conteneur.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((o) => o.textContent)).toEqual(["— motif —", "Livraison restaurant", "Perte"]);
    expect(conteneur.querySelectorAll("select")).toHaveLength(1); // l'entrée n'a pas de motif de sortie
    const [validerSortie, validerEntree] = boutons("Valider").filter((b) => /^\W*Valider\s*$/.test(b.textContent ?? ""));
    expect(validerSortie.disabled).toBe(true);
    expect(validerEntree.disabled).toBe(false);
    act(() => { select.value = "PERTE"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(validerSortie.disabled).toBe(true); // raison de la perte manquante
    taper(conteneur.querySelector<HTMLInputElement>('input[placeholder="Obligatoire"]')!, "Moisi");
    expect(validerSortie.disabled).toBe(false);
    await clic(validerSortie);
    expect(A.valider).toHaveBeenCalledWith(["s1"], {}, { s1: base.version }, { s1: { categorie: "PERTE", raison: "Moisi" } });
  });

  it("double saisie possible : la carte prévient (sans bloquer)", () => {
    monter(h(DemandesAValider, { demandes: [entree], estDirection: true }));
    expect(conteneur.textContent).toContain("Une entrée manuelle a été saisie en direct depuis cette demande sur « Riz »");
  });

  it("actions groupées : « Valider (n) » grisé tant qu'une sortie cochée n'a pas de motif ; le motif en lot part pour chacune", async () => {
    const sortie2: ApercuDemande = { ...sortie, id: "s2" };
    monter(h(DemandesAValider, { demandes: [sortie, sortie2, entree], estDirection: true }));
    const cases = [...conteneur.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((c) => c.getAttribute("aria-label")?.startsWith("Sélectionner :"));
    for (const c of cases) await clic(c);
    const lot = () => boutons("Valider (3)")[0];
    expect(lot().disabled).toBe(true);
    const motifLot = conteneur.querySelector<HTMLSelectElement>('select[aria-label^="Motif des 2 sortie"]')!;
    act(() => { motifLot.value = "LIVRAISON_RESTAURANT"; motifLot.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(lot().disabled).toBe(false);
    await clic(lot());
    const motifs = A.valider.mock.calls[0]![3];
    expect(motifs).toEqual({ s1: { categorie: "LIVRAISON_RESTAURANT", raison: "" }, s2: { categorie: "LIVRAISON_RESTAURANT", raison: "" } });
  });
});

describe("Inventaire hors Direction : en lecture, modifications proposées", () => {
  const art = { id: "a1", code: "137", designation: "Riz", nomCourt: null, surFicheCommande: false, domaine: "NOURRITURE" as const, categorieId: "c1", fournisseurId: null, unite: "Kg", prix: "2", uniteParCarton: null, quantite: "10", stockMinimum: "1", niveau: "OK" as const, haussePct: null, propositionEnAttente: true };
  const props = { articles: [art], categories: [{ id: "c1", nom: "Épicerie", domaine: "NOURRITURE" }], fournisseurs: [] };
  const ligne = () => conteneur.querySelector("tbody tr:not(:first-child)") ?? conteneur.querySelectorAll("tbody tr")[1];

  it("responsable : cases en lecture seule, listes désactivées, pastille « proposition en attente », pas de fusion", () => {
    monter(h(CatalogueTable, { ...props, estDirection: false }));
    const tr = ligne()!;
    const textes = [...tr.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')];
    expect(textes.length).toBeGreaterThan(5);
    // Cases texte en lecture seule ; la liste de recherche des fournisseurs (ChoixRecherche) désactivée.
    expect(textes.every((i) => i.readOnly || i.disabled)).toBe(true);
    expect(textes.some((i) => i.disabled)).toBe(true);
    expect([...tr.querySelectorAll("select")].every((s) => s.disabled)).toBe(true);
    expect(tr.textContent).toContain("proposition en attente");
    expect(conteneur.textContent).toContain("validées par la Direction");
    expect(conteneur.querySelector('input[name="quantite"]')).toBeNull();
  });

  it("Direction : cases modifiables (rien ne change pour elle)", () => {
    monter(h(CatalogueTable, { ...props, estDirection: true }));
    const tr = ligne()!;
    expect([...tr.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')].some((i) => i.readOnly || i.disabled)).toBe(false);
    expect([...tr.querySelectorAll("select")].some((s) => s.disabled)).toBe(false);
  });
});
