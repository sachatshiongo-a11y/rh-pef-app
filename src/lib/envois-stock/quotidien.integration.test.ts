import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { creerBaseTest } from "@/lib/test/db";
import type { Espion } from "@/lib/test/espion-ecritures";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — le courriel QUOTIDIEN du Stock (Direction, 2026-10-12) :
// contenu de chaque rubrique sur des données de test, égalité avec les fonctions qui alimentent les écrans,
// rien d'envoyé quand il n'y a rien à signaler, refus sans jeton, destinataires par rôle, aucune écriture.
const E = vi.hoisted(() => ({ espion: undefined as unknown as Espion }));
const M = vi.hoisted(() => ({ email: vi.fn(async () => true), push: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", async () => {
  const { creerEspion, proxyEspion } = await import("@/lib/test/espion-ecritures");
  E.espion = creerEspion();
  return { prisma: proxyEspion(E.espion) };
});
// L'envoi unique par jour (mémoire en journal d'audit) a ses propres tests (envoi-unique.integration.test.ts) : ici il laisse
// passer, pour que l'espion continue de prouver que la route n'écrit RIEN dans les données du Stock.
vi.mock("@/lib/envoi-unique", () => ({
  cleJour: (p: string) => `${p}-test`,
  envoiUnique: async (_c: string, _o: unknown, travail: () => Promise<{ resultat: unknown }>) => ({ dejaEnvoye: false, resultat: (await travail()).resultat }),
}));
vi.mock("@/lib/email", () => ({ envoyerEmail: M.email }));
vi.mock("@/lib/push", () => ({ envoyerPush: M.push }));

const { preparerEnvoiQuotidien } = await import("./quotidien");
const { destinatairesStock } = await import("./destinataires");
const { GET } = await import("@/app/api/cron/stock-quotidien/route");
const { indicateursStock } = await import("@/lib/indicateurs/stock");
const { dlcProches } = await import("@/lib/dlc-stock");
const { calculerAlertes } = await import("@/lib/alertes");
const { chargerAValiderStock } = await import("@/lib/a-valider-chargeurs");
const { libelleArticle } = await import("@/lib/libelle-article");
const { prisma: prismaEspionne } = await import("@/lib/prisma"); // le client que le code testé utilise (celui que l'espion surveille)

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
// Jeudi 15 octobre 2026, 07 h à Kinshasa (06 h UTC) — l'heure du déclencheur.
const MATIN = new Date("2026-10-15T06:00:00Z");
const norm = (s: string) => s.replace(/[\s  ]+/g, " ");
const SECRET = "secret-de-test-stock";
let fermer: () => Promise<void>;
let admin: { id: string; email: string };
let stock: { id: string; email: string };
const ids: Record<string, string> = {};

/** Table → empreinte JSON : tout ce que les courriels pourraient écrire, comparé avant / après. */
async function empreinte(): Promise<string> {
  const c = E.espion.client;
  const lots = await Promise.all([
    c.user.findMany({ orderBy: { id: "asc" } }), c.articleStock.findMany({ orderBy: { id: "asc" } }), c.stock.findMany({ orderBy: { id: "asc" } }),
    c.mouvementStock.findMany({ orderBy: { id: "asc" } }), c.factureFournisseur.findMany({ orderBy: { id: "asc" } }), c.bonDeCommande.findMany({ orderBy: { id: "asc" } }),
    c.ligneBonDeCommande.findMany({ orderBy: { id: "asc" } }), c.demandeValidationStock.findMany({ orderBy: { id: "asc" } }), c.notification.findMany({ orderBy: { id: "asc" } }),
    c.journalAudit.findMany({ orderBy: { id: "asc" } }), c.pushSubscription.findMany({ orderBy: { id: "asc" } }), c.config.findMany(),
  ]);
  return JSON.stringify(lots);
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MATIN);
  const db = await creerBaseTest();
  fermer = db.fermer; E.espion.client = db.prisma;
  const p = db.prisma;
  await p.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });

  // — Comptes : un par rôle, actif ou non —
  const compte = async (email: string, role: "ADMIN" | "MANAGER" | "VIEWER" | "STOCK" | "COMPTA" | "EMPLOYE", extra: { actif?: boolean; accesStock?: boolean } = {}) =>
    p.user.create({ data: { email, nom: email.split("@")[0]!, role, ...extra } });
  admin = await compte("direction@pef.cd", "ADMIN");
  stock = await compte("stock@pef.cd", "STOCK");
  await compte("stock-parti@pef.cd", "STOCK", { actif: false });
  await compte("rh@pef.cd", "MANAGER");
  await compte("consultation@pef.cd", "VIEWER");
  await compte("compta@pef.cd", "COMPTA");
  await compte("salarie-stock@pef.cd", "EMPLOYE", { accesStock: true });
  await compte("salarie@pef.cd", "EMPLOYE");

  // — Articles et stocks —
  const article = async (cle: string, designation: string, domaine: "NOURRITURE" | "BOISSON" | "AUTRE", q: string, min: string, extra: Record<string, unknown> = {}, seuilUrgent = "0") => {
    const a = await p.articleStock.create({ data: { designation, domaine, unite: domaine === "BOISSON" ? "L" : "kg", prixUnitaireUSD: 2, ...extra } });
    await p.stock.create({ data: { articleId: a.id, quantite: q, stockMinimum: min, seuilUrgent } });
    ids[cle] = a.id;
  };
  await article("farine", "Farine", "NOURRITURE", "0", "5"); // rupture
  await article("sel", "Sel", "NOURRITURE", "3", "5"); // à réapprovisionner
  await article("sucre", "Sucre", "NOURRITURE", "20", "5"); // satisfaisant : ne figure nulle part
  await article("huile", "Huile", "NOURRITURE", "-3", "2"); // urgent ET négatif
  await article("jus", "Jus tropical", "BOISSON", "1", "4", { marque: "Pressade", contenance: "1", contenanceUnite: "l" }, "2"); // urgent (seuil urgent 2), nom complet : marque + contenance
  await article("ancien", "Ancien sirop", "BOISSON", "-1", "0", { actif: false }); // négatif, désactivé

  // — Factures : échue, en francs à 5 jours, trop lointaine, réglée —
  const facture = (nom: string, numero: string, devise: "USD" | "CDF", reste: number, echeance: string, statut = "A_REGLER") =>
    p.factureFournisseur.create({
      data: {
        fournisseurNom: nom, numero, devise, mois: 10, annee: 2026, statut: statut as "A_REGLER", dateEcheance: d(echeance),
        ...(devise === "USD" ? { montantUSD: reste, resteAPayerUSD: reste } : { montantCDF: reste, resteAPayerCDF: reste }),
      },
    });
  await facture("Fournisseur A", "F-001", "USD", 120, "2026-10-10"); // échue depuis 5 j
  await facture("Fournisseur B", "F-002", "CDF", 280000, "2026-10-20"); // dans 5 j, en francs
  await facture("Fournisseur C", "F-003", "USD", 50, "2026-10-30"); // trop loin : absente
  await facture("Fournisseur D", "F-004", "USD", 0, "2026-10-12", "REGLEE"); // réglée : absente

  // — DLC : une entrée à DLC dans 2 jours (retenue), une à DLC lointaine (écartée) —
  await p.mouvementStock.create({ data: { articleId: ids.sel!, type: "ENTREE", quantite: 4, date: d("2026-10-10"), dlc: d("2026-10-17") } });
  await p.mouvementStock.create({ data: { articleId: ids.sucre!, type: "ENTREE", quantite: 9, date: d("2026-10-10"), dlc: d("2026-12-31") } });

  // — Demandes : une en attente, une décidée —
  await p.demandeValidationStock.create({ data: { nature: "PAIEMENT_FACTURE", statut: "EN_ATTENTE", resume: "Facture n° F-001 de Fournisseur A — 120,00 $", charge: {}, auteurId: stock.id, auteurNom: "Chef Stock", createdAt: new Date("2026-10-13T09:00:00Z") } });
  await p.demandeValidationStock.create({ data: { nature: "MODIF_ARTICLE", statut: "VALIDEE", resume: "Déjà décidée", charge: {}, auteurId: stock.id, auteurNom: "Chef Stock" } });

  // — Bons de commande : validé, reçu en partie, reçu (écarté), brouillon (écarté) —
  const bon = (numero: string, seq: number, statut: string, date: string, lignes: { designation: string; quantite: number; quantiteRecue?: number; prix?: number }[], total: number) =>
    p.bonDeCommande.create({
      data: {
        numero, sequence: seq, annee: 2026, mois: 10, date: d(date), statut: statut as "VALIDE", totalUSD: total,
        lignes: { create: lignes.map((l) => ({ designation: l.designation, quantite: l.quantite, quantiteRecue: l.quantiteRecue ?? null, prixUnitaireUSD: l.prix ?? 1 })) },
      },
    });
  await bon("001/PEF/OCT/26", 1, "VALIDE", "2026-10-08", [{ designation: "Farine", quantite: 10 }], 300);
  await bon("002/PEF/OCT/26", 2, "RECU_PARTIEL", "2026-10-05", [{ designation: "Sel", quantite: 10, quantiteRecue: 4 }, { designation: "Sucre", quantite: 5, quantiteRecue: 5 }], 80);
  await bon("003/PEF/OCT/26", 3, "RECU", "2026-10-01", [{ designation: "Huile", quantite: 2, quantiteRecue: 2 }], 20);
  await bon("004/PEF/OCT/26", 4, "BROUILLON", "2026-10-14", [{ designation: "Sucre", quantite: 1 }], 5);
}, 180_000);

