import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { verifySession } from "@/lib/auth";
import { calculerDeclarationsMois } from "@/lib/declarations";
import { BordereauDeclarationsDocument } from "@/lib/pdf/declarations";
import { chargerEntreprise } from "@/lib/entreprise";

export async function GET(request: Request) {
  await verifySession();

  const params = new URL(request.url).searchParams;
  const mois = Number(params.get("mois"));
  const annee = Number(params.get("annee"));
  if (!Number.isInteger(mois) || mois < 1 || mois > 12 || !Number.isInteger(annee)) {
    return new Response("Mois ou année invalide", { status: 400 });
  }

  const bordereau = await calculerDeclarationsMois(mois, annee);
  if (!bordereau) {
    return new Response("Aucune paie calculée pour ce mois", { status: 404 });
  }

  const ent = await chargerEntreprise();
  const buffer = await renderPdfBuffer(
    BordereauDeclarationsDocument({
      lignes: bordereau.lignes,
      mois,
      annee,
      tauxChange: bordereau.tauxChange,
      entreprise: ent.entreprise,
      logo: ent.logo,
    })
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Bordereau_declarations_${annee}-${String(mois).padStart(2, "0")}.pdf"`,
    },
  });
}
