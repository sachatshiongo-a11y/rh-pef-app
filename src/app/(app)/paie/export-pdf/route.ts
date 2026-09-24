import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { LivrePaieDocument } from "@/lib/pdf/livre-paie";

/**
 * Livre de paie du mois courant en PDF (mêmes colonnes que l'onglet Paie). Depuis le 2026-09-24
 * (demande Direction) : la Brigade sur ses pages, le Back-office à partir d'une nouvelle page,
 * puis une page « Récapitulatif ».
 */
export async function GET() {
  await verifySession();
  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const { moisCourant: mois, anneeCourante: annee } = config;

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: { include: { employee: true } } },
  });
  const lignes = run?.lignes ?? [];
  if (!run || lignes.length === 0) return new Response("Aucune paie calculée pour ce mois", { status: 404 });
  // Taux du bulletin — jamais déduit des montants nets stockés (voir src/lib/paie-net.ts et src/lib/livre-paie.ts).
  const taux = Number(run.tauxChangeUtilise);

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const buffer = await renderPdfBuffer(LivrePaieDocument({ lignes, taux, periode }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Livre_paie_${annee}-${String(mois).padStart(2, "0")}.pdf"`,
    },
  });
}
