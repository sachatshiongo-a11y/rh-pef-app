import "server-only";

import { prisma } from "@/lib/prisma";
import { lundiDe } from "@/lib/dates-fr";

/**
 * Jours de la SEMAINE À CHEVAL tombés avant le 1er du mois (lundi de la première semaine → veille du
 * 1er) : leurs heures placent le seuil hebdomadaire des heures supp. (`calculerHeuresSupp`,
 * `joursAvantMois`) sans être comptées dans le mois — même règle que la paie (`paie-reference.ts`).
 * Sert aux écrans Présences (grille, détail hebdomadaire, export). Vide si le mois commence un lundi.
 * Rend aussi les fériés de cette plage (un férié n'entre pas dans le seuil).
 */
export async function chargerHeuresAvantMois(annee: number, mois: number): Promise<{
  parEmploye: Record<string, { date: Date; heuresTravaillees: number }[]>;
  feriesIso: string[];
}> {
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const lundi = lundiDe(debutMois);
  if (lundi.getTime() >= debutMois.getTime()) return { parEmploye: {}, feriesIso: [] };
  const veille = new Date(debutMois.getTime() - 86_400_000);
  const [heures, feries] = await Promise.all([
    prisma.overtimeEntry.findMany({ where: { date: { gte: lundi, lte: veille } }, select: { employeeId: true, date: true, heuresTravaillees: true } }),
    prisma.jourFerie.findMany({ where: { date: { gte: lundi, lte: veille } }, select: { date: true } }),
  ]);
  const parEmploye: Record<string, { date: Date; heuresTravaillees: number }[]> = {};
  for (const h of heures) (parEmploye[h.employeeId] ??= []).push({ date: new Date(h.date), heuresTravaillees: Number(h.heuresTravaillees) });
  return { parEmploye, feriesIso: feries.map((f) => new Date(f.date).toISOString().slice(0, 10)) };
}
