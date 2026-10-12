import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Audit du 10/10/2026, stock 20 : anti-doublon de FOURNISSEUR sur tous les chemins de création
// (écran Fournisseurs, Liste d'achat, facture), et notification de la Direction quand un compte
// non-Direction en crée un. Test d'INTÉGRATION (Postgres éphémère, jamais la prod).
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

const { creerFournisseur } = await import("./actions");
const { entreeListeAchat } = await import("../entree/actions");
const { creerFactureAvecLignes } = await import("../factures/actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const fd = (o: Record<string, string>, multi: [string, string][] = []) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); for (const [k, v] of multi) f.append(k, v); return f; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);
const doublonDe = (r: unknown) => (r && typeof r === "object" && "doublonFournisseur" in r ? (r as unknown as { creationPossible: boolean; candidats: { nom: string }[]; message: string }) : null);
const noms = async () => (await prisma.fournisseur.findMany({ orderBy: { nom: "asc" } })).map((f) => f.nom);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK" } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  en("dir");
  await prisma.notification.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.ligneFacture.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
  await prisma.fournisseur.deleteMany();
});

describe("écran Fournisseurs", () => {
  it("nom IDENTIQUE à un existant : refus sec, rien n'est créé, même avec « Créer quand même »", async () => {
    await prisma.fournisseur.create({ data: { nom: "Maison Kathy" } });
    for (const extra of [{} as Record<string, string>, { creerQuandMeme: "1" }]) {
      const d = doublonDe(await creerFournisseur(fd({ nom: "  maison  KATHY ", ...extra })));
      expect(d?.creationPossible).toBe(false);
      expect(d?.candidats.map((c) => c.nom)).toEqual(["Maison Kathy"]);
    }
    expect(await noms()).toEqual(["Maison Kathy"]);
  }, 60_000);

  it("nom PROCHE : refusé et signalé, créé avec « Créer quand même »", async () => {
    await prisma.fournisseur.create({ data: { nom: "Maison Kathy" } });
    const d = doublonDe(await creerFournisseur(fd({ nom: "Kathy" })));
    expect(d?.creationPossible).toBe(true);
    expect(d?.message).toContain("« Maison Kathy »");
    expect(await noms()).toEqual(["Maison Kathy"]);
    expect(await creerFournisseur(fd({ nom: "Kathy", creerQuandMeme: "1" }))).toBeUndefined();
    expect(await noms()).toEqual(["Kathy", "Maison Kathy"]);
  }, 60_000);

  it("un nom sans rapport passe ; deux créations simultanées du même nom ne font qu'un fournisseur", async () => {
    expect(await creerFournisseur(fd({ nom: "Quincaillerie Lumumba" }))).toBeUndefined();
    const rs = await Promise.all([creerFournisseur(fd({ nom: "Brasimba" })), creerFournisseur(fd({ nom: "Brasimba" }))]);
    expect(rs.filter((r) => r === undefined)).toHaveLength(1);
    expect((await noms()).filter((n) => n === "Brasimba")).toHaveLength(1);
  }, 60_000);

  it("une erreur de saisie (nom vide) revient lisible", async () => {
    expect(erreurDe(await creerFournisseur(fd({ nom: "  " })))).toMatch(/nom est requis/);
  }, 60_000);
});

