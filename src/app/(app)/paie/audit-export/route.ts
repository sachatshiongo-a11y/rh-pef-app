import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";

/**
 * Export Excel du journal d'audit (qui / quand / quoi : avant → après) — réservé Admin.
 * Trace toutes les actions sensibles : transitions de paie (validé/payé/rouvert), primes,
 * acomptes, frais médicaux, contrats, réinitialisations. Utile en cas de contrôle.
 * Optionnel : ?entite=PayrollLine pour filtrer, ?depuis=YYYY-MM-DD pour borner dans le temps.
 */
export async function GET(request: Request) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const url = new URL(request.url);
  const entite = url.searchParams.get("entite") ?? undefined;
  const depuisStr = url.searchParams.get("depuis");
  const depuis = depuisStr ? new Date(depuisStr) : undefined;

  const entrees = await prisma.journalAudit.findMany({
    where: {
      ...(entite ? { entite } : {}),
      ...(depuis && !isNaN(depuis.getTime()) ? { date: { gte: depuis } } : {}),
    },
    orderBy: { date: "desc" },
    include: { user: { select: { nom: true } } },
    take: 20000,
  });

  const entete = [
    "Date et heure",
    "Utilisateur",
    "Entité",
    "Référence",
    "Champ",
    "Ancienne valeur",
    "Nouvelle valeur",
  ];
  const rows = entrees.map((e) => [
    new Date(e.date).toLocaleString("fr-FR"),
    e.user?.nom ?? e.userId,
    e.entite,
    e.entiteId,
    e.champ,
    e.ancienneValeur ?? "",
    e.nouvelleValeur ?? "",
  ]);

  const buf = await classeurExcel({
    titre: "Journal d'audit",
    periode: `Extrait le ${new Date().toLocaleDateString("fr-FR")} — ${entrees.length} entrée(s)`,
    feuilles: [{ nom: "Audit", entete, lignes: rows }],
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Journal_audit_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
