import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { lireCoordonneesSaisies, urlAffiche } from "@/lib/pointage-qr";
import { qrLuSurLaPage } from "@/lib/test/qr-pdf";

// Les réglages du pointage par la Direction, contre une VRAIE base (Postgres embarqué). Chaque
// refus est suivi d'une RELECTURE de la base : un refus qui aurait écrit quand même serait pire
// qu'une erreur. La session est mockée comme dans `espace/signature-actions.integration.test.ts`,
// mais `requireRole` garde ici son VRAI comportement (refuser un rôle hors liste) : c'est lui que
// les tests « non-ADMIN » mettent à l'épreuve.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", employeeId: null as string | null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireRole: (user: { role: string }, allowed: string[]) => {
    if (!allowed.includes(user.role)) throw new Error("Accès refusé : rôle insuffisant.");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { reglerPositionRestaurant, reglerRayon, changerCodeAffiche } = await import("./pointage-actions");
const { GET: imprimerAffiche } = await import("./pointage/affiche/route");
const { enregistrerScan } = await import("@/lib/pointage-scan");

const RESTAURANT = { lat: -4.3217, lng: 15.3125 };
const MESSAGE_FENETRE = "rapprochez-vous d'une fenêtre et réessayez";
const MESSAGE_AFFICHE_PERIMEE = "Cette affiche n'est plus valable, demandez la nouvelle à la Direction.";

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let adminId: string;

/** Les réglages du pointage + le nombre d'entrées au journal : ce qu'un refus ne doit pas changer. */
async function etat() {
  const c = await prisma.config.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { pointageLatitude: true, pointageLongitude: true, pointageRayonM: true, pointageCode: true },
  });
  return {
    lat: c.pointageLatitude === null ? null : Number(c.pointageLatitude),
    lng: c.pointageLongitude === null ? null : Number(c.pointageLongitude),
    rayonM: c.pointageRayonM,
    code: c.pointageCode,
    journal: await prisma.journalAudit.count(),
  };
}

async function journalDe(champ: string) {
  return prisma.journalAudit.findMany({
    where: { entite: "Config", entiteId: "singleton", champ },
    select: { userId: true, ancienneValeur: true, nouvelleValeur: true },
  });
}

async function regler(data: { lat: number | null; lng: number | null; code: string | null; rayonM?: number }) {
  await prisma.config.update({
    where: { id: "singleton" },
    data: { pointageLatitude: data.lat, pointageLongitude: data.lng, pointageCode: data.code, pointageRayonM: data.rayonM ?? 150 },
  });
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });
  const admin = await prisma.user.create({ data: { email: "direction@test.pef", nom: "Direction", role: "ADMIN" } });
  adminId = admin.id;
});

afterAll(async () => {
  await fermer?.();
});

beforeEach(async () => {
  A.user = { id: adminId, role: "ADMIN", nom: "Direction", employeeId: null };
  await regler({ lat: null, lng: null, code: null });
});

describe("seule la Direction (ADMIN) règle le pointage", () => {
  for (const role of ["MANAGER", "VIEWER", "COMPTA", "STOCK", "EMPLOYE"]) {
    it(`${role} : les trois réglages et l'affiche sont refusés, rien n'est écrit`, async () => {
      await regler({ lat: RESTAURANT.lat, lng: RESTAURANT.lng, code: "code-en-vigueur" });
      const avant = await etat();
      A.user = { id: adminId, role, nom: "Autre", employeeId: null };

      expect(await reglerPositionRestaurant({ lat: 0.5, lng: 0.5, precisionM: 10 })).toEqual({ erreur: "Accès refusé : rôle insuffisant." });
      expect(await reglerRayon(500)).toEqual({ erreur: "Accès refusé : rôle insuffisant." });
      expect(await changerCodeAffiche()).toEqual({ erreur: "Accès refusé : rôle insuffisant." });
      const affiche = await imprimerAffiche();
      expect(affiche.status).toBe(403);
      expect(affiche.headers.get("Content-Type")).not.toBe("application/pdf");

      expect(await etat()).toEqual(avant);
    });
  }
});