afterAll(async () => { vi.useRealTimers(); await fermer?.(); });
beforeEach(() => { M.email.mockClear(); M.push.mockClear(); process.env.CRON_SECRET = SECRET; delete process.env.NEXT_PUBLIC_SITE_URL; });

const rubrique = async (cle: string) => (await preparerEnvoiQuotidien(MATIN))!.rubriques.find((r) => r.cle === cle)!;
const texte = (r: { groupes: { titre?: string; lignes: { texte: string }[] }[] }) => r.groupes.flatMap((g) => [g.titre ?? "", ...g.lignes.map((l) => l.texte)]).map(norm).join("\n");

describe("rubrique 1 — articles en rupture ou sous le seuil, par domaine", () => {
  it("range les alertes par domaine, l'urgent d'abord, avec le nom complet (marque + contenance) et le seuil", async () => {
    const r = await rubrique("alertes");
    const t = texte(r);
    expect(t).toContain("Nourriture (3, dont 2 urgent(s))");
    expect(t).toContain("Boissons (1, dont 1 urgent(s))");
    expect(t).toContain("Farine — 0 kg · EN RUPTURE · seuil minimum 5 kg");
    expect(t).toContain("Huile — -3 kg · EN RUPTURE · seuil minimum 2 kg");
    expect(t).toContain("Sel — 3 kg · À RÉAPPROVISIONNER · seuil minimum 5 kg");
    // Le nom de l'article, par libelle-article.ts : marque et contenance comprises.
    const jus = libelleArticle({ designation: "Jus tropical", marque: "Pressade", contenance: "1", contenanceUnite: "l" });
    expect(jus).toBe("Jus tropical Pressade 1 l");
    expect(t).toContain(`${jus} — 1 L · URGENT`);
    expect(t).not.toContain("Sucre"); // satisfaisant
    expect(t).not.toContain("Ancien sirop"); // désactivé : l'accueil Stock ne le compte pas non plus
    // Les urgents (rupture) passent avant le « à réapprovisionner » dans le domaine.
    expect(t.indexOf("Farine")).toBeLessThan(t.indexOf("Sel —"));
    expect(t.indexOf("Huile")).toBeLessThan(t.indexOf("Sel —"));
  });

  it("le même nombre que l'accueil Stock (indicateursStock) : urgents, à réapprovisionner, total", async () => {
    const r = await rubrique("alertes");
    const ind = await indicateursStock(MATIN, { nbAlertes: 100 });
    expect(r.nombre).toBe(ind.alertes.length);
    expect(r.resume).toContain(`${ind.nbUrgent} urgent(s) · ${ind.nbAppro} à réapprovisionner`);
    expect([ind.nbUrgent, ind.nbAppro]).toEqual([3, 1]);
  });
});

