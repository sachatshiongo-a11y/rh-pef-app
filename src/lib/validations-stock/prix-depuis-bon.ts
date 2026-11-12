import "server-only";

// PRIX DU CATALOGUE MIS À JOUR DEPUIS UN BON DE COMMANDE (2026-11-12) — demande de Sacha : « pouvoir changer les prix des
// articles quand on fait un bon de commande », catalogue mis à jour.
//
// Règles (toutes déjà celles de la maison) :
//  - LA DEVISE DE SAISIE FAIT FOI : le prix de référence de l'article prend la devise DU BON et le prix saisi, tel quel
//    (jamais converti). Un article en dollars dont on a saisi un prix en francs passe en francs (`harmoniserPrix` efface
//    l'ancien prix en dollars, il n'est jamais converti en silence) — c'est le journal / la proposition qui le dit.
//  - Seules les lignes dont le prix a été TOUCHÉ à l'écran et qui diffère du catalogue sont écrites : un prix simplement
//    proposé (et converti « ≈ » au taux du jour) ne remplace jamais le catalogue. Une ligne sans prix ne remet jamais
//    le catalogue à zéro (ni NUL).
//  - MÊME RÈGLE « LA DIRECTION VALIDE » que `modifierArticle` : la Direction écrit tout de suite (journalisé, avant → après) ;
//    un autre compte PROPOSE (« À valider »), rien ne change avant la décision. Par la même porte d'écriture
//    (`appliquerPatchArticleTx` / `proposerModifications`), jamais par une écriture directe.
//  - PRIX FOURNISSEUR : il n'y a pas de colonne à écrire. Le dernier prix par fournisseur est CALCULÉ depuis l'historique
//    d'achats (`prix-fournisseurs.ts`), dont les lignes de bons ENGAGÉS (validé, envoyé, reçu) : le prix saisi sur le bon
//    devient le prix du fournisseur du bon dès que le bon est validé, sans copie qui divergerait.
//  - Le bon est déjà enregistré quand on arrive ici : un refus (proposition déjà en attente d'un autre compte, article
//    disparu…) ne le défait pas, il est rapporté dans le message.

import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import type { DevisePrix } from "@/lib/prix-article";
import { messageLisible } from "@/lib/erreur-metier";
import { appliquerPatchArticleTx, changementsDe, lireArticlesTx, nomsReferencesTx, texteChangements, type PatchArticle } from "./article";
import { estDirection, proposerModifications, type Acteur } from "./demandes";

/** Une ligne du bon telle que saisie : le prix est dans la devise du bon. */
export type LignePrixSaisie = { articleId: string | null; prix: number | null; prixTouche: boolean };

/** Précision de la colonne : 4 décimales en dollars, 2 en francs. */
const DECIMALES: Record<DevisePrix, number> = { USD: 4, CDF: 2 };
const CHAMP_PRIX: Record<DevisePrix, "prixUnitaireUSD" | "prixUnitaireCDF"> = { USD: "prixUnitaireUSD", CDF: "prixUnitaireCDF" };

/**
 * Les changements de prix à porter au catalogue : un par article (la DERNIÈRE ligne touchée gagne), seulement pour les
 * lignes reliées à un article, touchées, avec un prix > 0 après arrondi à la précision de la colonne.
 */
export function prixATransmettre(lignes: readonly LignePrixSaisie[], devise: DevisePrix): { articleId: string; prix: string }[] {
  const parArticle = new Map<string, string>();
  for (const l of lignes) {
    if (!l.articleId || !l.prixTouche || l.prix === null || !Number.isFinite(l.prix)) continue;
    const p = new Decimal(l.prix).toDecimalPlaces(DECIMALES[devise]);
    if (p.lessThanOrEqualTo(0)) continue; // sans prix : jamais un zéro dans le catalogue
    parArticle.set(l.articleId, p.toFixed());
  }
  return [...parArticle].map(([articleId, prix]) => ({ articleId, prix }));
}

