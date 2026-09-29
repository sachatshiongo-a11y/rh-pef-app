import { exigerEspaceSalarie } from "@/lib/garde-route";
import { genererContratPdf } from "@/lib/pdf/contrat-buffer";
import { prisma } from "@/lib/prisma";
import { chargerContratsClasses } from "@/lib/contrats-espace";
import { ParametreLegalManquantError } from "@/lib/config";

/** Contrat de travail (PDF) du salarié pour SON espace — accès limité à ses propres contrats. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await exigerEspaceSalarie();
  if (!g.ok) return g.reponse;
  const user = g.user;
  const { id } = await params;
  // « Anciens » de « Mes contrats » : l'exemplaire figé s'il existe — seulement pour un contrat de
  // CE salarié que le classement range bien parmi les anciens (un contrat en vigueur se lit dans
  // ses conditions actuelles, c'est elle qui se signe).
  const sp = new URL(request.url).searchParams;
  const exemplaireFige =
    sp.get("exemplaire") === "fige" &&
    (await chargerContratsClasses(prisma, user.employeeId)).some((c) => c.contrat.id === id && c.classement.categorie === "ANCIEN");
  let pdf: Awaited<ReturnType<typeof genererContratPdf>>;
  try {
    pdf = await genererContratPdf(id, { exemplaireFige });
  } catch (e) {
    // Paramètre légal manquant : l'affaire de la Direction, pas du salarié — on ne lui montre pas
    // le nom technique de la clé, seulement qu'il n'y est pour rien et à qui s'adresser.
    if (e instanceof ParametreLegalManquantError) {
      return new Response("Votre contrat ne peut pas être affiché pour le moment : un réglage manque côté Direction. Prévenez-la.", {
        status: 409,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    throw e;
  }
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
