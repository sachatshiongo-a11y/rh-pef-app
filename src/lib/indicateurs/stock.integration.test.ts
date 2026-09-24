import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Non-régression de l'extraction des indicateurs de stock : l'accueil Stock affiche, sur ce jeu de
// données, EXACTEMENT les chiffres d'avant. Valeurs attendues posées à la main.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "stock@pef.cd", accesStock: false, employeeId: null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));

let prisma: PrismaClient;
let fermer: () => Promise<void>;
/** Texte rendu : balises retirées, entités décodées, espaces (insécables comprises) ramenées à une seule. */
const texte = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s\u00a0\u202f]+/g, " ");
// Aujourd'hui (UTC, comme les bornes de la page) : toutes les dates du jeu tombent dans la semaine
// et le mois en cours, quel que soit le jour où le test tourne.
const auj = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "stock@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });

  const creer = async (designation: string, prix: string, quantite: string, stockMinimum: string) => {
    const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: prix } });
    await prisma.stock.create({ data: { articleId: a.id, quantite, stockMinimum } });
    return a;
  };
  // Valeur : 10 × 2,50 + 3 × 4,00 + 0 × 7,00 = 37,00. Urgent : Beurre (0 ≤ 0, seuil 2). À réappro : Sel (3 ≤ 5).
  const farine = await creer("Farine", "2.5", "10", "0");
  await creer("Sel", "4", "3", "5");
  await creer("Beurre", "7", "0", "2");

  // Factures : 120 à régler cette semaine, 80 échue non réglée, 500 réglée (ignorée).
  await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fourn. A", montantUSD: 120, resteAPayerUSD: 120, mois: 9, annee: 2026, statut: "A_REGLER", dateEcheance: auj } });
  await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fourn. B", montantUSD: 80, resteAPayerUSD: 80, mois: 9, annee: 2026, statut: "ECHUE_NON_REGLEE" } });
  await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fourn. C", montantUSD: 500, resteAPayerUSD: 0, mois: 9, annee: 2026, statut: "REGLEE" } });
  // Légumes du mois : 15,50. Conso du mois : sortie valorisée 12,00 + sortie sans montant 2 × 2,50 = 17,00.
  await prisma.achatLegume.create({ data: { date: auj, legume: "Tomate", quantite: 5, montantUSD: 15.5 } });
  await prisma.mouvementStock.create({ data: { articleId: farine.id, type: "SORTIE", quantite: 4, montantUSD: 12, date: auj } });
  await prisma.mouvementStock.create({ data: { articleId: farine.id, type: "SORTIE", quantite: 2, date: auj } });
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("accueil Stock — mêmes chiffres avant et après l'extraction", () => {
  it("cartes d'indicateurs et articles au seuil", async () => {
    const { default: StockDashboard } = await import("@/app/(stock)/stock/page");
    const t = texte(renderToStaticMarkup(await StockDashboard()));
    expect(t).toContain("Alertes urgentes 1");
    expect(t).toContain("À réapprovisionner 1");
    expect(t).toContain("Valeur du stock 37,00 $");
    expect(t).toContain("Factures à payer 200,00 $ 2 facture(s)");
    expect(t).toContain("À régler cette semaine 120,00 $ 1 facture(s)");
    expect(t).toContain("Factures échues 80,00 $ 1 facture(s)");
    expect(t).toContain("Légumes frais du mois 15,50 $ 1 achat(s)");
    expect(t).toContain("Conso. du mois (sorties) ≈ 17,00 $ 2 sortie(s) valorisées");
    // Articles au seuil : l'urgent d'abord.
    expect(t).toContain("Articles au seuil minimum (2)");
    expect(t.indexOf("Beurre")).toBeLessThan(t.indexOf("Sel 3"));
  }, 60_000);
});

describe("indicateursStock — fonction partagée", () => {
  it("une somme sans aucune ligne reste null (l'accueil affiche « — », jamais « 0,00 $ »)", async () => {
    const { indicateursStock } = await import("./stock");
    // Janvier 2020 : aucun légume, aucune facture à échéance cette semaine-là, aucune sortie.
    const i = await indicateursStock(new Date(Date.UTC(2020, 0, 15)));
    expect(i.legumesMois).toEqual({ montant: null, nb: 0 });
    expect(i.facturesSemaine).toEqual({ montant: null, nb: 0 });
    expect(i.consoMois).toEqual({ montant: 0, nb: 0 });
  }, 60_000);

  it("5 articles en alerte par défaut, urgents d'abord, avec l'identifiant pour le lien vers la fiche", async () => {
    const { indicateursStock } = await import("./stock");
    const i = await indicateursStock(new Date());
    expect(i.nbUrgent).toBe(1);
    expect(i.alertes.map((a) => [a.designation, a.niveau])).toEqual([["Beurre", "URGENT"], ["Sel", "APPRO"]]);
    expect(i.alertes[0]!.articleId).toBeTruthy();
    expect((await indicateursStock(new Date(), { nbAlertes: 1 })).alertes).toHaveLength(1);
  }, 60_000);
});
