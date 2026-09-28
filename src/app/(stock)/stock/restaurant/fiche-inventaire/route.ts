import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { FichesInventaireDocument, type EspaceFiche } from "@/lib/pdf/fiche-inventaire-resto";

/**
 * Fiche(s) d'inventaire du restaurant en PDF, à remplir à la main.
 * `?espace=CUISINE` (défaut) ou `BAR` : la fiche de cet espace ; `?espace=TOUS` : Cuisine puis Bar.
 */
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const demande = new URL(req.url).searchParams.get("espace");
  const espaces: EspaceFiche[] = demande === "TOUS" ? ["CUISINE", "BAR"] : [demande === "BAR" ? "BAR" : "CUISINE"];

  const fiches = await Promise.all(
    espaces.map(async (espace) => ({
      espace,
      // Même filtre et même ordre que l'écran « Stock restaurant ».
      articles: await prisma.articleResto.findMany({
        where: { espace, actif: true },
        orderBy: [{ categorie: "asc" }, { ordre: "asc" }, { designation: "asc" }],
        select: { designation: true, unite: true, categorie: true, actif: true },
      }),
    })),
  );

  const buffer = await renderPdfBuffer(FichesInventaireDocument({ fiches }));
  const nom = demande === "TOUS" ? "Cuisine_Bar" : espaces[0] === "BAR" ? "Bar" : "Cuisine";
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Fiche_inventaire_${nom}.pdf"` },
  });
}
