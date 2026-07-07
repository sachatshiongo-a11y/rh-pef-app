import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { STATUT_FACTURE_LABEL } from "@/lib/stock";

const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "");

export async function GET() {
  const user = await verifySession();
  requireModule(user, "stock");

  const factures = await prisma.factureFournisseur.findMany({
    orderBy: [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }],
    include: { fournisseur: { select: { nom: true } } },
  });

  const lignes = factures.map((f) => [
    f.fournisseur?.nom ?? f.fournisseurNom,
    f.numero ?? "",
    d(f.date),
    d(f.dateEcheance),
    d(f.datePaiement),
    Number(f.montantUSD),
    Number(f.montantRegleUSD),
    Number(f.resteAPayerUSD),
    STATUT_FACTURE_LABEL[f.statut] ?? f.statut,
    f.modePaiement ?? "",
  ]);

  const buf = await classeurExcel({
    titre: "Factures fournisseurs",
    periode: new Date().toLocaleDateString("fr-FR"),
    feuilles: [{
      nom: "Factures",
      entete: ["Fournisseur", "N° facture", "Date", "Échéance", "Date paiement", "Montant USD", "Réglé USD", "Reste USD", "Statut", "Mode de paiement"],
      lignes,
    }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Factures_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
