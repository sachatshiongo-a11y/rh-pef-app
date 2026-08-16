import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Reprise PONCTUELLE des correspondances poste → shift qui étaient codées en dur dans
// `genererPlanningAuto` (expressions régulières sur le nom du shift). Objectif : que la première
// génération après déploiement produise le même résultat qu'avant sur ce point précis.
//
// Idempotent : relançable sans créer de doublon (contrainte unique poste+shiftId + skipDuplicates).
// Ne touche jamais aux shifts « Admin » et « Nuit », qui n'étaient jamais affectés automatiquement.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const [employes, shifts] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, select: { poste: true, secteur: true }, distinct: ["poste"] }),
    prisma.shift.findMany({ where: { actif: true } }),
  ]);

  const parNom = (re: RegExp) => shifts.find((s) => re.test(s.nom));
  const caisse = parNom(/caisse/i);
  const cuisine = parNom(/matin cuisine/i);
  const salle = parNom(/matin\/midi salle/i);
  const journee = parNom(/journée 8h-17h/i) ?? shifts.find((s) => !s.systeme && !/admin|nuit/i.test(s.nom));

  const lignes: { poste: string; shiftId: string; ordre: number }[] = [];
  for (const e of employes) {
    if (!e.poste) continue;
    const poste = (e.poste ?? "").toLowerCase();
    const secteur = (e.secteur ?? "").toLowerCase();
    const shift = /caissi/.test(poste)
      ? (caisse ?? journee)
      : /cuisine/.test(secteur)
        ? (cuisine ?? journee)
        : /salle/.test(secteur)
          ? (salle ?? journee)
          : journee;
    if (!shift) {
      console.warn(`⚠ Aucun shift trouvé pour le poste « ${e.poste} » — à configurer à la main.`);
      continue;
    }
    lignes.push({ poste: e.poste, shiftId: shift.id, ordre: 0 });
  }

  const res = await prisma.shiftPoste.createMany({ data: lignes, skipDuplicates: true });
  console.log(`${res.count} correspondance(s) poste → shift écrite(s) sur ${lignes.length} calculée(s).`);
  console.table(lignes.map((l) => ({ poste: l.poste, shift: shifts.find((s) => s.id === l.shiftId)?.nom })));
}

main().finally(() => prisma.$disconnect());
