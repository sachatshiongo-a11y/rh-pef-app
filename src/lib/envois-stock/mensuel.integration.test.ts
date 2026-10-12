import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { creerBaseTest } from "@/lib/test/db";
import type { Espion } from "@/lib/test/espion-ecritures";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — le RAPPORT MENSUEL du Stock (Direction, 2026-10-12),
// le 1er du mois, sur le mois écoulé : contenu de chaque rubrique sur des données de test, mêmes chiffres que les
// fonctions qui alimentent les écrans, dollars et francs additionnés séparément, « partiel » annoncé, refus sans
// jeton, destinataires par rôle, aucune écriture.
const E = vi.hoisted(() => ({ espion: undefined as unknown as Espion }));
const M = vi.hoisted(() => ({ email: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", async () => {
  const { creerEspion, proxyEspion } = await import("@/lib/test/espion-ecritures");
  E.espion = creerEspion();
  return { prisma: proxyEspion(E.espion) };
});
vi.mock("@/lib/email", () => ({ envoyerEmail: M.email }));

const { preparerRapportMensuel, moisEcoule } = await import("./mensuel");
const { GET } = await import("@/app/api/cron/stock-mensuel/route");
const { indicateursStock } = await import("@/lib/indicateurs/stock");
const { chargerEcartsVentes, chargerEcartsVentesPeriode } = await import("@/app/(stock)/stock/journalier/ecarts-data");
const { texteValeurEcart, texteQuantiteEcart } = await import("@/lib/ecarts-ventes-presentation");
const { chargerHausses } = await import("@/lib/inventaire-export");
const { chargerPrixParFournisseur } = await import("@/lib/article-fournisseurs");
const { totalFactures, libelleTotal } = await import("@/lib/facture-devise");
const { formaterUSD } = await import("@/lib/montant");
const { libelleArticle } = await import("@/lib/libelle-article");
const { prisma: prismaEspionne } = await import("@/lib/prisma");

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
// Dimanche 1er novembre 2026, 07 h à Kinshasa (06 h UTC) : le rapport parle d'octobre 2026.
const LE_PREMIER = new Date("2026-11-01T06:00:00Z");
const norm = (s: string) => s.replace(/[\s  ]+/g, " ");
const SECRET = "secret-de-test-stock";
let fermer: () => Promise<void>;
let ids: Record<string, string> = {};

async function empreinte(): Promise<string> {
  const c = E.espion.client;
  return JSON.stringify(await Promise.all([
    c.user.findMany({ orderBy: { id: "asc" } }), c.articleStock.findMany({ orderBy: { id: "asc" } }), c.stock.findMany({ orderBy: { id: "asc" } }),
    c.mouvementStock.findMany({ orderBy: { id: "asc" } }), c.factureFournisseur.findMany({ orderBy: { id: "asc" } }), c.ligneFacture.findMany({ orderBy: { id: "asc" } }),
    c.articleFournisseur.findMany({ orderBy: { id: "asc" } }), c.comptageResto.findMany({ orderBy: { id: "asc" } }), c.venteJournaliere.findMany({ orderBy: { id: "asc" } }),
    c.clotureStock.findMany({ orderBy: { id: "asc" } }), c.notification.findMany({ orderBy: { id: "asc" } }), c.journalAudit.findMany({ orderBy: { id: "asc" } }), c.config.findMany(),
  ]));
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LE_PREMIER);
  const db = await creerBaseTest();
  fermer = db.fermer; E.espion.client = db.prisma;
  const p = db.prisma;
  await p.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  await p.user.create({ data: { email: "direction@pef.cd", nom: "Direction", role: "ADMIN" } });
  await p.user.create({ data: { email: "stock@pef.cd", nom: "Stock", role: "STOCK" } });
  await p.user.create({ data: { email: "rh@pef.cd", nom: "RH", role: "MANAGER" } });

  const fA = (await p.fournisseur.create({ data: { nom: "Fournisseur A" } })).id;
  const fB = (await p.fournisseur.create({ data: { nom: "Fournisseur B" } })).id;
  ids = { fA, fB };

  // — Catalogue : farine (2 $, marque), gin (35 $, 70 cl), épice SANS prix —
  const farine = (await p.articleStock.create({ data: { designation: "Farine T55", marque: "Grands Moulins", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: 2 } })).id;
  const gin = (await p.articleStock.create({ data: { designation: "Gin", domaine: "BOISSON", unite: "bouteille", contenance: "70", contenanceUnite: "cl", prixUnitaireUSD: 35 } })).id;
  const epice = (await p.articleStock.create({ data: { designation: "Épice", domaine: "NOURRITURE", unite: "kg" } })).id;
  Object.assign(ids, { farine, gin, epice });
  await p.stock.createMany({ data: [{ articleId: farine, quantite: 10 }, { articleId: gin, quantite: 2 }, { articleId: epice, quantite: 4 }] });
  await p.articleFournisseur.createMany({ data: [{ articleId: farine, fournisseurId: fA, habituel: true }, { articleId: farine, fournisseurId: fB }] });

  // — Factures : septembre (hors mois), puis octobre —
  const facture = (data: Record<string, unknown>, lignes: { articleId: string; designation: string; quantite: number; prix: number }[] = []) =>
    p.factureFournisseur.create({
      data: {
        mois: 10, annee: 2026, statut: "A_REGLER", ...data,
        ...(lignes.length ? { lignes: { create: lignes.map((l) => ({ articleId: l.articleId, designation: l.designation, quantite: l.quantite, prixUnitaireUSD: l.prix })) } } : {}),
      } as never,
    });
  await facture({ fournisseurId: fA, fournisseurNom: "Fournisseur A", numero: "A-0", devise: "USD", date: d("2026-09-10"), mois: 9, montantUSD: 10, resteAPayerUSD: 0, statut: "REGLEE" }, [{ articleId: farine, designation: "Farine T55", quantite: 5, prix: 2 }]);
  await facture({ fournisseurId: fA, fournisseurNom: "Fournisseur A", numero: "A-1", devise: "USD", date: d("2026-10-10"), montantUSD: 500, resteAPayerUSD: 500, dateEcheance: d("2026-10-09") }, [{ articleId: farine, designation: "Farine T55", quantite: 5, prix: 3 }]);
  await facture({ fournisseurId: fA, fournisseurNom: "Fournisseur A", numero: "A-2", devise: "USD", date: d("2026-10-20"), montantUSD: 100, resteAPayerUSD: 0, statut: "REGLEE" });
  await facture({ fournisseurId: fB, fournisseurNom: "Fournisseur B", numero: "B-1", devise: "CDF", date: d("2026-10-12"), montantCDF: 280000, resteAPayerCDF: 280000, dateEcheance: d("2026-11-20") });
  await facture({ fournisseurNom: "Marché libre", numero: "L-1", devise: "USD", date: d("2026-10-15"), montantUSD: 40, resteAPayerUSD: 40, dateEcheance: d("2026-10-25") });

  // — Achats directs (Liste d'achat) d'octobre —
  const achat = (data: Record<string, unknown>) => p.mouvementStock.create({ data: { type: "ENTREE", origine: "Liste d'achat", ...data } as never });
  await achat({ articleId: farine, fournisseurId: fB, quantite: 5, date: d("2026-10-05"), devise: "USD", montantOrigine: 10, montantUSD: 10 });
  await achat({ articleId: gin, fournisseurId: fB, quantite: 2, date: d("2026-10-05"), devise: "CDF", montantOrigine: 140000, tauxChangeUtilise: 2800, montantUSD: 50 });
  await achat({ articleId: farine, quantite: 10, date: d("2026-10-06"), devise: "USD", montantOrigine: 20, montantUSD: 20 });
  await achat({ articleId: epice, fournisseurId: fA, quantite: 1, date: d("2026-10-07") }); // sans montant : annoncé, jamais 0

  // — Sorties d'octobre : livraison 12 $ (montant saisi), perte au prix du catalogue (1 × 2 $), sans motif ET sans prix, livraison de gin 2 × 35 $ —
  await p.mouvementStock.create({ data: { articleId: farine, type: "SORTIE", quantite: 4, date: d("2026-10-06"), categorieSortie: "LIVRAISON_RESTAURANT", montantUSD: 12 } });
  await p.mouvementStock.create({ data: { articleId: farine, type: "SORTIE", quantite: 1, date: d("2026-10-09"), categorieSortie: "PERTE", raisonSortie: "Moisi" } });
  await p.mouvementStock.create({ data: { articleId: epice, type: "SORTIE", quantite: 1, date: d("2026-10-09") } });
  await p.mouvementStock.create({ data: { articleId: gin, type: "SORTIE", quantite: 2, date: d("2026-10-07"), categorieSortie: "LIVRAISON_RESTAURANT" } });

  // — Restaurant : gin au bar (comptages 10 → 8, 2 livrées), 60 cocktails de 4 cl ; farine en cuisine avec UN SEUL comptage (écart inconnu) —
  const restoGin = (await p.articleResto.create({ data: { espace: "BAR", designation: "Gin", unite: "bouteille", liens: { create: { articleStockId: gin } } } })).id;
  await p.comptageResto.createMany({ data: [{ articleRestoId: restoGin, date: d("2026-10-04"), quantite: "10" }, { articleRestoId: restoGin, date: d("2026-10-11"), quantite: "8" }] });
  const cocktail = (await p.ficheTechnique.create({ data: { nom: "Gin tonic", type: "BAR", ingredients: { create: { articleId: gin, unite: "cl", quantite: "4", ordre: 0 } } } })).id;
  await p.venteJournaliere.create({ data: { date: d("2026-10-08"), ficheId: cocktail, quantite: 60 } });
  const restoFarine = (await p.articleResto.create({ data: { espace: "CUISINE", designation: "Farine", unite: "kg", liens: { create: { articleStockId: farine } } } })).id;
  await p.comptageResto.create({ data: { articleRestoId: restoFarine, date: d("2026-10-05"), quantite: "2" } });
}, 180_000);

