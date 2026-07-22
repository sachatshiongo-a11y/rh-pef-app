import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION — #5 (régression) : un jour codé « P » (Présent) SANS heures saisies produit
// un salaire 0 $ SILENCIEUX pour ce jour (paie-batch.ts / bulletin-live.ts). `tachesBloquantesCloture`
// doit bloquer la clôture du mois tant que ce cas n'est pas corrigé, pour forcer une correction
// explicite plutôt que de laisser passer un jour non payé sans que personne ne s'en aperçoive.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { tachesBloquantesCloture } = await import("./cloture-paie");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empSansHeuresId: string;
let empAvecHeuresId: string;

const baseEmp = {
  sexe: "M", etatCivil: "Célibataire", poste: "Test", secteur: "Cuisine",
  categorie: "BRIGADE" as const, salaireMensuel: 200, dateEmbauche: new Date("2024-01-01"), contrat: "CDI" as const,
};

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;

  const e1 = await prisma.employee.create({ data: { ...baseEmp, matricule: "CP01-PEF", nom: "Sans Heures" } });
  empSansHeuresId = e1.id;
  const e2 = await prisma.employee.create({ data: { ...baseEmp, matricule: "CP02-PEF", nom: "Avec Heures" } });
  empAvecHeuresId = e2.id;

  // e1 : deux jours "P" en juillet, AUCUNE heure saisie (heures effacées après coup par ex.).
  await prisma.attendance.createMany({
    data: [
      { employeeId: empSansHeuresId, date: new Date("2026-07-06"), code: "P" },
      { employeeId: empSansHeuresId, date: new Date("2026-07-07"), code: "P" },
    ],
  });

  // e2 : un jour "P" AVEC heures saisies (cas normal, ne doit rien bloquer).
  await prisma.attendance.create({ data: { employeeId: empAvecHeuresId, date: new Date("2026-07-06"), code: "P" } });
  await prisma.overtimeEntry.create({ data: { employeeId: empAvecHeuresId, date: new Date("2026-07-06"), heuresTravaillees: 8 } });
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("tachesBloquantesCloture — jour « P » sans heures (#5, régression)", () => {
  it("un jour P SANS heures saisies produit une tâche bloquante JOUR_P_SANS_HEURES", async () => {
    const taches = await tachesBloquantesCloture(7, 2026);
    const tache = taches.find((t) => t.type === "JOUR_P_SANS_HEURES" && t.employeeId === empSansHeuresId);
    expect(tache).toBeTruthy();
    expect(tache?.nom).toBe("Sans Heures");
    expect(tache?.detail).toMatch(/2 jour/);
  });

  it("un jour P AVEC heures saisies ne produit AUCUNE tâche bloquante pour cet employé", async () => {
    const taches = await tachesBloquantesCloture(7, 2026);
    const tache = taches.find((t) => t.type === "JOUR_P_SANS_HEURES" && t.employeeId === empAvecHeuresId);
    expect(tache).toBeUndefined();
  });

  it("un mois sans aucun jour P concerné ne produit aucune tâche JOUR_P_SANS_HEURES", async () => {
    const taches = await tachesBloquantesCloture(8, 2026);
    expect(taches.filter((t) => t.type === "JOUR_P_SANS_HEURES")).toHaveLength(0);
  });
});
