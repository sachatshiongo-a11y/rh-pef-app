// @vitest-environment happy-dom
//
// Saisie d'une facture — garde-fous de l'audit du 10/10/2026 :
//  - « Créer quand même » quand la facture ressemble à une déjà saisie (constat 6) ; le même numéro est un
//    refus sec (message, aucun bouton) ;
//  - fournisseur proche : « Utiliser … » / « Créer », jamais rattaché d'office (constat 7) ;
//  - lecture d'un PDF : libellé lu conservé, article proposé « à choisir », jamais appliqué sans clic (constat 8).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const envois = vi.hoisted(() => ({
  facture: vi.fn(async (_fd: FormData): Promise<unknown> => ({ erreur: "refus de test" })),
  pdf: vi.fn(async (_fd: FormData): Promise<unknown> => ({})),
}));
vi.mock("../actions", () => ({ creerFactureAvecLignes: envois.facture, analyserFacturePDF: envois.pdf }));

import { NouvelleFactureForm } from "./nouveau-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const FOURNISSEURS = [{ id: "f1", nom: "Marché central", delaiJours: 30 }];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
beforeEach(() => { envois.facture.mockReset(); envois.pdf.mockReset(); });

function monter() {
  conteneur = document.createElement("div"); document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(NouvelleFactureForm, { articles: [{ id: "a1", designation: "Lait de coco", prix: null, unite: "L" }], fournisseurs: FOURNISSEURS, bons: [], bcInitial: null })));
  act(() => {
    const nom = conteneur.querySelector<HTMLInputElement>('input[name="fournisseurNom"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nom, "Marché");
    nom.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const cliquer = async (b: HTMLElement) => { await act(async () => b.click()); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const bouton = (t: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(t))!;

describe("facture déjà saisie", () => {
  it("avertissement avec lien vers la facture existante ; « Créer quand même » renvoie avec forcerFacture", async () => {
    envois.facture.mockResolvedValueOnce({ erreur: `DOUBLON_FACTURE|${JSON.stringify({ message: "Une facture du même fournisseur, du même montant (100,00 $) existe déjà.", factures: [{ id: "x1", numero: "FA-1", date: "2026-09-10" }] })}` });
    monter();
    await cliquer(bouton("Enregistrer la facture"));
    expect(envois.facture.mock.calls[0][0].get("forcerFacture")).toBeNull();
    const boite = conteneur.querySelector("[data-doublon-facture]")!;
    expect(boite.textContent).toContain("Facture peut-être déjà saisie");
    expect(boite.textContent).toContain("Facture n° FA-1 du 10/09/2026");
    expect(boite.querySelector("a")).toBeNull(); // pas de lien vers une page interne en nouvel onglet (application installée) : on perdrait aussi la saisie
    expect(bouton("Créer quand même").getAttribute("type")).toBe("button"); // jamais le bouton d'envoi par défaut
    envois.facture.mockClear();
    await cliquer(bouton("Créer quand même"));
    expect(envois.facture.mock.calls[0][0].get("forcerFacture")).toBe("1");
    expect(envois.facture.mock.calls[0][0].get("fournisseurNom")).toBe("Marché");
  });

  it("même numéro : message d'erreur simple, aucun bouton « Créer quand même »", async () => {
    envois.facture.mockResolvedValueOnce({ erreur: "Ce fournisseur a déjà une facture n° FA-1 (100,00 $, 10/09/2026) : un numéro de facture est unique chez un fournisseur. Rien n'a été enregistré." });
    monter();
    await cliquer(bouton("Enregistrer la facture"));
    expect(conteneur.textContent).toContain("déjà une facture n° FA-1");
    expect(conteneur.querySelector("[data-doublon-facture]")).toBeNull();
    expect([...conteneur.querySelectorAll("button")].some((b) => b.textContent?.includes("Créer quand même"))).toBe(false);
  });

  it("le garde-fou franchi reste franchi : « Créer quand même » puis le doublon d'achat garde forcerFacture", async () => {
    envois.facture
      .mockResolvedValueOnce({ erreur: `DOUBLON_FACTURE|${JSON.stringify({ message: "ressemble", factures: [] })}` })
      .mockResolvedValueOnce({ erreur: "DOUBLON_POSSIBLE|Farine déjà entrée." });
    monter();
    await cliquer(bouton("Enregistrer la facture"));
    await cliquer(bouton("Créer quand même"));
    envois.facture.mockClear();
    await cliquer(bouton("Enregistrer quand même"));
    const fd = envois.facture.mock.calls[0][0];
    expect([fd.get("forcerDoublons"), fd.get("forcerFacture")]).toEqual(["1", "1"]);
  });
});

describe("fournisseur proche", () => {
  const PROCHES = `FOURNISSEUR_PROCHE|${JSON.stringify({ candidats: [{ id: "f9", nom: "Maison Kathy" }], creationPossible: true })}`;
  it("propose « Utiliser » et « Créer » ; « Utiliser » renvoie l'identifiant et le nom choisis", async () => {
    envois.facture.mockResolvedValueOnce({ erreur: PROCHES });
    monter();
    await cliquer(bouton("Enregistrer la facture"));
    expect(conteneur.querySelector("[data-choix-fournisseur]")).not.toBeNull();
    envois.facture.mockClear();
    await cliquer(bouton("Utiliser « Maison Kathy »"));
    const fd = envois.facture.mock.calls[0][0];
    expect([fd.get("fournisseurId"), fd.get("fournisseurNom")]).toEqual(["f9", "Maison Kathy"]);
  });
  it("« Créer » renvoie fournisseurNouveau", async () => {
    envois.facture.mockResolvedValueOnce({ erreur: PROCHES });
    monter();
    await cliquer(bouton("Enregistrer la facture"));
    envois.facture.mockClear();
    await cliquer(bouton("Créer « Marché »"));
    expect(envois.facture.mock.calls[0][0].get("fournisseurNouveau")).toBe("1");
  });
});

describe("lecture d'un PDF", () => {
  it("ligne sans nom identique : libellé lu conservé, article « à choisir » proposé, rattaché seulement au clic", async () => {
    envois.pdf.mockResolvedValueOnce({
      montant: 12, date: "2026-10-01", numero: "L-1", devise: "USD", fournisseur: { nom: "Marché", rccm: null, idNational: null, telephone: null, email: null, adresse: null, ville: null }, match: null, proches: [],
      lignes: [{ designation: "Lait entier 1L", quantite: 2, prixUnitaireUSD: 6, total: 12, articleId: null, articleNom: null, unite: null, suggestion: { id: "a1", libelle: "Lait de coco", unite: "L" } }],
    });
    monter();
    const entree = conteneur.querySelector<HTMLInputElement>('input[name="facturePdf"]')!;
    Object.defineProperty(entree, "files", { value: [new File(["x"], "f.pdf", { type: "application/pdf" })], configurable: true });
    await cliquer(bouton("Lire le PDF"));
    expect(conteneur.querySelector<HTMLInputElement>('input[name="ligne_designation"]')!.value).toBe("Lait entier 1L");
    expect(conteneur.querySelector<HTMLInputElement>('input[name="ligne_articleId"]')!.value).toBe(""); // pas rattaché d'office
    const aChoisir = conteneur.querySelector("[data-ligne-a-choisir]")!;
    expect(aChoisir.textContent).toContain("à choisir");
    expect(aChoisir.textContent).toContain("Lait de coco");
    await cliquer(bouton("Utiliser"));
    expect(conteneur.querySelector<HTMLInputElement>('input[name="ligne_articleId"]')!.value).toBe("a1");
    expect(conteneur.querySelector<HTMLInputElement>('input[name="ligne_designation"]')!.value).toBe("Lait entier 1L"); // libellé du PDF conservé
  });
});
