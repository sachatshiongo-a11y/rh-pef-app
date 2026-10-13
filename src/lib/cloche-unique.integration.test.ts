import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// LA CLOCHE UNIQUE (2026-10-12) — preuve sur une base éphémère, avec les VRAIS chargeurs et les VRAIES actions de cloche :
// une seule cloche dans les espaces RH, Stock et Exploitation, qui montre les notifications de TOUS les espaces du compte
// (chacune avec son domaine, l'étiquette de la cloche) et jamais celles d'un espace qui n'est pas le sien.
//  1. QUI VOIT QUOI : la Direction les trois espaces, chaque autre rôle le sien ; une notification ADRESSÉE à un compte
//     n'est vue que de lui ; la cloche personnelle du salarié (SALARIE) n'est jamais dans la cloche d'espace.
//  2. « TOUT MARQUER LU » ne touche que ce que le compte voit (même ensemble que la cloche).
//  3. SUPPRIMER / MARQUER : les gardes de `peutToucherNotification` tiennent, rien n'est écrit en cas de refus.
//  4. COÛT : au plus trois requêtes par cloche, quel que soit le nombre d'espaces.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, requetes: [] as string[] }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, modele: string) => {
      const m = (H.client as unknown as Record<string, unknown>)[modele];
      if (typeof m === "function") return (m as (...a: unknown[]) => unknown).bind(H.client);
      // Chaque requête d'un modèle est comptée (nom du modèle + de la méthode).
      return new Proxy({}, {
        get: (_u, methode: string) => (...args: unknown[]) => {
          H.requetes.push(`${modele}.${methode}`);
          return ((m as Record<string, (...a: unknown[]) => unknown>)[methode]).apply(m, args);
        },
      });
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/email", () => ({ envoyerEmail: async () => {} }));

const NOTIFS = await import("@/lib/notifications");
const ACTIONS = await import("@/app/(app)/notifications-actions");
const { MESSAGE_NOTIFICATION_REFUSEE, domainesGerables } = await import("@/lib/acces-notification");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

type Compte = "DIR" | "MGR" | "VIEW" | "STK" | "STK2" | "CPT" | "CPT2" | "EMP" | "EMPS";
const COMPTES: Record<Compte, { role: Role; accesStock?: boolean }> = {
  DIR: { role: "ADMIN" }, MGR: { role: "MANAGER" }, VIEW: { role: "VIEWER" }, STK: { role: "STOCK" }, STK2: { role: "STOCK" },
  CPT: { role: "COMPTA" }, CPT2: { role: "COMPTA" }, EMP: { role: "EMPLOYE" }, EMPS: { role: "EMPLOYE", accesStock: true },
};
const ids = {} as Record<Compte, string>;
const N = {} as Record<"rh" | "stock" | "exploDir" | "exploCpt" | "stockStk" | "salarie", string>;

const compte = (c: Compte) => ({ id: ids[c], role: COMPTES[c].role, accesStock: !!COMPTES[c].accesStock });
function en(c: Compte) { A.user = { ...compte(c), email: `${c}@pef.test`, nom: c, employeeId: null }; }
const vues = async (c: Compte) => (await NOTIFS.chargerNotificationsCompte(compte(c)));
const idsVus = async (c: Compte) => (await vues(c)).items.map((i) => i.id).sort();
const lues = async () => Object.fromEntries(await Promise.all(Object.entries(N).map(async ([k, id]) => [k, (await prisma.notification.findUniqueOrThrow({ where: { id } })).lu])));
const existe = async (id: string) => (await prisma.notification.count({ where: { id } })) === 1;
const tousSont = (...cles: (keyof typeof N)[]) => cles.map((k) => N[k]).sort();

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const c of Object.keys(COMPTES) as Compte[]) {
    ids[c] = (await prisma.user.create({ data: { email: `${c.toLowerCase()}@pef.test`, nom: c, role: COMPTES[c].role } })).id;
  }
  const n = (domaine: string, message: string, destinataireUserId: string | null = null) =>
    prisma.notification.create({ data: { domaine, type: "AUTRE", message, destinataireUserId, lien: "/a-valider" } }).then((x) => x.id);
  N.rh = await n("RH", "Congé à valider");
  N.stock = await n("STOCK", "Bon de commande à valider");
  N.exploDir = await n("EXPLOITATION", "Demande de ratios reçue", ids.DIR);
  N.exploCpt = await n("EXPLOITATION", "Demande de ratios refusée", ids.CPT);
  N.stockStk = await n("STOCK", "Votre demande de stock est approuvée", ids.STK);
  N.salarie = await n("SALARIE", "Votre congé est approuvé", ids.EMP);
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("cloche unique — chaque compte voit les notifications de TOUS ses espaces, et d'eux seulement", () => {
  it("les domaines gérés par rôle : Direction les trois, les autres le leur, un salarié simple aucun", () => {
    expect(domainesGerables(compte("DIR"))).toEqual(["RH", "STOCK", "EXPLOITATION"]);
    expect(domainesGerables(compte("MGR"))).toEqual(["RH"]);
    expect(domainesGerables(compte("VIEW"))).toEqual(["RH"]);
    expect(domainesGerables(compte("STK"))).toEqual(["STOCK"]);
    expect(domainesGerables(compte("CPT"))).toEqual(["EXPLOITATION"]);
    expect(domainesGerables(compte("EMP"))).toEqual([]);
    expect(domainesGerables(compte("EMPS"))).toEqual(["STOCK"]);
  });

  it("Direction : RH + Stock partagés et ce qui LUI est adressé en Exploitation — pas ce qui est adressé à d'autres, pas la cloche d'un salarié", async () => {
    const c = await vues("DIR");
    expect(c.items.map((i) => i.id).sort()).toEqual(tousSont("rh", "stock", "exploDir"));
    expect(c.nonLues).toBe(3); // le compteur de la cloche est le total
    expect(c.nonLuesListees).toBe(3); // ... et tout ce qui est compté est listé
    expect(Object.fromEntries(c.items.map((i) => [i.id, i.domaine]))).toEqual({ [N.rh]: "RH", [N.stock]: "STOCK", [N.exploDir]: "EXPLOITATION" }); // l'étiquette d'espace
  });

  it("Responsable RH et consultation : la RH seulement", async () => {
    expect(await idsVus("MGR")).toEqual(tousSont("rh"));
    expect(await idsVus("VIEW")).toEqual(tousSont("rh"));
  });

  it("Stock : le partagé du Stock + ce qui est adressé à CE magasinier ; l'autre magasinier ne voit que le partagé", async () => {
    expect(await idsVus("STK")).toEqual(tousSont("stock", "stockStk"));
    expect(await idsVus("STK2")).toEqual(tousSont("stock"));
    expect(await idsVus("EMPS")).toEqual(tousSont("stock")); // salarié avec accès Stock : ce qu'il voit aujourd'hui, ni plus ni moins
  });

  it("Compta : ce qui lui est adressé en Exploitation ; une autre Compta rien ; un salarié simple rien du tout", async () => {
    expect(await idsVus("CPT")).toEqual(tousSont("exploCpt"));
    expect(await idsVus("CPT2")).toEqual([]);
    const emp = await vues("EMP");
    expect(emp.items).toEqual([]);
    expect(emp.nonLues).toBe(0);
  });

  it("la cloche d'un espace (chargerNotifications) reste cloisonnée à CET espace, comme avant", async () => {
    expect((await NOTIFS.chargerNotifications("EXPLOITATION", ids.DIR)).items.map((i) => i.id)).toEqual([N.exploDir]);
    expect((await NOTIFS.chargerNotifications("STOCK", ids.DIR)).items.map((i) => i.id)).toEqual([N.stock]);
    expect((await NOTIFS.chargerNotifications("EXPLOITATION", ids.CPT2)).items).toEqual([]); // adressée à un autre compte : jamais vue
  });

  it("le coût est borné : au plus 3 requêtes (non lues, lues récentes, config) pour la Direction, 2 sans RH — jamais une par espace", async () => {
    H.requetes = [];
    await NOTIFS.chargerNotificationsCompte(compte("DIR"));
    expect(H.requetes.sort()).toEqual(["config.findUnique", "notification.findMany", "notification.findMany"]);
    H.requetes = [];
    await NOTIFS.chargerNotificationsCompte(compte("STK"));
    expect(H.requetes.sort()).toEqual(["notification.findMany", "notification.findMany"]);
  });
});

