import { prisma } from "@/lib/prisma";

/**
 * `TypeConge.tauxPct` indexé par nom, pour résoudre la déductibilité d'un congé
 * (`congeDeductibleDuSolde`, dans `@/lib/payroll`). `LeaveRequest.type` est du texte libre
 * (pas de FK stricte vers `TypeConge`), donc on résout le taux par nom au moment du calcul.
 */
export async function chargerTauxParTypeConge(): Promise<Map<string, number | null>> {
  const types = await prisma.typeConge.findMany({ select: { nom: true, tauxPct: true } });
  return new Map(types.map((t) => [t.nom, t.tauxPct]));
}
