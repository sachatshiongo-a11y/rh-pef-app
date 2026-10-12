import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Bons de commande EN FRANCS à l'écran (2026-10-16, « bons de commande en francs congolais aussi ») : création et
// modification dans la devise choisie, sans AUCUN aller-retour par le dollar — les contraintes CHECK de devise de la
// migration 20261012090000 sont posées sur la base de test (elle est construite par `db push`, qui les ignore).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", accesStock: false } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock;307;" }); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const B = await import("./actions");
const { renderPdfBuffer } = await import("@/lib/pdf/fonts");
const { BonCommandeDocument } = await import("@/lib/pdf/bon-commande");
const { pagesDuPdf } = await import("@/lib/test/pdf-lecture");
const { libelleTotalBon, deviseBon, totalBon, prixLigneBon } = await import("@/lib/bon-commande-devise");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let pg: Client;
let four: string, art: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  pg = new Client({ connectionString: db.url });
  await pg.connect();
  // Les CHECK de devise (BonDeCommande_devise_check, LigneBonDeCommande_devise_check) : ceux de la vraie migration.
  await pg.query(fs.readFileSync(path.join(__dirname, "../../../../../prisma/migrations/20261012090000_bons_commande_devise_receptions/migration.sql"), "utf8"));
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  four = (await prisma.fournisseur.create({ data: { nom: "ETS SENEVE" } })).id;
  art = (await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg" } })).id;
}, 180_000);
afterAll(async () => { await pg?.end(); await fermer?.(); });

const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);
const form = (devise: "USD" | "CDF" | null, lignes: { articleId?: string; designation: string; quantite: string; prix: string }[], extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("fournisseurId", four);
  if (devise) f.set("devise", devise);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  for (const l of lignes) { f.append("ligne_articleId", l.articleId ?? ""); f.append("ligne_designation", l.designation); f.append("ligne_quantite", l.quantite); f.append("ligne_prix", l.prix); f.append("ligne_uniteParCarton", ""); }
  return f;
};
const creer = (f: FormData) => expect(B.creerBonCommande(f)).rejects.toThrow("NEXT_REDIRECT");
const dernier = () => prisma.bonDeCommande.findFirstOrThrow({ orderBy: { createdAt: "desc" }, include: { lignes: { orderBy: { designation: "asc" } } } });
const nombres = (l: { prixUnitaireUSD: unknown; totalLigneUSD: unknown; prixUnitaireCDF: unknown; totalLigneCDF: unknown }) => [l.prixUnitaireUSD, l.totalLigneUSD, l.prixUnitaireCDF, l.totalLigneCDF].map((x) => (x === null ? null : Number(x)));

describe("création d'un bon en francs", () => {
  it("prix, totaux de ligne et total du bon en francs ; AUCUN montant en dollars, aucun taux", async () => {
    await creer(form("CDF", [
      { articleId: art, designation: "Farine", quantite: "10", prix: "2 800" },
      { designation: "Huile", quantite: "3", prix: "4 950,5" },
      { designation: "Transport", quantite: "1", prix: "" }, // sans prix
    ]));
    const b = await dernier();
    expect(b.devise).toBe("CDF");
    expect(b.totalUSD).toBeNull();
    expect(b.tauxChangeUtilise).toBeNull();
    expect(Number(b.totalCDF)).toBe(28000 + 14851.5); // lignes chiffrées seulement
    const par = Object.fromEntries(b.lignes.map((l) => [l.designation, nombres(l)]));
    expect(par.Farine).toEqual([null, null, 2800, 28000]);
    expect(par.Huile).toEqual([null, null, 4950.5, 14851.5]);
    expect(par.Transport).toEqual([null, null, null, null]); // jamais 0 à la place d'un prix absent
    expect(b.statut).toBe("VALIDE"); // créé par la Direction
  }, 60_000);

  it("lecture : total incomplet annoncé en francs, ligne sans prix « — », jamais un $", async () => {
    const b = await dernier();
    expect(deviseBon(b)).toBe("CDF");
    expect(totalBon(b)).toBe(42851.5);
    expect(libelleTotalBon(b, 1, 3)).toMatch(/^42[\s ]851([,.]50)? FC \(incomplet : 1 ligne\(s\) sans prix\)$/);
    expect(libelleTotalBon(b, 1, 3)).not.toContain("$");
    expect(prixLigneBon(b.lignes.find((l) => l.designation === "Transport")!, "CDF")).toBeNull();
  }, 60_000);

  it("le PDF du bon : prix et totaux en FC, colonnes en FC, aucun « $ » dans le tableau", async () => {
    const b = await prisma.bonDeCommande.findFirstOrThrow({ orderBy: { createdAt: "desc" }, include: { lignes: true, fournisseur: true } });
    const pdf = await renderPdfBuffer(BonCommandeDocument({ bc: b, fournisseur: b.fournisseur, acheteur: null }));
    const t = (await pagesDuPdf(pdf)).map((p) => p.plat).join(" ");
    const tableau = t.slice(t.indexOf("Désignation"), t.indexOf("CONDITIONS"));
    expect(tableau).toContain("P.U. (CDF)");
    expect(tableau).toContain("2 800 FC");
    expect(tableau).toContain("28 000 FC");
    expect(tableau).not.toContain("$");
  }, 60_000);

  it("un bon en dollars reste ce qu'il était : total en dollars, équivalent en francs figé, lignes en dollars", async () => {
    await creer(form("USD", [{ designation: "Sucre", quantite: "4", prix: "1,5" }]));
    const b = await dernier();
    expect(b.devise).toBe("USD");
    expect(Number(b.totalUSD)).toBe(6);
    expect(Number(b.totalCDF)).toBe(16800); // équivalent figé à la création, inchangé
    expect(nombres(b.lignes[0])).toEqual([1.5, 6, null, null]);
    // Ancien formulaire (sans champ devise) : dollars, comme avant.
    await creer(form(null, [{ designation: "Sel", quantite: "2", prix: "3" }]));
    expect((await dernier()).devise).toBe("USD");
  }, 60_000);

  it("devise inconnue : refusée, rien n'est créé", async () => {
    const avant = await prisma.bonDeCommande.count();
    const f = form("CDF", [{ designation: "X", quantite: "1", prix: "1" }]);
    f.set("devise", "EUR");
    expect(erreurDe(await B.creerBonCommande(f))).toMatch(/Devise du bon inconnue/);
    expect(await prisma.bonDeCommande.count()).toBe(avant);
  }, 60_000);
});

