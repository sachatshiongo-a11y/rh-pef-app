import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// LA CLOCHE LISTE TOUT CE QU'ELLE COMPTE (Direction, 13/10/2026) — preuve sur une base éphémère, avec les VRAIS chargeurs.
// Avant : la liste montrait les 30 plus récentes (lues ou non) alors que le chiffre comptait TOUTES les non lues ; une non lue
// ancienne était comptée sans jamais apparaître. Maintenant : toutes les non lues visibles par le compte, complétées par les lues
// les plus récentes jusqu'à 30 éléments, du plus récent au plus ancien ; au-delà d'un plafond de sécurité (300), la cloche le dit.
//  1. 40 notifications dont 35 non lues → les 35 sont listées (y compris les plus anciennes).
//  2. Complément : peu de non lues → complétées par les lues récentes jusqu'à 30.
//  3. Cloisonnement inchangé : rien d'un autre espace, rien d'adressé à un autre compte, rien de la cloche d'un salarié.
//  4. Plafond annoncé : 305 non lues → 300 listées, le total reste 305, `nonLuesListees` le dit.
//  5. Cloche du salarié : même défaut, même correction (20 éléments).
//  6. Coût : deux lectures indexées (non lues, lues récentes) ; le COMPTE n'est lu que si le plafond est atteint.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, requetes: [] as string[] }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, modele: string) => {
      const m = (H.client as unknown as Record<string, unknown>)[modele];
      if (typeof m === "function") return (m as (...a: unknown[]) => unknown).bind(H.client);
      return new Proxy({}, {
        get: (_u, methode: string) => (...args: unknown[]) => {
          H.requetes.push(`${modele}.${methode}`);
          return ((m as Record<string, (...a: unknown[]) => unknown>)[methode]).apply(m, args);
        },
      });
    },
  }),
}));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/email", () => ({ envoyerEmail: async () => {} }));

const NOTIFS = await import("@/lib/notifications");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

type Compte = "DIR" | "MGR" | "STK" | "STK2" | "EMP" | "EMP2";
const ROLES: Record<Compte, Role> = { DIR: "ADMIN", MGR: "MANAGER", STK: "STOCK", STK2: "STOCK", EMP: "EMPLOYE", EMP2: "EMPLOYE" };
const ids = {} as Record<Compte, string>;
const compte = (c: Compte) => ({ id: ids[c], role: ROLES[c], accesStock: false });
const cloche = (c: Compte) => NOTIFS.chargerNotificationsCompte(compte(c));

