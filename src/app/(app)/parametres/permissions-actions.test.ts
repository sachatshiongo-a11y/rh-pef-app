import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  session: { id: "admin-1", role: "ADMIN" } as { id: string; role: string },
  cible: null as null | { id: string; nom: string; role: string; accesStock: boolean; permissions: unknown },
  ecritures: [] as unknown[],
  journal: [] as { champ: string; ancienneValeur?: unknown; nouvelleValeur?: unknown; userId: string }[],
  invalides: [] as string[],
}));

vi.mock("@/lib/auth", () => ({
  verifySession: async () => H.session,
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé."); },
  invaliderProfil: (id: string) => { H.invalides.push(id); },
}));
vi.mock("@/lib/prisma", () => {
  const tx = { user: { update: async (a: unknown) => { H.ecritures.push(a); } } };
  return { prisma: { user: { findUnique: async () => H.cible }, $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) } };
});
vi.mock("@/lib/audit", () => ({ journaliserPlusieurs: async (_c: unknown, e: typeof H.journal) => { H.journal.push(...e); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { Prisma } from "@prisma/client";
import { definirPermissionsUtilisateur } from "./permissions-actions";

const stock = (permissions: unknown = null) => ({ id: "s1", nom: "Magasinier", role: "STOCK", accesStock: false, permissions });
const rh = (permissions: unknown = null) => ({ id: "r1", nom: "Responsable", role: "MANAGER", accesStock: false, permissions });

beforeEach(() => {
  H.session = { id: "admin-1", role: "ADMIN" };
  H.cible = stock();
  H.ecritures.length = 0;
  H.journal.length = 0;
  H.invalides.length = 0;
});

describe("definirPermissionsUtilisateur", () => {
  it("n'est ouvert qu'à la Direction : un compte RH ne règle les droits de personne, et rien n'est écrit", async () => {
    H.session = { id: "m1", role: "MANAGER" };
    const r = await definirPermissionsUtilisateur("s1", { "stock.bon_valider": true });
    expect(r).toMatchObject({ erreur: expect.stringContaining("Accès refusé") });
    expect(H.ecritures).toEqual([]);
  });

  it("accorde « valider un bon » : n'enregistre que l'écart, journalise, invalide le profil en cache", async () => {
    await definirPermissionsUtilisateur("s1", { "stock.bon_valider": true, "stock.mouvement": true });
    expect(H.ecritures).toEqual([{ where: { id: "s1" }, data: { permissions: { "stock.bon_valider": true } } }]);
    expect(H.journal).toEqual([{ entite: "User", entiteId: "s1", champ: "permission:stock.bon_valider", ancienneValeur: "retirée", nouvelleValeur: "accordée", userId: "admin-1" }]);
    expect(H.invalides).toEqual(["s1"]);
  });

  it("retirer une permission puis la remettre au défaut revient à NULL (comportement du rôle)", async () => {
    await definirPermissionsUtilisateur("s1", { "stock.catalogue": false });
    expect(H.ecritures[0]).toMatchObject({ data: { permissions: { "stock.catalogue": false } } });
    H.cible = stock({ "stock.catalogue": false });
    H.ecritures.length = 0;
    await definirPermissionsUtilisateur("s1", { "stock.catalogue": true });
    expect(H.ecritures).toEqual([{ where: { id: "s1" }, data: { permissions: Prisma.DbNull } }]);
    expect(H.journal.at(-1)).toMatchObject({ champ: "permission:stock.catalogue", ancienneValeur: "retirée", nouvelleValeur: "accordée" });
  });

  it("une case non envoyée ne change pas l'état actuel", async () => {
    H.cible = stock({ "stock.exports": false });
    await definirPermissionsUtilisateur("s1", { "stock.bon_valider": true });
    expect(H.ecritures[0]).toMatchObject({ data: { permissions: { "stock.exports": false, "stock.bon_valider": true } } });
  });

  it("aucun changement : aucune écriture, aucune ligne de journal", async () => {
    await definirPermissionsUtilisateur("s1", { "stock.mouvement": true, "stock.bon_valider": false });
    expect(H.ecritures).toEqual([]);
    expect(H.journal).toEqual([]);
  });

  it("refuse les permissions d'un autre espace, les clés inconnues et les valeurs non booléennes", async () => {
    expect(await definirPermissionsUtilisateur("s1", { "rh.paie": false })).toMatchObject({ erreur: expect.stringContaining("ne concerne pas") });
    expect(await definirPermissionsUtilisateur("s1", { "stock.inventee": true })).toMatchObject({ erreur: expect.stringContaining("inconnue") });
    expect(await definirPermissionsUtilisateur("s1", { "stock.bon_valider": "oui" as unknown as boolean })).toMatchObject({ erreur: expect.stringContaining("invalide") });
    expect(H.ecritures).toEqual([]);
  });

  it("refuse la Direction, un compte Consultation et un compte introuvable", async () => {
    H.cible = { id: "a2", nom: "Autre", role: "ADMIN", accesStock: false, permissions: null };
    expect(await definirPermissionsUtilisateur("a2", { "rh.paie": false })).toMatchObject({ erreur: expect.stringContaining("Direction") });
    H.cible = { id: "v1", nom: "Lecteur", role: "VIEWER", accesStock: false, permissions: null };
    expect(await definirPermissionsUtilisateur("v1", { "rh.paie": false })).toMatchObject({ erreur: expect.stringContaining("compte RH ou Stock") });
    H.cible = null;
    expect(await definirPermissionsUtilisateur("zz", {})).toMatchObject({ erreur: expect.stringContaining("introuvable") });
    expect(H.ecritures).toEqual([]);
  });

  it("compte RH : retirer « Paie » est enregistré et journalisé", async () => {
    H.cible = rh();
    await definirPermissionsUtilisateur("r1", { "rh.paie": false });
    expect(H.ecritures).toEqual([{ where: { id: "r1" }, data: { permissions: { "rh.paie": false } } }]);
    expect(H.journal).toMatchObject([{ champ: "permission:rh.paie", ancienneValeur: "accordée", nouvelleValeur: "retirée" }]);
  });
});
