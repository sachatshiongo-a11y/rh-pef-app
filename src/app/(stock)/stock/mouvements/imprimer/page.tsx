import { prisma } from "@/lib/prisma";
import { PrintDoc } from "../../_print/print-doc";

const TYPE: Record<string, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement" };

export default async function MouvementsImprimerPage() {
  const mouvements = await prisma.mouvementStock.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 2000,
    include: { article: { select: { designation: true } } },
  });

  const lignes = mouvements.map((m) => [
    new Date(m.date).toLocaleDateString("fr-FR"),
    m.article.designation,
    TYPE[m.type] ?? m.type,
    `${m.type === "SORTIE" ? "−" : "+"}${Number(m.quantite)}`,
    m.origine ?? "",
  ] as (string | number)[]);

  return (
    <PrintDoc
      titre="Mouvements de stock"
      sousTitre={new Date().toLocaleDateString("fr-FR")}
      entete={["Date", "Article", "Type", "Quantité", "Origine"]}
      aligneDroite={[3]}
      lignes={lignes}
    />
  );
}
