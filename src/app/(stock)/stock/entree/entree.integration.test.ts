import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { WHERE_ACHATS_LISTE } from "@/lib/achats-liste";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — Liste d'achat, décisions Direction du
// 2026-09-28 : date au choix, fournisseur facultatif par ligne, historique limité aux achats du
// formulaire, avertissement (non bloquant) de double saisie.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Testeur" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { entreeListeAchat, verifierDoublonsListe } = await import("./actions");
const { genererDonneesRapportDetail } = await import("@/lib/rapports");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });
}, 300_000);

afterAll(async () => { await fermer?.(); });

type Ligne = { articleId?: string; designation?: string; unite?: string; domaine?: string; quantite: number; montant?: number; fournisseurId?: string; fournisseurNom?: string };
const fd = (lignes: Ligne[], opts: { date?: string; devise?: "USD" | "CDF"; origine?: string } = {}) => {
  const f = new FormData();
  if (opts.origine !== undefined) f.set("origine", opts.origine);
  if (opts.date !== undefined) f.set("date", opts.date);
  f.set("devise", opts.devise ?? "USD");
  for (const l of lignes) {
    f.append("articleId", l.articleId ?? "");
    f.append("designation", l.designation ?? "");
    f.append("unite", l.unite ?? "");
    f.append("domaine", l.domaine ?? "NOURRITURE");
    f.append("quantite", String(l.quantite));
    f.append("montant", String(l.montant ?? 0));
    f.append("fournisseurId", l.fournisseurId ?? "");
    f.append("fournisseurNom", l.fournisseurNom ?? "");
  }
  return f;
};
const ok = <T,>(r: T | { erreur: string }): T => {
  if (r && typeof r === "object" && "erreur" in r) throw new Error(`erreur inattendue : ${(r as { erreur: string }).erreur}`);
  return r as T;
};
const article = (designation: string) => prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg" } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const veille = () => { const d = new Date(`${jourKinshasaISO()}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() - 1); return iso(d); };

describe("Liste d'achat — date au choix", () => {
  it("le mouvement reçoit la date saisie ; le stock (et donc les alertes) augmente comme avant", async () => {
    const art = await article("Farine T55");
    await prisma.stock.create({ data: { articleId: art.id, quantite: 2, stockMinimum: 5 } });
    const r = ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 10, montant: 30 }], { date: "2026-03-12" })));
    expect(r.crees).toEqual([]);
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id } });
    expect(iso(m.date)).toBe("2026-03-12");
    const s = await prisma.stock.findUniqueOrThrow({ where: { articleId: art.id } });
    expect(Number(s.quantite)).toBe(12);
  });

  it("sans date : aujourd'hui à Kinshasa", async () => {
    const art = await article("Sel fin");
    ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 1 }])));
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id } });
    expect(iso(m.date)).toBe(jourKinshasaISO());
  });

  it("date dans le futur : refusée par un MESSAGE renvoyé (pas levé), rien n'est écrit", async () => {
    const art = await article("Sucre");
    const r = await entreeListeAchat(fd([{ articleId: art.id, quantite: 4 }], { date: "2099-01-01" }));
    expect(r).toEqual({ erreur: "La date de l'achat ne peut pas être dans le futur." });
    expect(await prisma.mouvementStock.count({ where: { articleId: art.id } })).toBe(0);
    expect(await prisma.stock.count({ where: { articleId: art.id } })).toBe(0);
  });

  it("date d'une période clôturée : refusée par un message lisible, rien n'est écrit", async () => {
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 2 } });
    const art = await article("Huile");
    const r = await entreeListeAchat(fd([{ articleId: art.id, quantite: 4 }], { date: "2026-02-15" }));
    expect("erreur" in r && r.erreur).toMatch(/02\/2026 est clôturée/);
    expect(await prisma.mouvementStock.count({ where: { articleId: art.id } })).toBe(0);
  });

  it("l'achat antidaté compte dans le rapport des achats À SA DATE (indicateurs justes)", async () => {
    const art = await article("Levure");
    ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 3, montant: 12 }], { date: "2026-04-07" })));
    const avril = await genererDonneesRapportDetail("ACHATS", new Date("2026-04-01T00:00:00Z"), new Date("2026-04-30T00:00:00Z"));
    expect(avril.lignes.some((l) => l[1] === "Levure")).toBe(true);
    const mai = await genererDonneesRapportDetail("ACHATS", new Date("2026-05-01T00:00:00Z"), new Date("2026-05-31T00:00:00Z"));
    expect(mai.lignes.some((l) => l[1] === "Levure")).toBe(false);
  });
});

