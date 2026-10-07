import type { PrismaClient } from "@prisma/client";
import { formaterNombre } from "@/lib/montant";
import { cleMouvement, lireCharge, texteDecimal, type ChargeMouvement } from "@/lib/validations-stock/charge";

/**
 * Dépose en base une demande MOUVEMENT_MANUEL EN ATTENTE, exactement comme le faisait l'application
 * entre le 2026-10-01 et le 2026-10-07 (même charge, même résumé, mêmes cibles, même cloche). Depuis,
 * l'application n'en crée plus : ce sont les demandes restées en attente en production, que la
 * Direction doit toujours pouvoir valider ou refuser. Réservé aux tests.
 */
export async function deposerAncienneDemandeMouvement(
  prisma: PrismaClient,
  p: { auteur: { id: string; nom: string }; type: "ENTREE" | "SORTIE"; date: string; origine: string; raisonSortie?: string | null; lignes: [string, number][] },
) {
  const ids = p.lignes.map(([id]) => id);
  const arts = await prisma.articleStock.findMany({ where: { id: { in: ids } }, include: { stock: true } });
  const parId = new Map(arts.map((a) => [a.id, a]));
  const charge: ChargeMouvement = {
    v: 1, type: p.type, date: new Date(`${p.date}T00:00:00.000Z`).toISOString(), origine: p.origine, raisonSortie: p.raisonSortie ?? null,
    lignes: p.lignes.map(([articleId, q]) => {
      const a = parId.get(articleId)!;
      return { articleId, designation: a.designation, unite: a.unite, quantite: texteDecimal(q), stockAvant: a.stock?.quantite.toString() ?? "0", prixUnitaireUSD: a.prixUnitaireUSD?.toString() ?? null };
    }),
  };
  lireCharge("MOUVEMENT_MANUEL", JSON.parse(JSON.stringify(charge))); // relisible comme à la validation
  const detail = charge.lignes.map((l) => `${l.designation} ${formaterNombre(Number(l.quantite), { maximumFractionDigits: 3 })}${l.unite ? ` ${l.unite}` : ""}`).join(", ");
  const resume = `${p.type === "ENTREE" ? "Entrée" : "Sortie"} manuelle « ${p.origine} » : ${detail}`;
  const d = await prisma.demandeValidationStock.create({
    data: {
      nature: "MOUVEMENT_MANUEL", resume, charge: charge as unknown as object, auteurId: p.auteur.id, auteurNom: p.auteur.nom,
      cibles: { create: ids.map((id) => ({ cle: cleMouvement(id) })) },
    },
  });
  await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `À valider — ${resume} (${p.auteur.nom})`, lien: "/stock/a-valider", refId: d.id } });
  return d;
}
