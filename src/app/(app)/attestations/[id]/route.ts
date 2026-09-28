import { verifySession, estRH } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exemplaireAttestation } from "@/lib/pdf/attestation-buffer";

/** Exemplaire d'une attestation délivrée — pour la RH (même règle que le layout RH : `estRH`). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!estRH(user.role)) return new Response("Accès refusé", { status: 403 });
  const { id } = await params;
  const a = await prisma.attestation.findUnique({ where: { id } });
  if (!a) return new Response("Attestation introuvable", { status: 404 });
  const pdf = await exemplaireAttestation(a);
  if (!pdf) return new Response("Cette attestation n'a pas été délivrée.", { status: 404 });

  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
