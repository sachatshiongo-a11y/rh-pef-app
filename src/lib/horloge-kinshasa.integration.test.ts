import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// Le « maintenant » des écrans et des actions est celui de KINSHASA (UTC+1), pas celui du serveur
// (UTC). Constaté le 2026-10-01 à 00 h 19 WAT : le serveur était encore le 30 septembre à 23 h 19, et
// septembre passait pour le mois courant alors que les sorties du jour étaient datées d'octobre.
// Chaque cas ci-dessous fige l'horloge au 1er octobre 00 h 30 Kinshasa (= 23 h 30 UTC la veille) et
// vérifie que l'effet est celui du mois neuf ; la contre-épreuve fige le 31 octobre 23 h 30 Kinshasa
// (= 22 h 30 UTC, même mois des deux côtés) : rien ne doit bouger. Seule la date est simulée : les
// minuteries (Postgres embarqué) restent réelles.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Testeur", email: "t@pef.cd", accesStock: false, employeeId: null } }));
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

const PREMIER_00H30 = new Date("2026-09-30T23:30:00Z"); // jeudi 1er octobre 2026, 00 h 30 à Kinshasa
const DERNIER_23H30 = new Date("2026-10-31T22:30:00Z"); // samedi 31 octobre 2026, 23 h 30 à Kinshasa
const jour = (iso: string) => new Date(`${iso}T00:00:00Z`);

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let seq = 0;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });
  await seedParametresLegaux(prisma);
  await prisma.typeConge.create({ data: { nom: "Congé annuel", compteDansSolde: true, ordre: 1 } });
}, 120_000);

afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { vi.useRealTimers(); await fermer?.(); });

/** Fige la date (et elle seule) : les minuteries de Postgres embarqué restent réelles. */
function a(instant: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instant);
}
async function article(designation: string, quantite = 10) {
  const art = await prisma.articleStock.create({ data: { designation: `${designation} ${++seq}`, domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: "2" } });
  await prisma.stock.create({ data: { articleId: art.id, quantite } });
  return art;
}

