import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// FICHE FOURNISSEUR EN ONGLETS (demande de la Direction, 2026-10-01) : rendu de la VRAIE page sur
// une base éphémère. Ce qu'on tient ici :
//  - onglet par défaut (Factures) et valeur inconnue ; l'onglet et le filtre viennent de l'URL ;
//  - seules les données de l'onglet affiché sont lues (espionnage des requêtes, pas du markup) ;
//  - filtres À régler / Payées / Toutes et En cours / Reçus / Tous ;
//  - regroupement par mois, le plus récent ouvert ;
//  - la pastille « Paiement demandé » reste sur sa facture ;
//  - les liens vers une facture / un bon portent le retour vers le bon onglet.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "fiche@pef.cd", accesStock: false, employeeId: null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...vrai, verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} };
});
// Les composants clients n'appellent leurs actions qu'au clic : ici, rendu seul.
vi.mock("../../factures/actions", () => ({ marquerPayee: async () => ({}), supprimerFacture: async () => ({}), marquerPayeesEnLot: async () => ({}), supprimerFacturesEnLot: async () => ({}) }));
vi.mock("../../commandes/actions", () => ({ validerBonsEnLot: async () => ({}), supprimerBonsEnLot: async () => ({}), changerStatutBonCommande: async () => {}, validerBonCommande: async () => {}, supprimerBonCommande: async () => {} }));
vi.mock("next/navigation", async () => {
  const vrai = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...vrai, useRouter: () => ({ push: () => {}, refresh: () => {} }) };
});

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let idF: string, idG: string, idFactureSept: string, idBonValide: string;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const texte = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");

async function rendre(sp: Record<string, string | string[]> = {}, id = idF): Promise<string> {
  const { default: Page } = await import("./page");
  const element = await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) });
  return renderToStaticMarkup(element);
}

/** Les requêtes de CONTENU d'onglet qu'un rendu a posées sur chaque table. */
function espionner() {
  const ap = {
    factures: vi.spyOn(prisma.factureFournisseur, "findMany"),
    bons: vi.spyOn(prisma.bonDeCommande, "findMany"),
    achats: vi.spyOn(prisma.mouvementStock, "findMany"),
    articles: vi.spyOn(prisma.articleStock, "findMany"),
  };
  return ap;
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "fiche@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;

  const f = await prisma.fournisseur.create({ data: { nom: "SENEVE", telephone: "+243 810 000 000", ville: "Lubumbashi" } });
  const g = await prisma.fournisseur.create({ data: { nom: "AUTRE SARL" } });
  idF = f.id; idG = g.id;

  const fac = (numero: string, annee: number, mois: number, statut: "A_REGLER" | "ECHUE_NON_REGLEE" | "REGLEE", montant: number, reste: number, fournisseurId = f.id) =>
    prisma.factureFournisseur.create({ data: { fournisseurId, fournisseurNom: fournisseurId === f.id ? "SENEVE" : "AUTRE SARL", numero, annee, mois, date: d(`${annee}-${String(mois).padStart(2, "0")}-10`), montantUSD: montant, resteAPayerUSD: reste, montantRegleUSD: montant - reste, statut } });
  const s1 = await fac("F-SEPT-1", 2026, 9, "A_REGLER", 100, 100);
  const s2 = await fac("F-SEPT-2", 2026, 9, "ECHUE_NON_REGLEE", 50, 50);
  await fac("F-AOUT-1", 2026, 8, "REGLEE", 200, 0);
  await fac("F-JUIL-1", 2026, 7, "A_REGLER", 30, 30);
  await fac("G-UNIQUE", 2026, 9, "A_REGLER", 999, 999, g.id);
  idFactureSept = s1.id;

  // Un paiement demandé à la Direction sur F-SEPT-2.
  const dem = await prisma.demandeValidationStock.create({ data: { nature: "PAIEMENT_FACTURE", resume: "Facture F-SEPT-2", charge: {}, auteurId: u.id, auteurNom: "Magasinier" } });
  await prisma.cibleDemandeStock.create({ data: { cle: `FACTURE:${s2.id}`, demandeId: dem.id } });

  const bon = (numero: string, sequence: number, statut: "BROUILLON" | "VALIDE" | "ENVOYE" | "RECU_PARTIEL" | "RECU" | "ANNULE", date: string, fournisseurId = f.id) =>
    prisma.bonDeCommande.create({ data: { numero, sequence, annee: 2026, mois: Number(date.slice(5, 7)), date: d(date), fournisseurId, statut, totalUSD: 10 * sequence } });
  await bon("BC-BROUILLON", 1, "BROUILLON", "2026-09-05");
  idBonValide = (await bon("BC-VALIDE", 2, "VALIDE", "2026-08-05")).id;
  await bon("BC-ENVOYE", 3, "ENVOYE", "2026-08-06");
  await bon("BC-PARTIEL", 4, "RECU_PARTIEL", "2026-07-06");
  await bon("BC-RECU", 5, "RECU", "2026-07-07");
  await bon("BC-ANNULE", 6, "ANNULE", "2026-07-08");
  await bon("BC-DE-G", 7, "VALIDE", "2026-09-09", g.id);

  const a = await prisma.articleStock.create({ data: { designation: "Farine T55", domaine: "NOURRITURE", unite: "kg", fournisseurId: f.id } });
  await prisma.stock.create({ data: { articleId: a.id, quantite: 10, stockMinimum: 2 } });
  await prisma.mouvementStock.create({ data: { articleId: a.id, type: "ENTREE", quantite: 5, date: d("2026-09-01"), origine: "Liste d'achat", fournisseurId: f.id, montantUSD: 12 } });
});
afterAll(async () => { await fermer(); });
afterEach(() => { vi.restoreAllMocks(); A.user.role = "ADMIN"; });