afterAll(async () => { vi.useRealTimers(); await fermer?.(); });
beforeEach(() => { M.email.mockClear(); process.env.CRON_SECRET = SECRET; delete process.env.NEXT_PUBLIC_SITE_URL; });

const rapport = () => preparerRapportMensuel(LE_PREMIER);
const rubrique = async (cle: string) => (await rapport()).rubriques.find((r) => r.cle === cle)!;
const texte = (r: { groupes: { titre?: string; lignes: { texte: string }[] }[] }) => r.groupes.flatMap((g) => [g.titre ?? "", ...g.lignes.map((l) => l.texte)]).map(norm).join("\n");

describe("le mois du rapport", () => {
  it("le 1er novembre à 07 h (Kinshasa), le mois écoulé est octobre 2026 — bornes du 1er au 31", () => {
    expect(moisEcoule(LE_PREMIER)).toEqual({ annee: 2026, mois: 10, cle: "2026-10", debut: "2026-10-01", fin: "2026-10-31", libelle: "Octobre 2026" });
  });
  it("entre 00 h et 01 h à Kinshasa (23 h UTC la veille), c'est déjà le 1er : le mois écoulé est celui qui vient de finir", () => {
    expect(moisEcoule(new Date("2026-10-31T23:30:00Z")).libelle).toBe("Octobre 2026"); // 00 h 30 le 1er novembre à Kinshasa
    expect(moisEcoule(new Date("2026-10-31T22:30:00Z")).libelle).toBe("Septembre 2026"); // 23 h 30 le 31 octobre à Kinshasa
  });
  it("janvier : le mois écoulé est décembre de l'année d'avant ; février bissextile : 29 jours", () => {
    expect(moisEcoule(new Date("2027-01-01T06:00:00Z"))).toMatchObject({ annee: 2026, mois: 12, libelle: "Décembre 2026", fin: "2026-12-31" });
    expect(moisEcoule(new Date("2028-03-01T06:00:00Z"))).toMatchObject({ annee: 2028, mois: 2, fin: "2028-02-29" });
  });
});