describe("sorties et entrées de stock sans date saisie : le jour civil de Kinshasa", () => {
  it("mouvement manuel : daté du 1er octobre à 00 h 30 Kinshasa, pas du 30 septembre", async () => {
    const { mouvementManuel } = await import("@/app/(stock)/stock/mouvements/actions");
    const art = await article("Farine");
    const fd = new FormData();
    fd.set("type", "SORTIE"); fd.set("categorieSortie", "LIVRAISON_RESTAURANT"); fd.append("articleId", art.id); fd.append("quantite", "2");
    a(PREMIER_00H30);
    const res = await mouvementManuel(fd);
    if (res && "erreur" in res) throw new Error(res.erreur);
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id } });
    expect(m.date.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("contre-épreuve : le 31 octobre à 23 h 30 Kinshasa, daté du 31 octobre", async () => {
    const { mouvementManuel } = await import("@/app/(stock)/stock/mouvements/actions");
    const art = await article("Sucre");
    const fd = new FormData();
    fd.set("type", "ENTREE"); fd.append("articleId", art.id); fd.append("quantite", "1");
    a(DERNIER_23H30);
    await mouvementManuel(fd);
    expect((await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id } })).date.toISOString().slice(0, 10)).toBe("2026-10-31");
  });

  it("correction d'un stock négatif : l'entrée d'ajustement est datée du 1er octobre", async () => {
    const { corrigerStocksNegatifs } = await import("@/app/(stock)/stock/catalogue/actions");
    const art = await article("Sel", -3);
    a(PREMIER_00H30);
    const res = await corrigerStocksNegatifs([art.id]);
    if ("erreur" in res) throw new Error(res.erreur);
    expect((await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id } })).date.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("achat de légumes frais : daté du 1er octobre", async () => {
    const { creerAchatsLegumes } = await import("@/app/(stock)/stock/legumes/actions");
    const fd = new FormData();
    fd.append("legume", "Tomate-horloge"); fd.append("unite", "kg"); fd.append("quantite", "3"); fd.append("montantCDF", "5600");
    a(PREMIER_00H30);
    const res = await creerAchatsLegumes(fd);
    if (res && "erreur" in res) throw new Error(res.erreur);
    expect((await prisma.achatLegume.findFirstOrThrow({ where: { legume: "Tomate-horloge" } })).date.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("bon de commande : numéro, mois ET date suivent Kinshasa", () => {
  it("le 1er octobre 00 h 30 : OCTOBRE, daté du 1er ; le 31 octobre 23 h 30 : daté du 31 ; le 1er janvier 00 h 30 : JANVIER/27 daté du 1er janvier", async () => {
    const { creerBonCommande } = await import("@/app/(stock)/stock/commandes/actions");
    const bon = async (instant: Date) => {
      const fd = new FormData();
      fd.append("ligne_designation", "Farine"); fd.append("ligne_quantite", "2"); fd.append("ligne_prix", "3");
      a(instant);
      try {
        const res = await creerBonCommande(fd);
        if (res && "erreur" in res) throw new Error(res.erreur);
      } catch (e) {
        if (!String((e as { digest?: string }).digest ?? "").startsWith("NEXT_REDIRECT")) throw e; // l'action redirige vers la fiche du bon
      }
      vi.useRealTimers();
    };
    await bon(PREMIER_00H30);
    await bon(DERNIER_23H30);
    await bon(new Date("2026-12-31T23:30:00Z")); // 1er janvier 2027, 00 h 30 à Kinshasa
    const bcs = await prisma.bonDeCommande.findMany({ orderBy: [{ date: "asc" }, { numero: "asc" }] });
    // `date` : posée explicitement (le défaut @default(now()) de la base serait le jour UTC, donc la veille).
    expect(bcs.map((b) => [b.mois, b.annee, b.date.toISOString().slice(0, 10)])).toEqual([[10, 2026, "2026-10-01"], [10, 2026, "2026-10-31"], [1, 2027, "2027-01-01"]]);
    expect(bcs.map((b) => b.numero.split("/").slice(-2).join("/"))).toEqual(["OCTOBRE/26", "OCTOBRE/26", "JANVIER/27"]);
  });

  it("réception d'un bon de commande : datée du jour de Kinshasa", async () => {
    const { receptionnerBonCommande } = await import("@/app/(stock)/stock/commandes/actions");
    const art = await article("Riz-bc");
    const bc = await prisma.bonDeCommande.create({ data: { numero: "900/PEF/TEST/OCTOBRE/26", sequence: 900, annee: 2026, mois: 10, date: jour("2026-10-01"), statut: "VALIDE", lignes: { create: [{ articleId: art.id, designation: "Riz", quantite: 2, prixUnitaireUSD: 1, totalLigneUSD: 2 }] } }, include: { lignes: true } });
    const fd = new FormData();
    fd.append("recu_ligneId", bc.lignes[0].id); fd.append("recu_quantite", "2");
    a(PREMIER_00H30);
    const res = await receptionnerBonCommande(bc.id, fd);
    if (res && "erreur" in res) throw new Error(res.erreur);
    expect((await prisma.reception.findFirstOrThrow({ where: { bonDeCommandeId: bc.id } })).date.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("comptage physique : session et ajustements datés du jour de Kinshasa", () => {
  it("la fiche de comptage et ses mouvements d'ajustement portent le 1er octobre à 00 h 30 Kinshasa", async () => {
    const { appliquerComptage } = await import("@/app/(stock)/stock/reconciliation/actions");
    const art = await article("Lait-cpt", 10);
    const fd = new FormData();
    fd.append("recon_articleId", art.id); fd.append("recon_physique", "9.5"); fd.append("recon_explication", "casse");
    a(PREMIER_00H30);
    const res = await appliquerComptage(fd);
    if (res && "erreur" in res) throw new Error(res.erreur);
    const sessions = await prisma.sessionComptage.findMany({ orderBy: { createdAt: "desc" }, take: 1 });
    expect(sessions[0].date.toISOString().slice(0, 10)).toBe("2026-10-01");
    const aj = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: art.id, type: "AJUSTEMENT" } });
    expect(aj.date.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("indicateurs de stock : mois et semaine en cours", () => {
  it("le 1er octobre à 00 h 30 : consommation et légumes d'octobre ; le 31 à 23 h 30 : inchangé", async () => {
    const { indicateursStock } = await import("@/lib/indicateurs/stock");
    const art = await article("Huile");
    await prisma.mouvementStock.deleteMany({ where: { id: { not: "" }, NOT: { articleId: art.id } } }); // repart d'un mois vierge
    await prisma.achatLegume.deleteMany({});
    // Octobre : une sortie valorisée 3,00 et un achat de légumes 4,00 ; septembre : 100 et 200.
    await prisma.mouvementStock.create({ data: { articleId: art.id, type: "SORTIE", quantite: 1, montantUSD: 3, date: jour("2026-10-01") } });
    await prisma.mouvementStock.create({ data: { articleId: art.id, type: "SORTIE", quantite: 1, montantUSD: 100, date: jour("2026-09-30") } });
    await prisma.achatLegume.create({ data: { date: jour("2026-10-01"), legume: "Oignon-ind", quantite: 1, montantUSD: 4 } });
    await prisma.achatLegume.create({ data: { date: jour("2026-09-30"), legume: "Ail-ind", quantite: 1, montantUSD: 200 } });
    const premier = await indicateursStock(PREMIER_00H30);
    expect(premier.consoMois).toMatchObject({ montant: 3 });
    expect(premier.legumesMois).toMatchObject({ montant: 4 });
    const dernier = await indicateursStock(DERNIER_23H30);
    expect(dernier.consoMois).toMatchObject({ montant: 3 });
    expect(dernier.legumesMois).toMatchObject({ montant: 4 });
    // Septembre se demande explicitement (la valeur par défaut est le mois courant de Kinshasa).
    const sept = await indicateursStock(PREMIER_00H30, { mois: "2026-09" });
    expect(sept.consoMois.montant).toBeGreaterThanOrEqual(100);
    expect(sept.legumesMois.montant).toBeGreaterThanOrEqual(200);
  }, 60_000);

  it("la semaine en cours bascule le lundi à 00 h Kinshasa (dimanche 23 h UTC)", async () => {
    const { indicateursStock } = await import("@/lib/indicateurs/stock");
    // Facture à régler dont l'échéance tombe le lundi 12 octobre : dans la semaine en cours dès le
    // lundi 00 h 30 à Kinshasa (= dimanche 11 octobre 23 h 30 UTC), pas avant.
    await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fourn. lundi", montantUSD: 55, resteAPayerUSD: 55, mois: 10, annee: 2026, statut: "A_REGLER", dateEcheance: jour("2026-10-12") } });
    const lundiNuit = await indicateursStock(new Date("2026-10-11T23:30:00Z"));
    expect(lundiNuit.facturesSemaine).toEqual({ montant: 55, nb: 1 });
    const dimancheSoir = await indicateursStock(new Date("2026-10-11T22:30:00Z")); // dimanche 23 h 30 à Kinshasa
    expect(dimancheSoir.facturesSemaine).toEqual({ montant: null, nb: 0 });
  }, 60_000);
});

describe("congés acquis : le mois révolu tombe le 1er à 00 h à Kinshasa", () => {
  it("embauché le 1er septembre : 1,5 j acquis dès le 1er octobre 00 h 30 Kinshasa (mois révolu), 0 la veille", async () => {
    const { chargerSoldeCongeSalarie } = await import("@/lib/solde-conge-salarie");
    const e = await prisma.employee.create({
      data: { matricule: "HK1-PEF", nom: "Horloge Un", sexe: "F", etatCivil: "Célibataire", poste: "Cuisinière", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: jour("2026-09-01"), contrat: "CDI" },
    });
    expect((await chargerSoldeCongeSalarie(prisma, e.id, PREMIER_00H30)).acquis).toBe(1.5);
    expect((await chargerSoldeCongeSalarie(prisma, e.id, new Date("2026-09-30T22:30:00Z"))).acquis).toBe(0); // 30 sept., 23 h 30 à Kinshasa
    expect((await chargerSoldeCongeSalarie(prisma, e.id, DERNIER_23H30)).acquis).toBe(1.5);
  }, 60_000);
});

describe("alertes : « aujourd'hui » est le jour de Kinshasa", () => {
  it("un congé non validé qui débute le 1er octobre « débute aujourd'hui » à 00 h 30 Kinshasa", async () => {
    const { calculerAlertes } = await import("@/lib/alertes");
    const e = await prisma.employee.create({
      data: { matricule: "HK2-PEF", nom: "Horloge Deux", sexe: "F", etatCivil: "Célibataire", poste: "Serveuse", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: jour("2025-01-01"), contrat: "CDI" },
    });
    await prisma.leaveRequest.create({ data: { employeeId: e.id, type: "Congé annuel", dateDebut: jour("2026-10-02"), dateFin: jour("2026-10-03"), nbJours: 2, statut: "EN_ATTENTE" } });
    a(PREMIER_00H30);
    const alertes = await calculerAlertes();
    const c = alertes.find((x) => x.message.includes("Horloge Deux"))!;
    expect(c.message).toContain("débute dans 1 jour(s)"); // jeudi 1er → vendredi 2 octobre : demain
    a(new Date("2026-10-01T22:30:00Z")); // 1er octobre, 23 h 30 à Kinshasa : toujours demain
    expect((await calculerAlertes()).find((x) => x.message.includes("Horloge Deux"))!.message).toContain("débute dans 1 jour(s)");
  }, 60_000);
});

describe("échéances (dates pures) comparées au JOUR de Kinshasa, pas à l'instant", () => {
  const DERNIER_JOUR = "2026-10-12";
  const instants = {
    "10 h Kinshasa": "2026-10-12T09:00:00Z",
    "23 h 30 Kinshasa": "2026-10-12T22:30:00Z",
  };

  it("contrat qui finit le 12 : l'alerte « expire le » vaut jusqu'au soir du 12, plus le 13 à 00 h 30", async () => {
    const { calculerAlertes } = await import("@/lib/alertes");
    const e = await prisma.employee.create({
      data: { matricule: "HK3-PEF", nom: "Horloge Trois", sexe: "F", etatCivil: "Célibataire", poste: "Serveuse", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: jour("2025-01-01"), contrat: "CDD" },
    });
    await prisma.contrat.create({ data: { employeeId: e.id, type: "CDD", statut: "ACTIF", dateDebut: jour("2026-04-12"), dateFin: jour(DERNIER_JOUR), salaireMensuel: 300, devise: "USD", heuresHebdo: 40, poste: "Serveuse" } });
    const alerte = async (instant: string) => { a(new Date(instant)); const r = (await calculerAlertes()).find((x) => x.message.includes("Horloge Trois") && x.type === "CONTRAT"); vi.useRealTimers(); return r; };
    for (const [quand, instant] of Object.entries(instants)) expect(await alerte(instant), quand).toBeDefined();
    expect(await alerte("2026-10-12T23:30:00Z")).toBeUndefined(); // 13 octobre, 00 h 30 à Kinshasa : fini
  });

  it("accueil RH : un congé du 12 au 12 est « en cours » toute la journée du 12, plus le 13", async () => {
    const { default: AccueilPage } = await import("@/app/(app)/accueil/page");
    const e = await prisma.employee.create({
      data: { matricule: "HK4-PEF", nom: "Horloge Quatre", sexe: "F", etatCivil: "Célibataire", poste: "Serveuse", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: jour("2025-01-01"), contrat: "CDI" },
    });
    await prisma.leaveRequest.create({ data: { employeeId: e.id, type: "Congé annuel", dateDebut: jour(DERNIER_JOUR), dateFin: jour(DERNIER_JOUR), nbJours: 1, statut: "APPROUVE" } });
    const enCours = async (instant: string) => {
      a(new Date(instant));
      const t = renderToStaticMarkup(await AccueilPage()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      vi.useRealTimers();
      return /Congés en cours (\d+)/.exec(t)?.[1];
    };
    for (const [quand, instant] of Object.entries(instants)) expect(await enCours(instant), quand).toBe("1");
    expect(await enCours("2026-10-12T23:30:00Z")).toBe("0"); // 13 octobre, 00 h 30 à Kinshasa
  }, 60_000);
});

describe("rapport « paiements » : le retard est en jours civils de Kinshasa", () => {
  it("échéance du 1er octobre : 4 j le 5 octobre toute la journée (10 h comme 23 h 30), 5 j dès le 6 à 00 h 30", async () => {
    const { genererDonneesRapportDetail } = await import("@/lib/rapports");
    await prisma.factureFournisseur.create({ data: { fournisseurNom: "Fourn. retard", montantUSD: 10, resteAPayerUSD: 10, mois: 9, annee: 2026, statut: "ECHUE_NON_REGLEE", dateEcheance: jour("2026-10-01") } });
    const retard = async (instant: string) => {
      a(new Date(instant));
      const d = await genererDonneesRapportDetail("PAIEMENTS", jour("2026-10-01"), jour("2026-10-31"));
      vi.useRealTimers();
      return d.lignes.find((l) => l[0] === "Fourn. retard")?.[3];
    };
    expect(await retard("2026-10-05T09:00:00Z")).toBe("4 j");
    expect(await retard("2026-10-05T22:30:00Z")).toBe("4 j"); // 23 h 30 à Kinshasa : l'ancien arrondi à midi disait 5
    expect(await retard("2026-10-05T23:30:00Z")).toBe("5 j"); // 6 octobre, 00 h 30 à Kinshasa
  }, 60_000);
});
