import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import type { ReactElement } from "react";
import { renderToStaticMarkup, renderToReadableStream } from "react-dom/server";
import { formaterUSD } from "@/lib/montant";
import { creerBaseTest } from "@/lib/test/db";
import { whereMouvements, whereColonne } from "@/lib/filtre-mouvements";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — cartes « Entrées de stock » du tableau
// de bord Stock (demande Direction 2026-09-30). Les achats et la facture passent par les VRAIES
// actions (Liste d'achat, facture avec lignes) : les montants figés sont ceux de la production.
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
vi.mock("next/navigation", () => ({
  redirect: () => {},
  usePathname: () => "/stock",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { chargerIndicateursEntrees, ecartDePartition, voitIndicateursEntrees } = await import("./entrees-stock");
const { Prisma } = await import("@prisma/client");
const { entreeListeAchat } = await import("@/app/(stock)/stock/entree/actions");
const { creerFactureAvecLignes } = await import("@/app/(stock)/stock/factures/actions");
const { genererDonneesRapport } = await import("@/lib/rapports");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const jour = (m: number, j: number) => new Date(Date.UTC(2026, m - 1, j));
const ok = <T,>(r: T | { erreur: string }): T => {
  if (r && typeof r === "object" && "erreur" in r) throw new Error(`erreur inattendue : ${(r as { erreur: string }).erreur}`);
  return r as T;
};

type LigneAchat = { articleId: string; quantite: number; montant: number; devise: "USD" | "CDF" };
const listeAchat = (date: string, lignes: LigneAchat[], origine?: string) => {
  const f = new FormData();
  f.set("date", date);
  if (origine) f.set("origine", origine);
  for (const l of lignes) {
    f.append("articleId", l.articleId); f.append("designation", ""); f.append("unite", ""); f.append("domaine", "NOURRITURE");
    f.append("quantite", String(l.quantite)); f.append("montant", String(l.montant)); f.append("devise", l.devise);
    f.append("fournisseurId", ""); f.append("fournisseurNom", "");
  }
  return entreeListeAchat(f);
};
type LigneFac = { articleId: string | null; designation: string; quantite: number; prix: number };
const facture = (date: string, numero: string, lignes: LigneFac[], entrerEnStock: boolean) => {
  const f = new FormData();
  f.set("fournisseurNom", "Grossiste Kin"); f.set("numero", numero); f.set("date", date); f.set("forcerDoublons", "1");
  if (entrerEnStock) f.set("entrerEnStock", "on");
  for (const l of lignes) {
    f.append("ligne_articleId", l.articleId ?? ""); f.append("ligne_designation", l.designation); f.append("ligne_unite", "");
    f.append("ligne_quantite", String(l.quantite)); f.append("ligne_prix", String(l.prix));
  }
  return creerFactureAvecLignes(f);
};

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "kpi@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });
  const art = async (designation: string) => (await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: 9 } })).id;
  const [farine, sucre, sel, huile, riz] = [await art("Farine"), await art("Sucre"), await art("Sel"), await art("Huile"), await art("Riz")];

  // ── Septembre 2026 ──
  // Liste d'achat : 30 $ ; 10 000 FC → 3,5714 $ ; 7 000 FC → 2,50 $ ; une ligne SANS montant.
  ok(await listeAchat("2026-09-05", [{ articleId: farine, quantite: 10, montant: 30, devise: "USD" }, { articleId: sucre, quantite: 3, montant: 10000, devise: "CDF" }]));
  ok(await listeAchat("2026-09-06", [{ articleId: sel, quantite: 2, montant: 7000, devise: "CDF" }, { articleId: riz, quantite: 1, montant: 0, devise: "USD" }], "Marché Gambela"));
  // Facture entrée en stock : 5 × 2,34 + 2 × 7,50 = 26,70 $ en stock ; + transport 20 $ hors catalogue (pas en stock).
  ok(await facture("2026-09-10", "F-1", [
    { articleId: farine, designation: "Farine", quantite: 5, prix: 2.34 },
    { articleId: huile, designation: "Huile", quantite: 2, prix: 7.5 },
    { articleId: null, designation: "Transport", quantite: 1, prix: 20 },
  ], true));
  // Facture purement financière (non entrée en stock) : 100 $ facturés, rien en stock.
  ok(await facture("2026-09-11", "F-2", [{ articleId: riz, designation: "Riz", quantite: 10, prix: 10 }], false));

  const rec = await prisma.reception.create({ data: {} });
  await prisma.mouvementStock.createMany({ data: [
    // Historique sans origine : règle de la Liste d'achat (origine NULL incluse) → Liste d'achat, 1 $.
    { articleId: riz, type: "ENTREE", quantite: 1, montantUSD: 1, date: jour(9, 3) },
    // Autres : réception de bon de commande 50 $, entrée manuelle et correction de stock négatif sans montant.
    { articleId: riz, type: "ENTREE", quantite: 4, montantUSD: 50, date: jour(9, 12), receptionId: rec.id, origine: "Réception BC 001/PEF" },
    { articleId: sel, type: "ENTREE", quantite: 1, date: jour(9, 13), origine: "Entrée manuelle" },
    { articleId: sucre, type: "ENTREE", quantite: 2, date: jour(9, 14), origine: "Correction stock négatif (mise à 0)" },
    // Ni entrées ni achats : un ajustement d'inventaire et une sortie, valorisés exprès.
    { articleId: farine, type: "AJUSTEMENT", quantite: 3, montantUSD: 999, date: jour(9, 15), origine: "Inventaire" },
    { articleId: farine, type: "SORTIE", quantite: 3, montantUSD: 500, date: jour(9, 15), categorieSortie: "PERTE", raisonSortie: "x" },
  ] });
  // Légumes (hors stock) : 15,50 $ et un achat en francs SANS équivalent USD figé.
  await prisma.achatLegume.createMany({ data: [
    { date: jour(9, 8), legume: "Tomates fraiches", quantite: 5, montantCDF: 43400, montantUSD: 15.5, tauxChangeUtilise: 2800 },
    { date: jour(9, 9), legume: "Oignons", quantite: 2, montantCDF: 5000 },
  ] });

  // ── Août 2026 : ne doit rien changer à septembre ──
  ok(await listeAchat("2026-08-20", [{ articleId: farine, quantite: 100, montant: 1000, devise: "USD" }]));
  await prisma.mouvementStock.create({ data: { articleId: riz, type: "ENTREE", quantite: 1, montantUSD: 70, date: jour(8, 21), receptionId: rec.id } });
  await prisma.achatLegume.create({ data: { date: jour(8, 22), legume: "Ail", quantite: 1, montantUSD: 4 } });
}, 300_000);

