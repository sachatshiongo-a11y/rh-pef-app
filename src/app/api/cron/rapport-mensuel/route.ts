import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { envoyerEmail } from "@/lib/email";
import { MOIS_FR_MAJ } from "@/lib/dates-fr";

// Toujours exécuté à la demande (jamais mis en cache) : c'est un déclencheur.
export const dynamic = "force-dynamic";

const usd = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

/**
 * Rapport mensuel automatique envoyé à la Direction : synthèse PAIE (masse salariale, coût
 * employeur, heures, congés) + ACHATS (liste d'achat, factures fournisseurs) du MOIS ÉCOULÉ.
 *
 * Appelé le 1er de chaque mois par un planning GitHub Actions
 * (`.github/workflows/rapport-mensuel.yml`), protégé par le même jeton partagé `CRON_SECRET`
 * que les rappels quotidiens (`Authorization: Bearer …` ou `?token=`).
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

  // Mois écoulé, à l'heure de Kinshasa (UTC+1) — le déclencheur tourne le 1er au matin.
  const kinshasa = new Date(Date.now() + 3_600_000);
  const moisRapport = kinshasa.getUTCMonth() === 0 ? 12 : kinshasa.getUTCMonth(); // 1..12
  const anneeRapport = moisRapport === 12 ? kinshasa.getUTCFullYear() - 1 : kinshasa.getUTCFullYear();
  const debutMois = new Date(Date.UTC(anneeRapport, moisRapport - 1, 1));
  const finMois = new Date(Date.UTC(anneeRapport, moisRapport, 0, 23, 59, 59));
  const labelMois = `${MOIS_FR_MAJ[moisRapport - 1]} ${anneeRapport}`;

  const [run, effectif, achatsListe, factures] = await Promise.all([
    prisma.payrollRun.findUnique({
      where: { mois_annee: { mois: moisRapport, annee: anneeRapport } },
      include: { lignes: true },
    }),
    prisma.employee.count({ where: { actif: true } }),
    prisma.mouvementStock.findMany({
      where: { type: "ENTREE", factureId: null, montantUSD: { not: null }, date: { gte: debutMois, lte: finMois } },
      select: { montantUSD: true },
    }),
    prisma.factureFournisseur.findMany({
      where: { mois: moisRapport, annee: anneeRapport },
      select: { montantUSD: true, montantRegleUSD: true, statut: true },
    }),
  ]);

  // — Synthèse paie (si un calcul existe pour le mois) —
  let blocPaie: string;
  if (run && run.lignes.length > 0) {
    const lignes = run.lignes;
    const somme = (f: (l: (typeof lignes)[number]) => number) => lignes.reduce((a, l) => a + f(l), 0);
    const totalNet = somme((l) => Number(l.salNetUSD));
    const totalCout = somme((l) => Number(l.coutEmployeurUSD));
    const totalHeures = somme((l) => Number(l.heuresTravaillees));
    const totalHS = somme((l) => Number(l.heuresSupp30) + Number(l.heuresSupp60) + Number(l.heuresSupp100));
    const totalConges = somme((l) => l.joursCongePris);
    const payees = run.lignes.filter((l) => l.statutPaiement === "PAYE").length;
    blocPaie = [
      `👥 PAIE — ${run.lignes.length} bulletin(s) (${payees} payé(s)) · effectif actif : ${effectif}`,
      "",
      `• Masse salariale nette : ${usd(totalNet)}`,
      `• Coût employeur total : ${usd(totalCout)}`,
      `• Heures travaillées : ${totalHeures.toLocaleString("fr-FR")} h (dont ${totalHS.toLocaleString("fr-FR")} h supp.)`,
      `• Jours de congé pris : ${totalConges}`,
    ].join("\n");
  } else {
    blocPaie = `👥 PAIE — aucun calcul de paie enregistré pour ${labelMois} (effectif actif : ${effectif}).`;
  }

  // — Synthèse achats (module Stock) —
  const totalListe = achatsListe.reduce((a, m) => a + Number(m.montantUSD ?? 0), 0);
  const totalFactures = factures.reduce((a, f) => a + Number(f.montantUSD), 0);
  const totalRegle = factures.reduce((a, f) => a + Number(f.montantRegleUSD), 0);
  const enAttente = factures.filter((f) => f.statut !== "REGLEE").length;
  const blocAchats = [
    `🛒 ACHATS — ${labelMois}`,
    "",
    `• Liste d'achat (sans facture) : ${usd(totalListe)} (${achatsListe.length} ligne(s) valorisée(s))`,
    `• Factures fournisseurs : ${usd(totalFactures)} sur ${factures.length} facture(s), réglé ${usd(totalRegle)}${enAttente > 0 ? ` — ${enAttente} en attente de règlement` : ""}`,
    `• Total achats du mois : ${usd(totalListe + totalFactures)}`,
  ].join("\n");

  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://gestion.patesenfolie.cd";
  const corps = [
    "Bonjour,",
    "",
    `Voici la synthèse du mois de ${labelMois} :`,
    "",
    blocPaie,
    "",
    blocAchats,
    "",
    `Détails : ${base}/paie · ${base}/stock`,
  ].join("\n");

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", actif: true },
    select: { email: true },
  });
  const emails = admins.map((a) => a.email).filter(Boolean);
  if (emails.length > 0) {
    await envoyerEmail(emails, `📊 Rapport mensuel — ${labelMois}`, corps);
  }

  return NextResponse.json({ envoye: emails.length > 0, destinataires: emails.length, mois: labelMois });
}
