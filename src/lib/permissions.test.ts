import { describe, it, expect } from "vitest";
import {
  DEFINITIONS_PERMISSIONS,
  PERMISSIONS_RH,
  PERMISSIONS_STOCK,
  aPermission,
  lireSurcharges,
  permissionsRefusees,
  surchargesDepuisCases,
} from "./permissions";
import { entreesVisibles, choisirBarreDuBas } from "./navigation-espaces";
import { NAV_GROUPS as NAV_RH, BARRE_DU_BAS as BARRE_RH } from "@/app/(app)/navigation";
import { NAV_GROUPS as NAV_STOCK } from "@/app/(stock)/navigation";

describe("registre des permissions", () => {
  it("une dizaine par espace au plus, clés uniques et préfixées par leur espace", () => {
    expect(PERMISSIONS_RH.length).toBeLessThanOrEqual(10);
    expect(PERMISSIONS_STOCK.length).toBeLessThanOrEqual(10);
    const cles = DEFINITIONS_PERMISSIONS.map((d) => d.cle);
    expect(new Set(cles).size).toBe(cles.length);
    for (const d of DEFINITIONS_PERMISSIONS) expect(d.cle.startsWith(`${d.espace}.`)).toBe(true);
  });
  it("Valider un bon et Enregistrer une facture sont fermés par défaut au rôle Stock (comportement actuel : Direction seule)", () => {
    expect(aPermission({ role: "STOCK" }, "stock.bon_valider")).toBe(false);
    expect(aPermission({ role: "STOCK" }, "stock.facture")).toBe(false);
  });
});

describe("défauts = comportement actuel du rôle", () => {
  it("un compte sans réglage garde tout ce que son rôle avait", () => {
    for (const d of PERMISSIONS_RH) expect(aPermission({ role: "MANAGER" }, d.cle as never), d.cle).toBe(d.defaut);
    for (const d of PERMISSIONS_STOCK) expect(aPermission({ role: "STOCK" }, d.cle as never), d.cle).toBe(d.defaut);
    expect(permissionsRefusees({ role: "MANAGER" })).toEqual(
      DEFINITIONS_PERMISSIONS.filter((d) => d.espace === "stock").map((d) => d.cle), // hors de son espace
    );
    expect(permissionsRefusees({ role: "STOCK", permissions: null }).filter((c) => c.startsWith("rh."))).toHaveLength(PERMISSIONS_RH.length);
  });
  it("la Direction a toujours tout, quoi qu'on stocke", () => {
    const tout = Object.fromEntries(DEFINITIONS_PERMISSIONS.map((d) => [d.cle, false]));
    for (const d of DEFINITIONS_PERMISSIONS) expect(aPermission({ role: "ADMIN", permissions: tout }, d.cle)).toBe(true);
  });
  it("la Consultation lit comme avant dans l'espace RH et n'entre pas au Stock", () => {
    expect(aPermission({ role: "VIEWER", permissions: { "rh.paie": false } }, "rh.paie")).toBe(true);
    expect(aPermission({ role: "VIEWER" }, "stock.mouvement")).toBe(false);
  });
  it("un salarié sans accès Stock n'a aucune permission Stock ; avec l'accès, il suit le rôle Stock", () => {
    expect(aPermission({ role: "EMPLOYE", accesStock: false }, "stock.mouvement")).toBe(false);
    expect(aPermission({ role: "EMPLOYE", accesStock: true }, "stock.mouvement")).toBe(true);
    expect(aPermission({ role: "EMPLOYE", accesStock: true }, "stock.bon_valider")).toBe(false);
  });
});

describe("écarts par personne", () => {
  it("retirer une permission par défaut, en accorder une qui ne l'est pas", () => {
    const u = { role: "STOCK" as const, permissions: { "stock.mouvement": false, "stock.bon_valider": true } as const };
    expect(aPermission(u, "stock.mouvement")).toBe(false);
    expect(aPermission(u, "stock.bon_valider")).toBe(true);
    expect(aPermission(u, "stock.catalogue")).toBe(true);
  });
  it("une permission d'un autre espace n'est jamais accordée par un écart stocké", () => {
    expect(aPermission({ role: "STOCK", permissions: { "rh.paie": true } }, "rh.paie")).toBe(false);
    expect(aPermission({ role: "MANAGER", permissions: { "stock.facture": true } }, "stock.facture")).toBe(false);
  });
  it("lireSurcharges ignore clés inconnues, valeurs non booléennes et formes invalides", () => {
    expect(lireSurcharges({ "rh.paie": false, "rh.inconnue": true, "stock.facture": "oui" })).toEqual({ "rh.paie": false });
    expect(lireSurcharges(null)).toEqual({});
    expect(lireSurcharges([true])).toEqual({});
    expect(lireSurcharges("x")).toEqual({});
  });
  it("surchargesDepuisCases ne stocke que ce qui diffère du défaut, et null quand tout est par défaut", () => {
    const defauts = Object.fromEntries(PERMISSIONS_STOCK.map((d) => [d.cle, d.defaut]));
    expect(surchargesDepuisCases("stock", defauts)).toBeNull();
    expect(surchargesDepuisCases("stock", { ...defauts, "stock.facture": true, "stock.exports": false })).toEqual({ "stock.facture": true, "stock.exports": false });
  });
  it("surchargesDepuisCases conserve les écarts de l'autre espace", () => {
    expect(surchargesDepuisCases("stock", { "stock.facture": true }, { "rh.paie": false })).toEqual({ "rh.paie": false, "stock.facture": true });
  });
});

describe("menus", () => {
  it("la permission retirée masque l'entrée de menu, et seulement elle", () => {
    const items = NAV_RH.flatMap((g) => g.items);
    const vus = entreesVisibles(items, "MANAGER", ["rh.paie"]).map((i) => i.href);
    expect(vus).not.toContain("/paie");
    expect(vus).toContain("/employes");
    expect(entreesVisibles(items, "MANAGER").map((i) => i.href)).toContain("/paie");
  });
  it("Stock : sans « Restaurant », les trois entrées du restaurant disparaissent", () => {
    const items = NAV_STOCK.flatMap((g) => g.items);
    const vus = entreesVisibles(items, "STOCK", ["stock.restaurant"]).map((i) => i.href);
    for (const h of ["/stock/journalier", "/stock/restaurant", "/stock/fiches"]) expect(vus).not.toContain(h);
    expect(vus).toContain("/stock/catalogue");
  });
  it("la barre du bas suit : le bouton Présences disparaît sans la permission, les autres restent dans l'ordre", () => {
    const avec = choisirBarreDuBas(NAV_RH, BARRE_RH, "MANAGER").map((e) => e.href);
    const sans = choisirBarreDuBas(NAV_RH, BARRE_RH, "MANAGER", {}, ["rh.presences"]).map((e) => e.href);
    expect(avec).toContain("/presences");
    expect(sans).not.toContain("/presences");
    expect(sans).toEqual(avec.filter((h) => h !== "/presences"));
  });
  it("toute entrée de menu qui porte une permission en cite une qui existe", () => {
    const cles = new Set<string>(DEFINITIONS_PERMISSIONS.map((d) => d.cle));
    for (const it of [...NAV_RH, ...NAV_STOCK].flatMap((g) => g.items)) if (it.permission) expect(cles.has(it.permission), it.href).toBe(true);
  });
});
