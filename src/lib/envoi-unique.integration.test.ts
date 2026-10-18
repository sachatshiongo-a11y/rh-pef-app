import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import type { Alerte } from "@/lib/alertes";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — UN SEUL ENVOI PAR PÉRIODE (Direction, 2026-10-18).
// GitHub (en retard de plusieurs heures) ET cron-job.org (à 8 h) appellent les mêmes routes : le second appel du jour
// ne doit rien renvoyer, même s'il arrive en même temps que le premier. Un échec n'empêche pas le réessai.
// Les vraies routes sont appelées ; seuls l'envoi (courriel, push) et le calcul du contenu sont simulés.
const M = vi.hoisted(() => ({
  prisma: undefined as unknown as PrismaClient,
  email: vi.fn(async (_a: string[], _s: string, _c: string) => true),
  push: vi.fn(async () => {}),
  alertes: [] as Alerte[],
  stock: { nombre: 2 } as { nombre: number } | null,
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, p) => (M.prisma as unknown as Record<string | symbol, unknown>)[p] }) }));
vi.mock("@/lib/email", () => ({ envoyerEmail: M.email }));
vi.mock("@/lib/push", () => ({ envoyerPush: M.push }));
vi.mock("@/lib/alertes", () => ({ calculerAlertes: async () => M.alertes }));
vi.mock("@/lib/envois-stock/destinataires", () => ({ destinatairesStock: async () => [{ id: "s1", email: "stock@pef.cd" }] }));
vi.mock("@/lib/envois-stock/quotidien", () => ({
  preparerEnvoiQuotidien: async () => (M.stock ? { sujet: "Stock", corps: "Corps", nombre: M.stock.nombre, rubriques: [{ cle: "alertes", titre: "Alertes", nombre: 1 }] } : null),
}));
vi.mock("@/lib/envois-stock/mensuel", () => ({
  preparerRapportMensuel: async () => ({ sujet: "Mensuel", corps: "Corps", rubriques: [], mois: { cle: "2026-09", libelle: "Septembre 2026" } }),
}));

const { GET: alertes } = await import("@/app/api/cron/alertes/route");
const { GET: stockQuotidien } = await import("@/app/api/cron/stock-quotidien/route");
const { GET: stockMensuel } = await import("@/app/api/cron/stock-mensuel/route");
const { GET: rapportMensuel } = await import("@/app/api/cron/rapport-mensuel/route");
const { envoiUnique, cleJour, DUREE_RESERVATION_MS } = await import("@/lib/envoi-unique");

const SECRET = "secret-de-test-envoi-unique";
const CONGE: Alerte = { type: "CONGE_NON_VALIDE", espace: "RH", niveau: "urgent", message: "Congé de Awa à valider.", lien: "/conges" };
// Lundi 19 octobre 2026, 08 h à Kinshasa (07 h UTC) : l'heure du déclencheur précis.
const HUIT_HEURES = new Date("2026-10-19T07:00:00Z");
const route = (nom: string, query = "", jeton: string | null = SECRET) =>
  new NextRequest(`https://gestion.patesenfolie.cd/api/cron/${nom}${query}`, { headers: jeton ? { authorization: `Bearer ${jeton}` } : {} });
