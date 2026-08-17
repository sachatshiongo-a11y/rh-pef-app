/**
 * ACTIVATION (2026-07-22) — pose le paramètre légal `salaires_saisis_en_net = 1` sur l'exercice
 * fiscal ACTIF de la base courante (.env → prod). Décision client : les salaires saisis sont des
 * NETS, le moteur reconstitue le brut. Réversible : relancer avec valeur 0 (ou éditer dans /parametres)
 * puis « Recalculer la paie du mois ». Les bulletins VALIDE/PAYE (figés) ne sont pas touchés.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// `npx tsx scripts/_activer-salaires-net.ts`      → active (valeur 1)
// `npx tsx scripts/_activer-salaires-net.ts off`  → désactive (valeur 0, retour au calcul historique)
const valeur = process.argv[2] === "off" ? 0 : 1;

async function main() {
  const exercice = await prisma.exerciceFiscal.findFirstOrThrow({ where: { actif: true } });
  const ligne = await prisma.parametreLegal.upsert({
    where: { exerciceId_cle: { exerciceId: exercice.id, cle: "salaires_saisis_en_net" } },
    update: { valeur },
    create: {
      exerciceId: exercice.id,
      cle: "salaires_saisis_en_net",
      valeur,
      unite: "choix",
      libelle: "Salaires saisis interprétés comme des NETS (reconstitution du brut)",
      commentaire: "Activé le 2026-07-22 à la demande du client. À valider par un comptable.",
    },
  });
  console.log(`\n✓ Paramètre posé — exercice ${exercice.annee} (id ${exercice.id})`);
  console.log(`  salaires_saisis_en_net = ${Number(ligne.valeur)} (${valeur === 1 ? "ACTIF" : "désactivé"}, statut ${ligne.statutValidation})`);
  console.log(
    valeur === 1
      ? `\nLes brouillons de paie du mois seront recalculés en brut reconstitué à la prochaine\nouverture de /paie (rafraîchissement). Bulletins déjà validés/payés : inchangés.\n`
      : `\nRetour au calcul historique. Rouvrir /paie pour recalculer les brouillons.\n`
  );
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
