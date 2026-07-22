import "server-only";
import { prisma } from "@/lib/prisma";
import { chargerEntreprise } from "@/lib/entreprise";
import { chargerParametresPaie } from "@/lib/config";
import type { entreprise as entrepriseDefaut } from "@/lib/pdf/theme";
import type { ImagePdf } from "@/lib/entreprise";
import type { ParametresPaie } from "@/lib/payroll";

export type DonneesBulletinsDuMois = {
  run: NonNullable<Awaited<ReturnType<typeof chargerRun>>>;
  feries: string[];
  congesParEmp: Map<string, { dateDebut: Date; dateFin: Date }[]>;
  codesParEmp: Map<string, Record<number, string>>;
  primesParEmp: Map<string, { nom: string; montantUSD: number }[]>;
  entreprise: typeof entrepriseDefaut;
  logo: ImagePdf;
  /** Paramètres de paie (2026-07-22) — pour reconstituer le brut affiché sur le bulletin PDF. */
  parametres: ParametresPaie;
};

function chargerRun(mois: number, annee: number) {
  return prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: { include: { employee: true }, orderBy: { employee: { nom: "asc" } } } },
  });
}

/**
 * Charge les données communes aux exports de bulletins du mois (PDF groupé et ZIP séparé) :
 * le run de paie, les jours fériés, et les congés/présences/primes du mois regroupés par employé.
 * Renvoie `null` si aucune paie n'est calculée pour ce mois (aucun run ou aucune ligne).
 */
export async function chargerDonneesBulletinsDuMois(mois: number, annee: number): Promise<DonneesBulletinsDuMois | null> {
  const run = await chargerRun(mois, annee);
  if (!run || run.lignes.length === 0) return null;

  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const [conges, attendances, primes, feriesRows, ent, parametres] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } },
    }),
    prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.prime.findMany({ where: { mois, annee }, orderBy: { createdAt: "asc" } }),
    prisma.jourFerie.findMany({ select: { date: true } }),
    chargerEntreprise(),
    chargerParametresPaie(),
  ]);

  const feries = feriesRows.map((f) => new Date(f.date).toISOString().slice(0, 10));

  const congesParEmp = new Map<string, { dateDebut: Date; dateFin: Date }[]>();
  for (const c of conges)
    (congesParEmp.get(c.employeeId) ?? congesParEmp.set(c.employeeId, []).get(c.employeeId)!).push({
      dateDebut: new Date(c.dateDebut),
      dateFin: new Date(c.dateFin),
    });

  const codesParEmp = new Map<string, Record<number, string>>();
  for (const a of attendances) {
    const map = codesParEmp.get(a.employeeId) ?? codesParEmp.set(a.employeeId, {}).get(a.employeeId)!;
    map[new Date(a.date).getUTCDate()] = a.code;
  }

  const primesParEmp = new Map<string, { nom: string; montantUSD: number }[]>();
  for (const p of primes)
    (primesParEmp.get(p.employeeId) ?? primesParEmp.set(p.employeeId, []).get(p.employeeId)!).push({
      nom: p.nom,
      montantUSD: Number(p.montantUSD),
    });

  return { run, feries, congesParEmp, codesParEmp, primesParEmp, entreprise: ent.entreprise, logo: ent.logo, parametres };
}
