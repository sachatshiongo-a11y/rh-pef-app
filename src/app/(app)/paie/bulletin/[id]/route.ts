import { exigerEspaceRH } from "@/lib/garde-route";
import { genererBulletinPdf } from "@/lib/pdf/bulletin-buffer";
import type { Devise } from "@/lib/pdf/theme";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const { id } = await params;
  const url = new URL(request.url);
  const devise: Devise = url.searchParams.get("devise") === "CDF" ? "CDF" : "USD";
  // ?dl=1 → téléchargement direct ; sinon affichage inline (aperçu).
  const telecharger = url.searchParams.get("dl") === "1";

  const pdf = await genererBulletinPdf(id, devise);
  if (!pdf) return new Response("Bulletin introuvable", { status: 404 });

  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
    },
  });
}
