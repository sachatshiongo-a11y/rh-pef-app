import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { endpointPushAutorise } from "./push-services";
import { oublierAbonnementPush } from "./oublier-abonnement-push";

// Audit du 10/10/2026, sécurité 7 : (1) un abonnement push acceptait une adresse arbitraire (le
// serveur l'appelait ensuite à chaque notification) ; (2) la déconnexion laissait l'appareil abonné.

describe("services push acceptés", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/dXk9abc:APA91b",
    "https://fcm.googleapis.com/wp/dXk9abc",
    "https://web.push.apple.com/QGuQyavXutnMH3Ixyz",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB",
  ])("accepté : %s", (u) => expect(endpointPushAutorise(u)).toBe(true));

  it.each([
    "http://fcm.googleapis.com/fcm/send/x", // pas en HTTPS
    "https://fcm.googleapis.com:8443/fcm/send/x", // port non standard
    "https://user:mdp@fcm.googleapis.com/fcm/send/x", // identifiants
    "https://169.254.169.254/latest/meta-data/", // métadonnées de l'hébergeur
    "https://localhost:3000/api/cron/alertes",
    "https://evil.com/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evilpush.apple.com/x", // suffixe sans point
    "https://gestion.patesenfolie.cd/api/x",
    "pas une adresse",
    "",
    42,
  ])("refusé : %s", (u) => expect(endpointPushAutorise(u)).toBe(false));
});

describe("enregistrerPush refuse un service inconnu (contrôle côté serveur)", () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock("@/lib/prisma"); vi.doUnmock("@/lib/auth"); });
  it("rien n'est écrit pour une adresse hors liste", async () => {
    const ecrit = vi.fn();
    vi.doMock("@/lib/prisma", () => ({ prisma: { pushSubscription: { findUnique: async () => null, upsert: ecrit } } }));
    vi.doMock("@/lib/auth", () => ({ verifySession: async () => ({ id: "u1" }) }));
    const { enregistrerPush } = await import("@/app/(app)/push-actions");
    const r = await enregistrerPush({ endpoint: "https://169.254.169.254/latest/meta-data/", p256dh: "k", auth: "a" });
    expect(r).toMatchObject({ erreur: expect.stringContaining("non reconnu") });
    expect(ecrit).not.toHaveBeenCalled();
    await enregistrerPush({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "k", auth: "a" });
    expect(ecrit).toHaveBeenCalledTimes(1);
  });
});

describe("déconnexion : l'appareil oublie son abonnement", () => {
  it("retiré côté serveur PUIS côté navigateur", async () => {
    const ordre: string[] = [];
    const r = await oublierAbonnementPush({
      abonnementCourant: async () => ({ endpoint: "https://fcm.googleapis.com/x", unsubscribe: async () => { ordre.push("navigateur"); return true; } }),
      supprimerCoteServeur: async (e) => { ordre.push(`serveur ${e}`); },
    });
    expect(r).toBe("oublie");
    expect(ordre).toEqual(["serveur https://fcm.googleapis.com/x", "navigateur"]);
  });
  it("aucun abonnement : rien à faire ; erreur ou lenteur : la déconnexion n'est jamais bloquée", async () => {
    expect(await oublierAbonnementPush({ abonnementCourant: async () => null, supprimerCoteServeur: async () => {} })).toBe("aucun");
    expect(await oublierAbonnementPush({ abonnementCourant: async () => { throw new Error("pas de SW"); }, supprimerCoteServeur: async () => {} })).toBe("echec");
    const t0 = Date.now();
    expect(await oublierAbonnementPush({ abonnementCourant: () => new Promise(() => {}), supprimerCoteServeur: async () => {}, delaiMs: 50 })).toBe("echec");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("garde-fou : aucun formulaire ne déconnecte sans passer par FormulaireDeconnexion", () => {
    const SRC = path.resolve(__dirname, "..");
    const directs: string[] = [];
    let avecComposant = 0;
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) {
          const t = fs.readFileSync(p, "utf8");
          if (/action=\{logout\}/.test(t)) directs.push(path.relative(SRC, p));
          if (/<FormulaireDeconnexion\b/.test(t)) avecComposant++;
        }
      }
    };
    parcourir(SRC);
    expect(directs).toEqual([]);
    expect(avecComposant).toBeGreaterThanOrEqual(6);
  });
});