describe("Liste d'achat — fournisseur facultatif par ligne", () => {
  it("fournisseur choisi dans la liste (par id) : porté par le mouvement, aucun doublon", async () => {
    const f = await prisma.fournisseur.create({ data: { nom: "Papa Jonas" } });
    const art = await article("Tomates pelées");
    const r = ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 2, fournisseurId: f.id, fournisseurNom: "Papa Jonas" }], { date: veille() })));
    expect(r.fournisseursCrees).toEqual([]);
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id } });
    expect(m.fournisseurId).toBe(f.id);
    expect(await prisma.fournisseur.count({ where: { nom: "Papa Jonas" } })).toBe(1);
  });

  it("nom tapé qui correspond à un fournisseur connu (casse, accents) : rapproché, pas recréé", async () => {
    const f = await prisma.fournisseur.create({ data: { nom: "Maman Épiphanie" } });
    const art = await article("Oignons secs");
    const r = ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 2, fournisseurNom: "maman epiphanie" }])));
    expect(r.fournisseursCrees).toEqual([]);
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id } });
    expect(m.fournisseurId).toBe(f.id);
  });

  it("nouveau fournisseur : créé à la volée par son nom, UNE fois même sur deux lignes", async () => {
    const a1 = await article("Riz");
    const a2 = await article("Haricots");
    const r = ok(await entreeListeAchat(fd([
      { articleId: a1.id, quantite: 5, fournisseurNom: "Kin Marché Central" },
      { articleId: a2.id, quantite: 3, fournisseurNom: "  Kin Marché Central " },
    ])));
    expect(r.fournisseursCrees).toEqual(["Kin Marché Central"]);
    const fs = await prisma.fournisseur.findMany({ where: { nom: "Kin Marché Central" } });
    expect(fs).toHaveLength(1);
    const ms = await prisma.mouvementStock.findMany({ where: { articleId: { in: [a1.id, a2.id] } } });
    expect(ms.map((m) => m.fournisseurId)).toEqual([fs[0].id, fs[0].id]);
  });

  it("sans fournisseur : la ligne reste sans fournisseur (facultatif)", async () => {
    const art = await article("Poivre");
    ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 1 }])));
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id } });
    expect(m.fournisseurId).toBeNull();
  });

  it("fournisseur inconnu (id périmé) : message lisible, rien n'est écrit", async () => {
    const art = await article("Ail");
    const r = await entreeListeAchat(fd([{ articleId: art.id, quantite: 1, fournisseurId: "00000000-0000-0000-0000-000000000000", fournisseurNom: "Fantôme" }]));
    expect(r).toEqual({ erreur: "Fournisseur introuvable (ligne 1) : rechargez la page et choisissez-le à nouveau." });
    expect(await prisma.mouvementStock.count({ where: { articleId: art.id } })).toBe(0);
  });

  it("la suppression d'un fournisseur laisse l'achat en place, sans fournisseur (SetNull)", async () => {
    const f = await prisma.fournisseur.create({ data: { nom: "Éphémère" } });
    const art = await article("Persil");
    ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 1, fournisseurId: f.id }])));
    await prisma.fournisseur.delete({ where: { id: f.id } });
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id } });
    expect(m.fournisseurId).toBeNull();
  });
});

describe("historique de la Liste d'achat — les achats du formulaire, et eux seuls", () => {
  it("écarte les entrées par facture, par réception de BC, manuelles et de correction ; garde les achats (origine vide comprise)", async () => {
    const art = await article("Mozzarella");
    const fac = await prisma.factureFournisseur.create({ data: { fournisseurNom: "Laiterie", montantUSD: 10, mois: 9, annee: 2026 } });
    const rec = await prisma.reception.create({ data: {} });
    const base = { articleId: art.id, type: "ENTREE" as const, quantite: 1, date: new Date("2026-09-10T00:00:00Z") };
    await prisma.mouvementStock.createMany({
      data: [
        { ...base, origine: "Facture Laiterie", factureId: fac.id },
        { ...base, origine: "Réception BC 001/PEF/SEPT/26", receptionId: rec.id },
        { ...base, origine: "Entrée manuelle" },
        { ...base, origine: "Correction stock négatif (mise à 0)" },
        { ...base, origine: null },
      ],
    });
    ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 1 }], { date: "2026-09-10", origine: "Courses du 10" })));
    const vus = await prisma.mouvementStock.findMany({ where: { ...WHERE_ACHATS_LISTE, articleId: art.id } });
    expect(vus.map((m) => m.origine).sort()).toEqual(["Courses du 10", null].sort());
  });
});

