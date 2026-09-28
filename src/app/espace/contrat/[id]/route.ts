import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { genererContratPdf } from "@/lib/pdf/contrat-buffer";
import { prisma } from "@/lib/prisma";
import { chargerContratsClasses } from "@/lib/contrats-espace";

/** Contrat de travail (PDF) du salarié pour SON espace — accès limité à ses propres contrats. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) {
    return new Response("Accès refusé", { status: 403 });
  }
  const { id } = await params;
  // « Anciens » de « Mes contrats » : l'exemplaire figé s'il existe — seulement pour un contrat de
  // CE salarié que le classement range bien parmi les anciens (un contrat en vigueur se lit dans
  // ses conditions actuelles, c'est elle qui se signe).
  const sp = new URL(request.url).searchParams;
  const exemplaireFige =
    sp.get("exemplaire") === "fige" &&
    (await chargerContratsClasses(prisma, user.employeeId)).some((c) => c.contrat.id === id && c.classement.categorie === "ANCIEN");
  const pdf = await genererContratPdf(id, { exemplaireFige });
  if (!pdf) return new Response("Contrat introuvable", { status: 404 });
  if (pdf.employeeId !== user.employeeId) return new Response("Accès refusé", { status: 403 });

  const telecharger = sp.get("dl") === "1";
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
    },
  });
}
