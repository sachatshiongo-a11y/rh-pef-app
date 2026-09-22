import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { BulletinsDocument } from "@/lib/pdf/bulletin";
import { chargerDonneesBulletinsDuMois, bulletinsPourPdf } from "@/lib/paie-bulletins";
import type { Devise } from "@/lib/pdf/theme";

/** Tous les bulletins du mois courant dans UN seul PDF (une page par employé). */
export async function GET(request: Request) {
  await verifySession();
  const devise: Devise = new URL(request.url).searchParams.get("devise") === "CDF" ? "CDF" : "USD";

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const mois = config.moisCourant;
  const annee = config.anneeCourante;

  const donnees = await chargerDonneesBulletinsDuMois(mois, annee);
  if (!donnees) {
    return new Response("Aucune paie calculée pour ce mois", { status: 404 });
  }

  // Assemblage partagé avec l'export ZIP — c'est lui qui pose `signatureSalarie` sur chaque
  // bulletin : la liasse du mois porte les mêmes mentions que le bulletin ouvert à l'unité.
  const bulletins = bulletinsPourPdf(donnees);

  const buffer = await renderPdfBuffer(BulletinsDocument({ bulletins, devise }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Bulletins_${annee}-${String(mois).padStart(2, "0")}_${devise}.pdf"`,
    },
  });
}
