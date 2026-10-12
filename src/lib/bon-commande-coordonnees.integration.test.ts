import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { pagesDuPdf } from "@/lib/test/pdf-lecture";

// Bon de commande (PDF) : où se SAISISSENT les informations qu'il imprime, et qu'elles y arrivent.
//  - fournisseur : Adresse et ID National (fiche fournisseur, Direction seulement) ;
//  - acheteur : Adresse de livraison et Contact (Paramètres de la société, Direction seulement),
//    le reste (pays, siège, RCCM, Id. Nat., téléphone) venant de l'identité de la société.
// Base éphémère, jamais la production.
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
vi.mock("@/lib/garde-route", () => ({ exigerEspaceStock: async () => ({ ok: true, user: A.user }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;`, url }); },
}));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { creerFournisseur, modifierFournisseur } = await import("@/app/(stock)/stock/fournisseurs/actions");
const { mettreAJourEntreprise } = await import("@/app/(app)/parametres/actions");
const BC_PDF = await import("@/app/(stock)/stock/commandes/[id]/pdf/route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const rediriger = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { if ((e as { url?: string }).url) return (e as { url: string }).url; throw e; } return ""; };

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest());
  H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  A.user = { id: A.user.id, role: "ADMIN", nom: "Direction", accesStock: false };
  await prisma.ligneBonDeCommande.deleteMany();
  await prisma.bonDeCommande.deleteMany();
  await prisma.fournisseur.deleteMany();
  await prisma.paramEntreprise.deleteMany();
  await prisma.parametresAchat.deleteMany();
});

describe("fiche fournisseur : Adresse et ID National", () => {
  it("saisis à la création puis modifiés ; vidés = absents ; réservés à la Direction", async () => {
    await creerFournisseur(fd({ nom: "REGAL", adresse: " 12 avenue du Port ", idNational: "01-910-N123" }));
    let f = await prisma.fournisseur.findFirstOrThrow({ where: { nom: "REGAL" } });
    expect(f.adresse).toBe("12 avenue du Port");
    expect(f.idNational).toBe("01-910-N123");

    await modifierFournisseur(f.id, fd({ adresse: "Gombe, 5 rue Kasa-Vubu", idNational: "" }));
    f = await prisma.fournisseur.findUniqueOrThrow({ where: { id: f.id } });
    expect(f.adresse).toBe("Gombe, 5 rue Kasa-Vubu");
    expect(f.idNational).toBeNull();

    A.user = { ...A.user, role: "STOCK" };
    expect(await modifierFournisseur(f.id, fd({ adresse: "Autre" }))).toMatchObject({ erreur: expect.stringMatching(/rôle insuffisant/) });
    expect((await prisma.fournisseur.findUniqueOrThrow({ where: { id: f.id } })).adresse).toBe("Gombe, 5 rue Kasa-Vubu");
  });
});

describe("Paramètres de la société : Adresse de livraison et Contact acheteur", () => {
  const identite = (extra: Record<string, string> = {}) => fd({ nom: "TOLYA SARL", pays: "République Démocratique du Congo", ...extra });

  it("enregistrés par la Direction (espaces retirés) ; un compte non-Direction est refusé", async () => {
    expect(await rediriger(() => mettreAJourEntreprise(identite({ adresseLivraison: "  Entrepôt de la Gombe ", contactAchats: " Mme Dupont " })))).toBe("");
    const p = await prisma.paramEntreprise.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(p.adresseLivraison).toBe("Entrepôt de la Gombe");
    expect(p.contactAchats).toBe("Mme Dupont");

    A.user = { ...A.user, role: "MANAGER" };
    expect(decodeURIComponent(await rediriger(() => mettreAJourEntreprise(identite({ adresseLivraison: "Pirate" }))))).toMatch(/erreur=.*rôle insuffisant/);
    expect((await prisma.paramEntreprise.findUniqueOrThrow({ where: { id: "singleton" } })).adresseLivraison).toBe("Entrepôt de la Gombe");
  });

  it("de bout en bout : le PDF du bon imprime l'adresse du fournisseur, l'ID National, et l'adresse de livraison / contact de la société", async () => {
    await mettreAJourEntreprise(identite({ adresseLivraison: "Entrepôt de la Gombe", contactAchats: "Mme Dupont", rccm: "CD/KNG/RCCM/18-B-01373", idNat: "01-F4300-N74832J" })).catch(() => {});
    const f = await prisma.fournisseur.create({ data: { nom: "REGAL", adresse: "12 avenue du Port", idNational: "01-910-N123" } });
    const bc = await prisma.bonDeCommande.create({
      data: {
        numero: "001/PEF/REGAL/OCT/26", sequence: 1, annee: 2026, mois: 10, statut: "VALIDE", fournisseurId: f.id, totalUSD: 28,
        lignes: { create: [{ designation: "Monin fraise sirop 1L", unite: "Bouteille", uniteParCarton: 6, nbCartons: 0.33, quantite: 2, prixUnitaireUSD: 14, totalLigneUSD: 28 }] },
      },
    });
    const res = await BC_PDF.GET(new Request("http://x"), { params: Promise.resolve({ id: bc.id }) });
    expect(res.status).toBe(200);
    const t = (await pagesDuPdf(Buffer.from(await res.arrayBuffer()))).map((p) => p.plat).join(" ");
    expect(t).toContain("Adresse 12 avenue du Port");
    expect(t).toContain("ID National 01-910-N123");
    expect(t).toContain("Adresse de livraison Entrepôt de la Gombe");
    expect(t).toContain("Contact Mme Dupont");
    expect(t).toContain("Pays République Démocratique du Congo");
    expect(t).toMatch(/Monin fraise sirop 1L 6 0,33 2 Bouteille 14,00 \$ 28,00 \$/);
  }, 60_000);
});
