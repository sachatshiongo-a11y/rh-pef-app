import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formaterNombre } from "@/lib/montant";
import { jjmmaaaa, ORIGINE_LISTE_ACHAT, WHERE_ACHATS_LISTE } from "@/lib/achats-liste";
import type { AnalyseLigne, ArticleCandidat } from "@/lib/achats-doublons";
import { decisionArticle } from "@/lib/article-proche";
import { prixSaisi } from "@/lib/prix-article";

/** Fenêtre de la double saisie : celle du contrôle des Factures. */
const FENETRE_JOURS = 14;

/** La base, ou une transaction. */
type Client = Prisma.TransactionClient;

/** Une ligne telle que l'écran la fait vérifier : article du catalogue OU désignation libre, et quantité. */
export type LigneAVerifier = { articleId: string; designation: string; quantite: number };

/** Le catalogue tel que la recherche des articles proches le lit (inactifs compris : voir `decisionArticle`). */
export async function catalogueCandidats(client: Client = prisma): Promise<ArticleCandidat[]> {
  const articles = await client.articleStock.findMany({
    orderBy: { designation: "asc" },
    select: { id: true, designation: true, unite: true, domaine: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true, actif: true },
  });
  // Prix de référence dans SA devise (2026-10-08) : un article en francs propose ses francs.
  return articles.map((a) => ({ id: a.id, designation: a.designation, unite: a.unite, domaine: a.domaine, prix: prixSaisi(a)?.montant ?? null, devisePrix: a.devisePrix, actif: a.actif }));
}

/**
 * Analyse d'une liste À LA SAISIE : pour chaque ligne (même ordre), son sort au catalogue
 * (`decisionArticle` : rattachement automatique, articles proches à choisir, nouvel article), plus
 * les avertissements non bloquants de toujours. Une ligne sans article ni désignation, ou sans
 * quantité, n'est pas analysée (null). N'écrit rien.
 */
export async function analyserListeAchat(dateISO: string, lignes: readonly LigneAVerifier[]): Promise<{ lignes: (AnalyseLigne | null)[]; avertissements: string[] }> {
  const actives = lignes.map((l) => !!(l.articleId || l.designation.trim()) && l.quantite > 0);
  const libres = lignes.some((l, i) => actives[i] && !l.articleId);
  const catalogue = libres ? await catalogueCandidats() : [];
  const decisions = lignes.map((l, i) => (!actives[i] ? null : l.articleId ? ({ type: "catalogue" } as const) : decisionArticle(l.designation, catalogue)));
  const resolues = lignes.flatMap((l, i) => {
    const d = decisions[i];
    const articleId = !d ? "" : d.type === "catalogue" ? l.articleId : d.type === "auto" ? d.article.id : "";
    return articleId ? [{ articleId, quantite: l.quantite }] : [];
  });
  const avertissements = await avertissementsListeAchat(dateISO, resolues);
  return { lignes: decisions.map((d) => (d ? { article: d } : null)), avertissements };
}

/**
 * Avertissements NON bloquants d'une Liste d'achat, à la saisie comme à l'enregistrement.
 * L'outil signale, la personne tranche : rien n'est refusé ici.
 *
 * 1. DOUBLE SAISIE — même article déjà entré à ±14 jours, QUELLE QUE SOIT la quantité, par une
 *    FACTURE, par la RÉCEPTION d'un bon de commande ou par une LISTE D'ACHAT déjà enregistrée
 *    (double envoi) : si c'est le même achat, le stock le compterait deux fois. C'est le contrôle
 *    des Factures (`creerFacture`, ±14 jours sur les entrées hors facture), pris dans l'autre sens.
 *    (Décision Direction 2026-10-08 : il RESTE non bloquant — pas de case à cocher.)
 * 2. COMPTAGE POSTÉRIEUR — un achat daté AVANT un comptage d'inventaire de l'article : si la
 *    marchandise était au dépôt ce jour-là, le comptage l'a déjà mise dans le stock.
 *
 * Les lignes arrivent RÉSOLUES (article du catalogue, ou ligne libre rattachée automatiquement) :
 * une ligne qui créera un article n'a, par définition, rien à signaler.
 */
export async function avertissementsListeAchat(dateISO: string, lignes: readonly { articleId: string; quantite: number }[]): Promise<string[]> {
  const resolues = lignes.filter((l) => l.articleId && l.quantite > 0);
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