const appeler = (h: (r: NextRequest) => Promise<Response>, nom: string, query = "", jeton: string | null = SECRET) => h(route(nom, query, jeton));
const marqueurs = (cle?: string) => M.prisma.journalAudit.findMany({ where: { entite: "EnvoiPlanifie", ...(cle ? { entiteId: cle } : {}) }, orderBy: { date: "asc" } });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fermer: () => Promise<void>;
let adminId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  fermer = db.fermer; M.prisma = db.prisma;
  adminId = (await db.prisma.user.create({ data: { email: "direction@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
});
afterAll(async () => { await fermer(); });

beforeEach(async () => {
  process.env.CRON_SECRET = SECRET;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(HUIT_HEURES);
  M.email.mockReset(); M.email.mockResolvedValue(true);
  M.push.mockClear();
  M.alertes = [CONGE]; M.stock = { nombre: 2 };
  await M.prisma.journalAudit.deleteMany({ where: { entite: "EnvoiPlanifie" } });
});
afterEach(() => { vi.useRealTimers(); });

describe("rappels RH : un seul courriel par jour civil de Kinshasa", () => {
  it("deux appels le même jour (GitHub en retard puis cron-job.org) : un seul envoi, le second répond dejaEnvoye sans renvoyer", async () => {
    const un = await appeler(alertes, "alertes");
    expect(un.status).toBe(200);
    expect(await un.json()).toMatchObject({ envoye: true, nombre: 1 });
    vi.setSystemTime(new Date("2026-10-19T11:12:00Z")); // 4 h de retard : même jour civil
    const deux = await appeler(alertes, "alertes");
    expect(deux.status).toBe(200);
    expect(await deux.json()).toEqual({ envoye: false, dejaEnvoye: true });
    expect(M.email).toHaveBeenCalledTimes(1);
    expect(M.push).toHaveBeenCalledTimes(1);
    const lignes = await marqueurs();
    expect(lignes.map((l) => [l.entiteId, l.champ, l.userId])).toEqual([["rappels-2026-10-19", "envoye", adminId]]);
  });

  it("deux appels SIMULTANÉS (envoi lent) : un seul courriel, l'autre est averti qu'un envoi est en cours", async () => {
    M.email.mockImplementation(async () => { await pause(250); return true; });
    const [a, b] = await Promise.all([appeler(alertes, "alertes"), appeler(alertes, "alertes")]);
    const corps = [await a.json(), await b.json()];
    expect(M.email).toHaveBeenCalledTimes(1);
    expect(corps.filter((c) => c.envoye === true)).toHaveLength(1);
    expect(corps.filter((c) => c.dejaEnvoye === true)).toHaveLength(1);
    expect(await marqueurs()).toHaveLength(1);
    // Et cinq à la fois sur un autre jour.
    vi.setSystemTime(new Date("2026-10-20T07:00:00Z"));
    await Promise.all(Array.from({ length: 5 }, () => appeler(alertes, "alertes")));
    expect(M.email).toHaveBeenCalledTimes(2);
  });

  it("le lendemain, c'est un nouvel envoi ; la frontière est minuit à KINSHASA (23 h UTC), pas minuit UTC", async () => {
    await appeler(alertes, "alertes");
    vi.setSystemTime(new Date("2026-10-19T22:59:00Z")); // 23 h 59 à Kinshasa : toujours le 19
    expect((await (await appeler(alertes, "alertes")).json()).dejaEnvoye).toBe(true);
    vi.setSystemTime(new Date("2026-10-19T23:01:00Z")); // 00 h 01 le 20 à Kinshasa
    expect((await (await appeler(alertes, "alertes")).json()).envoye).toBe(true);
    expect(M.email).toHaveBeenCalledTimes(2);
    expect((await marqueurs()).map((l) => l.entiteId)).toEqual(["rappels-2026-10-19", "rappels-2026-10-20"]);
  });

  it("échec puis réessai : le 502 n'écrit aucun marqueur, le réessai renvoie, le troisième appel est refusé", async () => {
    M.email.mockResolvedValueOnce(false);
    const echec = await appeler(alertes, "alertes");
    expect(echec.status).toBe(502);
    expect(await echec.json()).toMatchObject({ envoye: false, erreur: "courriel" });
    expect(await marqueurs()).toEqual([]); // ni « envoye », ni réservation qui traîne
    const reessai = await appeler(alertes, "alertes");
    expect(reessai.status).toBe(200);
    expect(await reessai.json()).toMatchObject({ envoye: true });
    expect((await (await appeler(alertes, "alertes")).json()).dejaEnvoye).toBe(true);
    expect(M.email).toHaveBeenCalledTimes(2);
  });

  it("rien à signaler : rien n'est envoyé ni mémorisé ; si une alerte apparaît plus tard dans la journée, elle part", async () => {
    M.alertes = [];
    expect(await (await appeler(alertes, "alertes")).json()).toEqual({ envoye: false, nombre: 0 });
    expect(await marqueurs()).toEqual([]);
    M.alertes = [CONGE];
    expect((await (await appeler(alertes, "alertes")).json()).envoye).toBe(true);
  });

  it("?forcer=1 (avec le jeton) renvoie malgré le marqueur ; sans le jeton : 401, rien ne part", async () => {
    await appeler(alertes, "alertes");
    expect((await (await appeler(alertes, "alertes", "?forcer=1")).json()).envoye).toBe(true);
    expect(M.email).toHaveBeenCalledTimes(2);
    const refus = await appeler(alertes, "alertes", "?forcer=1", null);
    expect(refus.status).toBe(401);
    expect((await appeler(alertes, "alertes", "?forcer=1", "mauvais")).status).toBe(401);
    expect(M.email).toHaveBeenCalledTimes(2);
    // Après un forçage, l'appel ordinaire reste refusé (le marqueur est toujours là).
    expect((await (await appeler(alertes, "alertes")).json()).dejaEnvoye).toBe(true);
  });

  it("une exception pendant l'envoi libère la réservation : l'appel suivant n'attend pas 10 minutes", async () => {
    M.email.mockRejectedValueOnce(new Error("boum"));
    await expect(appeler(alertes, "alertes")).rejects.toThrow("boum");
    expect(await marqueurs()).toEqual([]);
    expect((await (await appeler(alertes, "alertes")).json()).envoye).toBe(true);
  });
});

describe("réservation en cours et réservation abandonnée", () => {
  const poser = (cle: string, minutes: number) =>
    M.prisma.journalAudit.create({ data: { entite: "EnvoiPlanifie", entiteId: cle, champ: "reserve", userId: adminId, date: new Date(HUIT_HEURES.getTime() - minutes * 60_000) } });

  it("une réservation de 2 minutes (envoi en cours ailleurs) : pas de second envoi, réponse enCours", async () => {
    await poser("rappels-2026-10-19", 2);
    expect(await (await appeler(alertes, "alertes")).json()).toEqual({ envoye: false, dejaEnvoye: true, enCours: true });
    expect(M.email).not.toHaveBeenCalled();
  });

  it("une réservation de plus de 10 minutes (instance coupée en plein envoi) est tenue pour abandonnée et nettoyée", async () => {
    expect(DUREE_RESERVATION_MS).toBe(600_000);
    await poser("rappels-2026-10-19", 11);
    expect((await (await appeler(alertes, "alertes")).json()).envoye).toBe(true);
    expect((await marqueurs()).map((l) => l.champ)).toEqual(["envoye"]);
  });

  it("relecture 2026-10-18 : une réservation orpheline d'un AUTRE jour est purgée au passage suivant (la clé change chaque jour)", async () => {
    await poser("rappels-2026-10-12", 60 * 24 * 7);
    await poser("stock-2026-10-19", 3); // récente, d'une autre route : intacte
    await appeler(alertes, "alertes");
    expect((await marqueurs()).map((l) => `${l.entiteId}:${l.champ}`).sort()).toEqual(["rappels-2026-10-19:envoye", "stock-2026-10-19:reserve"]);
  });

  it("relecture 2026-10-18 : la ligne du journal dit en clair que c'est un envoi automatique et que l'utilisateur n'a rien fait", async () => {
    await appeler(alertes, "alertes");
    const [l] = await marqueurs();
    expect(l.nouvelleValeur).toMatch(/Courriel planifié ENVOYÉ par le serveur/);
    expect(l.nouvelleValeur).toMatch(/n'a effectué aucune action/);
    await appeler(alertes, "alertes", "?forcer=1");
    expect((await marqueurs()).map((x) => x.nouvelleValeur).join("|")).toMatch(/renvoi forcé/);
  });
});

describe("sans compte Direction actif : on envoie sans mémoire plutôt que de bloquer", () => {
  it("aucun ADMIN actif pour porter la ligne d'audit", async () => {
    await M.prisma.user.update({ where: { id: adminId }, data: { actif: false } });
    try {
      const r = await envoiUnique("essai-sans-admin", {}, async () => ({ reussi: true, resultat: { corps: { ok: true }, status: 200 } }));
      expect(r).toEqual({ dejaEnvoye: false, resultat: { corps: { ok: true }, status: 200 } });
      expect(await marqueurs("essai-sans-admin")).toEqual([]);
    } finally {
      await M.prisma.user.update({ where: { id: adminId }, data: { actif: true } });
    }
  });
});

describe("courriel quotidien du Stock : même protection, clé « stock-AAAA-MM-JJ »", () => {
  it("deux appels : un seul envoi ; échec puis réessai ; simultanés ; forcer ; l'aperçu ne mémorise rien", async () => {
    expect((await (await appeler(stockQuotidien, "stock-quotidien", "?apercu=1")).json()).apercu).toBe(true);
    expect(await marqueurs()).toEqual([]);

    M.email.mockResolvedValueOnce(false);
    expect((await appeler(stockQuotidien, "stock-quotidien")).status).toBe(502);
    expect(await marqueurs()).toEqual([]);
    expect(await (await appeler(stockQuotidien, "stock-quotidien")).json()).toMatchObject({ envoye: true, destinataires: 1 });
    expect(await (await appeler(stockQuotidien, "stock-quotidien")).json()).toEqual({ envoye: false, dejaEnvoye: true });
    expect(M.email).toHaveBeenCalledTimes(2);
    expect((await marqueurs()).map((l) => l.entiteId)).toEqual(["stock-2026-10-19"]);

    expect((await (await appeler(stockQuotidien, "stock-quotidien", "?forcer=1")).json()).envoye).toBe(true);
    expect(M.email).toHaveBeenCalledTimes(3);

    vi.setSystemTime(new Date("2026-10-20T07:00:00Z"));
    M.email.mockImplementation(async () => { await pause(200); return true; });
    await Promise.all([appeler(stockQuotidien, "stock-quotidien"), appeler(stockQuotidien, "stock-quotidien")]);
    expect(M.email).toHaveBeenCalledTimes(4);
  });

  it("les rappels RH et le courriel du Stock ont chacun leur clé : l'un n'empêche pas l'autre", async () => {
    await appeler(alertes, "alertes");
    expect((await (await appeler(stockQuotidien, "stock-quotidien")).json()).envoye).toBe(true);
    expect((await marqueurs()).map((l) => l.entiteId).sort()).toEqual(["rappels-2026-10-19", "stock-2026-10-19"]);
  });

  it("rien à signaler : rien n'est envoyé ni mémorisé (réponse inchangée)", async () => {
    M.stock = null;
    expect(await (await appeler(stockQuotidien, "stock-quotidien")).json()).toEqual({ envoye: false, apercu: false, nombre: 0 });
    expect(await marqueurs()).toEqual([]);
  });
});

describe("rapports mensuels : un seul envoi par mois rapporté", () => {
  it("rapport RH du 1er : deux appels = un envoi ; la clé est le mois rapporté ; échec puis réessai ; forcer", async () => {
    vi.setSystemTime(new Date("2026-10-01T06:00:00Z")); // 1er octobre → rapport de septembre
    M.email.mockResolvedValueOnce(false);
    expect((await appeler(rapportMensuel, "rapport-mensuel")).status).toBe(502);
    expect(await marqueurs()).toEqual([]);
    expect(await (await appeler(rapportMensuel, "rapport-mensuel")).json()).toMatchObject({ envoye: true, mois: "Septembre 2026" });
    expect(await (await appeler(rapportMensuel, "rapport-mensuel")).json()).toMatchObject({ envoye: false, dejaEnvoye: true });
    expect(M.email).toHaveBeenCalledTimes(2);
    expect((await marqueurs()).map((l) => l.entiteId)).toEqual(["rapport-mensuel-2026-09"]);
    expect((await (await appeler(rapportMensuel, "rapport-mensuel", "?forcer=1")).json()).envoye).toBe(true);
    expect(M.email).toHaveBeenCalledTimes(3);
  });

  it("rapport du Stock : idem, clé « stock-mensuel-2026-09 »", async () => {
    expect(await (await appeler(stockMensuel, "stock-mensuel")).json()).toMatchObject({ envoye: true, mois: "Septembre 2026" });
    expect(await (await appeler(stockMensuel, "stock-mensuel")).json()).toMatchObject({ envoye: false, dejaEnvoye: true });
    expect(M.email).toHaveBeenCalledTimes(1);
    expect((await marqueurs()).map((l) => l.entiteId)).toEqual(["stock-mensuel-2026-09"]);
    expect((await (await appeler(stockMensuel, "stock-mensuel", "?forcer=1")).json()).envoye).toBe(true);
    expect((await appeler(stockMensuel, "stock-mensuel", "", null)).status).toBe(401);
  });
});

describe("clé de jour", () => {
  it("jour civil de Kinshasa", () => {
    expect(cleJour("rappels", new Date("2026-10-18T23:30:00Z"))).toBe("rappels-2026-10-19");
    expect(cleJour("stock", new Date("2026-10-19T22:59:59Z"))).toBe("stock-2026-10-19");
  });
});
