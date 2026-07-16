import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { FichePosteDocument } from "@/lib/pdf/fiche-poste";
import { labelCategoriePro } from "@/lib/categorie-professionnelle";

/**
 * Génère le PDF d'une fiche de poste (buffer + nom de fichier). La classe / catégorie
 * professionnelle est déduite des salariés occupant le poste (valeur la plus fréquente).
 * Renvoie null si la fiche est introuvable.
 */
export async function genererFichePostePdf(ficheId: string): Promise<{ buffer: Buffer; nomFichier: string } | null> {
  const fiche = await prisma.fichePoste.findUnique({ where: { id: ficheId } });
  if (!fiche) return null;

  // Classe : catégorie saisie sur la fiche en priorité ; sinon la plus fréquente parmi les salariés du poste.
  let categorie = fiche.categorieProfessionnelle ?? null;
  if (!categorie) {
    const employes = await prisma.employee.findMany({
      where: { poste: { equals: fiche.poste.trim(), mode: "insensitive" } },
      select: { categorieProfessionnelle: true },
    });
    const compte = new Map<string, number>();
    for (const e of employes) {
      if (e.categorieProfessionnelle) compte.set(e.categorieProfessionnelle, (compte.get(e.categorieProfessionnelle) ?? 0) + 1);
    }
    categorie = [...compte.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  const classe = labelCategoriePro(categorie);

  const buffer = await renderToBuffer(FichePosteDocument({ fiche, classe }));
  const slug = fiche.poste.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return { buffer, nomFichier: `Fiche_de_poste_${slug || "poste"}.pdf` };
}
