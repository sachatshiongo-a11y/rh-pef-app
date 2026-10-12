import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// GARDE-FOU : LES ENVOIS AUTOMATIQUES DU STOCK N'ÉCRIVENT RIEN (Direction, 2026-10-12).
//
// Le courriel quotidien et le rapport mensuel LISENT les données du Stock et envoient un message. Rien d'autre :
// ni mouvement, ni statut, ni notification en base, ni journal. Ce test parcourt les sources de ces envois À CHAQUE
// PASSAGE et refuse toute écriture Prisma ou tout SQL d'écriture ; il est éprouvé sur des sources écrites ici
// (falsification). Son pendant à l'exécution : les tests d'intégration, qui branchent un client Prisma ESPION
// (src/lib/test/espion-ecritures.ts) et comparent l'empreinte des tables avant / après.
//
// Hors de ce périmètre, sciemment : les fonctions PARTAGÉES que ces envois appellent (indicateursStock, dlcProches,
// chargerHausses…) — lecture seule elles aussi, ce que l'espion vérifie à l'exécution — et l'envoi lui-même
// (`envoyerEmail`, `envoyerPush`), dont le seul effet de bord est de supprimer un abonnement push périmé.

const RACINE = path.resolve(__dirname, "../../..");
const SOURCES = [
  ...fs.readdirSync(__dirname).filter((f) => /\.ts$/.test(f) && !/\.test\./.test(f)).map((f) => `src/lib/envois-stock/${f}`),
  "src/app/api/cron/stock-quotidien/route.ts",
  "src/app/api/cron/stock-mensuel/route.ts",
];

const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Les écritures qu'un source ne doit pas contenir. */
export function ecritures(source: string): string[] {
  const s = sansCommentaires(source);
  const trouvees: string[] = [];
  for (const m of s.matchAll(/\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/g)) trouvees.push(`écriture Prisma .${m[1]}()`);
  for (const m of s.matchAll(/\$(executeRaw|executeRawUnsafe|transaction)\b/g)) trouvees.push(`$${m[1]}`);
  for (const m of s.matchAll(/\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|DROP\s+TABLE)\b/gi)) trouvees.push(`SQL d'écriture ${m[1]}`);
  for (const m of s.matchAll(/\b(revalidatePath|revalidateTag)\s*\(/g)) trouvees.push(m[1]!); // un envoi ne touche pas au cache des écrans
  return trouvees;
}

describe("les envois automatiques du Stock n'écrivent rien", () => {
  it("le parcours trouve bien les sources (garde contre un faux vert)", () => {
    expect(SOURCES).toEqual(expect.arrayContaining([
      "src/lib/envois-stock/quotidien.ts", "src/lib/envois-stock/mensuel.ts", "src/lib/envois-stock/destinataires.ts",
      "src/app/api/cron/stock-quotidien/route.ts", "src/app/api/cron/stock-mensuel/route.ts",
    ]));
  });

  it.each(SOURCES)("%s : aucune écriture Prisma, aucun SQL d'écriture, aucune transaction", (f) => {
    expect(ecritures(fs.readFileSync(path.join(RACINE, f), "utf8"))).toEqual([]);
  });

  it("falsification : le détecteur reconnaît une écriture Prisma, un SQL d'écriture et une transaction — et elles seules", () => {
    expect(ecritures("await prisma.notification.create({ data: {} })")).toEqual(["écriture Prisma .create()"]);
    expect(ecritures("await tx.stock.updateMany({})")).toEqual(["écriture Prisma .updateMany()"]);
    expect(ecritures("await prisma.$executeRaw`UPDATE \"Stock\" SET x = 1`")).toEqual(["$executeRaw", `SQL d'écriture UPDATE "`]);
    expect(ecritures("await prisma.$transaction([])")).toEqual(["$transaction"]);
    expect(ecritures("revalidatePath('/stock')")).toEqual(["revalidatePath"]);
    // Des lectures et des commentaires ne sont pas des écritures.
    expect(ecritures("// await prisma.stock.update()\nconst x = await prisma.stock.findMany({ where: {} }); /* .delete( */")).toEqual([]);
    expect(ecritures("await prisma.$queryRaw`SELECT 1`")).toEqual([]);
  });

  it("chaque source du périmètre existe (un fichier renommé ne sort pas du contrôle sans que le test le dise)", () => {
    for (const f of SOURCES) expect(fs.existsSync(path.join(RACINE, f)), f).toBe(true);
  });
});
