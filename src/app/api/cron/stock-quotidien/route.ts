import { NextRequest, NextResponse } from "next/server";
import { jetonCronValide } from "@/lib/jeton-cron";
import { envoyerEmail } from "@/lib/email";
import { envoyerPush } from "@/lib/push";
import { destinatairesStock } from "@/lib/envois-stock/destinataires";
import { preparerEnvoiQuotidien } from "@/lib/envois-stock/quotidien";

// Toujours exécuté à la demande (jamais mis en cache) : c'est un déclencheur.
export const dynamic = "force-dynamic";

/**
 * Courriel quotidien du Stock, à 7 h (Kinshasa), à la Direction et au rôle Stock : articles en rupture ou sous le seuil,
 * factures échues ou à échéance sous 7 jours, DLC proches, demandes en attente, bons de commande à réceptionner, stocks
 * négatifs. Il ne part QUE s'il y a quelque chose à signaler.
 *
 * Appelé chaque matin par un planning GitHub Actions (`.github/workflows/stock-quotidien.yml`), protégé par le même
 * jeton partagé `CRON_SECRET` que les rappels RH (en-tête `Authorization: Bearer …` ou `?token=`). Ne renvoie jamais
 * d'info sensible ; ne fait rien si le jeton est absent ou incorrect.
 *
 * `?apercu=1` (avec le jeton) : rend le sujet et le texte du courriel SANS rien envoyer — pour tester sans écrire à personne.
 * Cette route n'écrit RIEN dans les données du Stock (lecture seule) ; l'envoi se fait par courriel et notification.
 */
export async function GET(request: NextRequest) {
  if (!jetonCronValide(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const apercu = request.nextUrl.searchParams.get("apercu") === "1";

  const envoi = await preparerEnvoiQuotidien(new Date());
  if (!envoi) return NextResponse.json({ envoye: false, apercu, nombre: 0 });

  const destinataires = await destinatairesStock();
  if (apercu) {
    return NextResponse.json({ envoye: false, apercu: true, nombre: envoi.nombre, destinataires: destinataires.length, sujet: envoi.sujet, corps: envoi.corps });
  }
  if (destinataires.length === 0) return NextResponse.json({ envoye: false, nombre: envoi.nombre, destinataires: 0 });

  const nbAlertes = envoi.rubriques.find((r) => r.cle === "alertes")?.nombre ?? 0;
  await Promise.all([
    envoyerEmail(destinataires.map((d) => d.email), envoi.sujet, envoi.corps),
    envoyerPush(destinataires.map((d) => d.id), {
      title: `Pâtes en Folie · Stock : ${envoi.nombre} point(s)`,
      body: envoi.rubriques.map((r) => r.titre).join(" · ").slice(0, 180),
      url: "/stock",
      tag: "stock-du-jour",
    }),
  ]);

  return NextResponse.json({ envoye: true, nombre: envoi.nombre, rubriques: envoi.rubriques.map((r) => r.cle), articlesEnAlerte: nbAlertes, destinataires: destinataires.length });
}
