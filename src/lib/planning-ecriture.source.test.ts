import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Garde-fou de SOURCE : depuis le 2026-09-23 le planning est une pièce de paie (la brigade est
 * payée sur ses heures PLANIFIÉES). Toute écriture de PlanningCreneau qui ne passe pas par
 * `ecrireCreneaux` (src/lib/planning-ecriture.ts) contournerait le verrou (paie validée ou payée)
 * et le journal d'audit.
 *
 * La détection est une UNION PLATE de règles indépendantes, parce que chacune a un angle mort que
 * les autres couvrent. Ne pas « simplifier » en une seule expression :
 *   R1 appel d'une méthode d'écriture du délégué : `prisma.planningCreneau.upsert(`, `tx.planningCreneau?.create(` ;
 *   R2 accès au délégué par crochets : `prisma["planningCreneau"]` (R1 ne le voit pas) ;
 *   R3 délégué manipulé sans méthode (alias, déstructuration, passage en argument) :
 *      `const pc = tx.planningCreneau;` puis `pc.create(` (R1 ne le voit pas) ;
 *   R4 SQL brut qui écrit la table : `INSERT INTO "PlanningCreneau"`, `DELETE FROM "public"."PlanningCreneau"` ;
 *   R5 écriture IMBRIQUÉE par une relation : `employee.update({ data: { planningCreneaux: { create: … } } })`.
 *      Les noms de relation sont LUS dans prisma/schema.prisma, pas tenus à la main.
 *
 * Ce que ce garde-fou NE couvre PAS (limites assumées) :
 *   - le code hors de src/ (prisma/seed, scripts/) ;
 *   - un accès dynamique au modèle (`prisma[nomDeModele]` avec une variable) ;
 *   - les suppressions en CASCADE de la base (supprimer un salarié efface ses créneaux, onDelete: Cascade) ;
 *   - les fichiers de test (*.test.ts, *.test.tsx), qui posent leurs données directement.
 */
const RACINE = path.join(process.cwd(), "src");
const AUTORISE = path.join("lib", "planning-ecriture.ts");

const METHODES = "create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany";

/** Noms des champs de relation de type PlanningCreneau[] (ex. `planningCreneaux`, `creneaux`), lus dans le schéma. */
function relationsVersCreneau(): string[] {
  const schema = fs.readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  return [...schema.matchAll(/^\s*(\w+)\s+PlanningCreneau\[\]/gm)].map((m) => m[1]);
}

const RELATIONS = relationsVersCreneau();

const REGLES: { nom: string; motif: RegExp }[] = [
  { nom: "R1 méthode d'écriture", motif: new RegExp(`\\bplanningCreneau\\s*(?:\\?\\.|\\.)\\s*(?:${METHODES})\\s*\\(`) },
  { nom: "R2 crochets", motif: /\[\s*["'`]planningCreneau["'`]\s*\]/ },
  { nom: "R3 délégué manipulé", motif: /\bplanningCreneau\b\s*(?:[;,)\]}]|$)/m },
  {
    nom: "R4 SQL brut",
    motif: /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO|COPY)\s+(?:ONLY\s+)?(?:"public"\.)?"PlanningCreneau"/i,
  },
  {
    nom: "R5 écriture imbriquée",
    motif: new RegExp(
      `\\b(?:${RELATIONS.join("|")})\\s*:\\s*\\{\\s*(?:create|createMany|connectOrCreate|upsert|update|updateMany|delete|deleteMany|set|connect|disconnect)\\b`,
    ),
  },
];

/** Règles qui détectent une écriture dans `source` (vide = rien de détecté). */
function ecrituresDetectees(source: string): string[] {
  return REGLES.filter((r) => r.motif.test(source)).map((r) => r.nom);
}

/** Sources parcourues : TypeScript ET JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`) — un script JS
 *  posé dans src/ écrirait aussi bien la table. Les fichiers de test sont exclus, quelle que soit
 *  leur extension. */
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST = /\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

function fichiers(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return SOURCE.test(e.name) && !TEST.test(e.name) ? [p] : [];
  });
}

