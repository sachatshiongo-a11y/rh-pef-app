import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
  const ex = await prisma.exerciceFiscal.findMany({ select: { id: true, annee: true, actif: true } });
  console.log("Exercices :", JSON.stringify(ex));
  const rows = await prisma.parametreLegal.findMany({ where: { cle: "salaires_saisis_en_net" }, select: { exerciceId: true, valeur: true, statutValidation: true, updatedAt: true } });
  console.log("Lignes salaires_saisis_en_net :");
  for (const r of rows) console.log(`  exercice ${r.exerciceId} → valeur ${Number(r.valeur)} (${r.statutValidation}) maj ${r.updatedAt.toISOString()}`);
}
main().finally(() => prisma.$disconnect());