describe("rubrique 2 — factures échues ou à échéance sous 7 jours", () => {
  it("liste l'échue et celle en francs, pas la lointaine ni la réglée, avec les jours et le reste dans la devise de chacune", async () => {
    const r = await rubrique("factures");
    const t = texte(r);
    expect(t).toContain("Fournisseur A — facture n° F-001 · reste 120,00 $ · ÉCHUE depuis 5 j (10/10/2026)");
    expect(t).toContain("Fournisseur B — facture n° F-002 · reste 280 000 FC · échéance dans 5 j (20/10/2026)");
    expect(t).not.toContain("F-003");
    expect(t).not.toContain("F-004");
    expect(r.nombre).toBe(2);
    expect(norm(r.resume!)).toContain("2 facture(s), dont 1 échue(s) — reste à payer : 120,00 $ + 280 000 FC");
  });

  it("le même total que l'alerte « factures à payer sous 7 jours » de l'accueil (calculerAlertes)", async () => {
    const r = await rubrique("factures");
    const alerte = (await calculerAlertes()).find((a) => a.type === "FACTURES")!;
    expect(norm(alerte.message)).toContain("2 facture(s) fournisseur à payer sous 7 jours — 120,00 $ + 280 000 FC (dont 1 échue(s))");
    expect(norm(r.resume!)).toContain("120,00 $ + 280 000 FC");
  });
});

