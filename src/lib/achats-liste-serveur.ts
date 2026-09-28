import "server-only";
import { prisma } from "@/lib/prisma";
import { cleAlnum } from "@/lib/texte";
import { formaterNombre } from "@/lib/montant";
import { jjmmaaaa, memeQuantite } from "@/lib/achats-liste";

export type LigneAVerifier = { articleId: string; designation: string; quantite: number };

/**
 * Avertissements NON bloquants d'une Liste d'achat, à la saisie comme à l'enregistrement.
 * L'outil signale, la personne tranche : rien n'est refusé ici.
 *
 * 1. DOUBLE SAISIE — même article, même jour, même quantité déjà entré par une FACTURE ou par la
 *    RÉCEPTION d'un bon de commande : si c'est le même achat, le stock le compterait deux fois.
 * 2. COMPTAGE POSTÉRIEUR — un achat daté AVANT un comptage d'inventaire de l'article : si la
 *    marchandise était au dépôt ce jour-là, le comptage l'a déjà mise dans le stock.
 *
 * Une ligne en désignation libre est rapprochée de l'article comme le fera l'enregistrement
 * (même clé `cleAlnum`) ; une désignation nouvelle n'a, par définition, rien à signaler.
 */
export async function avertissementsListeAchat(dateISO: string, lignes: LigneAVerifier[]): Promise<string[]> {
  const aVerifier = lignes.filter((l) => (l.articleId || l.designation.trim()) && l.quantite > 0);
  if (aVerifier.length === 0) return [];

  const sansId = aVerifier.some((l) => !l.articleId);
  const catalogue = sansId ? await prisma.articleStock.findMany({ select: { id: true, designation: true } }) : [];
  const parNom = new Map(catalogue.map((a) => [cleAlnum(a.designation), a.id]));
  const resolues = aVerifier
    .map((l) => ({ ...l, articleId: l.articleId || parNom.get(cleAlnum(l.designation)) || "" }))
    .filter((l) => l.articleId);
  if (resolues.length === 0) return [];
  const ids = [...new Set(resolues.map((l) => l.articleId))];
  const date = new Date(`${dateISO}T00:00:00.000Z`);

  const [entrees, comptages] = await Promise.all([
    prisma.mouvementStock.findMany({
      where: { type: "ENTREE", date, articleId: { in: ids }, OR: [{ factureId: { not: null } }, { receptionId: { not: null } }] },
      select: {
        articleId: true, quantite: true,
        article: { select: { designation: true } },
        facture: { select: { numero: true, fournisseurNom: true } },
        reception: { select: { bonDeCommande: { select: { numero: true } } } },
      },
    }),
    prisma.ligneComptage.findMany({
      where: { articleId: { in: ids }, session: { date: { gt: date } } },
      select: { articleId: true, designation: true, session: { select: { date: true } } },
      orderBy: { session: { date: "desc" } },
    }),
  ]);

  const messages: string[] = [];
  for (const l of resolues) {
    const doublon = entrees.find((e) => e.articleId === l.articleId && memeQuantite(e.quantite, l.quantite));
    if (doublon) {
      const par = doublon.facture
        ? `la facture${doublon.facture.numero ? ` ${doublon.facture.numero}` : ""} (${doublon.facture.fournisseurNom})`
        : `la réception du bon de commande${doublon.reception?.bonDeCommande ? ` ${doublon.reception.bonDeCommande.numero}` : ""}`;
      messages.push(
        `« ${doublon.article.designation} » : ${formaterNombre(l.quantite, { maximumFractionDigits: 3 })} déjà entré(s) en stock le ${jjmmaaaa(dateISO)} par ${par}. Si c'est le même achat, le stock le comptera deux fois.`,
      );
    }
    const comptage = comptages.find((c) => c.articleId === l.articleId);
    if (comptage) {
      messages.push(
        `« ${comptage.designation} » : un comptage d'inventaire du ${jjmmaaaa(comptage.session.date.toISOString())} est postérieur à cet achat. Si la marchandise était déjà au dépôt ce jour-là, le comptage l'a déjà comptée.`,
      );
    }
  }
  return [...new Set(messages)];
}
