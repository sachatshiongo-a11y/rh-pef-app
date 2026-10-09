// @vitest-environment happy-dom
//
// CONGÉS — LA LISTE (refonte 2026-10-09) : sections dans l'ordre, « Passés » repliée, cases à cocher et barre
// d'actions groupées, droits (décider et supprimer = Direction ; PDF = toute l'équipe RH), téléphone (cartes).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LigneConge } from "@/lib/conges-liste";

const M = vi.hoisted(() => ({
  approuverCongesEnLot: vi.fn(async (ids: string[]) => ({ traitees: ids.length, echecs: [] as string[] })),
  refuserCongesEnLot: vi.fn(async (ids: string[]) => ({ traitees: ids.length, echecs: [] as string[] })),
  supprimerCongesEnLot: vi.fn(async (ids: string[]) => ({ traitees: ids.length, echecs: [] as string[] })),
}));
vi.mock("./actions", () => ({
  approuverCongeFormulaire: vi.fn(), refuserConge: vi.fn(), supprimerConge: vi.fn(),
  approuverCongesEnLot: M.approuverCongesEnLot, refuserCongesEnLot: M.refuserCongesEnLot, supprimerCongesEnLot: M.supprimerCongesEnLot,
}));
vi.mock("../signature-actions", () => ({ faireSignerDocument: vi.fn() }));

import { ListeConges, type GroupeMois, type SectionListe } from "./liste-conges";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ligne = (id: string, nom: string, statut: LigneConge["statut"], debut: string, fin: string, extra: Partial<LigneConge> = {}): LigneConge => ({
  id, employeeId: `emp-${id}`, nom, photoUrl: null, type: "Congé annuel", debut, fin, nbJours: 5, statut, approuveParNom: null,
  signature: statut === "APPROUVE" ? { etat: "A_SIGNER", signeLeTexte: null } : null, ...extra,
});
const A1 = ligne("a1", "Aimée Mutita", "EN_ATTENTE", "2026-10-20", "2026-10-24");
const A2 = ligne("a2", "Bijou Mputu", "EN_ATTENTE", "2026-11-02", "2026-11-06");
const C1 = ligne("c1", "Christian Lumbu", "APPROUVE", "2026-10-05", "2026-10-12", { signature: { etat: "SIGNE", signeLeTexte: "08/10/2026" } });
const V1 = ligne("v1", "Dorcas Ilunga", "APPROUVE", "2026-12-01", "2026-12-05");
const P1 = ligne("p1", "Emmanuel Tshimanga", "APPROUVE", "2026-09-01", "2026-09-05", { approuveParNom: "Sacha Tshiongo" });
const P2 = ligne("p2", "Fatuma Mwamba", "REFUSE", "2026-08-03", "2026-08-07");

const SECTIONS: SectionListe[] = [
  { cle: "A_TRAITER", lignes: [A1, A2], total: 2, tronque: false },
  { cle: "EN_COURS", lignes: [C1], total: 1, tronque: false },
  { cle: "A_VENIR", lignes: [V1], total: 1, tronque: false },
  { cle: "PASSES", lignes: [P1, P2], total: 2, tronque: false },
];

let conteneur: HTMLDivElement;
let racine: Root;
type Props = Partial<Parameters<typeof ListeConges>[0]>;
function monter(role: "ADMIN" | "MANAGER" | "VIEWER", props: Props = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(ListeConges, {
    regroupement: "etat", sections: SECTIONS, groupes: [], passesOuvertParDefaut: false, anneeCourante: 2026,
    peutGerer: role !== "VIEWER", peutApprouver: role === "ADMIN", filtresRetour: {}, vide: null, pagination: h("nav", { "data-pagination": "" }, "pagination"),
    ...props,
  })));
}
beforeEach(() => { vi.stubGlobal("confirm", vi.fn(() => true)); Object.values(M).forEach((f) => f.mockClear()); });
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  vi.unstubAllGlobals();
});