describe("la position du restaurant", () => {
  it("par le GPS : enregistrée et journalisée avec sa précision", async () => {
    expect(await reglerPositionRestaurant({ lat: -4.32171234, lng: 15.31254321, precisionM: 12.4 })).toBeUndefined();
    const e = await etat();
    expect(e.lat).toBe(-4.321712);
    expect(e.lng).toBe(15.312543);
    expect(await journalDe("pointagePosition")).toContainEqual({
      userId: adminId, ancienneValeur: "non réglée", nouvelleValeur: "-4.321712, 15.312543 (précision ±12 m)",
    });
  });

  it("précision de 150 m : refusée, avec la consigne, rien n'est écrit", async () => {
    const avant = await etat();
    const r = await reglerPositionRestaurant({ lat: RESTAURANT.lat, lng: RESTAURANT.lng, precisionM: 150 });
    expect(r).toEqual({ erreur: expect.stringContaining(MESSAGE_FENETRE) });
    expect(r).toEqual({ erreur: expect.stringContaining("±150 m") });
    expect(await etat()).toEqual(avant);
  });

  it("précision de 100 m pile : acceptée (le plafond est inclus)", async () => {
    expect(await reglerPositionRestaurant({ lat: RESTAURANT.lat, lng: RESTAURANT.lng, precisionM: 100 })).toBeUndefined();
    expect((await etat()).lat).toBe(RESTAURANT.lat);
  });

  it("saisie manuelle (copiée depuis Google Maps) : acceptée, journalisée comme telle", async () => {
    const saisie = lireCoordonneesSaisies("-4.3217, 15.3125");
    expect(saisie).not.toBeNull();
    expect(await reglerPositionRestaurant({ ...saisie!, precisionM: null })).toBeUndefined();
    const e = await etat();
    expect([e.lat, e.lng]).toEqual([RESTAURANT.lat, RESTAURANT.lng]);
    expect(await journalDe("pointagePosition")).toContainEqual({
      userId: adminId, ancienneValeur: "non réglée", nouvelleValeur: "-4.3217, 15.3125 (saisie manuelle)",
    });
  });

  it("des coordonnées impossibles venues du navigateur : refusées, rien n'est écrit", async () => {
    const avant = await etat();
    for (const e of [
      { lat: 95, lng: 15, precisionM: 10 },
      { lat: -4.3, lng: 181, precisionM: null },
      { lat: Number.NaN, lng: 15, precisionM: 10 },
      { lat: -4.3, lng: 15, precisionM: -1 },
      { lat: -4.3, lng: 15, precisionM: Number.POSITIVE_INFINITY },
      { lat: "-4.3", lng: 15, precisionM: 10 } as unknown as { lat: number; lng: number; precisionM: number },
    ]) {
      expect(await reglerPositionRestaurant(e)).toEqual({ erreur: expect.any(String) });
    }
    expect(await etat()).toEqual(avant);
  });
});

describe("le rayon toléré", () => {
  it("entre 50 et 1 000 m : enregistré et journalisé", async () => {
    expect(await reglerRayon(50)).toBeUndefined();
    expect((await etat()).rayonM).toBe(50);
    expect(await reglerRayon(1000)).toBeUndefined();
    expect((await etat()).rayonM).toBe(1000);
    const journal = await journalDe("pointageRayonM");
    expect(journal).toContainEqual({ userId: adminId, ancienneValeur: "150", nouvelleValeur: "50" });
    expect(journal).toContainEqual({ userId: adminId, ancienneValeur: "50", nouvelleValeur: "1000" });
  });

  it("hors bornes ou illisible : refusé, rien n'est écrit", async () => {
    const avant = await etat();
    for (const r of [49, 1001, 0, -150, Number.NaN, 150.5]) {
      expect(await reglerRayon(r)).toEqual({ erreur: "Le rayon doit être un nombre entier de mètres, entre 50 et 1 000." });
    }
    expect(await etat()).toEqual(avant);
  });
});