afterAll(async () => { await fermer?.(); });

const SEPT_DEBUT = jour(9, 1), SEPT_FIN = jour(9, 30);
const septembre = () => chargerIndicateursEntrees(2026, 9);

describe("Entrées de stock — septembre 2026", () => {
  it("chaque indicateur, posé à la main ; 1 = 2 + 3 + 4 au centime", async () => {
    const i = await septembre();
    expect(i.libellePeriode).toBe("septembre 2026");
    expect(i.cleMois).toBe("2026-9");
    // Liste d'achat : 30 + 3,5714 + 2,50 + 1 (historique) = 37,0714 → 37,07 ; 5 entrées dont 1 sans valeur.
    expect(i.achats).toEqual({ montant: 37.07, nb: 5, nbSansValeur: 1 });
    // Factures : 11,70 + 15,00 — le transport (hors catalogue) et la facture non entrée n'y sont pas.
    expect(i.factures).toEqual({ montant: 26.7, nb: 2, nbSansValeur: 0 });
    // Autres : réception 50 $ ; entrée manuelle et correction sans valeur.
    expect(i.autres).toEqual({ montant: 50, nb: 3, nbSansValeur: 2 });
    // Total : ni l'ajustement (999 $) ni la sortie (500 $) ni les légumes.
    expect(i.total).toEqual({ montant: 113.77, nb: 10, nbSansValeur: 3 });
    expect(Math.round(i.total.montant * 100)).toBe(Math.round(i.achats.montant * 100) + Math.round(i.factures.montant * 100) + Math.round(i.autres.montant * 100));
    expect(i.ecart).toBeNull();
  });

  it("les trois catégories partagent TOUTES les entrées du mois, sans recouvrement ; chaque carte compte la liste que son lien ouvre", async () => {
    const ids = async (motif: "entrees" | "achats" | "factures" | "autres") =>
      (await prisma.mouvementStock.findMany({ where: whereMouvements({ mois: "2026-9", articleId: null, motif }), select: { id: true } })).map((m) => m.id);
    const [toutes, achats, factures, autres] = [await ids("entrees"), await ids("achats"), await ids("factures"), await ids("autres")];
    expect([...achats, ...factures, ...autres].sort()).toEqual([...toutes].sort());
    expect(new Set([...achats, ...factures, ...autres]).size).toBe(achats.length + factures.length + autres.length);
    const vraies = await prisma.mouvementStock.count({ where: { type: "ENTREE", date: { gte: SEPT_DEBUT, lt: jour(10, 1) } } });
    expect(toutes.length).toBe(vraies);
    // Le lien d'une carte ouvre Mouvements filtré (mois + motif) : la colonne Entrées compte le même nombre.
    const i = await septembre();
    for (const motif of ["entrees", "achats", "factures", "autres"] as const) {
      const attendu = motif === "entrees" ? i.total.nb : i[motif].nb;
      expect(await prisma.mouvementStock.count({ where: whereColonne({ mois: "2026-9", articleId: null, motif }, "ENTREES") }), motif).toBe(attendu);
    }
  });

  it("égal aux rapports existants du même mois : « Achats (liste d'achat) » et « Factures fournisseurs »", async () => {
    const i = await septembre();
    const achats = await genererDonneesRapport("ACHATS", SEPT_DEBUT, SEPT_FIN);
    expect(achats.lignes).toHaveLength(1);
    expect(i.achats.montant).toBe(achats.lignes[0][1]);
    const factures = await genererDonneesRapport("FACTURES", SEPT_DEBUT, SEPT_FIN);
    // Facturé 46,70 (dont 20 $ de transport hors stock) + 100 $ non entrés = 146,70 : ≠ entrées par facture, annoncé.
    expect(i.facture).toEqual({ montant: 146.7, nb: 2 });
    expect(i.facture.montant).toBe(factures.lignes[0][1]);
  });

  it("« partiel » : les entrées sans montant USD figé sont comptées à part, jamais pour zéro", async () => {
    const i = await septembre();
    const sansValeur = await prisma.mouvementStock.count({ where: { type: "ENTREE", montantUSD: null, date: { gte: SEPT_DEBUT, lt: jour(10, 1) } } });
    expect(sansValeur).toBe(3);
    expect(i.total.nbSansValeur).toBe(sansValeur);
    expect(i.achats.nbSansValeur + i.factures.nbSansValeur + i.autres.nbSansValeur).toBe(sansValeur);
  });

  it("les légumes frais (hors stock) n'entrent pas dans le total", async () => {
    const avant = (await septembre()).total;
    expect(avant.montant).toBe(113.77);
    await prisma.achatLegume.create({ data: { date: jour(9, 20), legume: "Persil", quantite: 1, montantUSD: 1000 } });
    try {
      expect((await septembre()).total).toEqual(avant);
    } finally {
      await prisma.achatLegume.deleteMany({ where: { legume: "Persil" } });
    }
  });
});