describe("rubrique 1 — achats par fournisseur, dollars et francs à part", () => {
  it("un fournisseur par ligne : factures du mois (devise de chacune) + achats directs (devise de saisie), jamais convertis", async () => {
    const t = texte(await rubrique("achats"));
    expect(t).toContain("Fournisseur A — 600,00 $ (2 facture(s), 1 achat(s) direct(s)) · partiel : 1 achat(s) sans montant");
    expect(t).toContain("Fournisseur B — 10,00 $ + 420 000 FC (1 facture(s), 2 achat(s) direct(s))");
    expect(t).toContain("Marché libre — 40,00 $ (1 facture(s))");
    expect(t).toContain("Sans fournisseur renseigné — 20,00 $ (1 achat(s) direct(s))");
    expect(t).not.toContain("A-0"); // la facture de septembre n'est pas du mois
  });

  it("total du mois : dollars et francs séparés ; le chiffre en dollars figé de la Liste d'achat est DIT et n'est pas additionné", async () => {
    const r = await rubrique("achats");
    const resume = norm(r.resume!);
    expect(resume).toContain("Total du mois : 670,00 $ + 420 000 FC (factures 640,00 $ + 280 000 FC · achats directs 30,00 $ + 140 000 FC)");
    expect(resume).toContain("Dollars et francs sont additionnés séparément, jamais convertis");
    expect(resume).toContain("Partiel : 1 achat(s) direct(s) sans montant saisi ne sont pas comptés (leur montant est inconnu, pas nul).");
    // 10 $ + 50 $ (équivalent figé de 140 000 FC) + 20 $ = 80 $ : le chiffre de l'écran Liste d'achat.
    expect(resume).toContain("la Liste d'achat vaut 80,00 $ en équivalent dollars figé à la saisie");
    expect(resume).toContain("ce n'est pas additionné aux totaux ci-dessus");
  });

  it("les factures du mois = le total des fonctions des écrans (totalFactures), à l'identique", async () => {
    const octobre = await E.espion.client.factureFournisseur.findMany({ where: { annee: 2026, mois: 10 }, select: { devise: true, montantUSD: true, montantCDF: true } });
    const attendu = libelleTotal(totalFactures(octobre, "montant"), "—", formaterUSD);
    expect(attendu).toBe("640,00 $ + 280 000 FC");
    expect(norm((await rubrique("achats")).resume!)).toContain(`factures ${attendu}`);
  });

  it("des légumes frais achetés dans le mois : le montant de la carte de l'accueil (indicateursStock), pas un autre", async () => {
    const p = E.espion.client;
    await p.achatLegume.create({ data: { date: d("2026-10-14"), legume: "Tomate", quantite: 5, montantUSD: 15.5 } });
    try {
      expect(texte(await rubrique("achats"))).toContain("Légumes frais (sans fournisseur) : 15,50 $ · 1 achat(s)");
      expect((await indicateursStock(LE_PREMIER, { mois: "2026-10" })).legumesMois).toEqual({ montant: 15.5, nb: 1 });
    } finally { await p.achatLegume.deleteMany({}); }
  });

  it("les légumes frais (achats sans fournisseur) viennent de la même carte que l'accueil ; chaque ligne mène à la fiche du fournisseur", async () => {
    const r = await rubrique("achats");
    expect(texte(r)).toContain("Légumes frais (sans fournisseur) : aucun achat"); // aucun légume : jamais « 0,00 $ » ni « — — »
    const liens = r.groupes.flatMap((g) => g.lignes.map((l) => l.lien));
    expect(liens).toContain(`/stock/fournisseurs/${ids.fA}`);
    expect(liens).toContain(`/stock/fournisseurs/${ids.fB}`);
  });
});

