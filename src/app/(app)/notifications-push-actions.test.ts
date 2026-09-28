import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@prisma/client";

/**
 * Cloche et abonnements push : un compte ÉTRANGER est refusé — avec un message lisible rendu comme
 * VALEUR, sans aucune écriture — et le compte légitime passe. `prisma` est simulé : on vérifie
 * surtout qu'aucune écriture n'est tentée quand le droit manque.
 */
const A = vi.hoisted(() => ({
  user: { id: "u-moi", email: "m@t", nom: "Moi", role: "EMPLOYE" as string, accesStock: false, employeeId: "emp-moi" as string | null },
  notif: null as null | { id: string; domaine: string; destinataireUserId: string | null },
  abo: null as null | { userId: string; p256dh: string; auth: string },
  ecritures: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findUnique: async () => A.notif,
      updateMany: async (args: unknown) => { A.ecritures.push(`notification.updateMany ${JSON.stringify(args)}`); return { count: 1 }; },
      deleteMany: async (args: unknown) => { A.ecritures.push(`notification.deleteMany ${JSON.stringify(args)}`); return { count: 1 }; },
    },
    pushSubscription: {
      findUnique: async () => A.abo,
      upsert: async (args: unknown) => { A.ecritures.push(`push.upsert ${JSON.stringify(args)}`); return {}; },
      deleteMany: async (args: unknown) => { A.ecritures.push(`push.deleteMany ${JSON.stringify(args)}`); return { count: 1 }; },
    },
  },
}));

const { marquerNotificationsLues, supprimerNotification } = await import("./notifications-actions");
const { enregistrerPush, supprimerPush } = await import("./push-actions");
const { MESSAGE_NOTIFICATION_REFUSEE, MESSAGE_PUSH_REFUSE } = await import("@/lib/acces-notification");

const compte = (role: Role, extra: Partial<typeof A.user> = {}) => {
  A.user = { ...A.user, id: "u-moi", role, accesStock: false, employeeId: "emp-moi", ...extra };
};

beforeEach(() => {
  A.ecritures = [];
  A.notif = null;
  A.abo = null;
});

describe("marquerNotificationsLues — « Tout marquer lu » d'une cloche d'espace", () => {
  it.each<[Role, boolean]>([["EMPLOYE", false], ["STOCK", false], ["COMPTA", false], ["ADMIN", true], ["MANAGER", true], ["VIEWER", true]])(
    "cloche RH, compte %s → autorisé : %s",
    async (role, autorise) => {
      compte(role);
      const r = await marquerNotificationsLues("RH");
      if (autorise) {
        expect(r).toEqual({ ok: true });
        expect(A.ecritures).toEqual([expect.stringContaining('"domaine":"RH"')]);
      } else {
        expect(r).toEqual({ erreur: MESSAGE_NOTIFICATION_REFUSEE });
        expect(A.ecritures).toEqual([]);
      }
    },
  );

  it.each<[Role, boolean, boolean]>([
    ["EMPLOYE", false, false], ["EMPLOYE", true, true], ["MANAGER", false, false], ["VIEWER", false, false],
    ["COMPTA", false, false], ["STOCK", false, true], ["ADMIN", false, true],
  ])("cloche STOCK, compte %s (accès stock %s) → autorisé : %s", async (role, accesStock, autorise) => {
    compte(role, { accesStock });
    const r = await marquerNotificationsLues("STOCK");
    expect(r).toEqual(autorise ? { ok: true } : { erreur: MESSAGE_NOTIFICATION_REFUSEE });
    expect(A.ecritures.length).toBe(autorise ? 1 : 0);
  });

  it("un domaine inventé retombe sur RH : un salarié reste refusé", async () => {
    compte("EMPLOYE");
    const r = await marquerNotificationsLues("SALARIE" as "RH");
    expect(r).toEqual({ erreur: MESSAGE_NOTIFICATION_REFUSEE });
    expect(A.ecritures).toEqual([]);
  });
});

