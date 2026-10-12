import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Audit du 10/10/2026, stock 2 et 19 — test d'INTÉGRATION (Postgres éphémère, jamais la prod) :
//  - réceptions PARTIELLES : la quantité reçue est gardée PAR LIGNE, le statut se calcule sur le cumul
//    (« Reçu partiel » jusqu'à ce que TOUT soit reçu), les lignes libres (sans article) se réceptionnent, sans
//    effet sur le stock ; refus sur un bon brouillon, annulé ou déjà reçu ;
//  - une ligne sans prix reste SANS prix (null), jamais 0, et le total du bon n'en tient pas compte.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Sacha", accesStock: false } }));
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

const { receptionnerBonCommande, creerBonCommande } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let farine: string;
const fd = (paires: [string, string][]) => { const f = new FormData(); for (const [k, v] of paires) f.append(k, v); return f; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);
let compteur = 0;
/** Un bon de 10 sacs de farine (article) + 3 « transport » (ligne libre). */
async function bon(statut: "BROUILLON" | "VALIDE" | "ENVOYE" | "RECU_PARTIEL" | "RECU" | "ANNULE" = "VALIDE") {
  compteur++;
  return prisma.bonDeCommande.create({
    data: {
      numero: `00${compteur}/PEF/TEST/OCT/26`, sequence: compteur, annee: 2026, mois: 10, statut, totalUSD: 50,
      lignes: { create: [
        { designation: "Farine", articleId: farine, quantite: 10, prixUnitaireUSD: 5, totalLigneUSD: 50 },
        { designation: "Transport", quantite: 3 }, // ligne libre, sans prix
      ] },
    },
    include: { lignes: { orderBy: { designation: "asc" } } },
  });
}
const lignesDe = async (id: string) => prisma.ligneBonDeCommande.findMany({ where: { bonDeCommandeId: id }, orderBy: { designation: "asc" } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Sacha", role: "ADMIN" } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const a = await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "sac", stock: { create: { quantite: 7 } } } });
  farine = a.id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => { A.user.role = "ADMIN"; await prisma.reception.deleteMany(); });

describe("réceptions partielles", () => {
  it("la quantité reçue est gardée par ligne et s'ajoute : Reçu partiel, puis Reçu quand tout est arrivé", async () => {
    const b = await bon();
    const [farineL, transportL] = b.lignes.map((l) => l.id);
    // 1re réception : 6 sacs sur 10, le transport pas encore arrivé.
    expect(erreurDe(await receptionnerBonCommande(b.id, fd([["recu_ligneId", farineL], ["recu_quantite", "6"]])))).toBeNull();
    let ls = await lignesDe(b.id);
    expect(Number(ls[0].quantiteRecue)).toBe(6);
    expect(ls[1].quantiteRecue).toBeNull(); // le transport n'a rien reçu : pas encore de quantité, pas un 0 inventé
    expect((await prisma.bonDeCommande.findUniqueOrThrow({ where: { id: b.id } })).statut).toBe("RECU_PARTIEL");
    // 2e réception : les 4 sacs restants ; le transport (ligne libre) reste à recevoir -> toujours partiel.
    expect(erreurDe(await receptionnerBonCommande(b.id, fd([["recu_ligneId", farineL], ["recu_quantite", "4"]])))).toBeNull();
    ls = await lignesDe(b.id);
    expect(Number(ls[0].quantiteRecue)).toBe(10);
    expect((await prisma.bonDeCommande.findUniqueOrThrow({ where: { id: b.id } })).statut).toBe("RECU_PARTIEL");
    // 3e réception : la ligne LIBRE se réceptionne ; tout est reçu -> « Reçu ».
    expect(erreurDe(await receptionnerBonCommande(b.id, fd([["recu_ligneId", transportL], ["recu_quantite", "3"]])))).toBeNull();
    expect(Number((await lignesDe(b.id))[1].quantiteRecue)).toBe(3);
    expect((await prisma.bonDeCommande.findUniqueOrThrow({ where: { id: b.id } })).statut).toBe("RECU");
    expect(await prisma.reception.count({ where: { bonDeCommandeId: b.id } })).toBe(3);
  }, 60_000);

  it("une réception ne touche JAMAIS au stock (l'entrée se fait par facture / liste d'achat)", async () => {
    const b = await bon();
    await receptionnerBonCommande(b.id, fd([["recu_ligneId", b.lignes[0].id], ["recu_quantite", "10"]]));
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: farine } })).quantite)).toBe(7);
    expect(await prisma.mouvementStock.count({ where: { articleId: farine } })).toBe(0);
  }, 60_000);

  it("un bon importé en PDF (lignes sans article) est réceptionnable", async () => {
    compteur++;
    const pdf = await prisma.bonDeCommande.create({
      data: { numero: `PDF${compteur}`, sequence: compteur, annee: 2026, mois: 10, statut: "VALIDE", totalUSD: 20, documentUrl: "/fichiers/x.pdf",
        lignes: { create: [{ designation: "Huile 5L", quantite: 4, prixUnitaireUSD: 5, totalLigneUSD: 20 }] } },
      include: { lignes: true },
    });
    expect(erreurDe(await receptionnerBonCommande(pdf.id, fd([["recu_ligneId", pdf.lignes[0].id], ["recu_quantite", "4"]])))).toBeNull();
    expect((await prisma.bonDeCommande.findUniqueOrThrow({ where: { id: pdf.id } })).statut).toBe("RECU");
  }, 60_000);

  it.each([["BROUILLON", /brouillon/], ["ANNULE", /annulé/], ["RECU", /déjà reçu/]] as const)("refus sur un bon %s : rien n'est écrit", async (statut, motif) => {
    const b = await bon(statut);
    const r = await receptionnerBonCommande(b.id, fd([["recu_ligneId", b.lignes[0].id], ["recu_quantite", "1"]]));
    expect(erreurDe(r)).toMatch(motif);
    expect((await lignesDe(b.id))[0].quantiteRecue).toBeNull();
    expect(await prisma.reception.count({ where: { bonDeCommandeId: b.id } })).toBe(0);
  }, 60_000);

  it("quantité négative ou rien de saisi : refusé", async () => {
    const b = await bon();
    expect(erreurDe(await receptionnerBonCommande(b.id, fd([["recu_ligneId", b.lignes[0].id], ["recu_quantite", "-2"]])))).toMatch(/négative/);
    expect(erreurDe(await receptionnerBonCommande(b.id, fd([["recu_ligneId", b.lignes[0].id], ["recu_quantite", "0"]])))).toMatch(/au moins une quantité/);
  }, 60_000);

  it("deux réceptions simultanées ne s'écrasent pas : le cumul est exact", async () => {
    const b = await bon();
    const f = () => receptionnerBonCommande(b.id, fd([["recu_ligneId", b.lignes[0].id], ["recu_quantite", "2"]]));
    const rs = await Promise.all([f(), f(), f()]);
    expect(rs.every((r) => erreurDe(r) === null)).toBe(true);
    expect(Number((await lignesDe(b.id))[0].quantiteRecue)).toBe(6);
  }, 60_000);
});

