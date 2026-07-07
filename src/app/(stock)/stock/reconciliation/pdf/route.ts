import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { FicheStockDocument } from "@/lib/pdf/fiche-stock";
import type { Prisma } from "@prisma/client";

export async function GET(request: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const dom = url.searchParams.get("domaine");
  const domaine = dom === "NOURRITURE" || dom === "BOISSON" ? dom : undefined;

  const where: Prisma.ArticleStockWhereInput = {
    actif: true,
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const articles = await prisma.articleStock.findMany({
    where,
    orderBy: [{ domaine: "asc" }, { designation: "asc" }],
    include: { stock: true },
  });

  const parDomaine = new Map<string, { designation: string; unite: string | null; theorique: string }[]>();
  for (const a of articles) {
    if (!parDomaine.has(a.domaine)) parDomaine.set(a.domaine, []);
    parDomaine.get(a.domaine)!.push({
      designation: a.designation,
      unite: a.unite,
      theorique: a.stock ? Number(a.stock.quantite).toLocaleString("fr-FR", { maximumFractionDigits: 3 }) : "0",
    });
  }
  const groupes = [...parDomaine.entries()].map(([domaine, arts]) => ({ domaine, articles: arts }));
  const sousTitre = new Date().toLocaleDateString("fr-FR") + (domaine ? ` — ${domaine === "NOURRITURE" ? "Nourriture" : "Boissons"}` : "");

  const buffer = await renderToBuffer(FicheStockDocument({ groupes, sousTitre }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Fiche_comptage_${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
}
