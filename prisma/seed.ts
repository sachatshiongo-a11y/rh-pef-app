import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Seed de base : paramètres OPÉRATIONNELS (taux de change, période) + jours fériés.
// Les paramètres LÉGAUX (CNSS, IPR, INPP, ONEM, HS...) sont chargés séparément par
// scripts/seed-legal-2026.ts (table ParametreLegal versionnée par exercice).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.config.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      tauxChangeCDF: 2300,
      anneeCourante: 2026,
      moisCourant: 6,
    },
  });

  const joursFeries = [
    { date: new Date("2026-01-01"), designation: "Jour de l'An" },
    { date: new Date("2026-01-04"), designation: "Martyrs de l'Indépendance" },
    { date: new Date("2026-01-17"), designation: "Mwalimu J.K." },
    { date: new Date("2026-05-01"), designation: "Fête du Travail" },
    { date: new Date("2026-05-17"), designation: "Journée de Libération" },
    { date: new Date("2026-06-30"), designation: "Fête de l'Indépendance" },
    { date: new Date("2026-08-01"), designation: "Fête des Parents" },
    { date: new Date("2026-12-25"), designation: "Noël" },
  ];
  for (const j of joursFeries) {
    await prisma.jourFerie.upsert({
      where: { date: j.date },
      update: { designation: j.designation, annee: j.date.getFullYear() },
      create: { date: j.date, designation: j.designation, annee: j.date.getFullYear() },
    });
  }

  console.log(
    "Seed de base terminé : Config + jours fériés. Lancez ensuite scripts/seed-legal-2026.ts pour les paramètres légaux."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
