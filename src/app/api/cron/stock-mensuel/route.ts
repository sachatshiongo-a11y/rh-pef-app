import { NextRequest, NextResponse } from "next/server";
import { jetonCronValide } from "@/lib/jeton-cron";
import { envoyerEmail } from "@/lib/email";
import { destinatairesStock } from "@/lib/envois-stock/destinataires";
import { preparerRapportMensuel } from "@/lib/envois-stock/mensuel";

// Toujours exécuté à la demande (jamais mis en cache) : c'est un déclencheur.
export const dynamic = "force-dynamic";

/**
 * Rapport mensuel du Stock, le 1er du mois à 7 h (Kinshasa), à la Direction et au rôle Stock, sur le MOIS ÉCOULÉ : achats
 * par fournisseur (dollars et francs à part), consommation, valeur du stock, plus gros écarts ventes / consommation, prix
 * des fournisseurs, factures à payer.
 *
 * Appelé par un planning GitHub Actions (`.github/workflows/stock-mensuel.yml`), protégé par le même jeton partagé
 * `CRON_SECRET` que les rappels RH (`Authorization: Bearer …` ou `?token=`).
 *
 * `?apercu=1` (avec le jeton) : rend le sujet et le texte du rapport SANS rien envoyer. Lecture seule : aucune écriture.
 */
export async function GET(request: NextRequest) {
  if (!jetonCronValide(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const apercu = request.nextUrl.searchParams.get("apercu") === "1";

  const rapport = await preparerRapportMensuel(new Date());
  const destinataires = await destinatairesStock();
  if (apercu) {
    return NextResponse.json({ envoye: false, apercu: true, mois: rapport.mois.libelle, destinataires: destinataires.length, sujet: rapport.sujet, corps: rapport.corps });
  }
  if (destinataires.length > 0) await envoyerEmail(destinataires.map((d) => d.email), rapport.sujet, rapport.corps);

  return NextResponse.json({ envoye: destinataires.length > 0, destinataires: destinataires.length, mois: rapport.mois.libelle });
}
