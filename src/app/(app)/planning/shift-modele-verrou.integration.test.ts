import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// La paie relit les HEURES du shift de chaque créneau à chaque calcul, et le modèle hebdomadaire
// pour les jours dus sans créneau (revue finale du 2026-09-24, point 2). Changer les heures d'un
// shift qui a servi à une paie validée ou payée est refusé ; sinon, c'est journalisé (avant → après).
// Le nom et la couleur restent libres et non journalisés. Le modèle est journalisé, sans verrou.
// Les tests s'enchaînent sur une même base : l'ordre compte.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "MANAGER", nom: "Chef de salle" } }));
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
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

const { modifierShift, saisirModele } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids = { martine: "", rachel: "", esther: "", journee: "", soir: "", libre: "" };
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirection = (message: string) => `REDIRECT /planning?erreur=${encodeURIComponent(message)}`;
const journalShift = (id: string) => prisma.journalAudit.findMany({ where: { entite: "Shift", entiteId: id }, orderBy: [{ date: "asc" }, { champ: "asc" }] });
const shift = (id: string) => prisma.shift.findUniqueOrThrow({ where: { id } });
const formulaire = (id: string, o: Partial<Record<"nom" | "couleur" | "heureDebut" | "heureFin" | "dureeHeures" | "tauxHoraireUSD", string>>) =>
  fd({ id, nom: "Journée", couleur: "indigo", heureDebut: "08:00", heureFin: "17:00", dureeHeures: "", tauxHoraireUSD: "", ...o });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "chef@pef.cd", nom: "Chef de salle", role: "MANAGER" } })).id;
  const base = { sexe: "F", etatCivil: "Célibataire", poste: "Serveur", secteur: "Salle", categorie: "BRIGADE" as const, salaireMensuel: 400, dateEmbauche: d("2025-01-06"), contrat: "CDD", enfants: 0, heuresHebdomadaires: 54 };
  ids.martine = (await prisma.employee.create({ data: { ...base, matricule: "MM01-PEF", nom: "Martine Mutombo" } })).id;
  ids.rachel = (await prisma.employee.create({ data: { ...base, matricule: "RL01-PEF", nom: "Rachel Lunda" } })).id;
  ids.esther = (await prisma.employee.create({ data: { ...base, matricule: "EN01-PEF", nom: "Esther Nsundi" } })).id;
  ids.journee = (await prisma.shift.create({ data: { nom: "Journée", couleur: "indigo", heureDebut: "08:00", heureFin: "17:00" } })).id;
  ids.soir = (await prisma.shift.create({ data: { nom: "Soir", couleur: "purple", heureDebut: "16:00", heureFin: "22:00" } })).id;
  ids.libre = (await prisma.shift.create({ data: { nom: "Renfort", couleur: "teal", heureDebut: "11:00", heureFin: "15:00" } })).id;

  // Septembre : Martine VALIDÉE, Rachel PAYÉE, Esther ouverte. Août : Esther PAYÉE.
  const septembre = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, tauxChangeUtilise: 2300 } });
  const aout = await prisma.payrollRun.create({ data: { mois: 8, annee: 2026, tauxChangeUtilise: 2300 } });
  const montants = { salBrutUSD: 0, cnssSalarieUSD: 0, netImposableUSD: 0, iprCalculeUSD: 0, allocFamilialeUSD: 0, salNetUSD: 0, salNetCDF: 0, cnssPatronalUSD: 0, coutEmployeurUSD: 0, coutEmployeurCDF: 0 };
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: septembre.id, employeeId: ids.martine, statutPaiement: "VALIDE" } });
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: septembre.id, employeeId: ids.rachel, statutPaiement: "PAYE" } });
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: septembre.id, employeeId: ids.esther, statutPaiement: "PAS_VALIDE" } });
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: aout.id, employeeId: ids.esther, statutPaiement: "PAYE" } });

  // « Journée » : tenue par Martine et Rachel en septembre, et par Esther en août.
  await prisma.planningCreneau.createMany({ data: [
    { employeeId: ids.martine, date: d("2026-09-07"), shiftId: ids.journee },
    { employeeId: ids.martine, date: d("2026-09-08"), shiftId: ids.journee },
    { employeeId: ids.rachel, date: d("2026-09-07"), shiftId: ids.journee },
    { employeeId: ids.esther, date: d("2026-08-31"), shiftId: ids.journee },
    // « Soir » : seulement Esther, en septembre (mois ouvert).
    { employeeId: ids.esther, date: d("2026-09-09"), shiftId: ids.soir },
  ] });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("heures d'un shift qui a servi à une paie validée ou payée", () => {
  const REFUS = "Ce shift a servi à une paie validée (août 2026 : Esther Nsundi ; septembre 2026 : Martine Mutombo, Rachel Lunda) : créez un nouveau shift plutôt que de changer ses heures.";

  it("+1 h sur l'heure de fin : refus lisible (mois et salariés), shift inchangé, rien au journal", async () => {
    await expect(modifierShift(formulaire(ids.journee, { heureFin: "18:00" }))).rejects.toThrow(redirection(REFUS));
    const s = await shift(ids.journee);
    expect([s.heureDebut, s.heureFin, s.dureeHeures]).toEqual(["08:00", "17:00", null]);
    expect(await journalShift(ids.journee)).toHaveLength(0);
  });

  it("heure de début ou durée forcée : même refus", async () => {
    await expect(modifierShift(formulaire(ids.journee, { heureDebut: "07:00" }))).rejects.toThrow(redirection(REFUS));
    await expect(modifierShift(formulaire(ids.journee, { dureeHeures: "10" }))).rejects.toThrow(redirection(REFUS));
    expect((await shift(ids.journee)).dureeHeures).toBeNull();
  });

  it("changer le nom ou la couleur reste libre et n'est pas journalisé", async () => {
    await modifierShift(formulaire(ids.journee, { nom: "Journée continue", couleur: "green" }));
    const s = await shift(ids.journee);
    expect([s.nom, s.couleur, s.heureDebut, s.heureFin]).toEqual(["Journée continue", "green", "08:00", "17:00"]);
    expect(await journalShift(ids.journee)).toHaveLength(0);
  });
});

