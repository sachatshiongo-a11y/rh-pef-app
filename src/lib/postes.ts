import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Liste des intitulés de poste connus : union des postes des employés actifs et des fiches de
 * poste créées (même sans employé affecté). Triée alphabétiquement, sans doublon.
 */
export async function chargerPostes(): Promise<string[]> {
  const [employes, fiches] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, select: { poste: true } }),
    prisma.fichePoste.findMany({ select: { poste: true } }),
  ]);
  const set = new Set<string>();
  for (const e of employes) if (e.poste.trim()) set.add(e.poste.trim());
  for (const f of fiches) if (f.poste.trim()) set.add(f.poste.trim());
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}