describe("contrôle de la partition (jamais masqué)", () => {
  const D = (v: string) => new Prisma.Decimal(v);
  it("rien ne manque ni ne compte deux fois → pas d'écart, même quand l'arrondi des parts aurait pu en inventer un", () => {
    expect(ecartDePartition({ exact: D("10.0015"), nb: 3 }, [{ exact: D("3.0005"), nb: 1 }, { exact: D("3.0005"), nb: 1 }, { exact: D("4.0005"), nb: 1 }])).toBeNull();
  });
  it("une entrée hors catégorie → écart positif ; une entrée comptée deux fois → écart négatif ; une entrée sans valeur oubliée → écart de nombre", () => {
    expect(ecartDePartition({ exact: D("62.5"), nb: 3 }, [{ exact: D("50"), nb: 2 }, { exact: D("0"), nb: 0 }])).toEqual({ montant: 12.5, nb: 1 });
    expect(ecartDePartition({ exact: D("50"), nb: 2 }, [{ exact: D("50"), nb: 2 }, { exact: D("12.5"), nb: 1 }])).toEqual({ montant: -12.5, nb: -1 });
    expect(ecartDePartition({ exact: D("50"), nb: 3 }, [{ exact: D("50"), nb: 2 }])).toEqual({ montant: 0, nb: 1 });
  });
});

describe("le mois reçu est respecté", () => {
  it("août ne voit que les entrées d'août ; un mois vide vaut zéro entrée ; un mois invalide est refusé (jamais « tout l'historique »)", async () => {
    const aout = await chargerIndicateursEntrees(2026, 8);
    expect(aout.libellePeriode).toBe("août 2026");
    expect(aout.cleMois).toBe("2026-8");
    expect(aout.achats).toEqual({ montant: 1000, nb: 1, nbSansValeur: 0 });
    expect(aout.autres).toEqual({ montant: 70, nb: 1, nbSansValeur: 0 });
    expect(aout.factures).toEqual({ montant: 0, nb: 0, nbSansValeur: 0 });
    expect(aout.facture).toEqual({ montant: 0, nb: 0 });
    expect(aout.total).toEqual({ montant: 1070, nb: 2, nbSansValeur: 0 });
    expect((await chargerIndicateursEntrees(2026, 7)).total).toEqual({ montant: 0, nb: 0, nbSansValeur: 0 });
    for (const [a, m] of [[2026, 0], [2026, 13], [2026, 9.5], [Number.NaN, 9]]) {
      await expect(chargerIndicateursEntrees(a, m)).rejects.toThrow(/Mois invalide/);
    }
  });
});

