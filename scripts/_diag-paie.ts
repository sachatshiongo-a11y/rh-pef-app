/** DIAGNOSTIC LECTURE SEULE — état des lignes de paie du mois courant vs salaire net saisi. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const n = (x: unknown) => Number(x).toFixed(2).padStart(8);

async function main() {
  const ex = await prisma.exerciceFiscal.findFirstOrThrow({ where: { actif: true } });
  const flag = await prisma.parametreLegal.findFirst({ where: { exerciceId: ex.id, cle: "salaires_saisis_en_net" }, select: { valeur: true } });
  console.log(`\nExercice ${ex.annee} — salaires_saisis_en_net = ${flag ? Number(flag.valeur) : "ABSENT"}`);

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  console.log(`Mois courant : ${config.moisCourant}/${config.anneeCourante}\n`);
  const run = await prisma.payrollRun.findFirst({
    where: { mois: config.moisCourant, annee: config.anneeCourante },
    include: { lignes: { include: { employee: { select: { nom: true, salaireMensuel: true, transportJourCDF: true, categorie: true } } } } },
  });
  if (!run) { console.log("Aucun run pour le mois courant."); return; }

  console.log("Salarié                    Statut       SaisiNet  salBrut  brutImpo transpUSD  IPR   cnssSal  salNet");
  console.log("-".repeat(104));
  for (const l of run.lignes.sort((a, b) => a.employee.nom.localeCompare(b.employee.nom))) {
    const grossi = Number(l.salBrutUSD) - Number(l.transportUSD) > Number(l.employee.salaireMensuel) + 0.5 ? "▲grossi" : "=saisi";
    console.log(
      `${l.employee.nom.padEnd(26).slice(0, 26)} ${l.statutPaiement.padEnd(11)} ${n(l.employee.salaireMensuel)} ${n(l.salBrutUSD)} ${n(l.netImposableUSD)} ${n(l.transportUSD)} ${n(l.iprCalculeUSD)} ${n(l.cnssSalarieUSD)} ${n(l.salNetUSD)}  ${grossi}`
    );
  }
  console.log(`\n(grossi = base cotisable > salaire saisi → gross-up appliqué ; =saisi = pas de reconstitution)\n`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
