import { NextRequest, NextResponse } from "next/server";
import { calculerAlertes } from "@/lib/alertes";
import { envoyerEmail } from "@/lib/email";
import { envoyerPush } from "@/lib/push";
import { prisma } from "@/lib/prisma";

// Toujours exécuté à la demande (jamais mis en cache) : c'est un déclencheur.
export const dynamic = "force-dynamic";

/**
 * Rappels quotidiens par e-mail aux comptes Direction : échéances (congés non validés, contrats,
 * périodes d'essai, documents, déclaration CNSS) et rappel du jour de paie.
 *
 * Appelé chaque matin par un planning GitHub Actions (`.github/workflows/rappels-quotidiens.yml`),
 * protégé par un jeton partagé `CRON_SECRET` (en-tête `Authorization: Bearer …` ou `?token=`).
 * Ne renvoie jamais d'info sensible ; ne fait rien si le jeton est absent/incorrect.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fourni =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    request.nextUrl.searchParams.get("token") ??
    "";
  if (!secret || fourni !== secret) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const alertes = await calculerAlertes();
  // On n'envoie par e-mail que ce qui est proche (urgent/warning) pour éviter un bruit quotidien ;
  // les échéances lointaines (info, ~30 j) restent visibles dans la cloche in-app.
  const aEnvoyer = alertes.filter((a) => a.niveau === "urgent" || a.niveau === "warning");

  if (aEnvoyer.length === 0) {
    return NextResponse.json({ envoye: false, nombre: 0 });
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

  await Promise.all([
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

  return NextResponse.json({ envoye: true, nombre: aEnvoyer.length, urgents: urgents.length });
}