describe("onglet par défaut et valeur inconnue", () => {
  it("sans ?onglet : Factures est l'onglet actif, filtre À régler", async () => {
    const html = await rendre();
    const t = texte(html);
    expect(html).toMatch(/aria-current="page"[^>]*>Factures \(4\)</);
    expect(t).toContain("À régler (3)"); // F-SEPT-1, F-SEPT-2, F-JUIL-1 ; G-UNIQUE appartient à un autre fournisseur
    expect(t).toContain("N° F-SEPT-1");
    expect(t).not.toContain("F-AOUT-1"); // payée : hors du filtre par défaut
    expect(t).not.toContain("G-UNIQUE");
  });
  it("?onglet=nimporte-quoi retombe sur Factures", async () => {
    const html = await rendre({ onglet: "nimporte-quoi" });
    expect(html).toMatch(/aria-current="page"[^>]*>Factures \(4\)</);
    expect(texte(html)).toContain("N° F-SEPT-1");
  });
  it("les cinq onglets portent leur nombre ; Coordonnées n'en porte pas", async () => {
    const html = await rendre();
    for (const lib of ["Factures (4)", "Bons de commande (6)", "Achats directs (1)", "Articles (1)", "Coordonnées"]) expect(html).toContain(`>${lib}</a>`);
    expect(html).toContain(`href="/stock/fournisseurs/${idF}?onglet=bons"`);
    expect(html).toContain(`href="/stock/fournisseurs/${idF}?onglet=coordonnees"`);
  });
  it("les KPIs de factures restent au-dessus des onglets, quel que soit l'onglet", async () => {
    for (const onglet of ["factures", "bons", "achats", "articles", "coordonnees"]) {
      const t = texte(await rendre({ onglet }));
      expect(t, onglet).toContain("Total facturé 380,00 $"); // 100 + 50 + 200 + 30
      expect(t, onglet).toContain("Réglé 200,00 $");
      expect(t, onglet).toContain("Impayé (3) 180,00 $");
      expect(t, onglet).toContain("Échu (1) 50,00 $");
    }
  });
});

describe("seules les données de l'onglet affiché sont lues", () => {
  const attendu: Record<string, ("factures" | "bons" | "achats" | "articles")[]> = {
    factures: ["factures"], bons: ["bons"], achats: ["achats"], articles: ["articles"], coordonnees: [],
  };
  for (const [onglet, lus] of Object.entries(attendu)) {
    it(`?onglet=${onglet} : lit ${lus.length ? lus.join(", ") : "aucune liste"}`, async () => {
      const sp = espionner();
      await rendre({ onglet });
      for (const [nom, spy] of Object.entries(sp)) {
        expect(spy.mock.calls.length > 0, `${nom} lu pour l'onglet ${onglet}`).toBe((lus as string[]).includes(nom));
      }
    });
  }
  it("un onglet inconnu ne lit que les factures", async () => {
    const sp = espionner();
    await rendre({ onglet: "zzz" });
    expect(sp.factures).toHaveBeenCalledTimes(1);
    expect(sp.bons).not.toHaveBeenCalled();
    expect(sp.achats).not.toHaveBeenCalled();
    expect(sp.articles).not.toHaveBeenCalled();
  });
  it("la requête de factures est bornée à CE fournisseur et plafonnée", async () => {
    const sp = espionner();
    await rendre();
    const arg = sp.factures.mock.calls[0][0] as { where: { fournisseurId: string }; take: number };
    expect(arg.where.fournisseurId).toBe(idF);
    expect(arg.take).toBe(500);
  });
});

