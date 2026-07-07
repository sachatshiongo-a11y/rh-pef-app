/**
 * Seed du bloc « acheteur » des bons de commande (module Stock & Achats).
 *
 * Valeurs LUES depuis « Bon de commande V2.xlsm » (feuille « Bon de commande », bloc Acheteur) —
 * non recopiées de mémoire. Idempotent : upsert du singleton. À lancer APRÈS le déploiement de
 * la migration `stock` (sinon la table stock.ParametresAchat n'existe pas encore).
 *
 * Usage : npx tsx scripts/seed-parametres-achat.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ACHETEUR = {
  acheteurNom: "TOLYA SARL",
  acheteurAdresse: "CTC Mall, Avenue Wagenia, Gombe",
  acheteurVille: "KINSHASA",
  acheteurPays: "République démocratique du Congo",
  acheteurIdNational: "01-F4300-N74832J",
  acheteurRccm: "CD/KING/RCCM/18-B-01373",
  acheteurTelephone: "243811532104",
  acheteurContact: "Martine Mutombo",
};

async function main() {
  const r = await prisma.parametresAchat.upsert({
    where: { id: "singleton" },
    update: ACHETEUR,
    create: { id: "singleton", ...ACHETEUR },
  });
  console.log("✓ ParametresAchat (acheteur) semé :", r.acheteurNom, "—", r.acheteurRccm);
}

main()
  .catch((e) => {
    console.error("ÉCHEC seed ParametresAchat:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