describe("rubrique 2 — consommation : sorties, livraisons au restaurant, pertes", () => {
  it("les montants de la carte « Conso. du mois » de l'accueil, par motif, l'inconnu annoncé « partiel » (jamais 0)", async () => {
    const t = texte(await rubrique("consommation"));
    // Livraisons : 12 $ (montant saisi) + 2 × 35 $ (prix du catalogue) = 82 $ ; perte : 1 × 2 $ ; sans motif : sans prix → « — ».
    expect(t).toContain("Sorties du mois : ≈ 84,00 $ (3 sortie(s) valorisée(s) · partiel : 1 sans prix)");
    expect(t).toContain("dont livraisons au restaurant : 82,00 $ (2 sortie(s) valorisée(s))");
    expect(t).toContain("dont pertes : 2,00 $ (1 sortie(s) valorisée(s))");
    expect(t).toContain("dont sans motif : — (1 sortie(s) sans prix)");
  });

  it("égal à indicateursStock (la source de l'écran), pas à un recalcul", async () => {
    const ind = await indicateursStock(LE_PREMIER, { nbAlertes: 0, mois: "2026-10" });
    expect(ind.consoMois).toMatchObject({ montant: 84, nb: 3, nbSansPrix: 1 });
    expect(ind.consoMois.livraisons.montant).toBe(82);
    expect(ind.consoMois.pertes.montant).toBe(2);
  });

  it("chaque ligne mène à Mouvements, filtré sur le mois et le motif", async () => {
    const liens = (await rubrique("consommation")).groupes.flatMap((g) => g.lignes.map((l) => l.lien));
    expect(liens).toEqual(["/stock/mouvements?mois=2026-10", "/stock/mouvements?mois=2026-10&motif=livraison", "/stock/mouvements?mois=2026-10&motif=perte", "/stock/mouvements?mois=2026-10"]);
  });
});