describe("rubrique 3 — DLC dans les 7 jours", () => {
  it("retient l'entrée à DLC proche, avec le nombre de jours, pas la lointaine ; même total que le bloc de l'accueil", async () => {
    const r = await rubrique("dlc");
    expect(texte(r)).toContain("Sel — +4 kg entré le 10/10/2026 · DLC 17/10/2026 (dans 2 j)");
    expect(texte(r)).not.toContain("Sucre");
    expect(r.nombre).toBe((await dlcProches(MATIN)).total);
    expect(r.nombre).toBe(1);
  });
});

describe("rubrique 4 — demandes en attente de la Direction", () => {
  it("ne liste que les demandes EN ATTENTE, par nature, avec l'auteur et la date de Kinshasa", async () => {
    const r = await rubrique("demandes");
    const t = texte(r);
    expect(t).toContain("Paiements de factures (1)");
    expect(t).toContain("Facture n° F-001 de Fournisseur A — 120,00 $ — demandé par Chef Stock le 13/10/2026");
    expect(t).not.toContain("Déjà décidée");
  });

  it("le même nombre que le compteur « À valider » de la Direction (chargerAValiderStock)", async () => {
    const r = await rubrique("demandes");
    const compteur = await chargerAValiderStock({ id: admin.id, role: "ADMIN" });
    expect(r.nombre).toBe(compteur.demandes);
  });
});

describe("rubrique 5 — bons de commande validés mais non réceptionnés, ou reçus en partie", () => {
  it("liste le validé et le reçu en partie (avec ce qui reste), pas le reçu ni le brouillon", async () => {
    const r = await rubrique("bons");
    const t = texte(r);
    expect(t).toContain("001/PEF/OCT/26 · — · Validé · du 08/10/2026 (il y a 7 j) · 300,00 $");
    expect(t).toContain("002/PEF/OCT/26 · — · Reçu partiel · du 05/10/2026 (il y a 10 j) · 80,00 $ · reste à recevoir : 1 ligne(s)");
    expect(t).not.toContain("003/PEF");
    expect(t).not.toContain("004/PEF");
    expect(r.nombre).toBe(2);
  });
});

describe("rubrique 6 — stocks négatifs", () => {
  it("liste les négatifs comme le filtre « stock négatif » du catalogue, désactivés compris, avec le nom complet", async () => {
    const r = await rubrique("negatifs");
    const t = texte(r);
    expect(t).toContain("Huile — -3 kg");
    expect(t).toContain("Ancien sirop — -1 L (article désactivé)");
    expect(t).not.toContain("Farine"); // à 0 : en rupture, pas négatif
    expect(r.nombre).toBe(2);
  });
});

