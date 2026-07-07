import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";
import { calculerHeuresSupp } from "@/lib/payroll";
import { classeurExcel } from "@/lib/export-excel";

/**
 * Export Excel des heures supplémentaires du mois courant — FIDÈLE à l'onglet :
 * feuille 1 « Heures par jour » (mêmes colonnes que la grille : heures/jour + H. totales,
 * HS 30/60/100, HS valorisées $), feuille 2 « Détail hebdomadaire » (comme le tableau du bas).
 */
export async function GET() {
  await verifySession();

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const parametres = await chargerParametresPaie();
  const mois = config.moisCourant;
  const annee = config.anneeCourante;
  const nbJours = new Date(annee, mois, 0).getDate();
  const nbSemaines = Math.ceil(nbJours / 7);
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const [employees, entries, joursFeriesDuMois] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" } }),
    prisma.overtimeEntry.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
  ]);

  const joursFeries = new Set(
    joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10))
  );

  const hoursMap = new Map<string, number>();
  const joursParEmploye: Record<string, { date: Date; heuresTravaillees: number }[]> = {};
  for (const o of entries) {
    const day = new Date(o.date).getUTCDate();
    const h = Number(o.heuresTravaillees);
    hoursMap.set(`${o.employeeId}_${day}`, h);
    (joursParEmploye[o.employeeId] ??= []).push({ date: new Date(o.date), heuresTravaillees: h });
  }

  const enteteJours = Array.from({ length: nbJours }, (_, i) => String(i + 1));
  const enteteHeures = [
    "Matricule",
    "Nom",
    "Catégorie",
    ...enteteJours,
    "H. totales",
    "HS 30%",
    "HS 60%",
    "HS 100%",
    "HS valorisées $",
  ];
  const lignesHeures: (string | number)[][] = [];
  const lignesSemaines: (string | number)[][] = [];

  for (const e of employees) {
    const salaireJournalier = Number(e.salaireMensuel) / parametres.joursOuvrablesMois;
    const salaireHoraire = salaireJournalier / Number(e.heuresParJour);
    const hs = calculerHeuresSupp({
      jours: joursParEmploye[e.id] ?? [],
      heuresParJourContrat: Number(e.heuresParJour),
      heuresHebdoContrat: Number(e.heuresHebdomadaires),
      salaireHoraire,
      joursFeries,
      params: parametres,
    });

    const jours = Array.from({ length: nbJours }, (_, i) => hoursMap.get(`${e.id}_${i + 1}`) ?? "");
    lignesHeures.push([
      e.matricule,
      e.nom,
      e.categorie,
      ...jours,
      hs.heuresTotalesMois,
      hs.hs30,
      hs.hs60,
      hs.hs100,
      Number(hs.hsValorisee.toFixed(2)),
    ]);

    const parNumero = new Map(hs.semaines.map((s) => [s.semaine, s]));
    for (let sem = 1; sem <= nbSemaines; sem++) {
      const d = parNumero.get(sem);
      lignesSemaines.push([
        e.matricule,
        e.nom,
        `Semaine ${sem}`,
        d ? d.heuresTotales : 0,
        d ? d.hs30 : 0,
        d ? d.hs60 : 0,
        d ? d.hs100 : 0,
        d ? Number(d.hsValorisee.toFixed(2)) : 0,
      ]);
    }
  }

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const buf = await classeurExcel({
    titre: "Heures supplémentaires",
    periode,
    feuilles: [
      { nom: "Heures par jour", entete: enteteHeures, lignes: lignesHeures },
      {
        nom: "Détail hebdomadaire",
        titre: "Heures supplémentaires — détail hebdomadaire",
        entete: ["Matricule", "Nom", "Semaine", "Total", "HS 30%", "HS 60%", "HS 100%", "HS valorisées $"],
        lignes: lignesSemaines,
      },
    ],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Heures_supp_${annee}-${String(mois).padStart(2, "0")}.xlsx"`,
    },
  });
}