describe("« Tout marquer lu » ne touche que ce que le compte voit", () => {
  it("un salarié simple est refusé, rien n'est écrit", async () => {
    en("EMP");
    expect(await ACTIONS.marquerNotificationsLues()).toEqual({ erreur: MESSAGE_NOTIFICATION_REFUSEE });
    expect(Object.values(await lues()).every((l) => l === false)).toBe(true);
  });

  it("le magasinier : le Stock partagé et ce qui lui est adressé — ni la RH, ni l'Exploitation, ni le salarié", async () => {
    en("STK");
    expect(await ACTIONS.marquerNotificationsLues()).toEqual({ ok: true });
    expect(await lues()).toEqual({ rh: false, stock: true, exploDir: false, exploCpt: false, stockStk: true, salarie: false });
  });

  it("la Direction : RH + Stock + ce qui lui est adressé en Exploitation — pas ce qui est adressé à la Compta, pas un salarié", async () => {
    en("DIR");
    expect(await ACTIONS.marquerNotificationsLues()).toEqual({ ok: true });
    expect(await lues()).toEqual({ rh: true, stock: true, exploDir: true, exploCpt: false, stockStk: true, salarie: false });
    expect((await vues("DIR")).nonLues).toBe(0);
    expect((await vues("CPT")).nonLues).toBe(1); // celle de la Compta n'a pas été touchée
  });
});

describe("supprimer une notification : les gardes tiennent depuis la cloche unique", () => {
  it("refusé (rien n'est supprimé) hors de son espace ou de son adresse", async () => {
    const cas: [Compte, keyof typeof N][] = [
      ["STK", "rh"], ["CPT", "rh"], ["EMP", "rh"], ["MGR", "stock"], ["CPT", "stock"], ["MGR", "exploDir"],
      ["DIR", "exploCpt"], ["CPT2", "exploCpt"], ["STK2", "stockStk"], ["DIR", "stockStk"], ["DIR", "salarie"], ["EMP", "stock"],
    ];
    for (const [c, k] of cas) {
      en(c);
      expect(await ACTIONS.supprimerNotification(N[k]), `${c} → ${k}`).toEqual({ erreur: MESSAGE_NOTIFICATION_REFUSEE });
      expect(await existe(N[k]), `${c} → ${k} : supprimée malgré le refus`).toBe(true);
    }
  });

  it("accepté pour le bon compte : la Direction supprime RH, Stock et ce qui lui est adressé ; la Compta la sienne ; le salarié la sienne", async () => {
    for (const [c, k] of [["DIR", "rh"], ["DIR", "stock"], ["DIR", "exploDir"], ["CPT", "exploCpt"], ["STK", "stockStk"], ["EMP", "salarie"]] as [Compte, keyof typeof N][]) {
      en(c);
      expect(await ACTIONS.supprimerNotification(N[k]), `${c} → ${k}`).toEqual({ ok: true });
      expect(await existe(N[k])).toBe(false);
    }
  });
});
