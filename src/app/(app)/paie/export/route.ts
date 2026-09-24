import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { classeurLivrePaie } from "@/lib/livre-paie-excel";

/**
 * Export Excel du livre de paie — mêmes lignes et mêmes colonnes que l'onglet Paie, plus le
 * détail des retenues pour l'usage comptable. Depuis le 2026-09-24 (demande Direction), un onglet
 * par catégorie (Brigade, puis Back-office), chacun trié par nom, puis un onglet « Récapitulatif ».
 */
export async function GET(request: Request) {
  await verifySession();

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  // Mois/année optionnels (?mois=&annee=) pour exporter n'importe quel mois de l'historique.
  const sp = new URL(request.url).searchParams;
  const mois = Number(sp.get("mois")) || config.moisCourant;
  const annee = Number(sp.get("annee")) || config.anneeCourante;

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: { include: { employee: true } } },
  });

  // Taux du bulletin — jamais déduit des montants nets stockés (voir src/lib/paie-net.ts et src/lib/livre-paie.ts).
  const taux = run ? Number(run.tauxChangeUtilise) : 0;
  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const buf = await classeurLivrePaie({ lignes: run?.lignes ?? [], taux, periode });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Paie_${annee}-${String(mois).padStart(2, "0")}.xlsx"`,
    },
  });
}
