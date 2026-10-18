import { NextRequest, NextResponse } from "next/server";
import { jetonCronValide } from "@/lib/jeton-cron";
import { calculerAlertes } from "@/lib/alertes";
import { envoyerEmail } from "@/lib/email";
import { envoyerPush } from "@/lib/push";
import { prisma } from "@/lib/prisma";
import { cleJour, envoiUnique } from "@/lib/envoi-unique";

// Toujours exécuté à la demande (jamais mis en cache) : c'est un déclencheur.
export const dynamic = "force-dynamic";

/**
 * Rappels quotidiens par e-mail aux comptes Direction : échéances (congés non validés, contrats,
 * périodes d'essai, documents, déclaration CNSS) et rappel du jour de paie.
 *
 * Appelé chaque matin par un planning GitHub Actions (`.github/workflows/rappels-quotidiens.yml`),
 * protégé par un jeton partagé `CRON_SECRET` (en-tête `Authorization: Bearer …` ou `?token=`).
 * Ne renvoie jamais d'info sensible ; ne fait rien si le jeton est absent/incorrect.
 *
 * UN SEUL ENVOI PAR JOUR CIVIL DE KINSHASA (`lib/envoi-unique.ts`) : GitHub et cron-job.org peuvent tous deux appeler
 * cette route le même jour ; le second appel répond 200 `{ envoye: false, dejaEnvoye: true }` sans renvoyer. Un envoi
 * échoué n'est pas mémorisé (le réessai renvoie). `?forcer=1` (avec le jeton) renvoie malgré tout.
 */
export async function GET(request: NextRequest) {
  if (!jetonCronValide(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const forcer = request.nextUrl.searchParams.get("forcer") === "1";
  const sortie = await envoiUnique(cleJour("rappels"), { forcer }, async () => {
    const alertes = await calculerAlertes();
    // Rappels RH seulement : les alertes de l'espace Stock (« N facture(s) fournisseur à payer sous 7 jours »…) ont depuis le
    // 2026-10-12 leur courriel détaillé (`/api/cron/stock-quotidien`, mêmes destinataires ADMIN + les comptes Stock) ; les
    // répéter ici ferait un doublon dans la boîte de la Direction. Même filtre que l'accueil RH.
    // On n'envoie par e-mail que ce qui est proche (urgent/warning) pour éviter un bruit quotidien ;
    // les échéances lointaines (info, ~30 j) restent visibles dans la cloche in-app.
    const aEnvoyer = alertes.filter((a) => a.espace === "RH" && (a.niveau === "urgent" || a.niveau === "warning"));

    if (aEnvoyer.length === 0) {
      return { reussi: false, resultat: { corps: { envoye: false, nombre: 0 }, status: 200 } };
    }

    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", actif: true },
      select: { id: true, email: true },
    });

    // Domaine public de l'app (liens des rappels). Configurable via env ; par défaut le domaine actuel.
    const base = process.env.NEXT_PUBLIC_SITE_URL || "https://gestion.patesenfolie.cd";
    const urgents = aEnvoyer.filter((a) => a.niveau === "urgent");
    const warnings = aEnvoyer.filter((a) => a.niveau === "warning");
    const lignes = (list: typeof aEnvoyer) =>
      list.map((a) => `• ${a.message}${a.lien ? `\n  → ${base}${a.lien}` : ""}`).join("\n\n");

    const corps = [
      "Bonjour,",
      "",
      "Voici les rappels du jour :",
      urgents.length ? `\n🔴 URGENT\n\n${lignes(urgents)}` : "",
      warnings.length ? `\n🟠 À VENIR\n\n${lignes(warnings)}` : "",
      "",
      `Se connecter : ${base}/accueil`,
    ]
      .filter(Boolean)
      .join("\n");

    const [emailOk] = await Promise.all([
      envoyerEmail(
        admins.map((a) => a.email),
        `Pâtes en Folie · ${aEnvoyer.length} rappel(s) du jour`,
        corps,
      ),
      envoyerPush(admins.map((a) => a.id), {
        title: `Pâtes en Folie · ${aEnvoyer.length} rappel(s)`,
        body: urgents.length
          ? `${urgents.length} urgent(s) · ${warnings.length} à venir`
          : `${warnings.length} échéance(s) à venir`,
        url: "/accueil",
        tag: "rappels-du-jour",
      }),
    ]);

    // Courriel tenté mais refusé (SMTP injoignable…) : 502, pour que le déclencheur GitHub passe au rouge et prévienne.
    if (!emailOk) return { reussi: false, resultat: { corps: { envoye: false, erreur: "courriel", nombre: aEnvoyer.length }, status: 502 } };
    return { reussi: true, resultat: { corps: { envoye: true, nombre: aEnvoyer.length, urgents: urgents.length }, status: 200 } };
  });
  if (sortie.dejaEnvoye) return NextResponse.json({ envoye: false, dejaEnvoye: true, ...(sortie.enCours ? { enCours: true } : {}) });
  return NextResponse.json(sortie.resultat.corps, { status: sortie.resultat.status });
}
