import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { chargerEntreprise } from "@/lib/entreprise";
import { codeAfficheAImprimer, MESSAGE_POSITION_NON_REGLEE } from "@/lib/pointage-affiche";
import { urlAffiche } from "@/lib/pointage-qr";
import { ORIGINE_AFFICHE } from "@/lib/pointage-origines";
import { genererAffichePdf } from "@/lib/pdf/affiche-pointage";

/**
 * L'affiche de pointage (PDF A4) — Direction uniquement. Refusée tant que la position du
 * restaurant n'est pas réglée ; crée le code s'il n'existe pas encore, sinon réimprime le code en
 * vigueur. Le QR encode TOUJOURS l'origine officielle (`ORIGINE_AFFICHE`), jamais celle de la
 * requête : la Direction peut imprimer depuis n'importe laquelle des adresses de l'application.
 */
export async function GET() {
  const user = await verifySession();
  try {
    requireRole(user, ["ADMIN"]);
  } catch {
    return new Response("Accès refusé : seule la Direction imprime l'affiche de pointage.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let code: string;
  try {
    code = await codeAfficheAImprimer(prisma, user.id);
  } catch (e) {
    if (e instanceof Error && e.message === MESSAGE_POSITION_NON_REGLEE) {
      return new Response(MESSAGE_POSITION_NON_REGLEE, { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw e;
  }

  const { logo } = await chargerEntreprise();
  const buffer = await genererAffichePdf({ url: urlAffiche(ORIGINE_AFFICHE, code), logo });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Affiche-pointage.pdf"`,
      // Le PDF porte le code de l'affiche : aucun cache intermédiaire ne doit le garder.
      "Cache-Control": "no-store",
    },
  });
}