describe("onglet Factures : filtres, mois, pastilles", () => {
  it("Payées : seulement les réglées", async () => {
    const t = texte(await rendre({ onglet: "factures", filtre: "payees" }));
    expect(t).toContain("N° F-AOUT-1");
    expect(t).not.toContain("F-SEPT-1");
    expect(t).not.toContain("F-JUIL-1");
  });
  it("Toutes : les quatre, à plat sur trois mois", async () => {
    const t = texte(await rendre({ onglet: "factures", filtre: "toutes" }));
    for (const n of ["F-SEPT-1", "F-SEPT-2", "F-AOUT-1", "F-JUIL-1"]) expect(t).toContain(`N° ${n}`);
    expect(t).toContain("Septembre 2026");
    expect(t).toContain("Août 2026");
    expect(t).toContain("Juillet 2026");
  });
  it("filtre inconnu → À régler", async () => {
    const t = texte(await rendre({ onglet: "factures", filtre: "bidon" }));
    expect(t).toContain("N° F-SEPT-1");
    expect(t).not.toContain("F-AOUT-1");
  });
  it("regroupées par mois, le plus récent ouvert et lui seul", async () => {
    const html = await rendre({ onglet: "factures", filtre: "toutes" });
    const details = [...html.matchAll(/<details([^>]*)>\s*<summary[^>]*>.*?<span class="capitalize">([^<]+)<\/span>/g)].map((m) => ({ ouvert: /\bopen\b/.test(m[1]), titre: m[2] }));
    expect(details.map((x) => x.titre)).toEqual(["Septembre 2026", "Août 2026", "Juillet 2026"]);
    expect(details.map((x) => x.ouvert)).toEqual([true, false, false]);
  });
  it("À régler : tous les mois déroulés (comme les impayés de l'écran Factures) ; Payées et Toutes : le plus récent seul", async () => {
    const ouverts = (html: string) => [...html.matchAll(/<details([^>]*)>\s*<summary/g)].map((m) => /\bopen\b/.test(m[1]));
    expect(ouverts(await rendre({ onglet: "factures" }))).toEqual([true, true]); // septembre et juillet
    expect(ouverts(await rendre({ onglet: "factures", filtre: "a-regler" }))).toEqual([true, true]);
    expect(ouverts(await rendre({ onglet: "factures", filtre: "toutes" }))).toEqual([true, false, false]);
    expect(ouverts(await rendre({ onglet: "factures", filtre: "payees" }))).toEqual([true]);
  });
  it("la pastille « Paiement demandé » reste sur sa facture, et seulement sur elle", async () => {
    const html = await rendre({ onglet: "factures", filtre: "toutes" });
    expect(html.match(/Paiement demandé — en attente de la Direction/g)).toHaveLength(1);
    const ligne = html.split("<li ").find((l) => l.includes("F-SEPT-2"))!;
    expect(ligne).toContain("Paiement demandé — en attente de la Direction");
    const autre = html.split("<li ").find((l) => l.includes("F-SEPT-1"))!;
    expect(autre).not.toContain("Paiement demandé");
  });
  it("chaque ligne a sa case à cocher ; la barre d'actions groupées est là ; le nom du fournisseur n'est pas répété", async () => {
    const html = await rendre({ onglet: "factures", filtre: "toutes" });
    expect(html.match(/type="checkbox"/g)!.length).toBe(4 + 1); // 4 lignes + « Tout sélectionner »
    expect(html).toContain("Tout sélectionner");
    expect(html).not.toContain(`href="/stock/fournisseurs/${idF}" class="truncate`);
  });
  it("À régler vide mais des payées : l'écran le dit et propose Toutes", async () => {
    await prisma.factureFournisseur.updateMany({ where: { fournisseurId: idG }, data: { statut: "REGLEE", resteAPayerUSD: 0 } });
    const t = texte(await rendre({ onglet: "factures" }, idG));
    expect(t).toContain("Aucune facture à régler : tout est payé.");
    expect(t).toContain("Voir toutes les factures (1)");
    await prisma.factureFournisseur.updateMany({ where: { fournisseurId: idG }, data: { statut: "A_REGLER", resteAPayerUSD: 999 } });
  });
  it("les liens Détail portent le retour vers l'onglet et le filtre d'origine", async () => {
    const html = await rendre({ onglet: "factures", filtre: "payees" });
    const retour = encodeURIComponent(`/stock/fournisseurs/${idF}?onglet=factures&filtre=payees`);
    expect(html).toMatch(new RegExp(`href="/stock/factures/[0-9a-f-]{36}\\?retour=${retour.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  });
});

describe("onglet Bons de commande : filtres et mois", () => {
  it("En cours (défaut) : brouillon, validé, envoyé, reçu partiel — ni reçu ni annulé", async () => {
    const t = texte(await rendre({ onglet: "bons" }));
    for (const n of ["BC-BROUILLON", "BC-VALIDE", "BC-ENVOYE", "BC-PARTIEL"]) expect(t).toContain(n);
    expect(t).not.toContain("BC-RECU");
    expect(t).not.toContain("BC-ANNULE");
    expect(t).not.toContain("BC-DE-G");
    expect(t).toContain("En cours (4)");
    expect(t).toContain("Reçus (1)");
    expect(t).toContain("Tous (6)");
  });
  it("Reçus : seulement ceux reçus en totalité", async () => {
    const t = texte(await rendre({ onglet: "bons", filtre: "recus" }));
    expect(t).toContain("BC-RECU");
    expect(t).not.toContain("BC-PARTIEL");
    expect(t).not.toContain("BC-VALIDE");
  });
  it("Tous : les annulés n'apparaissent que là", async () => {
    const t = texte(await rendre({ onglet: "bons", filtre: "tous" }));
    expect(t).toContain("BC-ANNULE");
    expect(t).toContain("BC-RECU");
    expect(t).toContain("BC-BROUILLON");
  });
  it("regroupés par mois, le plus récent ouvert", async () => {
    const html = await rendre({ onglet: "bons", filtre: "tous" });
    const details = [...html.matchAll(/<details([^>]*)>\s*<summary[^>]*>.*?<span class="capitalize">([^<]+)<\/span>/g)].map((m) => ({ ouvert: /\bopen\b/.test(m[1]), titre: m[2] }));
    expect(details.map((x) => x.titre)).toEqual(["Septembre 2026", "Août 2026", "Juillet 2026"]);
    expect(details.map((x) => x.ouvert)).toEqual([true, false, false]);
  });
  it("les liens vers un bon portent le retour vers l'onglet Bons ; un filtre non défaut est conservé", async () => {
    const html = await rendre({ onglet: "bons", filtre: "tous" });
    const retour = encodeURIComponent(`/stock/fournisseurs/${idF}?onglet=bons&filtre=tous`);
    expect(html).toContain(`href="/stock/commandes/${idBonValide}?retour=${retour}"`);
  });
});

describe("Achats directs, Articles, Coordonnées : contenu inchangé", () => {
  it("Achats directs", async () => {
    const t = texte(await rendre({ onglet: "achats" }));
    expect(t).toContain("Achats directs — Liste d'achat (1)");
    expect(t).toContain("Farine T55");
    expect(t).toContain("+5");
  });
  it("Articles", async () => {
    const t = texte(await rendre({ onglet: "articles" }));
    expect(t).toContain("Articles fournis (1)");
    expect(t).toContain("Farine T55");
  });
  it("Coordonnées", async () => {
    const t = texte(await rendre({ onglet: "coordonnees" }));
    expect(t).toContain("Lubumbashi");
    expect(t).toContain("+243 810 000 000");
  });
});

describe("liens de retour des pages Facture et Bon de commande", () => {
  it("la facture ouverte depuis la fiche y ramène, sur le bon onglet ; sans retour valide, l'écran Factures", async () => {
    const retour = `/stock/fournisseurs/${idF}?onglet=factures&filtre=payees`;
    const { default: Page } = await import("../../factures/[id]/page");
    const avec = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: idFactureSept }), searchParams: Promise.resolve({ retour }) }));
    expect(avec).toContain(`href="${retour.replace(/&/g, "&amp;")}"`);
    expect(avec).toContain("← Retour");
    const sans = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: idFactureSept }), searchParams: Promise.resolve({}) }));
    expect(sans).toContain('href="/stock/factures"');
    // Retour vers la fiche d'un AUTRE fournisseur ou vers un autre site : ignoré.
    for (const faux of [`/stock/fournisseurs/${idG}?onglet=factures`, "https://faux-site.example"]) {
      const h = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: idFactureSept }), searchParams: Promise.resolve({ retour: faux }) }));
      expect(h).not.toContain("faux-site");
      expect(h).not.toContain(`/stock/fournisseurs/${idG}`);
      expect(h).toContain('href="/stock/factures"');
    }
  });
  it("le bon ouvert depuis la fiche y ramène (fil d'Ariane)", async () => {
    const retour = `/stock/fournisseurs/${idF}?onglet=bons`;
    const { default: Page } = await import("../../commandes/[id]/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: idBonValide }), searchParams: Promise.resolve({ retour }) }));
    expect(html).toContain(`href="${retour}"`);
    const sans = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: idBonValide }), searchParams: Promise.resolve({}) }));
    expect(sans).toContain('href="/stock/commandes"');
  });
});