describe("Liste d'achat", () => {
  const achat = (fournisseurNom: string, extra: [string, string][] = []) => fd({ date: "2026-10-05" }, [
    ["articleId", ""], ["designation", "Farine"], ["unite", "kg"], ["domaine", "NOURRITURE"], ["quantite", "5"], ["montant", "0"], ["devise", "USD"], ["fournisseurId", ""], ["fournisseurNom", fournisseurNom], ...extra,
  ]);

  it("un nom nouveau PROCHE d'un fournisseur existant : refus tant qu'on n'a pas choisi (rien n'est enregistré)", async () => {
    await prisma.fournisseur.create({ data: { nom: "Maison Kathy" } });
    const r = await entreeListeAchat(achat("Kathy"));
    expect(erreurDe(r)).toMatch(/Fournisseur déjà enregistré sous un nom proche.*« Kathy » → « Maison Kathy »/);
    expect(await noms()).toEqual(["Maison Kathy"]);
    expect(await prisma.mouvementStock.count()).toBe(0);
  }, 60_000);

  it("« Créer quand même » (un nom confirmé) : le fournisseur est créé et l'achat enregistré", async () => {
    await prisma.fournisseur.create({ data: { nom: "Maison Kathy" } });
    const r = await entreeListeAchat(achat("Kathy", [["fournisseurCreerQuandMeme", "Kathy"]]));
    expect(erreurDe(r)).toBeNull();
    expect(await noms()).toEqual(["Kathy", "Maison Kathy"]);
    expect(await prisma.mouvementStock.count()).toBe(1);
  }, 60_000);

  it("le même nom exact est rapproché sans rien demander ; un nom sans rapport est créé", async () => {
    await prisma.fournisseur.create({ data: { nom: "Maison Kathy" } });
    expect(erreurDe(await entreeListeAchat(achat("maison kathy")))).toBeNull();
    expect(erreurDe(await entreeListeAchat(achat("Quincaillerie Lumumba")))).toBeNull();
    expect(await noms()).toEqual(["Maison Kathy", "Quincaillerie Lumumba"]);
  }, 60_000);

  it("fournisseur créé par un compte non-Direction : la Direction est notifiée ; rien si c'est la Direction", async () => {
    en("resp");
    expect(erreurDe(await entreeListeAchat(achat("Quincaillerie Lumumba")))).toBeNull();
    const n = await prisma.notification.findMany({ where: { destinataireUserId: U.dir.id } });
    expect(n.some((x) => /Nouveau fournisseur créé par Jean \(Liste d'achat\) : « Quincaillerie Lumumba »/.test(x.message))).toBe(true);
    await prisma.notification.deleteMany();
    en("dir");
    expect(erreurDe(await entreeListeAchat(achat("Brasimba")))).toBeNull();
    expect((await prisma.notification.findMany()).some((x) => /fournisseur créé/i.test(x.message))).toBe(false);
  }, 60_000);
});

// Rappel : au-dessus de 0,82 (« Kathy » / « Maison Kathy ») le fournisseur est rattaché d'office par la facture
// (constat 7 de l'audit, traité avec les factures) ; l'anti-doublon vise la zone 0,7-0,82.
describe("Facture", () => {
  const facture = (fournisseurNom: string, extra: Record<string, string> = {}) => fd({ fournisseurNom, devise: "USD", numero: "F-1", date: "2026-10-05", ...extra }, [
    ["ligne_articleId", ""], ["ligne_designation", "Farine"], ["ligne_unite", "kg"], ["ligne_quantite", "5"], ["ligne_prix", "2"],
  ]);

  it("un fournisseur nouveau PROCHE d'un existant : demande de choix (FOURNISSEUR_PROCHE, un seul flux avec « Créer »), rien n'est créé", async () => {
    await prisma.fournisseur.create({ data: { nom: "Boulangerie Ndoki" } });
    const r = await creerFactureAvecLignes(facture("Boulangerie Kasa"));
    expect(erreurDe(r)).toMatch(/^FOURNISSEUR_PROCHE\|.*"creationPossible":true.*Boulangerie Ndoki|^FOURNISSEUR_PROCHE\|.*Boulangerie Ndoki.*"creationPossible":true/);
    expect(await noms()).toEqual(["Boulangerie Ndoki"]);
    expect(await prisma.factureFournisseur.count()).toBe(0);
  }, 60_000);

  it("« Créer » (fournisseurNouveau) crée le fournisseur ; le compte non-Direction notifie la Direction", async () => {
    await prisma.fournisseur.create({ data: { nom: "Boulangerie Ndoki" } });
    en("resp");
    // La création se termine par une redirection vers la fiche de la facture.
    await expect(creerFactureAvecLignes(facture("Boulangerie Kasa", { fournisseurNouveau: "1" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await noms()).toEqual(["Boulangerie Kasa", "Boulangerie Ndoki"]);
    const n = await prisma.notification.findMany({ where: { destinataireUserId: U.dir.id } });
    expect(n.some((x) => /Nouveau fournisseur créé par Jean \(facture\) : « Boulangerie Kasa »/.test(x.message))).toBe(true);
  }, 60_000);
});
