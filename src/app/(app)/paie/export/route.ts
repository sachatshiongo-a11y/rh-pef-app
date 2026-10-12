import { prisma } from "@/lib/prisma";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { exigerEspaceRH } from "@/lib/garde-route";
import { classeurLivrePaie } from "@/lib/livre-paie-excel";
import { MENTION_PROVISOIRE } from "@/lib/mention-provisoire";
import { lireMoisAnnee } from "@/lib/mois-route";

/**
 * Export Excel du livre de paie — mêmes lignes et mêmes colonnes que l'onglet Paie, plus le
 * détail des retenues pour l'usage comptable. Depuis le 2026-09-24 (demande Direction), un onglet
 * par catégorie (Brigade, puis Back-office), chacun trié par nom, puis un onglet « Récapitulatif ».
 */
export async function GET(request: Request) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  // Mois/année optionnels (?mois=&annee=) pour exporter n'importe quel mois de l'historique ; une valeur
  // illisible est refusée (400), jamais remplacée en silence par le mois courant (comme les autres routes de paie).
  const lu = lireMoisAnnee(new URL(request.url).searchParams, { mois: config.moisCourant, annee: config.anneeCourante });
  if (!lu.ok) return new Response(lu.message, { status: 400 });
  const { mois, annee } = lu;

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: { include: { employee: true } } },
  });

  // Taux du bulletin — jamais déduit des montants nets stockés (voir src/lib/paie-net.ts et src/lib/livre-paie.ts).
  const taux = run ? Number(run.tauxChangeUtilise) : 0;
  const periodeMois = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  // Lignes hors calcul (ligne rouverte d'un salarié sorti du calcul) : hors du livre (paie-hors-calcul.ts).
  const lignes = run ? await lignesComptees(prisma, run.lignes) : [];
  // Même mention que le livre PDF : un livre qui contient du non validé n'est pas un livre arrêté.
  const nonValides = lignes.filter((l) => l.statutPaiement === "PAS_VALIDE").length;
  const periode = nonValides > 0 ? `${periodeMois} — ${MENTION_PROVISOIRE} (${nonValides} bulletin(s) sur ${lignes.length})` : periodeMois;
  const buf = await classeurLivrePaie({ lignes, taux, periode });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Paie_${annee}-${String(mois).padStart(2, "0")}.xlsx"`,
    },
  });
}