/** Le patch d'article d'un changement de prix ; null si le catalogue a déjà ce prix dans cette devise. */
export function patchPrix(article: { devisePrix: DevisePrix; prixUnitaireUSD: { toString(): string } | null; prixUnitaireCDF: { toString(): string } | null }, devise: DevisePrix, prix: string): PatchArticle | null {
  const actuel = article[CHAMP_PRIX[devise]];
  if (article.devisePrix === devise && actuel !== null && new Decimal(actuel.toString()).equals(prix)) return null;
  return { ...(article.devisePrix !== devise ? { devisePrix: devise } : {}), [CHAMP_PRIX[devise]]: prix };
}

export type ResultatPrixCatalogue = { appliques: number; proposes: number; message: string | null };

/**
 * À appeler APRÈS l'enregistrement du bon. Ne lève jamais : tout refus devient un message (le bon reste enregistré).
 */
export async function majPrixCatalogueDepuisBon(user: Acteur, bon: { id: string; numero: string }, devise: DevisePrix, lignes: readonly LignePrixSaisie[]): Promise<ResultatPrixCatalogue> {
  const aTransmettre = prixATransmettre(lignes, devise);
  if (aTransmettre.length === 0) return { appliques: 0, proposes: 0, message: null };
  const unite = devise === "CDF" ? "FC" : "$";
  let appliques = 0, proposes = 0;
  const refus: string[] = [];

  try {
    const articles = await prisma.articleStock.findMany({ where: { id: { in: aTransmettre.map((a) => a.articleId) } }, select: { id: true, designation: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true } });
    const parId = new Map(articles.map((a) => [a.id, a]));
    const patchs = aTransmettre.flatMap((t) => {
      const a = parId.get(t.articleId);
      const patch = a ? patchPrix(a, devise, t.prix) : null;
      return a && patch ? [{ id: a.id, designation: a.designation, patch }] : [];
    });
    if (patchs.length === 0) return { appliques: 0, proposes: 0, message: null };

    if (estDirection(user)) {
      for (const p of patchs) {
        try {
          const changements = await prisma.$transaction(async (tx) => {
            const etat = (await lireArticlesTx(tx, [p.id], true)).get(p.id);
            const diff = etat ? changementsDe(etat, p.patch, await nomsReferencesTx(tx)) : [];
            await appliquerPatchArticleTx(tx, p.id, p.patch);
            return diff;
          });
          if (changements.length > 0) {
            appliques++;
            await journaliser(prisma, { entite: "ArticleStock", entiteId: p.id, champ: "modification", nouvelleValeur: `${texteChangements(changements)} (depuis le bon ${bon.numero})`, userId: user.id });
          }
        } catch (e) {
          refus.push(`« ${p.designation} » : ${messageLisible(e, "prix catalogue depuis un bon")}`);
        }
      }
    } else {
      // Un article à la fois : la proposition en attente d'un AUTRE compte sur l'un d'eux ne bloque pas les autres.
      for (const p of patchs) {
        try {
          const r = await proposerModifications(user, `Prix modifié depuis le bon ${bon.numero} (${unite})`, [{ id: p.id, patch: p.patch }]);
          if (!r.rien) proposes++;
        } catch (e) {
          refus.push(`« ${p.designation} » : ${messageLisible(e, "prix catalogue proposé depuis un bon")}`);
        }
      }
    }
  } catch (e) {
    refus.push(messageLisible(e, "prix catalogue depuis un bon"));
  }

  const morceaux: string[] = [];
  if (appliques > 0) morceaux.push(`Prix du catalogue mis à jour pour ${appliques} article${appliques > 1 ? "s" : ""}.`);
  if (proposes > 0) morceaux.push(`${proposes} changement${proposes > 1 ? "s" : ""} de prix du catalogue envoyé${proposes > 1 ? "s" : ""} à la Direction : le catalogue ne change qu'après sa validation.`);
  if (refus.length > 0) morceaux.push(`Le bon est enregistré, mais le catalogue n'a pas été mis à jour pour : ${refus.join(" ; ")}.`);
  return { appliques, proposes, message: morceaux.length ? morceaux.join(" ") : null };
}