describe("liens : chaque ligne mène à l'écran correspondant, en adresse absolue", () => {
  it("chaque puce est suivie de son lien absolu vers le domaine de production", async () => {
    const e = (await preparerEnvoiQuotidien(MATIN))!;
    const lignes = e.corps.split("\n");
    const puces = lignes.map((l, i) => ({ l, i })).filter((x) => x.l.startsWith("• "));
    expect(puces.length).toBeGreaterThanOrEqual(10);
    for (const { l, i } of puces) expect(lignes[i + 1], l).toMatch(/^ {2}→ https:\/\/gestion\.patesenfolie\.cd\/stock/);
    expect(e.corps).toContain(`→ https://gestion.patesenfolie.cd/stock/catalogue/${ids.farine}`);
    expect(e.corps).toMatch(/→ https:\/\/gestion\.patesenfolie\.cd\/stock\/factures\/[0-9a-f-]{36}/);
    expect(e.corps).toMatch(/→ https:\/\/gestion\.patesenfolie\.cd\/stock\/commandes\/[0-9a-f-]{36}/);
    expect(e.corps).toContain("→ https://gestion.patesenfolie.cd/stock/a-valider");
    expect(e.corps).not.toMatch(/→ \//); // jamais un lien relatif
  });

  it("le domaine suit NEXT_PUBLIC_SITE_URL quand il est défini (même règle que les rappels RH)", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://autre.exemple.cd/";
    const e = (await preparerEnvoiQuotidien(MATIN))!;
    expect(e.corps).toContain("→ https://autre.exemple.cd/stock/a-valider");
    expect(e.corps).not.toContain("gestion.patesenfolie.cd");
  });

  it("le sujet et le texte nomment les rubriques et le nombre de points", async () => {
    const e = (await preparerEnvoiQuotidien(MATIN))!;
    expect(e.sujet).toBe(`Pâtes en Folie · Stock : ${e.nombre} point(s) à signaler`);
    expect(e.nombre).toBe(4 + 2 + 1 + 1 + 2 + 2);
    expect(e.rubriques.map((r) => r.cle)).toEqual(["alertes", "factures", "dlc", "demandes", "bons", "negatifs"]);
    expect(e.corps).toContain("Voici ce que le Stock demande à voir ce 15/10/2026 :");
  });
});

describe("destinataires : la Direction et le rôle Stock, actifs — jamais le RH", () => {
  it("ADMIN et STOCK actifs, rien d'autre (ni RH, ni consultation, ni compta, ni salariés, ni compte désactivé)", async () => {
    const d1 = await destinatairesStock();
    expect(d1.map((x) => x.email)).toEqual(["direction@pef.cd", "stock@pef.cd"]);
    expect(d1.map((x) => x.role).sort()).toEqual(["ADMIN", "STOCK"]);
  });
});

