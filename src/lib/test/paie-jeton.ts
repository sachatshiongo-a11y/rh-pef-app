import type { PrismaClient } from "@prisma/client";
import { SELECTION_JETON, jetonDeLigneLue } from "@/lib/paie-jeton";

// Tests : ce que l'écran enverrait MAINTENANT pour ces lignes (jeton des montants affichés, taux de
// la paie compris) — le jeton est obligatoire pour valider et payer depuis le 2026-10-01. Une ligne
// qui n'existe plus n'a pas de jeton (l'écran ne la montre plus).
export async function jetonsDe(prisma: PrismaClient, ids: string[]): Promise<Record<string, string>> {
  const lignes = await prisma.payrollLine.findMany({ where: { id: { in: ids } }, select: { id: true, ...SELECTION_JETON } });
  return Object.fromEntries(lignes.map((l) => [l.id, jetonDeLigneLue(l)]));
}

export async function jetonDe(prisma: PrismaClient, id: string): Promise<string> {
  return (await jetonsDe(prisma, [id]))[id] ?? "";
}
