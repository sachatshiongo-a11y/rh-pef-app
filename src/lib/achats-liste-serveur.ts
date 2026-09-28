import "server-only";
import { prisma } from "@/lib/prisma";
import { cleAlnum } from "@/lib/texte";
import { formaterNombre } from "@/lib/montant";
import { jjmmaaaa, ORIGINE_LISTE_ACHAT, WHERE_ACHATS_LISTE } from "@/lib/achats-liste";

/** Fenêtre de la double saisie : celle du contrôle des Factures. */
const FENETRE_JOURS = 14;

export type LigneAVerifier = { articleId: string; designation: string; quantite: number };

/**
 * Avertissements NON bloquants d'une Liste d'achat, à la saisie comme à l'enregistrement.
 * L'outil signale, la personne tranche : rien n'est refusé ici.
 *
 * 1. DOUBLE SAISIE — même article déjà entré à ±14 jours, QUELLE QUE SOIT la quantité, par une
 *    FACTURE, par la RÉCEPTION d'un bon de commande ou par une LISTE D'ACHAT déjà enregistrée
 *    (double envoi) : si c'est le même achat, le stock le compterait deux fois. C'est le contrôle
 *    des Factures (`creerFacture`, ±14 jours sur les entrées hors facture), pris dans l'autre sens.
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
  const debut = new Date(date); debut.setUTCDate(debut.getUTCDate() - FENETRE_JOURS);
  const fin = new Date(date); fin.setUTCDate(fin.getUTCDate() + FENETRE_JOURS);

  const [entrees, comptages] = await Promise.all([
    prisma.mouvementStock.findMany({
      where: {
        type: "ENTREE", date: { gte: debut, lte: fin }, articleId: { in: ids },
        OR: [{ factureId: { not: null } }, { receptionId: { not: null } }, WHERE_ACHATS_LISTE],
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        articleId: true, quantite: true, date: true, origine: true,
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
  for (const articleId of ids) {
    const deja = entrees.filter((e) => e.articleId === articleId);
    if (deja.length > 0) {
      const detail = deja.slice(0, 5).map((e) => {
        const par = e.facture
          ? `la facture${e.facture.numero ? ` ${e.facture.numero}` : ""} (${e.facture.fournisseurNom})`
          : e.reception
          ? `la réception du bon de commande${e.reception.bonDeCommande ? ` ${e.reception.bonDeCommande.numero}` : ""}`
          : `la Liste d'achat${e.origine && e.origine !== ORIGINE_LISTE_ACHAT ? ` « ${e.origine} »` : ""}`;
        return `+${formaterNombre(Number(e.quantite), { maximumFractionDigits: 3 })} le ${jjmmaaaa(e.date.toISOString())} par ${par}`;
      });
      const suite = deja.length > 5 ? ` (et ${deja.length - 5} autre(s))` : "";
      messages.push(`« ${deja[0].article.designation} » : déjà entré en stock à ${FENETRE_JOURS} jours près — ${detail.join(" · ")}${suite}. Si c'est le même achat, le stock le comptera deux fois.`);
    }
    const comptage = comptages.find((c) => c.articleId === articleId);
    if (comptage) {
      messages.push(
        `« ${comptage.designation} » : un comptage d'inventaire du ${jjmmaaaa(comptage.session.date.toISOString())} est postérieur à cet achat. Si la marchandise était déjà au dépôt ce jour-là, le comptage l'a déjà comptée.`,
      );
    }
  }
  return messages;
}