describe("heures d'un shift sans paie validée : journalisées, avant → après", () => {
  it("un seul créneau, dans un mois ouvert : accepté, une entrée par champ changé et la durée payée", async () => {
    await modifierShift(fd({ id: ids.soir, nom: "Soir", couleur: "purple", heureDebut: "16:00", heureFin: "23:00", dureeHeures: "", tauxHoraireUSD: "" }));
    expect((await shift(ids.soir)).heureFin).toBe("23:00");
    const j = await journalShift(ids.soir);
    expect(j.map((e) => [e.champ, e.ancienneValeur, e.nouvelleValeur, e.userId])).toEqual([
      ["duree", "6 h", "7 h", A.user.id],
      ["heureFin", "22:00", "23:00", A.user.id],
    ]);
  });

  it("durée forcée puis retirée : journalisée, y compris le retour à null", async () => {
    await modifierShift(fd({ id: ids.libre, nom: "Renfort", couleur: "teal", heureDebut: "11:00", heureFin: "15:00", dureeHeures: "3,5", tauxHoraireUSD: "" }));
    await modifierShift(fd({ id: ids.libre, nom: "Renfort", couleur: "teal", heureDebut: "11:00", heureFin: "15:00", dureeHeures: "", tauxHoraireUSD: "" }));
    const j = await journalShift(ids.libre);
    expect(j.map((e) => [e.champ, e.ancienneValeur, e.nouvelleValeur])).toEqual([
      ["duree", "4 h", "3.5 h"],
      ["dureeHeures", null, "3.5"],
      ["duree", "3.5 h", "4 h"],
      ["dureeHeures", "3.5", null],
    ]);
  });

  it("paie rouverte (VALIDÉE → PAS_VALIDE partout) : le shift redevient modifiable", async () => {
    await prisma.payrollLine.updateMany({ data: { statutPaiement: "PAS_VALIDE" } });
    await modifierShift(formulaire(ids.journee, { nom: "Journée continue", couleur: "green", heureFin: "18:00" }));
    expect((await shift(ids.journee)).heureFin).toBe("18:00");
    expect((await journalShift(ids.journee)).map((e) => [e.champ, e.ancienneValeur, e.nouvelleValeur])).toEqual([
      ["duree", "9 h", "10 h"],
      ["heureFin", "17:00", "18:00"],
    ]);
  });
});

describe("modèle hebdomadaire : journalisé, avant → après", () => {
  const journalModele = (employeeId: string, jour: number, semaine: number) =>
    prisma.journalAudit.findMany({ where: { entite: "PlanningModele", entiteId: `${employeeId}|${jour}|${semaine}` }, orderBy: { date: "asc" } });

  it("création, changement, effacement : une entrée chacun ; ressaisir le même shift ne journalise rien", async () => {
    await saisirModele(ids.martine, 1, ids.journee, 1); // lundi, semaine A
    await saisirModele(ids.martine, 1, ids.journee, 1);
    await saisirModele(ids.martine, 1, ids.soir, 1);
    await saisirModele(ids.martine, 1, "", 1);
    await saisirModele(ids.martine, 1, "", 1); // effacer un modèle absent : rien
    expect((await journalModele(ids.martine, 1, 1)).map((e) => [e.champ, e.ancienneValeur, e.nouvelleValeur, e.userId])).toEqual([
      ["shiftId", null, ids.journee, A.user.id],
      ["shiftId", ids.journee, ids.soir, A.user.id],
      ["shiftId", ids.soir, null, A.user.id],
    ]);
    expect(await prisma.planningModele.count({ where: { employeeId: ids.martine } })).toBe(0);
  });

  it("couches distinctes : chaque (jour, couche) a sa propre trace", async () => {
    await saisirModele(ids.esther, 3, ids.soir, 0);
    await saisirModele(ids.esther, 3, ids.journee, 2);
    expect(await journalModele(ids.esther, 3, 0)).toHaveLength(1);
    expect(await journalModele(ids.esther, 3, 2)).toHaveLength(1);
    expect((await prisma.planningModele.findMany({ where: { employeeId: ids.esther }, orderBy: { semaine: "asc" } })).map((m) => [m.semaine, m.shiftId]))
      .toEqual([[0, ids.soir], [2, ids.journee]]);
  });
});
