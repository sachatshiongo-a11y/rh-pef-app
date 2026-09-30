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
const { genererDonneesRapportDetail, genererDonneesRapport } = await import("@/lib/rapports");

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
    // Borne basse : janvier (non clôturé) précède février (clôturé) → figé lui aussi.
    const r2 = await entreeListeAchat(fd([{ articleId: art.id, quantite: 4 }], { date: "2026-01-20" }));
    expect("erreur" in r2 && r2.erreur).toMatch(/02\/2026 est clôturée : le stock est figé jusqu'à ce mois inclus, aucun mouvement daté du 20\/01\/2026/);
    expect(await prisma.mouvementStock.count({ where: { articleId: art.id } })).toBe(0);
  });

  it("l'achat antidaté compte dans le rapport des achats À SA DATE (indicateurs justes)", async () => {
    const art = await article("Levure");
    ok(await entreeListeAchat(fd([{ articleId: art.id, quantite: 3, montant: 12 }], { date: "2026-04-07" })));
    const avril = await genererDonneesRapportDetail("ACHATS", new Date("2026-04-01T00:00:00Z"), new Date("2026-04-30T00:00:00Z"));
    expect(avril.lignes.some((l) => l[1] === "Levure")).toBe(true);
    // Le rapport suit la règle de l'écran : ni entrée manuelle, ni réception de bon de commande.
    const autre = await article("Entrée hors liste");
    const rec = await prisma.reception.create({ data: {} });
    await prisma.mouvementStock.createMany({ data: [
      { articleId: autre.id, type: "ENTREE", quantite: 1, montantUSD: 100, date: new Date("2026-04-08T00:00:00Z"), origine: "Entrée manuelle" },
      { articleId: autre.id, type: "ENTREE", quantite: 1, montantUSD: 100, date: new Date("2026-04-08T00:00:00Z"), receptionId: rec.id },
    ] });
    const avril2 = await genererDonneesRapportDetail("ACHATS", new Date("2026-04-01T00:00:00Z"), new Date("2026-04-30T00:00:00Z"));
    expect(avril2.lignes.some((l) => l[1] === "Entrée hors liste")).toBe(false);
    const synthese = await genererDonneesRapport("ACHATS", new Date("2026-04-01T00:00:00Z"), new Date("2026-04-30T00:00:00Z"));
    expect(synthese.lignes[0][1]).toBe(12);
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

  it("nom de fournisseur réduit à de la ponctuation : refusé (message renvoyé), rien n'est écrit", async () => {
    const art = await article("Câpres");
    const r = await entreeListeAchat(fd([{ articleId: art.id, quantite: 1, fournisseurNom: " -- . " }]));
    expect(r).toEqual({ erreur: "Nom de fournisseur illisible (ligne 1) : écrivez son nom en lettres ou en chiffres, ou laissez le champ vide." });
    expect(await prisma.mouvementStock.count({ where: { articleId: art.id } })).toBe(0);
    expect(await prisma.fournisseur.count({ where: { nom: { contains: "--" } } })).toBe(0);
  });

  it("Listes envoyées EN MÊME TEMPS avec le même nouveau fournisseur : créé une seule fois", async () => {
    const arts = await Promise.all(["manioc", "maïs", "riz", "blé", "sorgho", "mil"].map((x) => article(`Farine de ${x}`)));
    const noms = ["Marché Gambela", "marché gambela", "MARCHÉ GAMBELA", "Marche Gambela", "marché  gambela", "Marché-Gambela"];
    const rs = await Promise.all(arts.map((a, i) => entreeListeAchat(fd([{ articleId: a.id, quantite: 1, fournisseurNom: noms[i] }]))));
    rs.forEach((r) => ok(r));
    const fs = await prisma.fournisseur.findMany({ where: { nom: { in: noms } } });
    expect(fs).toHaveLength(1);
    const ms = await prisma.mouvementStock.findMany({ where: { articleId: { in: arts.map((a) => a.id) } } });
    expect(new Set(ms.map((m) => m.fournisseurId))).toEqual(new Set([fs[0].id]));
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

  it("fenêtre de ±14 jours, QUELLE QUE SOIT la quantité (même contrôle que celui des Factures, dans l'autre sens)", async () => {
    const art = await article("Beurre");
    const fac = await prisma.factureFournisseur.create({ data: { fournisseurNom: "Laiterie", numero: "L-9", montantUSD: 5, mois: 9, annee: 2026 } });
    await prisma.mouvementStock.create({ data: { articleId: art.id, type: "ENTREE", quantite: 6, date: new Date("2026-09-05T00:00:00Z"), factureId: fac.id } });
    const autreQte = ok(await verifierDoublonsListe("2026-09-05", [{ articleId: art.id, designation: "", quantite: 7 }]));
    expect(autreQte.avertissements).toHaveLength(1);
    expect(autreQte.avertissements[0]).toContain("+6 le 05/09/2026 par la facture L-9 (Laiterie)");
    const n = async (d: string) => ok(await verifierDoublonsListe(d, [{ articleId: art.id, designation: "", quantite: 1 }])).avertissements.length;
    // Bornes incluses : J-14 et J+14 avertissent, J-15 et J+15 non.
    expect([await n("2026-08-22"), await n("2026-09-19"), await n("2026-08-21"), await n("2026-09-20")]).toEqual([1, 1, 0, 0]);
  });

  it("une Liste d'achat déjà enregistrée (double envoi) est signalée à la seconde", async () => {
    const art = await article("Mascarpone");
    const liste = () => fd([{ articleId: art.id, quantite: 2 }], { date: "2026-09-21", origine: "Courses du 21" });
    expect(ok(await entreeListeAchat(liste())).avertissements).toEqual([]);
    const seconde = ok(await entreeListeAchat(liste()));
    expect(seconde.avertissements).toHaveLength(1);
    expect(seconde.avertissements[0]).toContain("+2 le 21/09/2026 par la Liste d'achat « Courses du 21 »");
  });

  it("entrée manuelle, autre article, ou sortie : aucun avertissement", async () => {
    const art = await article("Ricotta");
    const autre = await article("Gorgonzola");
    await prisma.mouvementStock.createMany({ data: [
      { articleId: art.id, type: "ENTREE", quantite: 2, date: new Date("2026-09-22T00:00:00Z"), origine: "Entrée manuelle" },
      { articleId: art.id, type: "SORTIE", quantite: 2, date: new Date("2026-09-22T00:00:00Z"), origine: "Livraison restaurant", categorieSortie: "LIVRAISON_RESTAURANT" },
      { articleId: autre.id, type: "ENTREE", quantite: 2, date: new Date("2026-09-22T00:00:00Z"), origine: "Liste d'achat" },
    ] });
    const r = ok(await verifierDoublonsListe("2026-09-22", [{ articleId: art.id, designation: "", quantite: 2 }]));
    expect(r.avertissements).toEqual([]);
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

describe("devise PAR LIGNE (décision Direction 2026-09-30)", () => {
  // Envoi du formulaire actuel : un champ `devise` par ligne, dans l'ordre des lignes (pas de devise globale).
  const fdParLigne = (lignes: (Ligne & { devise: string })[], date = "2026-09-24") => {
    const f = new FormData();
    f.set("date", date);
    for (const l of lignes) {
      f.append("articleId", l.articleId ?? "");
      f.append("designation", l.designation ?? "");
      f.append("unite", l.unite ?? "");
      f.append("domaine", l.domaine ?? "NOURRITURE");
      f.append("quantite", String(l.quantite));
      f.append("montant", String(l.montant ?? 0));
      f.append("devise", l.devise);
      f.append("fournisseurId", l.fournisseurId ?? "");
      f.append("fournisseurNom", l.fournisseurNom ?? "");
    }
    return f;
  };
  const mvt = (articleId: string) => prisma.mouvementStock.findFirstOrThrow({ where: { articleId } });
  const sansTaux = async <T,>(f: () => Promise<T>) => {
    await prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: 0 } });
    try { return await f(); } finally { await prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: 2800 } }); }
  };

  it("envoi MIXTE : ligne 1 en USD, ligne 2 en CDF → chaque mouvement porte SA devise et SON taux ; USD de la ligne CDF = montant ÷ taux", async () => {
    const a1 = await article("Tomates cerises");
    const a2 = await article("Mangues");
    ok(await entreeListeAchat(fdParLigne([
      { articleId: a1.id, quantite: 3, montant: 30, devise: "USD" },
      { articleId: a2.id, quantite: 5, montant: 28000, devise: "CDF" },
    ])));
    const m1 = await mvt(a1.id);
    expect([m1.devise, Number(m1.montantOrigine), m1.tauxChangeUtilise, Number(m1.montantUSD)]).toEqual(["USD", 30, null, 30]);
    const m2 = await mvt(a2.id);
    expect([m2.devise, Number(m2.montantOrigine), Number(m2.tauxChangeUtilise), Number(m2.montantUSD)]).toEqual(["CDF", 28000, 2800, 10]);
    // Le stock et le prix du catalogue ne changent pas de règle.
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: a2.id } })).quantite)).toBe(5);
  });

  it("ligne LIBRE en CDF : le nouvel article reçoit le PU converti en USD (règle inchangée, devise de SA ligne)", async () => {
    ok(await entreeListeAchat(fdParLigne([
      { designation: "Piment oiseau", unite: "sachet", quantite: 4, montant: 11200, devise: "CDF" },
      { designation: "Gingembre frais", unite: "kg", quantite: 2, montant: 9, devise: "USD" },
    ])));
    const piment = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Piment oiseau" } });
    expect(Number(piment.prixUnitaireUSD)).toBe(1); // 11 200 FC ÷ 2 800 ÷ 4
    const gingembre = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Gingembre frais" } });
    expect(Number(gingembre.prixUnitaireUSD)).toBe(4.5);
  });

  it("une ligne en CDF SANS taux défini : refus lisible qui nomme la ligne, RIEN n'est écrit (même la ligne USD)", async () => {
    const a1 = await article("Citrons verts");
    const a2 = await article("Oranges");
    const a3 = await article("Pamplemousses");
    const r = await sansTaux(() => entreeListeAchat(fdParLigne([
      { articleId: a1.id, quantite: 2, montant: 6, devise: "USD" },
      { articleId: a2.id, quantite: 3, montant: 9000, devise: "CDF" },
      { articleId: a3.id, quantite: 1, montant: 4000, devise: "CDF" },
    ])));
    expect(r).toEqual({ erreur: "Lignes 2, 3 payées en francs (FC) : le taux de change CDF/USD n'est pas défini (Paramètres), la conversion en dollars est impossible. Rien n'a été enregistré — passez ces lignes en USD ou faites définir le taux." });
    expect(await prisma.mouvementStock.count({ where: { articleId: { in: [a1.id, a2.id, a3.id] } } })).toBe(0);
    expect(await prisma.stock.count({ where: { articleId: { in: [a1.id, a2.id, a3.id] } } })).toBe(0);
    const seule = await sansTaux(() => entreeListeAchat(fdParLigne([{ articleId: a2.id, quantite: 3, montant: 9000, devise: "CDF" }])));
    expect(seule).toEqual({ erreur: "Ligne 1 payée en francs (FC) : le taux de change CDF/USD n'est pas défini (Paramètres), la conversion en dollars est impossible. Rien n'a été enregistré — passez la ligne en USD ou faites définir le taux." });
  });

  it("sans taux, une liste TOUTE en USD passe : le taux n'est lu que pour une ligne en francs à convertir", async () => {
    const a = await article("Bananes plantain");
    const b = await article("Noix de coco");
    ok(await sansTaux(() => entreeListeAchat(fdParLigne([
      { articleId: a.id, quantite: 2, montant: 5, devise: "USD" },
      { articleId: b.id, quantite: 1, devise: "CDF" }, // en francs mais SANS montant : rien à convertir
    ]))));
    expect(Number((await mvt(a.id)).montantUSD)).toBe(5);
    const mb = await mvt(b.id);
    expect([mb.devise, mb.montantUSD, mb.tauxChangeUtilise]).toEqual([null, null, null]); // comme avant : pas de montant, pas de devise
  });

  it("ANCIEN envoi (une seule devise globale, onglet ouvert pendant le déploiement) : elle vaut pour toutes les lignes, comme avant", async () => {
    const a1 = await article("Aubergines");
    const a2 = await article("Courgettes");
    ok(await entreeListeAchat(fd([{ articleId: a1.id, quantite: 2, montant: 5600 }, { articleId: a2.id, quantite: 1, montant: 14000 }], { devise: "CDF", date: "2026-09-24" })));
    const m1 = await mvt(a1.id);
    const m2 = await mvt(a2.id);
    expect([m1.devise, Number(m1.tauxChangeUtilise), Number(m1.montantUSD)]).toEqual(["CDF", 2800, 2]);
    expect([m2.devise, Number(m2.tauxChangeUtilise), Number(m2.montantUSD)]).toEqual(["CDF", 2800, 5]);
    // Et en USD global (le défaut d'avant) : rien ne change non plus.
    const a3 = await article("Poivrons");
    ok(await entreeListeAchat(fd([{ articleId: a3.id, quantite: 1, montant: 7 }])));
    const m3 = await mvt(a3.id);
    expect([m3.devise, m3.tauxChangeUtilise, Number(m3.montantUSD)]).toEqual(["USD", null, 7]);
  });

  it("devise autre que USD ou CDF (par ligne ou globale) : refusée, rien n'est écrit", async () => {
    const a1 = await article("Céleri");
    const a2 = await article("Fenouil");
    const r = await entreeListeAchat(fdParLigne([
      { articleId: a1.id, quantite: 1, montant: 3, devise: "USD" },
      { articleId: a2.id, quantite: 1, montant: 3, devise: "EUR" },
    ]));
    expect(r).toEqual({ erreur: "Devise inconnue (ligne 2) : « EUR ». Seules USD et FC (CDF) sont acceptées ; rien n'a été enregistré." });
    const g = await entreeListeAchat(fd([{ articleId: a1.id, quantite: 1, montant: 3 }, { articleId: a2.id, quantite: 1, montant: 3 }], { devise: "usd" as "USD" }));
    expect(g).toEqual({ erreur: "Devise inconnue : « usd ». Seules USD et FC (CDF) sont acceptées ; rien n'a été enregistré." });
    expect(await prisma.mouvementStock.count({ where: { articleId: { in: [a1.id, a2.id] } } })).toBe(0);
  });

  it("autant de devises que de lignes, ou une seule : un autre nombre est refusé (on ne devine jamais la devise d'un montant)", async () => {
    const a = await article("Radis");
    const f = fdParLigne([
      { articleId: a.id, quantite: 1, montant: 3, devise: "USD" },
      { articleId: a.id, quantite: 1, montant: 3, devise: "CDF" },
      { articleId: a.id, quantite: 1, montant: 3, devise: "USD" },
    ]);
    const deux = f.getAll("devise").slice(0, 2);
    f.delete("devise");
    for (const d of deux) f.append("devise", d);
    const r = await entreeListeAchat(f);
    expect(r).toEqual({ erreur: "Formulaire incohérent (une devise par ligne attendue) : rechargez la page et saisissez à nouveau ; rien n'a été enregistré." });
    expect(await prisma.mouvementStock.count({ where: { articleId: a.id } })).toBe(0);
  });
});
