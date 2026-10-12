import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Nombre d'articles URGENTS par domaine (badge du menu Stock), agrégé en SQL — MÊME RÈGLE que
 * `niveauAlerte` (@/lib/stock) : URGENT = quantité ≤ seuil urgent quand il est renseigné (> 0), sinon
 * rupture (quantité ≤ 0) uniquement si un seuil minimum est défini (sans seuil, pas d'alerte).
 * Articles ACTIFS seulement, comme le tableau de bord (`indicateursStock`) : le badge et le tableau de
 * bord comptent les mêmes articles (audit du 10/10/2026, stock 16).
 */
export async function urgentsParDomaine(): Promise<Record<"NOURRITURE" | "BOISSON" | "AUTRE", number>> {
  const lignes = await prisma.$queryRaw<{ domaine: string; n: number }[]>`
    SELECT a."domaine" AS domaine, COUNT(*)::int AS n
    FROM "stock"."Stock" s
    JOIN "stock"."ArticleStock" a ON a."id" = s."articleId"
    WHERE a."actif" = true
      AND ((s."seuilUrgent" > 0 AND s."quantite" <= s."seuilUrgent")
        OR (s."stockMinimum" > 0 AND s."quantite" <= 0))
    GROUP BY a."domaine"`;
  const urgent = { NOURRITURE: 0, BOISSON: 0, AUTRE: 0 };
  for (const r of lignes) if (r.domaine in urgent) urgent[r.domaine as keyof typeof urgent] = Number(r.n);
  return urgent;
}