describe("rubrique 3 — valeur du stock", () => {
  it("la valeur de la carte de l'accueil, annoncée « partiel : 1 sans prix » (l'épice sans prix n'est pas comptée 0)", async () => {
    const ind = await indicateursStock(LE_PREMIER);
    expect(ind.valeurStock).toBe(90); // 10 × 2 $ + 2 × 35 $ ; l'épice (4 kg) n'a pas de prix
    expect(ind.valeurStockSansPrix).toBe(1);
    const t = texte(await rubrique("valeur"));
    expect(t).toContain("90,00 $ — partiel : 1 sans prix · stock d'aujourd'hui, 01/11/2026 (la clôture du mois n'est pas encore faite)");
  });

  it("clôture du mois faite : l'instantané figé, comme l'accueil d'un mois passé", async () => {
    const p = E.espion.client;
    const ligne = { articleId: "x", code: "1", designation: "Farine", domaine: "NOURRITURE", unite: "kg", categorie: "", fournisseur: "", quantite: 5, stockMinimum: 0, prixUnitaireUSD: 24.69 };
    await p.clotureStock.create({ data: { annee: 2026, mois: 10, snapshot: { valeurTotaleUSD: 123.45, lignes: [ligne, { ...ligne, designation: "Inconnu", prixUnitaireUSD: 0 }] } } });
    try {
      const t = texte(await rubrique("valeur"));
      expect(t).toContain("123,45 $ — partiel : 1 sans prix");
      expect(t).toContain("(figé à la clôture du mois)");
    } finally { await p.clotureStock.deleteMany({}); }
  });

  it("aucun article valorisé : « — », jamais 0,00 $", async () => {
    const p = E.espion.client;
    const avant = await p.articleStock.findMany({ select: { id: true, prixUnitaireUSD: true } });
    await p.articleStock.updateMany({ data: { prixUnitaireUSD: null } });
    try {
      const t = texte(await rubrique("valeur"));
      expect(t).toContain("— — partiel : 3 sans prix");
      expect(t).not.toContain("0,00 $");
    } finally { for (const a of avant) await p.articleStock.update({ where: { id: a.id }, data: { prixUnitaireUSD: a.prixUnitaireUSD } }); }
  });
});