describe("changer le code de l'affiche", () => {
  it("refusé tant que la position du restaurant n'est pas réglée", async () => {
    const avant = await etat();
    const r = await changerCodeAffiche();
    expect(r).toEqual({ erreur: expect.stringContaining("Réglez d'abord la position du restaurant") });
    expect(await etat()).toEqual(avant);
    expect(avant.code).toBeNull();
  });

  it("l'ancienne affiche ne pointe plus, la nouvelle pointe — et le code n'est jamais journalisé", async () => {
    const emp = await prisma.employee.create({
      data: {
        matricule: "QR90-PEF", nom: "Salarié Affiche", sexe: "F", etatCivil: "Célibataire",
        poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
        dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
      },
    });
    const u = await prisma.user.create({ data: { email: "salarie.affiche@test.pef", nom: emp.nom, role: "EMPLOYE", employeeId: emp.id } });
    await regler({ lat: RESTAURANT.lat, lng: RESTAURANT.lng, code: "ancien-code-imprime" });

    expect(await changerCodeAffiche()).toBeUndefined();
    const { code: nouveau } = await etat();
    expect(nouveau).toBeTruthy();
    expect(nouveau).not.toBe("ancien-code-imprime");

    const scan = { employeeId: emp.id, userId: u.id, position: { lat: -4.3218, lng: 15.3126, precisionM: 20 }, maintenant: new Date("2026-09-15T07:02:00Z") };
    await expect(enregistrerScan(prisma, { ...scan, code: "ancien-code-imprime" })).rejects.toThrow(MESSAGE_AFFICHE_PERIMEE);
    expect(await prisma.pointage.count({ where: { employeeId: emp.id } })).toBe(0);
    await expect(enregistrerScan(prisma, { ...scan, code: nouveau! })).resolves.toMatchObject({ etat: "ARRIVEE" });

    const journal = await prisma.journalAudit.findMany({ where: { champ: "pointageCode" } });
    expect(journal.length).toBeGreaterThan(0);
    for (const j of journal) {
      expect(`${j.ancienneValeur} ${j.nouvelleValeur}`).not.toContain("ancien-code-imprime");
      expect(`${j.ancienneValeur} ${j.nouvelleValeur}`).not.toContain(nouveau!);
    }
  });
});

describe("imprimer l'affiche", () => {
  it("refusée tant que la position n'est pas réglée : pas de PDF, pas de code créé", async () => {
    const avant = await etat();
    const r = await imprimerAffiche();
    expect(r.status).toBe(409);
    expect(await r.text()).toContain("Réglez d'abord la position du restaurant");
    expect(await etat()).toEqual(avant);
  });

  it("sans code : en crée un, puis réimprime le MÊME (les affiches déjà collées restent bonnes)", async () => {
    await regler({ lat: RESTAURANT.lat, lng: RESTAURANT.lng, code: null });
    const r1 = await imprimerAffiche();
    expect(r1.status).toBe(200);
    expect(r1.headers.get("Content-Type")).toBe("application/pdf");
    const pdf = Buffer.from(await r1.arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const { code } = await etat();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Le QR imprimé porte l'adresse OFFICIELLE et le code en vigueur — jamais l'adresse d'où la
    // Direction imprime (l'application répond aussi sur rh-pef.onrender.com).
    expect(await qrLuSurLaPage(pdf)).toBe(urlAffiche("https://rh.patesenfolie.cd", code!));

    const r2 = await imprimerAffiche();
    expect(r2.status).toBe(200);
    expect((await etat()).code).toBe(code);
  }, 60_000);

  it("deux impressions simultanées sans code n'en créent qu'un, le même pour les deux", async () => {
    await regler({ lat: RESTAURANT.lat, lng: RESTAURANT.lng, code: null });
    const { codeAfficheAImprimer } = await import("@/lib/pointage-affiche");
    const journalAvant = await journalDe("pointageCode");
    const [a, b] = await Promise.all([codeAfficheAImprimer(prisma, adminId), codeAfficheAImprimer(prisma, adminId)]);
    expect(a).toBe(b);
    expect((await etat()).code).toBe(a);
    // Un seul code créé → une seule ligne de plus au journal, au nom de son auteur.
    const journalApres = await journalDe("pointageCode");
    expect(journalApres.length).toBe(journalAvant.length + 1);
    expect(journalApres).toContainEqual({ userId: adminId, ancienneValeur: "aucun", nouvelleValeur: "code créé à la première impression de l'affiche" });
  });

  it("création du code et journal sont UNE transaction : si le journal échoue, aucun code n'est créé", async () => {
    await regler({ lat: RESTAURANT.lat, lng: RESTAURANT.lng, code: null });
    const { codeAfficheAImprimer } = await import("@/lib/pointage-affiche");
    const avant = await etat();
    // Auteur inexistant : la ligne du journal viole sa clé étrangère vers User.
    await expect(codeAfficheAImprimer(prisma, "auteur-inexistant")).rejects.toThrow();
    expect(await etat()).toEqual(avant);
    expect(avant.code).toBeNull();
  });
});
