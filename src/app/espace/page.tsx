import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "./garde";
import { lundiDe } from "@/lib/dates-fr";
import { chargerContratsClasses } from "@/lib/contrats-espace";
import { chargerSoldeCongeSalarie } from "@/lib/solde-conge-salarie";
import { VueAccueil } from "./vue-accueil";

export default async function EspaceAccueil() {
  const s = await chargerSalarie();
  const now = new Date();
  // « Aujourd'hui » à l'heure de Kinshasa (UTC+1) → DATE à minuit UTC (cohérent avec le planning).
  const k = new Date(Date.now() + 3_600_000);
  const today = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  const lundiCourant = lundiDe(k);

  const [fiche, congesEnAttente, prochainsCreneaux, publiees, contratsClasses, echangesARepondre, solde] = await Promise.all([
    prisma.employee.findUnique({ where: { id: s.employeeId }, select: { photoUrl: true } }),
    prisma.leaveRequest.count({ where: { employeeId: s.employeeId, statut: "EN_ATTENTE" } }),
    // Prochains services À PARTIR D'AUJOURD'HUI (plus de créneaux passés de la semaine).
    prisma.planningCreneau.findMany({
      where: { employeeId: s.employeeId, date: { gte: today } },
      orderBy: { date: "asc" },
      take: 21,
      select: { date: true, shift: { select: { nom: true, heureDebut: true, heureFin: true } } },
    }),
    prisma.semainePubliee.findMany({ where: { lundi: { gte: lundiCourant } }, select: { lundi: true } }),
    chargerContratsClasses(prisma, s.employeeId, now),
    // Propositions d'échange qu'un collègue m'a faites et auxquelles je n'ai pas encore répondu.
    prisma.echangeCreneau.count({ where: { collegueId: s.employeeId, statut: "EN_ATTENTE", reponseCollegue: "EN_ATTENTE" } }),
    chargerSoldeCongeSalarie(prisma, s.employeeId, now),
  ]);

  // Prochain service = premier créneau à venir dont la SEMAINE est publiée (et qui a un horaire).
  const publieeSet = new Set(publiees.map((p) => new Date(p.lundi).toISOString().slice(0, 10)));
  const creneau = prochainsCreneaux.find(
    (c) => c.shift.heureDebut && publieeSet.has(lundiDe(new Date(c.date)).toISOString().slice(0, 10)),
  ) ?? null;

  return (
    <VueAccueil
      nom={s.nom}
      photoUrl={fiche?.photoUrl ?? null}
      prenom={s.prenom}
      contratsASigner={contratsClasses.filter((c) => c.classement.categorie === "A_SIGNER").length}
      echangesARepondre={echangesARepondre}
      congesEnAttente={congesEnAttente}
      soldeConge={solde.solde}
      prochainService={
        creneau
          ? {
              nom: creneau.shift.nom,
              heureDebut: creneau.shift.heureDebut,
              heureFin: creneau.shift.heureFin,
              date: new Date(creneau.date),
              aujourdhui: new Date(creneau.date).getTime() === today.getTime(),
            }
          : null
      }
    />
  );
}