describe("rubrique 4 — plus gros écarts entre ventes et consommation (fiches techniques)", () => {
  it("le bar : réel 4 bouteilles face à 60 cocktails × 4 cl, écart +0,571 et +20 $ ; la cuisine : un seul comptage, écart INCONNU annoncé (pas 0)", async () => {
    const r = await rubrique("ecarts");
    const t = texte(r);
    expect(t).toContain("Bar (1 écart(s)) — total net des écarts valorisés : +20,00 $");
    expect(t).toContain("Gin — écart +0,571 bouteille (réel 4, théorique 3,429, du 04/10 au 11/10) · valeur +20,00 $");
    expect(t).toContain("Cuisine (0 écart(s)) — 1 article(s) non comparable(s)");
    expect(t).not.toContain("Farine —"); // l'écart inconnu n'est pas une ligne d'écart
    expect(r.nombre).toBe(1);
  });

  it("mêmes chiffres que l'écran Écarts (chargerEcartsVentes, semaine du 5 au 11 octobre) : valeur et quantité identiques", async () => {
    const semaine = await chargerEcartsVentes(d("2026-10-05"), undefined);
    const g = semaine.ecarts.BAR.find((l) => l.designation === "Gin")!;
    const p = g.periode as Extract<typeof g.periode, { etat: "CONNUE" }>;
    const t = texte(await rubrique("ecarts"));
    expect(t).toContain(`écart ${texteQuantiteEcart(p.ecart, true)} bouteille`);
    expect(t).toContain(`valeur ${texteValeurEcart(g.valeur!)}`);
    // La période du mois rend la même ligne que la fonction de l'écran, sur la même fenêtre de comptages.
    const mois = await chargerEcartsVentesPeriode("2026-10-01", "2026-10-31", undefined);
    expect(mois.ecarts.BAR.find((l) => l.designation === "Gin")!.periode).toEqual(g.periode);
  });

  it("le lien ouvre la dernière semaine du mois, un vrai lundi (26 octobre)", async () => {
    const liens = (await rubrique("ecarts")).groupes.flatMap((g) => g.lignes.map((l) => l.lien));
    expect(liens).toEqual(["/stock/journalier?vue=ecarts&semaine=2026-10-26"]);
  });
});

describe("rubrique 5 — hausses de prix et fournisseur le moins cher", () => {
  it("la hausse du badge 📈 du catalogue (+50 %), pour un article acheté dans le mois, avec son nom complet (marque comprise)", async () => {
    expect((await chargerHausses()).get(ids.farine!)).toBeCloseTo(50, 6);
    const t = texte(await rubrique("prix"));
    const nom = libelleArticle({ designation: "Farine T55", marque: "Grands Moulins" });
    expect(nom).toBe("Farine T55 Grands Moulins");
    expect(t).toContain("Hausses de prix d'achat (1)");
    expect(t).toContain(`${nom} — dernier prix d'achat en hausse de +50 % par rapport à la moyenne des achats précédents`);
  });

  it("le fournisseur le moins cher, comme l'onglet Fournisseurs de la fiche article (chargerPrixParFournisseur)", async () => {
    const cmp = await chargerPrixParFournisseur(ids.farine!, { unite: "kg" }, 2800);
    expect(cmp.etat).toBe("COMPARE");
    expect(cmp.lignes.find((l) => l.moinsCher)!.fournisseurId).toBe(ids.fB);
    const t = texte(await rubrique("prix"));
    expect(t).toContain("Fournisseur le moins cher par article (1)");
    expect(t).toContain("Farine T55 Grands Moulins — le moins cher : Fournisseur B à 2,00 $ / kg (Liste d'achat du 05/10/2026) ; les autres : Fournisseur A (habituel) +50 %");
  });

  it("un prix inconnu n'est jamais 0 : une facture à prix nul n'entre pas dans la comparaison, la hausse reste calculée par la fonction de l'écran", async () => {
    const t = texte(await rubrique("prix"));
    expect(t).not.toContain("0,00 $ / kg");
  });
});

describe("rubrique 6 — factures à payer", () => {
  it("les cartes « Factures à payer » et « Factures échues » de l'accueil, dollars et francs à part, avec l'équivalent « ≈ » existant", async () => {
    const t = texte(await rubrique("factures-a-payer"));
    expect(t).toContain("À payer : 540,00 $ + 280 000 FC — 3 facture(s) · ≈ 640,00 $ au taux du jour");
    expect(t).toContain("dont échues : 540,00 $ — 2 facture(s)");
  });
});

