import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const EMAIL = process.argv[2];
const PASSWORD = process.argv[3];
const NOM = process.argv[4] ?? "Administrateur";

if (!EMAIL || !PASSWORD) {
  console.error("Usage: tsx scripts/create-admin.ts <email> <password> [nom]");
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
    console.error("Erreur création utilisateur Supabase Auth:", error.message);
    process.exit(1);
  }

  const authUser = data.user;
  console.log("Utilisateur Supabase Auth créé, id =", authUser.id);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  await prisma.user.upsert({
    where: { id: authUser.id },
    update: { email: EMAIL, nom: NOM, role: "ADMIN", actif: true },
    create: { id: authUser.id, email: EMAIL, nom: NOM, role: "ADMIN", actif: true },
  });

  console.log(`Profil applicatif créé avec le rôle ADMIN pour ${EMAIL}.`);
  await prisma.$disconnect();
}

main();