describe("garde-fou : le planning ne s'écrit que par ecrireCreneaux", () => {
  it("aucune écriture de PlanningCreneau hors src/lib/planning-ecriture.ts", () => {
    const tous = fichiers(RACINE);
    // Plancher anti-silence : un parcours qui ne trouve (presque) rien ne prouve rien.
    expect(tous.length).toBeGreaterThan(200);
    const fautifs = tous
      .filter((f) => path.relative(RACINE, f) !== AUTORISE)
      .map((f) => ({ f: path.relative(RACINE, f), regles: ecrituresDetectees(fs.readFileSync(f, "utf8")) }))
      .filter((x) => x.regles.length > 0)
      .map((x) => `${x.f} (${x.regles.join(", ")})`);
    expect(fautifs).toEqual([]);
  });

  it("le parcours lit aussi le JavaScript (.js, .jsx, .mjs, .cjs), jamais les tests", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "garde-planning-"));
    try {
      const noms = ["a.ts", "b.tsx", "c.js", "d.jsx", "e.mjs", "f.cjs", "g.test.ts", "h.test.js", "i.test.mjs", "j.json", "k.md"];
      for (const n of noms) fs.writeFileSync(path.join(dir, n), "");
      expect(fichiers(dir).map((f) => path.basename(f)).sort()).toEqual(["a.ts", "b.tsx", "c.js", "d.jsx", "e.mjs", "f.cjs"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("la réalité du dépôt : le seul chemin autorisé EST reconnu comme écrivant (sinon la règle ne voit plus rien)", () => {
    const source = fs.readFileSync(path.join(RACINE, AUTORISE), "utf8");
    expect(ecrituresDetectees(source)).toContain("R1 méthode d'écriture");
    // deleteMany, createMany, update et le retrait du marqueur ✨ : au moins 3 écritures réelles.
    const r1 = new RegExp(`\\bplanningCreneau\\s*(?:\\?\\.|\\.)\\s*(?:${METHODES})\\s*\\(`, "g");
    expect((source.match(r1) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("la réalité du schéma : les relations vers PlanningCreneau sont lues (Employee.planningCreneaux, Shift.creneaux)", () => {
    expect(RELATIONS).toEqual(expect.arrayContaining(["planningCreneaux", "creneaux"]));
  });

  it("formes historiques (retirées par la tâche 11) et contournements : toutes détectées", () => {
    const fautives = [
      // Formes réelles de planning/actions.ts et echange-creneau.ts avant le 2026-09-23.
      `await prisma.planningCreneau.deleteMany({ where: { employeeId, date } });`,
      `await prisma.planningCreneau.upsert({\n  where: { employeeId_date: { employeeId, date } },`,
      `await prisma.planningCreneau.createMany({\n  data: creneaux.map((c) => ({ ...c, genereAuto: true })),`,
      `prisma.planningCreneau\n        .upsert({ where })`,
      `await prisma.$transaction([\n    prisma.planningCreneau.upsert({`,
      // Contournements.
      `await tx.planningCreneau?.create({ data })`,
      `await prisma["planningCreneau"].create({ data })`,
      `const pc = tx.planningCreneau;\nawait pc.create({ data });`,
      `const { planningCreneau } = prisma;`,
      `vider(tx.planningCreneau, ids)`,
      `await tx.$executeRaw\`DELETE FROM "public"."PlanningCreneau" WHERE "date" >= \${debut}\`;`,
      `await prisma.$executeRawUnsafe('INSERT INTO "PlanningCreneau" ("id") VALUES ($1)', id);`,
      `await tx.$executeRaw\`update "PlanningCreneau" set "shiftId" = \${s}\`;`,
      `await prisma.employee.update({ where: { id }, data: { planningCreneaux: { deleteMany: {} } } });`,
      `await prisma.shift.create({ data: { nom, creneaux: { create: [{ employeeId, date }] } } });`,
    ];
    const manquees = fautives.filter((s) => ecrituresDetectees(s).length === 0);
    expect(manquees).toEqual([]);
  });

  it("sens inverse : les lectures et les types ne déclenchent rien", () => {
    const legitimes = [
      `await prisma.planningCreneau.findMany({ where: { date: { gte: debut } } })`,
      `await tx.planningCreneau.findUnique({ where: { employeeId_date: { employeeId, date } } })`,
      `await prisma.planningCreneau.count({ where: { employeeId } })`,
      `await prisma.planningCreneau.groupBy({ by: ["employeeId"] })`,
      `const w: Prisma.PlanningCreneauWhereInput = {};`,
      `include: { planningCreneaux: { where: { date: { gte: debut } } } }`,
      `select: { creneaux: true }`,
      `creneaux: { iso: string; nom: string; heures: number }[];`,
      `journal.push({ entite: "PlanningCreneau", entiteId: k });`,
      `SELECT l."employeeId" FROM "public"."PayrollLine" l`,
      `// Créneaux mis à jour dans PlanningCreneau par ecrireCreneaux.`,
    ];
    const declenchees = legitimes.filter((s) => ecrituresDetectees(s).length > 0);
    expect(declenchees).toEqual([]);
  });
});