describe("le rapport entier", () => {
  it("six rubriques dans l'ordre demandé, sujet et ouverture au nom du mois, liens absolus", async () => {
    const r = await rapport();
    expect(r.sujet).toBe("Pâtes en Folie · Stock : rapport de Octobre 2026");
    expect(r.rubriques.map((x) => x.cle)).toEqual(["achats", "consommation", "valeur", "ecarts", "prix", "factures-a-payer"]);
    expect(r.corps).toContain("Voici la synthèse du Stock pour Octobre 2026 :");
    const lignes = r.corps.split("\n");
    const puces = lignes.map((l, i) => ({ l, i })).filter((x) => x.l.startsWith("• "));
    expect(puces.length).toBeGreaterThanOrEqual(12);
    for (const { l, i } of puces) expect(lignes[i + 1], l).toMatch(/^ {2}→ https:\/\/gestion\.patesenfolie\.cd\/stock/);
    expect(r.corps).not.toMatch(/→ \//);
    expect(r.corps).not.toMatch(/NaN|undefined|null|Infinity/);
  });
});

describe("route /api/cron/stock-mensuel", () => {
  const appel = (init: { jeton?: string; query?: string } = {}) =>
    GET(new NextRequest(`https://gestion.patesenfolie.cd/api/cron/stock-mensuel${init.query ?? ""}`, { headers: init.jeton ? { authorization: `Bearer ${init.jeton}` } : {} }));

  it("refuse sans jeton ou avec un mauvais — sans toucher la base ni envoyer", async () => {
    E.espion.actif = true; E.espion.lectures = 0;
    expect((await appel()).status).toBe(401);
    expect((await appel({ jeton: "mauvais" })).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await appel({ jeton: SECRET })).status).toBe(401);
    E.espion.actif = false;
    expect(E.espion.lectures).toBe(0);
    expect(M.email).not.toHaveBeenCalled();
  });

  it("avec le bon jeton : UN courriel aux seuls comptes Stock (Direction + Stock), jamais le RH", async () => {
    const r = await appel({ jeton: SECRET });
    expect(await r.json()).toEqual({ envoye: true, destinataires: 2, mois: "Octobre 2026" });
    expect(M.email).toHaveBeenCalledTimes(1);
    const [a, sujet] = M.email.mock.calls[0] as unknown as [string[], string];
    expect(a).toEqual(["direction@pef.cd", "stock@pef.cd"]);
    expect(a).not.toContain("rh@pef.cd");
    expect(sujet).toBe("Pâtes en Folie · Stock : rapport de Octobre 2026");
  });

  it("aperçu : rend le texte du rapport sans rien envoyer, et exige le jeton", async () => {
    const corps = await (await appel({ jeton: SECRET, query: "?apercu=1" })).json();
    expect(corps).toMatchObject({ apercu: true, envoye: false, mois: "Octobre 2026", destinataires: 2 });
    expect(corps.corps).toContain("ACHATS PAR FOURNISSEUR");
    expect(M.email).not.toHaveBeenCalled();
    expect((await appel({ query: "?apercu=1" })).status).toBe(401);
  });

  it("n'écrit RIEN dans les données : espion sur toute écriture + empreinte des tables avant / après", async () => {
    const avant = await empreinte();
    E.espion.actif = true; E.espion.refus = [];
    await appel({ jeton: SECRET });
    await appel({ jeton: SECRET, query: "?apercu=1" });
    await rapport();
    E.espion.actif = false;
    expect(E.espion.refus).toEqual([]);
    expect(await empreinte()).toBe(avant);
  });

  it("l'espion mord ici aussi (falsification) : une écriture est refusée et enregistrée", async () => {
    E.espion.actif = true; E.espion.refus = [];
    await expect(Promise.resolve().then(() => prismaEspionne.stock.deleteMany({}))).rejects.toThrow(/écriture interdite/);
    E.espion.actif = false;
    expect(E.espion.refus).toEqual(["stock.deleteMany"]);
    expect(await E.espion.client.stock.count()).toBe(3);
  });
});