/** Une minute d'écart par rang : rang 0 = la plus ancienne. */
const T0 = new Date("2026-09-01T08:00:00.000Z").getTime();
const quand = (rang: number) => new Date(T0 + rang * 60_000);
async function semer(n: number, p: { domaine: string; lu: (rang: number) => boolean; debut?: number; destinataireUserId?: string | null; prefixe: string }) {
  const debut = p.debut ?? 0;
  await prisma.notification.createMany({
    data: Array.from({ length: n }, (_, k) => ({
      domaine: p.domaine, type: "AUTRE", message: `${p.prefixe} ${debut + k}`, lien: "/a-valider", lu: p.lu(debut + k),
      destinataireUserId: p.destinataireUserId ?? null, createdAt: quand(debut + k),
    })),
  });
}
const vider = () => prisma.notification.deleteMany({});
const rangs = (items: { message: string }[]) => items.map((i) => Number(i.message.split(" ").pop()));
const decroissant = (r: number[]) => r.every((x, i) => i === 0 || r[i - 1] > x);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const c of Object.keys(ROLES) as Compte[]) ids[c] = (await prisma.user.create({ data: { email: `${c.toLowerCase()}@pef.test`, nom: c, role: ROLES[c] } })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("la cloche liste TOUTES les non lues qu'elle compte", () => {
  it("40 notifications dont 35 non lues : les 35 sont listées, y compris les plus anciennes ; les 5 lues, plus récentes, ne les chassent pas", async () => {
    await vider();
    // Les 35 plus ANCIENNES sont non lues (rangs 0-34), les 5 plus récentes sont lues (rangs 35-39) : avant, la liste de
    // 30 montrait 5 lues + 25 non lues, et 10 non lues comptées n'apparaissaient nulle part.
    await semer(40, { domaine: "RH", lu: (r) => r >= 35, prefixe: "n" });
    const c = await cloche("DIR");
    expect(c.nonLues).toBe(35);
    expect(c.nonLuesListees).toBe(35);
    expect(c.items.filter((i) => !i.lu)).toHaveLength(35);
    expect(new Set(rangs(c.items.filter((i) => !i.lu)))).toEqual(new Set(Array.from({ length: 35 }, (_, i) => i))); // aucune non lue manquante
    expect(c.items).toHaveLength(35); // 35 non lues > 30 : pas de lue en complément
    expect(decroissant(rangs(c.items))).toBe(true); // du plus récent au plus ancien
  });

  it("peu de non lues : complétées par les lues LES PLUS RÉCENTES jusqu'à 30 au total, triées du plus récent au plus ancien", async () => {
    await vider();
    // 40 lues (rangs 0-39) + 3 non lues anciennes (rangs 100-102 sont les plus récentes ; ici on mélange : non lues = rangs 5, 20, 60).
    await semer(61, { domaine: "RH", lu: (r) => !(r === 5 || r === 20 || r === 60), prefixe: "n" });
    const c = await cloche("MGR");
    expect(c.nonLues).toBe(3);
    expect(c.nonLuesListees).toBe(3);
    expect(c.items).toHaveLength(30);
    const r = rangs(c.items);
    expect(decroissant(r)).toBe(true);
    expect(r).toContain(5); // la non lue ancienne est là...
    expect(r).toContain(20);
    expect(r).toContain(60);
    // ... et le reste est fait des 27 lues les plus récentes (rangs 59 → 33, hors 60 non lue).
    const lues = r.filter((x) => ![5, 20, 60].includes(x));
    expect(lues).toEqual(Array.from({ length: 27 }, (_, i) => 59 - i));
  });

  it("sans aucune non lue : les 30 lues les plus récentes, comme avant", async () => {
    await vider();
    await semer(45, { domaine: "RH", lu: () => true, prefixe: "n" });
    const c = await cloche("DIR");
    expect(c.nonLues).toBe(0);
    expect(c.nonLuesListees).toBe(0);
    expect(rangs(c.items)).toEqual(Array.from({ length: 30 }, (_, i) => 44 - i));
  });

  it("moins de 30 notifications au total : toutes sont listées", async () => {
    await vider();
    await semer(12, { domaine: "RH", lu: (r) => r % 2 === 0, prefixe: "n" });
    const c = await cloche("DIR");
    expect(c.items).toHaveLength(12);
    expect(c.nonLues).toBe(6);
  });
});

describe("cloisonnement inchangé : la correction ne montre pas plus que ce que le compte voit", () => {
  it("les 35 non lues d'un autre espace, d'un autre compte ou d'un salarié ne sont ni comptées ni listées", async () => {
    await vider();
    await semer(5, { domaine: "RH", lu: () => false, prefixe: "rh" });
    await semer(35, { domaine: "STOCK", lu: () => false, prefixe: "stock", debut: 100 }); // partagé du Stock
    await semer(35, { domaine: "STOCK", lu: () => false, prefixe: "adresse", debut: 200, destinataireUserId: ids.STK2 }); // adressé à STK2
    await semer(35, { domaine: "SALARIE", lu: () => false, prefixe: "salarie", debut: 300, destinataireUserId: ids.EMP }); // cloche perso d'un salarié
    await semer(35, { domaine: "EXPLOITATION", lu: () => false, prefixe: "explo", debut: 400, destinataireUserId: ids.DIR }); // adressé à la Direction

    const mgr = await cloche("MGR"); // RH seulement
    expect(mgr.nonLues).toBe(5);
    expect(mgr.items.map((i) => i.message.split(" ")[0]).every((p) => p === "rh")).toBe(true);

    const stk = await cloche("STK"); // le Stock partagé, rien de ce qui est adressé à STK2
    expect(stk.nonLues).toBe(35);
    expect(stk.nonLuesListees).toBe(35);
    expect(stk.items.every((i) => i.message.startsWith("stock"))).toBe(true);

    const stk2 = await cloche("STK2"); // le partagé + ce qui lui est adressé : 70 non lues, 70 listées
    expect(stk2.nonLues).toBe(70);
    expect(stk2.items).toHaveLength(70);
    expect(stk2.items.every((i) => i.message.startsWith("stock") || i.message.startsWith("adresse"))).toBe(true);

    const dir = await cloche("DIR"); // RH + Stock partagé + Exploitation adressée à lui ; ni « adresse » (STK2) ni « salarie »
    expect(dir.nonLues).toBe(5 + 35 + 35);
    expect(dir.items).toHaveLength(75);
    expect(dir.items.some((i) => i.message.startsWith("adresse") || i.message.startsWith("salarie"))).toBe(false);

    const emp = await cloche("EMP"); // un salarié simple n'a aucune cloche d'espace
    expect(emp.items).toEqual([]);
    expect(emp.nonLues).toBe(0);
  });
});

describe("plafond de sécurité : annoncé, jamais silencieux", () => {
  it("305 non lues : 300 listées (les plus récentes), le total reste 305, `nonLuesListees` le dit ; le COMPTE n'est lu qu'ici", async () => {
    await vider();
    await semer(305, { domaine: "RH", lu: () => false, prefixe: "n" });
    expect(NOTIFS.PLAFOND_NON_LUES_CLOCHE).toBe(300);
    H.requetes = [];
    const c = await cloche("DIR");
    expect(c.nonLues).toBe(305);
    expect(c.nonLuesListees).toBe(300);
    expect(c.items).toHaveLength(300);
    expect(rangs(c.items)).toEqual(Array.from({ length: 300 }, (_, i) => 304 - i)); // les 300 plus récentes
    expect(H.requetes.sort()).toEqual(["config.findUnique", "notification.count", "notification.findMany", "notification.findMany"]);
  });

  it("exactement 300 non lues : rien n'est coupé, pas d'annonce (le total est celui de la liste)", async () => {
    await vider();
    await semer(300, { domaine: "RH", lu: () => false, prefixe: "n" });
    const c = await cloche("DIR");
    expect(c.nonLues).toBe(300);
    expect(c.nonLuesListees).toBe(300);
    expect(c.items).toHaveLength(300);
  });
});

describe("coût : deux lectures indexées, pas de compte hors plafond", () => {
  it("une cloche ordinaire : non lues + lues récentes (+ config pour la RH), aucun count", async () => {
    await vider();
    await semer(50, { domaine: "RH", lu: (r) => r % 3 !== 0, prefixe: "n" });
    H.requetes = [];
    await cloche("DIR");
    expect(H.requetes.sort()).toEqual(["config.findUnique", "notification.findMany", "notification.findMany"]);
    H.requetes = [];
    await cloche("STK");
    expect(H.requetes.sort()).toEqual(["notification.findMany", "notification.findMany"]);
  });
});

describe("cloche du salarié : même défaut, même correction", () => {
  it("25 non lues + 10 lues plus récentes : les 25 sont listées (la liste d'avant en montrait 20)", async () => {
    await vider();
    await semer(35, { domaine: "SALARIE", lu: (r) => r >= 25, prefixe: "s", destinataireUserId: ids.EMP });
    await semer(40, { domaine: "SALARIE", lu: () => false, prefixe: "autre", debut: 100, destinataireUserId: ids.EMP2 }); // le salarié voisin : jamais mélangé
    const c = await NOTIFS.chargerNotificationsSalarie(ids.EMP);
    expect(c.nonLues).toBe(25);
    expect(c.nonLuesListees).toBe(25);
    expect(c.items).toHaveLength(25);
    expect(c.items.every((i) => i.message.startsWith("s ") && !i.lu)).toBe(true);
    expect(decroissant(rangs(c.items))).toBe(true);
  });

  it("peu de non lues : complétées par les lues récentes jusqu'à 20", async () => {
    await vider();
    await semer(40, { domaine: "SALARIE", lu: (r) => r !== 2, prefixe: "s", destinataireUserId: ids.EMP });
    const c = await NOTIFS.chargerNotificationsSalarie(ids.EMP);
    expect(c.nonLues).toBe(1);
    expect(c.items).toHaveLength(20);
    const r = rangs(c.items);
    expect(r).toContain(2);
    expect(r.filter((x) => x !== 2)).toEqual(Array.from({ length: 19 }, (_, i) => 39 - i));
    expect(decroissant(r)).toBe(true);
  });

  it("le plafond s'applique aussi à la cloche du salarié, et il est annoncé", async () => {
    await vider();
    await semer(302, { domaine: "SALARIE", lu: () => false, prefixe: "s", destinataireUserId: ids.EMP });
    const c = await NOTIFS.chargerNotificationsSalarie(ids.EMP);
    expect(c.nonLues).toBe(302);
    expect(c.nonLuesListees).toBe(300);
    expect(c.items).toHaveLength(300);
  });
});