describe("double saisie — avertissement NON bloquant", () => {
  it("même article, même jour, même quantité déjà entré par FACTURE : l'achat est enregistré ET signalé", async () => {
    const art = await article("Parmesan");
    const fac = await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fromagerie", numero: "F-77", montantUSD: 50, mois: 9, annee: 2026 } });
    await prisma.mouvementStock.create({ data: { articleId: art.id, type: "ENTREE", quantite: 4, date: new Date("2026-09-15T00:00:00Z"), origine: "Facture Fromagerie F-77", factureId: fac.id } });

    const r = ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 4 }], { date: "2026-09-15" })));
    expect(r.avertissements).toHaveLength(1);
    expect(r.avertissements[0]).toContain("Parmesan");
    expect(r.avertissements[0]).toContain("15/09/2026");
    expect(r.avertissements[0]).toContain("facture F-77");
    expect(await prisma.mouvementStock.count({ where: { articleId: art.id } })).toBe(2); // non bloquant
  });

  it("par RÉCEPTION de bon de commande : signalé aussi, dès la saisie (avant l'enregistrement)", async () => {
    const art = await article("Basilic");
    const bc = await prisma.bonDeCommande.create({ data: { numero: "009/PEF/SEPT/26", sequence: 9, annee: 2026, mois: 9 } });
    const rec = await prisma.reception.create({ data: { bonDeCommandeId: bc.id } });
    await prisma.mouvementStock.create({ data: { articleId: art.id, type: "ENTREE", quantite: 2.5, date: new Date("2026-09-16T00:00:00Z"), receptionId: rec.id } });

    const r = ok(await verifierDoublonsListe("2026-09-16", [{ articleId: art.id, designation: "", quantite: 2.5 }]));
    expect(r.avertissements).toHaveLength(1);
    expect(r.avertissements[0]).toContain("bon de commande 009/PEF/SEPT/26");
    expect(await prisma.mouvementStock.count({ where: { articleId: art.id } })).toBe(1); // la vérification n'écrit rien
  });

  it("une désignation libre qui retrouve l'article est vérifiée aussi", async () => {
    const art = await article("Crème fraîche");
    const fac = await prisma.factureFournisseur.create({ data: { fournisseurNom: "Laiterie", montantUSD: 5, mois: 9, annee: 2026 } });
    await prisma.mouvementStock.create({ data: { articleId: art.id, type: "ENTREE", quantite: 3, date: new Date("2026-09-17T00:00:00Z"), factureId: fac.id } });
    const r = ok(await verifierDoublonsListe("2026-09-17", [{ articleId: "", designation: "creme fraiche", quantite: 3 }]));
    expect(r.avertissements).toHaveLength(1);
  });

  it("autre quantité, autre jour, ou entrée hors facture/réception : aucun avertissement", async () => {
    const art = await article("Beurre");
    const fac = await prisma.factureFournisseur.create({ data: { fournisseurNom: "Laiterie", montantUSD: 5, mois: 9, annee: 2026 } });
    await prisma.mouvementStock.create({ data: { articleId: art.id, type: "ENTREE", quantite: 6, date: new Date("2026-09-18T00:00:00Z"), factureId: fac.id } });
    await prisma.mouvementStock.create({ data: { articleId: art.id, type: "ENTREE", quantite: 2, date: new Date("2026-09-18T00:00:00Z"), origine: "Liste d'achat" } });
    const r1 = ok(await verifierDoublonsListe("2026-09-18", [{ articleId: art.id, designation: "", quantite: 7 }]));
    const r2 = ok(await verifierDoublonsListe("2026-09-19", [{ articleId: art.id, designation: "", quantite: 6 }]));
    const r3 = ok(await verifierDoublonsListe("2026-09-18", [{ articleId: art.id, designation: "", quantite: 2 }]));
    expect([r1.avertissements, r2.avertissements, r3.avertissements]).toEqual([[], [], []]);
  });

  it("achat antidaté AVANT un comptage d'inventaire de l'article : signalé (le comptage l'a peut-être déjà compté)", async () => {
    const art = await article("Farine 00");
    const s = await prisma.sessionComptage.create({ data: { date: new Date("2026-09-20T00:00:00Z") } });
    await prisma.ligneComptage.create({ data: { sessionId: s.id, articleId: art.id, designation: "Farine 00", theorique: 10, physique: 12, ecart: 2 } });
    const avant = ok(await verifierDoublonsListe("2026-09-19", [{ articleId: art.id, designation: "", quantite: 2 }]));
    expect(avant.avertissements).toHaveLength(1);
    expect(avant.avertissements[0]).toContain("comptage d'inventaire du 20/09/2026");
    const memeJour = ok(await verifierDoublonsListe("2026-09-20", [{ articleId: art.id, designation: "", quantite: 2 }]));
    expect(memeJour.avertissements).toEqual([]);
  });
});