describe("droits : les mêmes que les autres montants du tableau de bord (espace Stock)", () => {
  it.each([
    [{ role: "ADMIN" as Role }, true],
    [{ role: "STOCK" as Role }, true],
    [{ role: "EMPLOYE" as Role, accesStock: true }, true],
    [{ role: "EMPLOYE" as Role, accesStock: false }, false],
    [{ role: "MANAGER" as Role }, false],
    [{ role: "VIEWER" as Role }, false],
    [{ role: "COMPTA" as Role }, false],
  ])("%j → montants visibles : %s", (user, visible) => {
    expect(voitIndicateursEntrees(user)).toBe(visible);
  });

  it("sans droit, le composant n'affiche rien et ne lit rien", async () => {
    const { CartesEntreesStock } = await import("@/app/(stock)/stock/_tableau-de-bord/cartes-entrees-stock");
    const espion = vi.spyOn(prisma.mouvementStock, "aggregate");
    try {
      expect(await rendreEnFlux(<CartesEntreesStock annee={2026} mois={9} voitMontants={false} />)).toBe("");
      expect(espion).not.toHaveBeenCalled();
    } finally {
      espion.mockRestore();
    }
  });
});

/** Rendu serveur COMPLET (composants asynchrones sous Suspense résolus), comme le flux de Next. */
async function rendreEnFlux(el: ReactElement): Promise<string> {
  const flux = await renderToReadableStream(el);
  await flux.allReady;
  return await new Response(flux).text();
}
const texte = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s\u00a0\u202f]+/g, " ");

describe("tableau de bord Stock rendu sur la base", () => {
  it("les cartes y figurent, pour le mois du tableau de bord, avec les chiffres du calcul et des liens sur ce mois", async () => {
    const { default: StockDashboard } = await import("@/app/(stock)/stock/page");
    const n = new Date();
    const [annee, mois] = [n.getFullYear(), n.getMonth() + 1]; // mois du tableau de bord (heure locale, comme la page)
    // Une entrée valorisée ce mois-ci, quel que soit le jour où le test tourne.
    const riz = (await prisma.articleStock.findFirstOrThrow({ where: { designation: "Riz" } })).id;
    const mv = await prisma.mouvementStock.create({ data: { articleId: riz, type: "ENTREE", quantite: 1, montantUSD: 12.34, date: new Date(Date.UTC(annee, mois - 1, 2)), origine: "Liste d'achat" } });
    try {
      const i = await chargerIndicateursEntrees(annee, mois);
      const html = await rendreEnFlux(await StockDashboard());
      const t = texte(html);
      expect(t).toContain(`Entrées de stock · ${i.libellePeriode}`);
      expect(t).toContain(`Total des entrées de stock ${formaterUSD(i.total.montant)} ${i.total.nb} entrée(s)`);
      expect(t).toContain(`dont Liste d'achat ${formaterUSD(i.achats.montant)} ${i.achats.nb} entrée(s)`);
      expect(html).toContain(`href="/stock/mouvements?mois=${i.cleMois}&amp;motif=entrees"`);
      expect(html).toContain(`href="/stock/mouvements?mois=${i.cleMois}&amp;motif=achats"`);
      expect(html).toContain(`href="/stock/mouvements?mois=${i.cleMois}&amp;motif=factures"`);
      // Rendu synchrone (ancien test de l'accueil) : la page ne casse pas, les cartes attendent sous Suspense.
      expect(texte(renderToStaticMarkup(await StockDashboard()))).toContain("Entrées de stock : chargement…");
    } finally {
      await prisma.mouvementStock.delete({ where: { id: mv.id } });
    }
  }, 60_000);

  it("un compte STOCK les voit aussi (mêmes droits que « Valeur du stock » ou « Factures à payer »)", async () => {
    A.user.role = "STOCK";
    try {
      const { default: StockDashboard } = await import("@/app/(stock)/stock/page");
      const t = texte(await rendreEnFlux(await StockDashboard()));
      expect(t).toContain("Factures à payer");
      expect(t).toContain("Total des entrées de stock");
    } finally {
      A.user.role = "ADMIN";
    }
  }, 60_000);
});