const tableau = () => conteneur.querySelector<HTMLElement>('[data-vue="tableau"]')!;
const cartes = () => conteneur.querySelector<HTMLElement>('[data-vue="cartes"]')!;
const idsLignes = (zone: HTMLElement) => [...zone.querySelectorAll("[data-conge]")].map((e) => e.getAttribute("data-conge"));
const titresSections = (zone: HTMLElement) => [...zone.querySelectorAll("[data-section]")].map((s) => s.getAttribute("data-section"));
const bouton = (texte: RegExp, zone: ParentNode = conteneur) => [...zone.querySelectorAll("button")].find((b) => texte.test(b.textContent ?? ""));
const caseDe = (id: string, zone: ParentNode = tableau()) => zone.querySelector<HTMLInputElement>(`[data-conge="${id}"] input[type="checkbox"]`)!;

describe("sections", () => {
  it("dans l'ordre : À traiter, En cours aujourd'hui, À venir, Passés ; chacune avec son compte", () => {
    monter("ADMIN", { passesOuvertParDefaut: true });
    expect(titresSections(tableau())).toEqual(["A_TRAITER", "EN_COURS", "A_VENIR", "PASSES"]);
    const titres = [...tableau().querySelectorAll("tbody > tr:first-child th")].map((t) => t.textContent?.replace(/\s+/g, " ").trim());
    expect(titres[0]).toMatch(/^À traiter \(2\)/);
    expect(titres[1]).toMatch(/^En cours aujourd'hui \(1\)/);
    expect(titres[2]).toMatch(/^À venir \(1\)/);
    expect(titres[3]).toMatch(/^▸Passés \(2\)/);
    expect(idsLignes(tableau())).toEqual(["a1", "a2", "c1", "v1", "p1", "p2"]);
  });

  it("« Passés » est repliée par défaut : ses lignes ne sont pas dans la page, la pagination non plus ; un clic la déplie", () => {
    monter("ADMIN");
    expect(idsLignes(tableau())).toEqual(["a1", "a2", "c1", "v1"]);
    expect(conteneur.querySelector("[data-pagination]")).toBeNull();
    const entete = bouton(/Passés/, tableau())!;
    expect(entete.getAttribute("aria-expanded")).toBe("false");
    act(() => entete.click());
    expect(idsLignes(tableau())).toEqual(["a1", "a2", "c1", "v1", "p1", "p2"]);
    expect(conteneur.querySelector("[data-pagination]")).not.toBeNull();
    act(() => bouton(/Passés/, tableau())!.click());
    expect(idsLignes(tableau())).toEqual(["a1", "a2", "c1", "v1"]);
  });

  it("« Passés » ouverte d'office (filtre actif, page demandée) : les lignes sont là", () => {
    monter("ADMIN", { passesOuvertParDefaut: true });
    expect(idsLignes(tableau())).toContain("p2");
  });

  it("une section vide n'est pas affichée ; rien du tout : l'état vide", () => {
    monter("ADMIN", { sections: SECTIONS.map((s) => (s.cle === "EN_COURS" ? { ...s, lignes: [], total: 0 } : s)) });
    expect(titresSections(tableau())).toEqual(["A_TRAITER", "A_VENIR", "PASSES"]);
    act(() => racine.unmount()); conteneur.remove();
    monter("ADMIN", { sections: [], vide: "Aucune demande de congé pour ce filtre." });
    expect(conteneur.textContent).toContain("Aucune demande de congé pour ce filtre.");
    expect(conteneur.querySelector("table")).toBeNull();
  });

  it("une section tronquée à la borne le dit (« affinez le filtre »)", () => {
    monter("ADMIN", { sections: SECTIONS.map((s) => (s.cle === "A_TRAITER" ? { ...s, tronque: true } : s)) });
    expect(tableau().textContent).toContain("premières demandes seulement : affinez le filtre");
  });

  it("par mois : un groupe par mois, le compte dit « sur cette page » quand le mois continue ailleurs ; la pagination est toujours là", () => {
    const groupes: GroupeMois[] = [
      { cle: "2026-11", titre: "Novembre 2026", lignes: [A2], partiel: false },
      { cle: "2026-10", titre: "Octobre 2026", lignes: [A1, C1], partiel: true },
    ];
    monter("ADMIN", { regroupement: "mois", sections: [], groupes });
    expect(idsLignes(tableau())).toEqual(["a2", "a1", "c1"]);
    const titres = [...tableau().querySelectorAll("tbody > tr:first-child th")].map((t) => t.textContent?.replace(/\s+/g, " ").trim());
    expect(titres).toEqual(["Novembre 2026 (1)", "Octobre 2026 (2 sur cette page)"]);
    expect(conteneur.querySelector("[data-pagination]")).not.toBeNull();
  });
});

describe("une ligne par demande", () => {
  it("avatar + nom cliquable vers la fiche, type, période sur une ligne, jours, statut, signature", () => {
    monter("ADMIN");
    const lienNom = tableau().querySelector<HTMLAnchorElement>('[data-conge="c1"] a[href="/employes/emp-c1"]')!;
    expect(lienNom.textContent).toContain("Christian Lumbu");
    expect(lienNom.querySelector("span")).toBeTruthy(); // l'avatar (initiales) à côté du nom
    const cellules = [...tableau().querySelectorAll('[data-conge="c1"] td')].map((c) => c.textContent?.replace(/\s+/g, " ").trim());
    expect(cellules[2]).toBe("Congé annuel");
    expect(cellules[3]).toBe("5 oct. → 12 oct."); // l'année est omise : on est en 2026
    expect(cellules[4]).toBe("5 j");
    expect(cellules[5]).toBe("Approuvé");
    expect(cellules[6]).toContain("Signé le 08/10/2026");
    expect(tableau().querySelector('[data-conge="v1"] td:nth-child(7)')?.textContent).toContain("À signer");
  });

  it("l'année s'affiche quand les dates sortent de l'année en cours", () => {
    monter("ADMIN", { sections: [{ cle: "A_VENIR", lignes: [ligne("z", "Zoé", "APPROUVE", "2026-09-28", "2027-01-20")], total: 1, tronque: false }] });
    expect(tableau().querySelector('[data-conge="z"] td:nth-child(4)')?.textContent).toBe("28 sept. → 20 janv. 2027");
  });

  it("le pavé de statut dit qui a approuvé (infobulle)", () => {
    monter("ADMIN", { passesOuvertParDefaut: true });
    expect(tableau().querySelector('[data-conge="p1"] td:nth-child(6) span')?.getAttribute("title")).toBe("Approuvé par Sacha Tshiongo");
  });

  it("téléphone : les mêmes demandes en cartes, mêmes sections", () => {
    monter("ADMIN", { passesOuvertParDefaut: true });
    expect(titresSections(cartes())).toEqual(["A_TRAITER", "EN_COURS", "A_VENIR", "PASSES"]);
    expect(idsLignes(cartes())).toEqual(["a1", "a2", "c1", "v1", "p1", "p2"]);
    expect(cartes().querySelector('[data-conge="a1"] a[href="/employes/emp-a1"]')).toBeTruthy();
    expect(cartes().textContent).toContain("Congé annuel · 20 oct. → 24 oct. · 5 j");
    // Le tableau n'apparaît que dès 1280 px, les cartes disparaissent à partir de là.
    expect(tableau().className).toMatch(/\bhidden\b.*\bxl:block\b/);
    expect(cartes().className).toMatch(/\bxl:hidden\b/);
  });
});

describe("droits (ceux d'avant)", () => {
  // Les actions de la ligne : tout sauf la case et le lien du nom (qui mène à la fiche).
  const boutonsLigne = (id: string, zone = tableau()) => [...zone.querySelectorAll(`[data-conge="${id}"] button, [data-conge="${id}"] a:not([href^="/employes/"])`)].map((e) => e.textContent?.trim());

  it("Direction : Approuver / Refuser sur une demande en attente, PDF, Signer, ✕", () => {
    monter("ADMIN");
    expect(boutonsLigne("a1")).toEqual(expect.arrayContaining(["✓Approuver", "✕Refuser", "PDF", "Supprimer la demande de Aimée Mutita✕"]));
    expect(boutonsLigne("v1")).toEqual(expect.arrayContaining(["PDF", "Signer"]));
    expect(boutonsLigne("v1")).not.toContain("✓Approuver");
  });

  it("Responsable : peut signer et créer, mais ne décide ni ne supprime", () => {
    monter("MANAGER");
    expect(boutonsLigne("a1")).toEqual(["PDF"]);
    expect(boutonsLigne("v1")).toEqual(["PDF", "Signer"]);
    expect(conteneur.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0); // PDF en lot : toute l'équipe RH
  });

  it("lecture seule : PDF seulement (ni Signer, ni décision, ni suppression)", () => {
    monter("VIEWER");
    expect(boutonsLigne("a1")).toEqual(["PDF"]);
    expect(boutonsLigne("v1")).toEqual(["PDF"]);
  });

  it("une demande déjà signée n'a plus de bouton Signer (l'icône dit « signé »)", () => {
    monter("ADMIN");
    expect(boutonsLigne("c1")).not.toContain("Signer");
  });
});

describe("actions groupées", () => {
  it("cocher une ligne fait apparaître la barre ; 1 en attente cochée : Approuver (1) Refuser (1) PDF (1) Supprimer (1)", () => {
    monter("ADMIN");
    expect(conteneur.textContent).toContain("0 sélectionné(s)");
    expect(bouton(/Approuver \(/)).toBeUndefined();
    act(() => caseDe("a1").click());
    expect(conteneur.textContent).toContain("1 sélectionné(s)");
    expect(bouton(/Approuver \(1\)/)).toBeTruthy();
    expect(bouton(/Refuser \(1\)/)).toBeTruthy();
    expect(bouton(/Supprimer \(1\)/)).toBeTruthy();
    expect([...conteneur.querySelectorAll("a")].some((a) => a.textContent === "PDF (1)")).toBe(true);
  });

  it("Approuver / Refuser ne portent QUE sur les demandes en attente cochées (une approuvée cochée n'est pas envoyée)", async () => {
    monter("ADMIN");
    act(() => { caseDe("a1").click(); caseDe("a2").click(); caseDe("c1").click(); });
    expect(bouton(/Approuver \(2\)/)).toBeTruthy();
    await act(async () => { bouton(/Approuver \(2\)/)!.click(); });
    expect(M.approuverCongesEnLot).toHaveBeenCalledWith(["a1", "a2"]);
    expect(conteneur.querySelector('[role="status"]')?.textContent).toBe("2 demande(s) approuvée(s).");
    expect(conteneur.textContent).toContain("0 sélectionné(s)"); // la sélection est vidée
  });

  it("Refuser en lot : demande confirmation, puis appelle l'action de lot existante", async () => {
    monter("ADMIN");
    act(() => caseDe("a2").click());
    await act(async () => { bouton(/Refuser \(1\)/)!.click(); });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Refuser 1 demande(s)"));
    expect(M.refuserCongesEnLot).toHaveBeenCalledWith(["a2"]);
  });

  it("une confirmation refusée n'écrit rien", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    monter("ADMIN");
    act(() => caseDe("a1").click());
    await act(async () => { bouton(/Approuver \(1\)/)!.click(); });
    expect(M.approuverCongesEnLot).not.toHaveBeenCalled();
  });

  it("Supprimer en lot (Direction) : toutes les cochées, confirmation d'abord", async () => {
    monter("ADMIN");
    act(() => { caseDe("a1").click(); caseDe("v1").click(); });
    await act(async () => { bouton(/Supprimer \(2\)/)!.click(); });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Supprimer 2 demande(s)"));
    expect(M.supprimerCongesEnLot).toHaveBeenCalledWith(["a1", "v1"]);
  });

  it("un échec partiel est NOMMÉ dans le rapport", async () => {
    M.approuverCongesEnLot.mockResolvedValueOnce({ traitees: 1, echecs: ["Bijou Mputu : base indisponible"] });
    monter("ADMIN");
    act(() => { caseDe("a1").click(); caseDe("a2").click(); });
    await act(async () => { bouton(/Approuver \(2\)/)!.click(); });
    expect(conteneur.querySelector('[role="status"]')?.textContent).toBe("1 demande(s) approuvée(s), 1 échec(s) — Bijou Mputu : base indisponible");
  });

  it("PDF en lot : le lien porte les ids cochés, ZIP ; au-delà de 50, un message au lieu du lien", () => {
    monter("ADMIN");
    act(() => { caseDe("c1").click(); caseDe("v1").click(); });
    const lien = [...conteneur.querySelectorAll("a")].find((a) => a.textContent === "PDF (2)")!;
    expect(lien.getAttribute("href")).toBe("/conges/pdf-lot?ids=c1,v1");
    act(() => racine.unmount()); conteneur.remove();
    const beaucoup = Array.from({ length: 51 }, (_, i) => ligne(`m${i}`, `Salarié ${i}`, "APPROUVE", "2026-12-01", "2026-12-02"));
    monter("ADMIN", { sections: [{ cle: "A_VENIR", lignes: beaucoup, total: 51, tronque: false }] });
    act(() => { conteneur.querySelector<HTMLInputElement>('[data-vue="tableau"] thead + tbody tr:first-child input[type="checkbox"]')!.click(); }); // la section entière
    expect(conteneur.textContent).toContain("PDF : 50 demandes au plus par lot (51 cochées)");
  });

  it("Responsable : PDF en lot oui ; ni Approuver / Refuser ni Supprimer", () => {
    monter("MANAGER");
    act(() => caseDe("a1").click());
    expect([...conteneur.querySelectorAll("a")].some((a) => a.textContent === "PDF (1)")).toBe(true);
    expect(bouton(/Approuver \(/)).toBeUndefined();
    expect(bouton(/Refuser \(/)).toBeUndefined();
    expect(bouton(/Supprimer \(/)).toBeUndefined();
  });

  it("la case d'une section coche toute la section ; « Tout sélectionner » coche ce qui est à l'écran (pas les Passés repliés)", () => {
    monter("ADMIN");
    act(() => conteneur.querySelector<HTMLInputElement>('[aria-label="Sélectionner toute la section À traiter"]')!.click());
    expect(caseDe("a1").checked && caseDe("a2").checked).toBe(true);
    expect(caseDe("c1").checked).toBe(false);
    act(() => conteneur.querySelector<HTMLInputElement>('[data-vue="tableau"]')!.ownerDocument.querySelector<HTMLInputElement>("label input[type=checkbox]")!.click());
    expect(conteneur.textContent).toContain("4 sélectionné(s)"); // a1, a2, c1, v1 — p1 et p2 sont repliées
  });

  it("replier « Passés » désélectionne ce qui disparaît de l'écran (on n'agit jamais sur ce qu'on ne voit pas)", () => {
    monter("ADMIN", { passesOuvertParDefaut: true });
    act(() => caseDe("p1").click());
    expect(conteneur.textContent).toContain("1 sélectionné(s)");
    act(() => bouton(/Passés/, tableau())!.click());
    expect(conteneur.textContent).toContain("0 sélectionné(s)");
  });

  it("la sélection se coche aussi depuis les cartes (même état que le tableau)", () => {
    monter("ADMIN");
    act(() => caseDe("a1", cartes()).click());
    expect(caseDe("a1", tableau()).checked).toBe(true);
    expect(conteneur.textContent).toContain("1 sélectionné(s)");
  });
});
