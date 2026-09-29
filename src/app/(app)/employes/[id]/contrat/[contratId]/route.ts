import { exigerEspaceRH } from "@/lib/garde-route";
import { genererContratPdf } from "@/lib/pdf/contrat-buffer";
import { ParametreLegalManquantError } from "@/lib/config";

/** Contrat de travail (PDF) généré depuis la fiche — Direction / Manager. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; contratId: string }> }) {
  const g = await exigerEspaceRH({ roles: ["ADMIN", "MANAGER"] });
  if (!g.ok) return g.reponse;
  const { id, contratId } = await params;

  let pdf: Awaited<ReturnType<typeof genererContratPdf>>;
  try {
    pdf = await genererContratPdf(contratId);
  } catch (e) {
    // Un paramètre légal manque dans l'exercice actif : on le dit (lequel, quel exercice) plutôt
    // qu'une erreur 500 muette — et jamais un contrat imprimé sans le chiffre.
    if (e instanceof ParametreLegalManquantError) {
      return new Response(`Contrat non généré : ${e.message}`, {
        status: 409,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    throw e;
  }
  if (!pdf || pdf.employeeId !== id) return new Response("Contrat introuvable", { status: 404 });

  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
    },
  });
}
