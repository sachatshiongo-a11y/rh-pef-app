// @vitest-environment happy-dom
//
// Fiches de comptage VIERGES (2026-10-09) : le bloc de tête de la Réconciliation, et la route Excel qu'il appelle.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

const garde = vi.hoisted(() => ({ exigerEspaceStock: vi.fn() }));
const bdd = vi.hoisted(() => ({ findMany: vi.fn(async (a: unknown) => { void a; return []; }) }));
const excel = vi.hoisted(() => ({ classeurExcel: vi.fn(async (a: unknown) => { void a; return Buffer.from("xlsx"); }) }));
vi.mock("@/lib/garde-route", () => garde);
vi.mock("@/lib/prisma", () => ({ prisma: { articleStock: { findMany: bdd.findMany } } }));
vi.mock("@/lib/export-excel", () => excel);

import { FichesVierges, FICHES_VIERGES, ficheHref } from "./fiches-vierges";
import { GET } from "./fiche/excel/route";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => { conteneur = document.createElement("div"); document.body.appendChild(conteneur); racine = createRoot(conteneur); vi.clearAllMocks(); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

describe("Bloc des fiches vierges", () => {
  it("un titre clair et une carte par domaine : nom, nombre d'articles, téléchargement Excel", () => {
    act(() => racine.render(createElement(FichesVierges, { nombres: { NOURRITURE: 212, BOISSON: 1, AUTRE: 0 } })));
    expect(conteneur.querySelector("h2")!.textContent).toBe("Imprimer une fiche de comptage vierge");
    const cartes = [...conteneur.querySelectorAll("li")];
    expect(cartes.map((c) => c.querySelector("p")!.textContent)).toEqual(["Fiche Nourriture", "Fiche Boissons", "Fiche Autre"]);
    expect(cartes.map((c) => c.querySelectorAll("p")[1].textContent)).toEqual(["212 articles", "1 article", "0 article"]);
    expect(cartes.map((c) => c.querySelector("a")!.getAttribute("href"))).toEqual([
      "/stock/reconciliation/fiche/excel?domaine=NOURRITURE",
      "/stock/reconciliation/fiche/excel?domaine=BOISSON",
      "/stock/reconciliation/fiche/excel?domaine=AUTRE",
    ]);
  });

  it("chaque lien passe par TelechargerLien : un clic ne navigue pas (fetch), le lien reste lisible pour les lecteurs d'écran", async () => {
    act(() => racine.render(createElement(FichesVierges, { nombres: { NOURRITURE: 1, BOISSON: 1, AUTRE: 1 } })));
    const lien = conteneur.querySelector("a")!;
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 403, headers: { "Content-Type": "text/plain" } })));
    vi.stubGlobal("alert", vi.fn());
    await act(async () => { lien.dispatchEvent(clic); });
    expect(clic.defaultPrevented).toBe(true);
    expect(lien.textContent).toContain("fiche vierge Nourriture"); // texte pour lecteur d'écran
    vi.unstubAllGlobals();
  });

  it("les adresses du bloc sont des routes qui existent", () => {
    for (const f of FICHES_VIERGES) {
      const href = ficheHref(f.domaine);
      expect(fs.existsSync(path.resolve(__dirname, `.${new URL(href, "http://x").pathname.replace("/stock/reconciliation", "")}/route.ts`))).toBe(true);
    }
  });
});

describe("Route de la fiche vierge", () => {
  it("refus de la garde : 403, la base n'est pas lue", async () => {
    garde.exigerEspaceStock.mockResolvedValue({ ok: false, reponse: new Response("Accès refusé.", { status: 403 }) });
    const r = await GET(new Request("http://x/stock/reconciliation/fiche/excel?domaine=BOISSON"));
    expect(r.status).toBe(403);
    expect(bdd.findMany).not.toHaveBeenCalled();
  });

  it("accès Stock : classeur Excel du seul domaine demandé, articles actifs, nom de fichier daté", async () => {
    garde.exigerEspaceStock.mockResolvedValue({ ok: true, user: { id: "u" } });
    bdd.findMany.mockResolvedValueOnce(([
      { domaine: "BOISSON", designation: "Primus", unite: "casier", categorie: { nom: "Bières" }, fournisseur: null, stock: { quantite: 20 } },
    ]) as never);
    const r = await GET(new Request("http://x/stock/reconciliation/fiche/excel?domaine=BOISSON"));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(r.headers.get("Content-Disposition")).toMatch(/^attachment; filename="Fiche_comptage_Boisson.*_\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect((bdd.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({ actif: true, domaine: "BOISSON" });
    const feuille = (excel.classeurExcel.mock.calls[0][0] as { feuilles: { entete: string[]; lignes: unknown[][] }[] }).feuilles[0];
    expect(feuille.entete).toEqual(["Désignation", "Fournisseur", "Unité", "Théorique", "Physique", "Écart"]);
    expect(feuille.lignes).toEqual([["Bières", "", "", "", "", ""], ["Primus", "", "casier", 20, "", ""]]);
  });
});