describe("bon de commande : ligne sans prix", () => {
  it("une case prix vide reste SANS prix (null), jamais 0 ; le total ne compte que les lignes chiffrées", async () => {
    A.user.role = "ADMIN";
    await expect(creerBonCommande(fd([
      ["ligne_designation", "Farine"], ["ligne_articleId", farine], ["ligne_quantite", "10"], ["ligne_prix", "5"], ["ligne_uniteParCarton", ""],
      ["ligne_designation", "Transport"], ["ligne_articleId", ""], ["ligne_quantite", "1"], ["ligne_prix", ""], ["ligne_uniteParCarton", ""],
    ]))).rejects.toThrow("NEXT_REDIRECT"); // la création se termine par une redirection vers la fiche
    const bc = await prisma.bonDeCommande.findFirstOrThrow({ orderBy: { createdAt: "desc" }, include: { lignes: { orderBy: { designation: "asc" } } } });
    expect(bc.devise).toBe("USD");
    expect(Number(bc.totalUSD)).toBe(50);
    expect(Number(bc.lignes[0].prixUnitaireUSD)).toBe(5);
    expect(bc.lignes[1].prixUnitaireUSD).toBeNull();
    expect(bc.lignes[1].totalLigneUSD).toBeNull();
  }, 60_000);
});
