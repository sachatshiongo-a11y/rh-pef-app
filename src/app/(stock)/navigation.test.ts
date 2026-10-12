import { describe, it, expect } from "vitest";
import { BARRE_DU_BAS, NAV_GROUPS, lienActif } from "./navigation";
import { choisirBarreDuBas } from "@/lib/navigation-espaces";

// Le menu de l'espace Stock, tel que le plan d'ergonomie du 2026-10-12 le fixe (§3.2, V2, V3) : l'ORDRE des groupes et
// des entrées est figé ici. Un déplacement se décide, il ne se fait pas par accident.
describe("menu Stock — groupes et ordre (plan d'ergonomie §3.2)", () => {
  it("six groupes, dans l'ordre : Pilotage, Dépôt, Restaurant, Fournisseurs & factures, Archives, Configuration", () => {
    expect(NAV_GROUPS.map((g) => g.titre)).toEqual(["Pilotage", "Dépôt", "Restaurant", "Fournisseurs & factures", "Archives", "Configuration"]);
  });

  it("chaque groupe porte ses entrées dans l'ordre voulu (libellé → adresse)", () => {
    expect(NAV_GROUPS.map((g) => g.items.map((i) => `${i.label} → ${i.href}`))).toEqual([
      ["Accueil → /stock", "À valider → /stock/a-valider"],
      ["Inventaire → /stock/catalogue", "Achats & mouvements → /stock/mouvements", "Réconciliation → /stock/reconciliation"],
      ["Conso. journalière → /stock/journalier", "Stock restaurant → /stock/restaurant", "Fiches techniques → /stock/fiches"],
      ["Bons de commande → /stock/commandes", "Factures → /stock/factures", "Fournisseurs → /stock/fournisseurs"],
      ["Archives → /stock/archives?vue=rapports"],
      ["Imports → /stock/imports", "Paramètres → /parametres"],
    ]);
  });

  it("« À valider » est la 2e ligne du menu et visible par tous les rôles ; seule la Configuration est réservée à la Direction", () => {
    const toutes = NAV_GROUPS.flatMap((g) => g.items);
    expect(toutes[1].href).toBe("/stock/a-valider");
    expect(toutes.filter((i) => i.adminOnly).map((i) => i.label)).toEqual(["Imports", "Paramètres"]);
  });

  it("« Utilisateurs » n'est plus au menu (c'est la rubrique de Paramètres) et chaque adresse n'apparaît qu'une fois", () => {
    const toutes = NAV_GROUPS.flatMap((g) => g.items);
    expect(toutes.map((i) => i.label)).not.toContain("Utilisateurs");
    expect(toutes.some((i) => i.href.startsWith("/stock/utilisateurs"))).toBe(false);
    const adresses = toutes.map((i) => i.href);
    expect(new Set(adresses).size).toBe(adresses.length);
  });
});

describe("barre du bas Stock — « Mouvements » (plan d'ergonomie, V2/V10)", () => {
  it("la Direction : Accueil · Inventaire · Mouvements · À valider (à la place de Conso.)", () => {
    expect(choisirBarreDuBas(NAV_GROUPS, BARRE_DU_BAS, "ADMIN").map((e) => e.court)).toEqual(["Accueil", "Inventaire", "Mouvements", "À valider"]);
  });

  it("le compte Stock garde la Conso. en 4e position, et le bouton « Achats » n'existe plus", () => {
    const stock = choisirBarreDuBas(NAV_GROUPS, BARRE_DU_BAS, "STOCK");
    expect(stock.map((e) => e.court)).toEqual(["Accueil", "Inventaire", "Mouvements", "Conso."]);
    expect(BARRE_DU_BAS.map((c) => c.court)).not.toContain("Achats");
  });

  it("« Mouvements » ouvre toujours /stock/mouvements", () => {
    expect(choisirBarreDuBas(NAV_GROUPS, BARRE_DU_BAS, "STOCK")[2].href).toBe("/stock/mouvements");
  });
});

describe("état actif du menu Stock", () => {
  it("Archives s'allume sur sa propre page (l'adresse du menu porte une vue)", () => {
    expect(lienActif("/stock/archives?vue=rapports", "/stock/archives")).toBe(true);
    expect(lienActif("/stock/archives?vue=rapports", "/stock/commandes")).toBe(false);
  });

  it("la fiche d'un comptage (/stock/archives/<id>) allume Réconciliation, plus Archives", () => {
    expect(lienActif("/stock/reconciliation", "/stock/archives/abc")).toBe(true);
    expect(lienActif("/stock/archives?vue=rapports", "/stock/archives/abc")).toBe(false);
  });

  it("l'Accueil ne s'allume que sur /stock ; Achats & mouvements sur ses trois sous-onglets", () => {
    expect(lienActif("/stock", "/stock")).toBe(true);
    expect(lienActif("/stock", "/stock/factures")).toBe(false);
    for (const p of ["/stock/mouvements", "/stock/entree", "/stock/legumes"]) expect(lienActif("/stock/mouvements", p)).toBe(true);
  });
});