describe("supprimerNotification — une notification précise, droit lu en BASE", () => {
  it("notification RH : un salarié est refusé, rien n'est supprimé", async () => {
    compte("EMPLOYE");
    A.notif = { id: "n1", domaine: "RH", destinataireUserId: null };
    expect(await supprimerNotification("n1")).toEqual({ erreur: MESSAGE_NOTIFICATION_REFUSEE });
    expect(A.ecritures).toEqual([]);
  });

  it("notification RH : la Direction la supprime", async () => {
    compte("ADMIN");
    A.notif = { id: "n1", domaine: "RH", destinataireUserId: null };
    expect(await supprimerNotification("n1")).toEqual({ ok: true });
    expect(A.ecritures).toEqual([expect.stringContaining('"id":"n1"')]);
  });

  it("notification STOCK : un MANAGER (RH seule) est refusé, un magasinier la supprime", async () => {
    A.notif = { id: "n2", domaine: "STOCK", destinataireUserId: null };
    compte("MANAGER");
    expect(await supprimerNotification("n2")).toEqual({ erreur: MESSAGE_NOTIFICATION_REFUSEE });
    compte("STOCK");
    expect(await supprimerNotification("n2")).toEqual({ ok: true });
    expect(A.ecritures.length).toBe(1);
  });

  it("notification SALARIÉ d'un autre : refusée, même à la Direction", async () => {
    A.notif = { id: "n3", domaine: "SALARIE", destinataireUserId: "u-collegue" };
    for (const role of ["EMPLOYE", "ADMIN"] as Role[]) {
      compte(role);
      expect(await supprimerNotification("n3")).toEqual({ erreur: MESSAGE_NOTIFICATION_REFUSEE });
    }
    expect(A.ecritures).toEqual([]);
  });

  it("notification SALARIÉ : son destinataire la supprime", async () => {
    compte("EMPLOYE");
    A.notif = { id: "n4", domaine: "SALARIE", destinataireUserId: "u-moi" };
    expect(await supprimerNotification("n4")).toEqual({ ok: true });
    expect(A.ecritures).toEqual([expect.stringContaining('"destinataireUserId":"u-moi"')]);
  });

  it("notification inexistante : même message, aucune écriture", async () => {
    compte("ADMIN");
    expect(await supprimerNotification("inconnue")).toEqual({ erreur: MESSAGE_NOTIFICATION_REFUSEE });
    expect(A.ecritures).toEqual([]);
  });
});

describe("abonnements push — l'appareil appartient au compte", () => {
  const cles = { p256dh: "cle-p", auth: "cle-a" };

  it("supprimerPush sur l'abonnement d'un autre compte : refusé, rien n'est supprimé", async () => {
    compte("EMPLOYE");
    A.abo = { userId: "u-autre", ...cles };
    expect(await supprimerPush("https://push/xyz")).toEqual({ erreur: MESSAGE_PUSH_REFUSE });
    expect(A.ecritures).toEqual([]);
  });

  it("supprimerPush sur son propre abonnement : supprimé (filtré sur SON compte)", async () => {
    compte("EMPLOYE");
    A.abo = { userId: "u-moi", ...cles };
    expect(await supprimerPush("https://push/xyz")).toEqual({ ok: true });
    expect(A.ecritures).toEqual([expect.stringContaining('"userId":"u-moi"')]);
  });

  it("supprimerPush sur un abonnement déjà parti : ok, sans écriture", async () => {
    compte("EMPLOYE");
    expect(await supprimerPush("https://push/xyz")).toEqual({ ok: true });
    expect(A.ecritures).toEqual([]);
  });

  it("enregistrerPush sur l'endpoint d'un autre, SANS ses clés : refusé (on ne détourne pas son appareil)", async () => {
    compte("EMPLOYE");
    A.abo = { userId: "u-autre", ...cles };
    expect(await enregistrerPush({ endpoint: "https://push/xyz", p256dh: "autre", auth: "autre" })).toEqual({ erreur: MESSAGE_PUSH_REFUSE });
    expect(A.ecritures).toEqual([]);
  });

  it("enregistrerPush sur l'endpoint d'un autre AVEC les mêmes clés (tablette partagée) : repris", async () => {
    compte("EMPLOYE");
    A.abo = { userId: "u-autre", ...cles };
    expect(await enregistrerPush({ endpoint: "https://push/xyz", ...cles })).toEqual({ ok: true });
    expect(A.ecritures).toEqual([expect.stringContaining('"userId":"u-moi"')]);
  });

  it("enregistrerPush : nouvel appareil, ou le sien → enregistré", async () => {
    compte("EMPLOYE");
    expect(await enregistrerPush({ endpoint: "https://push/neuf", ...cles })).toEqual({ ok: true });
    A.abo = { userId: "u-moi", p256dh: "ancienne", auth: "ancienne" };
    expect(await enregistrerPush({ endpoint: "https://push/neuf", ...cles })).toEqual({ ok: true });
    expect(A.ecritures.length).toBe(2);
  });

  it("enregistrerPush incomplet : message lisible, aucune écriture", async () => {
    compte("EMPLOYE");
    expect(await enregistrerPush({ endpoint: "", ...cles })).toEqual({ erreur: "Abonnement incomplet." });
    expect(A.ecritures).toEqual([]);
  });
});
