/**
 * Création d'un compte utilisateur (connexion + rôle applicatif).
 *
 * Usage :
 *   npx tsx scripts/create-user.ts <email> <mot-de-passe> <ADMIN|MANAGER|VIEWER> "<Nom complet>"
 *
 * Exemples :
 *   npx tsx scripts/create-user.ts directrice@patesenfolie.cd MotDePasse123 ADMIN "Dominique Tshiongo"
 *   npx tsx scripts/create-user.ts chef@patesenfolie.cd MotDePasse456 MANAGER "Chef de brigade"
 *
 * Rôles :
 *   ADMIN   — tout : paie, validation congés, paramètres, réinitialisations
 *   MANAGER — saisie présences/heures supp, demandes de congé, calcul de paie
 *   VIEWER  — consultation uniquement
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const EMAIL = process.argv[2];
const PASSWORD = process.argv[3];
const ROLE = (process.argv[4] ?? "").toUpperCase() as Role;
const NOM = process.argv[5];

const ROLES_VALIDES: Role[] = ["ADMIN", "MANAGER", "VIEWER"];

if (!EMAIL || !PASSWORD || !ROLES_VALIDES.includes(ROLE) || !NOM) {
  console.error(
    'Usage: npx tsx scripts/create-user.ts <email> <mot-de-passe> <ADMIN|MANAGER|VIEWER> "<Nom complet>"'
  );
  process.exit(1);
}

async function main() {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });

  if (error) {
    console.error("Erreur création utilisateur Supabase Auth :", error.message);
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  await prisma.user.upsert({
    where: { id: data.user.id },
    update: { email: EMAIL, nom: NOM, role: ROLE, actif: true },
    create: { id: data.user.id, email: EMAIL, nom: NOM, role: ROLE, actif: true },
  });

  console.log(`Compte créé : ${EMAIL} (${ROLE}) — ${NOM}`);
  console.log("L'utilisateur peut se connecter immédiatement sur la page de connexion.");
  await prisma.$disconnect();
}

main();