describe("modification d'un brouillon : plus de refus pour un bon en francs", () => {
  it("un brouillon en francs se modifie dans sa devise (prix, totaux), sans repasser par les dollars", async () => {
    A.user.role = "STOCK"; // un compte stock crée un brouillon
    await creer(form("CDF", [{ designation: "Riz", quantite: "5", prix: "3 000" }]));
    A.user.role = "ADMIN";
    const brouillon = await dernier();
    expect(brouillon.statut).toBe("BROUILLON");
    expect(Number(brouillon.totalCDF)).toBe(15000);

    // Le formulaire ne renvoie pas toujours la devise (champ absent) : celle du bon fait foi.
    await expect(B.modifierBonCommande(brouillon.id, form(null, [{ designation: "Riz", quantite: "6", prix: "3 100" }]))).rejects.toThrow("NEXT_REDIRECT");
    const b = await dernier();
    expect(b.devise).toBe("CDF");
    expect(b.totalUSD).toBeNull();
    expect(Number(b.totalCDF)).toBe(18600);
    expect(nombres(b.lignes[0])).toEqual([null, null, 3100, 18600]);
  }, 60_000);

  it("changer la devise d'un brouillon : l'autre devise est VIDÉE (colonnes et totaux), jamais convertie", async () => {
    const brouillon = await dernier();
    await expect(B.modifierBonCommande(brouillon.id, form("USD", [{ designation: "Riz", quantite: "6", prix: "1,1" }]))).rejects.toThrow("NEXT_REDIRECT");
    let b = await dernier();
    expect(b.devise).toBe("USD");
    expect(Number(b.totalUSD)).toBeCloseTo(6.6, 10);
    expect(nombres(b.lignes[0])).toEqual([1.1, 6.6, null, null]);
    await expect(B.modifierBonCommande(brouillon.id, form("CDF", [{ designation: "Riz", quantite: "6", prix: "3 100" }]))).rejects.toThrow("NEXT_REDIRECT");
    b = await dernier();
    expect([b.devise, b.totalUSD, Number(b.totalCDF)]).toEqual(["CDF", null, 18600]);
    expect(nombres(b.lignes[0])).toEqual([null, null, 3100, 18600]);
  }, 60_000);

  it("la base refuse un bon en francs avec un total en dollars (contrainte de la migration)", async () => {
    await expect(prisma.bonDeCommande.create({ data: { numero: "999/PEF/T/OCT/26", sequence: 999, annee: 2026, mois: 10, devise: "CDF", totalUSD: 5, totalCDF: 14000 } })).rejects.toThrow(/BonDeCommande_devise_check/);
  }, 60_000);
});

describe("arithmétique en francs", () => {
  it("centime de franc EXACT : 2,26 × 41 740,75 = 94 334,10 (le flottant donnait 94 334,09) ; total = somme des lignes (revue du 2026-10-12)", async () => {
    await creer(form("CDF", [
      { designation: "Ligne A", quantite: "2,26", prix: "41 740,75" },
      { designation: "Ligne B", quantite: "11,19", prix: "44 116,5" },
    ]));
    const b = await dernier();
    const par = Object.fromEntries(b.lignes.map((l) => [l.designation, nombres(l)]));
    expect(par["Ligne A"]).toEqual([null, null, 41740.75, 94334.1]);
    expect(par["Ligne B"]).toEqual([null, null, 44116.5, 493663.64]);
    expect(Number(b.totalCDF)).toBe(587997.74);
  }, 60_000);
});
