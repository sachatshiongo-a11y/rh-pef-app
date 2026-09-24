import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Les lignes de paie de la production (dont des bulletins VALIDÉS, figés) doivent traverser cette
// migration INCHANGÉES et rester lisibles, avec la source CONTRAT : elles ont été calculées sur le
// contrat. La base de test naît du SCHÉMA (db push), colonnes déjà présentes : on la ramène à l'état
// d'avant (colonnes et type retirés), on y laisse une ligne figée, puis on joue migration.sql — lu
// dans le fichier, jamais recopié. Le rejeu de TOUTES les migrations (diff vide, RLS) est l'affaire
// de src/lib/migrations.integration.test.ts.
const SQL = fs.readFileSync(path.join(__dirname, "migration.sql"), "utf8");
const NOUVELLES = ["avertissementsPaie", "heuresPayeesNonTravaillees", "motifReference", "sourceReference"];

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let ligneId: string;

const instantane = async () =>
  (await prisma.$queryRawUnsafe<{ l: Record<string, unknown> }[]>(
    `SELECT to_jsonb(p) AS l FROM "public"."PayrollLine" p WHERE p."id" = $1`, ligneId,
  ))[0].l;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;
  const emp = await prisma.employee.create({
    data: {
      matricule: "PR01-PEF", nom: "Test Référence", sexe: "F", etatCivil: "Célibataire", poste: "Cuisinier",
      secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  const run = await prisma.payrollRun.create({ data: { mois: 7, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2850 } });
  const l = await prisma.payrollLine.create({
    data: {
      payrollRunId: run.id, employeeId: emp.id, heuresTravaillees: 180, heuresContractuelles: 190.67,
      salBrutUSD: 310.5, cnssSalarieUSD: 15.53, netImposableUSD: 294.97, iprCalculeUSD: 8.2, allocFamilialeUSD: 3,
      salNetUSD: 289.77, salNetCDF: 825844.5, cnssPatronalUSD: 40.37, coutEmployeurUSD: 360.2, coutEmployeurCDF: 1026570,
    },
  });
  ligneId = l.id;
  // État de la production AVANT la migration : ni les 4 colonnes, ni le type.
  await prisma.$executeRawUnsafe(`ALTER TABLE "public"."PayrollLine" ${NOUVELLES.map((c) => `DROP COLUMN "${c}"`).join(", ")}`);
  await prisma.$executeRawUnsafe(`DROP TYPE "public"."SourceReferencePaie"`);
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("migration paie_reference_planning", () => {
  it("est purement additive : ni DROP, ni modification de colonne, ni réécriture de données", () => {
    const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/\bDROP\b|\bALTER\s+COLUMN\b|\bRENAME\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);
    for (const c of NOUVELLES) expect(code).toContain(`ADD COLUMN     "${c}"`);
  });

  it("laisse une ligne figée inchangée, source CONTRAT, sans motif, 0 h, aucun avertissement — et lisible", async () => {
    const avant = await instantane();
    expect(Object.keys(avant)).not.toContain("sourceReference"); // la pose d'avant a bien mordu
    await prisma.$executeRawUnsafe(SQL);
    const apres = await instantane();
    const { avertissementsPaie, heuresPayeesNonTravaillees, motifReference, sourceReference, ...reste } = apres;
    expect(reste).toEqual(avant);
    expect({ avertissementsPaie, heuresPayeesNonTravaillees, motifReference, sourceReference })
      .toEqual({ avertissementsPaie: [], heuresPayeesNonTravaillees: 0, motifReference: null, sourceReference: "CONTRAT" });
    const lue = await prisma.payrollLine.findUniqueOrThrow({ where: { id: ligneId } });
    expect(lue.sourceReference).toBe("CONTRAT");
    expect(Number(lue.salNetUSD)).toBe(289.77);
  });
});
