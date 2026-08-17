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
    // Pas de `distinct: ["poste"]` : on a besoin de TOUS les employés pour détecter, poste par
    // poste, si leurs secteurs mèneraient à des shifts différents (cf. `shiftPourEmploye` dans
    // `src/app/(app)/planning/actions.ts`, qui raisonne par employé, jamais par poste agrégé).
    prisma.employee.findMany({ where: { actif: true }, select: { poste: true, secteur: true } }),
    prisma.shift.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
  ]);

  const parNom = (re: RegExp) => shifts.find((s) => re.test(s.nom));
  const caisse = parNom(/caisse/i);
  const cuisine = parNom(/matin cuisine/i);
  const salle = parNom(/matin\/midi salle/i);
  const journee = parNom(/journée 8h-17h/i) ?? shifts.find((s) => !s.systeme && !/admin|nuit/i.test(s.nom));

  const shiftPourPosteSecteur = (poste: string, secteur: string) => {
    const p = poste.toLowerCase();
    const s = secteur.toLowerCase();
    if (/caissi/.test(p)) return caisse ?? journee;
    if (/cuisine/.test(s)) return cuisine ?? journee;
    if (/salle/.test(s)) return salle ?? journee;
    return journee;
  };

  const employesParPoste = new Map<string, { poste: string; secteur: string | null }[]>();
  for (const e of employes) {
    (employesParPoste.get(e.poste) ?? employesParPoste.set(e.poste, []).get(e.poste)!).push(e);
  }

  const lignes: { poste: string; shiftId: string; ordre: number }[] = [];
  for (const [poste, liste] of employesParPoste) {
    const secteursDistincts = [...new Set(liste.map((e) => e.secteur ?? ""))];
    const shiftsResultants = [...secteursDistincts.map((secteur) => shiftPourPosteSecteur(poste, secteur))];
    const shiftsDefinis = shiftsResultants.filter((s): s is NonNullable<typeof s> => s != null);
    const idsDistincts = new Set(shiftsDefinis.map((s) => s.id));

    if (idsDistincts.size === 0) {
      console.warn(`⚠ Aucun shift trouvé pour le poste « ${poste} » — à configurer à la main.`);
      continue;
    }
    // > 1 id distinct : secteurs qui mènent à des shifts différents. shiftsDefinis.length < nombre
    // de secteurs : au moins un secteur ne mène à AUCUN shift pendant qu'un autre en trouve un — même
    // ambiguïté (un secteur serait posé, l'autre pas), traitée à l'identique : on n'écrit rien.
    if (idsDistincts.size > 1 || shiftsDefinis.length !== secteursDistincts.length) {
      console.warn(
        `⚠ Poste « ${poste} » : secteurs distincts (${secteursDistincts.join(", ") || "(aucun)"}) qui mèneraient à des shifts différents — à configurer à la main.`
      );
      continue;
    }

    const shift = shiftsDefinis[0];
    lignes.push({ poste, shiftId: shift.id, ordre: 0 });
  }

  const res = await prisma.shiftPoste.createMany({ data: lignes, skipDuplicates: true });
  console.log(`${res.count} correspondance(s) poste → shift écrite(s) sur ${lignes.length} calculée(s).`);
  console.table(lignes.map((l) => ({ poste: l.poste, shift: shifts.find((s) => s.id === l.shiftId)?.nom })));
}

main().finally(() => prisma.$disconnect());