describe("route /api/cron/stock-quotidien", () => {
  const appel = (init: { jeton?: string; query?: string } = {}) =>
    GET(new NextRequest(`https://gestion.patesenfolie.cd/api/cron/stock-quotidien${init.query ?? ""}`, { headers: init.jeton ? { authorization: `Bearer ${init.jeton}` } : {} }));

  it("refuse sans jeton, avec un mauvais jeton, et sans CRON_SECRET configuré — sans toucher la base ni envoyer", async () => {
    E.espion.actif = true; E.espion.lectures = 0;
    expect((await appel()).status).toBe(401);
    expect((await appel({ jeton: "mauvais" })).status).toBe(401);
    expect((await appel({ query: "?token=mauvais" })).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await appel({ jeton: SECRET })).status).toBe(401);
    E.espion.actif = false;
    expect(E.espion.lectures).toBe(0); // le jeton est vérifié AVANT toute lecture
    expect(M.email).not.toHaveBeenCalled();
    expect(M.push).not.toHaveBeenCalled();
  });

  it("avec le bon jeton (en-tête ou ?token=), envoie UN courriel aux seuls comptes Stock et une notification aux mêmes", async () => {
    const r = await appel({ jeton: SECRET });
    expect(r.status).toBe(200);
    const corps = await r.json();
    expect(corps).toMatchObject({ envoye: true, nombre: 12, destinataires: 2 });
    expect(M.email).toHaveBeenCalledTimes(1);
    const [a, sujet, texteMail] = M.email.mock.calls[0] as unknown as [string[], string, string];
    expect(a).toEqual(["direction@pef.cd", "stock@pef.cd"]);
    expect(a).not.toContain("rh@pef.cd"); // un compte RH seul ne reçoit rien du Stock
    expect(sujet).toContain("12 point(s) à signaler");
    expect(texteMail).toContain("ARTICLES EN RUPTURE OU SOUS LE SEUIL — 4");
    expect(M.push).toHaveBeenCalledTimes(1);
    expect((M.push.mock.calls[0] as unknown as [string[]])[0].sort()).toEqual([admin.id, stock.id].sort());

    M.email.mockClear();
    expect((await appel({ query: `?token=${SECRET}` })).status).toBe(200);
    expect(M.email).toHaveBeenCalledTimes(1);
  });

  it("aperçu (?apercu=1) : rend le texte SANS envoyer ni courriel ni notification", async () => {
    const r = await appel({ jeton: SECRET, query: "?apercu=1" });
    const corps = await r.json();
    expect(corps).toMatchObject({ apercu: true, envoye: false, destinataires: 2 });
    expect(corps.sujet).toContain("point(s) à signaler");
    expect(corps.corps).toContain("FACTURES FOURNISSEURS ÉCHUES OU À ÉCHÉANCE SOUS 7 JOURS — 2");
    expect(corps.destinataires).toBe(2); // le nombre, jamais les adresses
    expect(JSON.stringify(corps)).not.toContain("direction@pef.cd");
    expect(M.email).not.toHaveBeenCalled();
    expect(M.push).not.toHaveBeenCalled();
    // L'aperçu exige le jeton, comme l'envoi.
    expect((await appel({ query: "?apercu=1" })).status).toBe(401);
  });

  it("n'écrit RIEN dans les données : espion sur toute écriture + empreinte des tables avant / après", async () => {
    const avant = await empreinte();
    E.espion.actif = true; E.espion.refus = [];
    await appel({ jeton: SECRET });
    await appel({ jeton: SECRET, query: "?apercu=1" });
    await preparerEnvoiQuotidien(MATIN);
    E.espion.actif = false;
    expect(E.espion.refus).toEqual([]);
    expect(await empreinte()).toBe(avant);
  });

  it("l'espion mord : une écriture est bien détectée (falsification)", async () => {
    E.espion.actif = true; E.espion.refus = [];
    await expect(Promise.resolve().then(() => prismaEspionne.config.update({ where: { id: "singleton" }, data: { moisCourant: 1 } }))).rejects.toThrow(/écriture interdite/);
    expect(() => prismaEspionne.$executeRaw`UPDATE "Config" SET "moisCourant" = 1`).toThrow(/écriture interdite/);
    E.espion.actif = false;
    expect(E.espion.refus).toEqual(["config.update", "$executeRaw"]);
    expect((await E.espion.client.config.findUnique({ where: { id: "singleton" } }))!.moisCourant).toBe(10);
  });
});

describe("rien à signaler : rien n'est envoyé", () => {
  it("après avoir réglé / retiré tout ce qui était à signaler, aucun courriel ni notification (route ET module)", async () => {
    const p = E.espion.client;
    await p.stock.updateMany({ data: { quantite: 50, stockMinimum: 1 } });
    await p.factureFournisseur.updateMany({ data: { statut: "REGLEE", resteAPayerUSD: 0, resteAPayerCDF: null } });
    await p.mouvementStock.deleteMany({ where: { dlc: { not: null } } });
    await p.demandeValidationStock.deleteMany({});
    await p.bonDeCommande.updateMany({ data: { statut: "RECU" } });
    expect(await preparerEnvoiQuotidien(MATIN)).toBeNull();

    const r = await GET(new NextRequest("https://gestion.patesenfolie.cd/api/cron/stock-quotidien", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(await r.json()).toEqual({ envoye: false, apercu: false, nombre: 0 });
    expect(M.email).not.toHaveBeenCalled();
    expect(M.push).not.toHaveBeenCalled();
  });
});
