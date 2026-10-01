import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { classeurExcel } from "@/lib/export-excel";
import { STATUT_FACTURE_LABEL } from "@/lib/stock";
import { jourCourantKinshasaISO, jourKinshasa } from "@/lib/heure-kinshasa";

const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Export Excel des factures : toutes (sans paramètre), ou la SÉLECTION de la barre d'actions
// groupées (`?ids=a,b,c`). Un `ids` présent mais sans identifiant valide exporte zéro ligne — jamais
// « tout » : une sélection mal formée ne doit pas se changer en export complet.
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const brut = new URL(req.url).searchParams.get("ids");
  const ids = brut === null ? null : brut.split(",").map((x) => x.trim()).filter((x) => UUID.test(x));

  const factures = await prisma.factureFournisseur.findMany({
    ...(ids ? { where: { id: { in: ids } } } : {}),
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
    periode: jourKinshasa(new Date()),
    feuilles: [{
      nom: "Factures",
      entete: ["Fournisseur", "N° facture", "Date", "Échéance", "Date paiement", "Montant USD", "Réglé USD", "Reste USD", "Statut", "Mode de paiement"],
      lignes,
    }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Factures_${jourCourantKinshasaISO()}.xlsx"`,
    },
  });
}
