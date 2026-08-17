import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Garde le VRAI défaut A6 : la fenêtre de lecture des jours fériés dans `genererPlanningAuto`
// (src/app/(app)/planning/actions.ts) doit couvrir l'HISTORIQUE (8 semaines avant `debut`), pas
// seulement [debut, fin] — sinon un férié travaillé AVANT la période n'est jamais reconnu comme un
// jour pénible par l'équité, et la rotation triche sans le savoir.
//
// Le test qui portait le nom « A6 » avant celui-ci vivait dans le moteur pur
// (`planning-auto.test.ts`) : il passait déjà sur le moteur d'AVANT la correction, il ne gardait
// donc rien — le défaut vivait dans `actions.ts` (la requête `jourFerie.findMany`), pas dans le
// moteur, qui se contente de recevoir la liste des fériés qu'on lui donne. Celui-ci appelle le
// vrai `genererPlanningAuto`, sur un Postgres éphémère : c'est le seul endroit où la fenêtre de
// lecture peut régresser.
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

const { genererPlanningAuto } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

/** Petit utilitaire : un FormData depuis un objet (valeurs répétées via un tableau). */
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
};

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "planning@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("genererPlanningAuto — fenêtre de lecture des jours fériés (A6)", () => {
  it("lit les fériés jusqu'à 8 semaines AVANT la période, pas seulement [debut, fin]", async () => {
    // « habitué » a travaillé un férié bien avant la période (dans la fenêtre d'historique lue par
    // la génération) ; « reposé » non. Les deux employés ont 0 h sur la période elle-même. Pour un
    // jour pénible DE la période (ici un dimanche), l'équité doit départager sur les jours pénibles
    // CUMULÉS — historique compris — et donc retenir « reposé ». Les identifiants sont choisis
    // ("aa-habitue" < "zz-repose") pour que le départage de repli (alphabétique, quand les deux
    // employés sont à égalité de jours pénibles) tombe sur « habitué » — c'est-à-dire le MAUVAIS
    // salarié : si la fenêtre de lecture des fériés se rétrécit à [debut, fin], ce test échoue.
    const shift = await prisma.shift.create({ data: { nom: "Matin", dureeHeures: 8, ordre: 0 } });
    const habitue = await prisma.employee.create({
      data: {
        id: "aa-habitue", matricule: "HAB01-PEF", nom: "Habitué", sexe: "F", etatCivil: "Célibataire",
        poste: "Cuisinier", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 100,
        dateEmbauche: new Date("2024-01-01"), contrat: "CDI", enfants: 0, heuresHebdomadaires: 48,
      },
    });
    const repose = await prisma.employee.create({
      data: {
        id: "zz-repose", matricule: "REP01-PEF", nom: "Reposé", sexe: "M", etatCivil: "Célibataire",
        poste: "Cuisinier", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 100,
        dateEmbauche: new Date("2024-01-01"), contrat: "CDI", enfants: 0, heuresHebdomadaires: 48,
      },
    });

    // Férié le mercredi 24 juin 2026 — largement avant la période (dimanche 12 juillet 2026), mais
    // dans les 8 semaines d'historique lues par `genererPlanningAuto` (debutHistorique = 17 mai 2026).
    const ferie = new Date("2026-06-24T00:00:00Z");
    await prisma.jourFerie.create({ data: { date: ferie, designation: "Férié test", annee: 2026 } });
    await prisma.planningCreneau.create({ data: { employeeId: habitue.id, date: ferie, shiftId: shift.id } });

    await prisma.besoinShift.create({ data: { shiftId: shift.id, poste: "Cuisinier", jourSemaine: 0, nombreRequis: 1 } });

    const resume = await genererPlanningAuto("2026-07-12", "2026-07-12", fd({ jours: ["0"] })); // dimanche seul

    expect(resume.crees).toBe(1);
    const creneauDimanche = await prisma.planningCreneau.findFirst({ where: { date: new Date("2026-07-12T00:00:00Z") } });
    expect(creneauDimanche?.employeeId).toBe(repose.id);
  }, 60_000);
});
