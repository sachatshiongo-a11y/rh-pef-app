"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser, journaliserPlusieurs } from "@/lib/audit";
import { exigerPeriodeOuverte, exigerPeriodesOuvertes } from "@/lib/cloture-stock";
import { appliquerMouvementManuel, lireMouvementSaisi } from "@/lib/validations-stock/mouvement";
import { resumeCompteRendu } from "@/lib/rattachement-auto";
import { apresCommit } from "@/lib/validations-stock/demandes";
import { Prisma } from "@prisma/client";
import { MESSAGE_MOTIF_SORTIE, estMotifSortie } from "@/lib/motif-sortie";
import type { SelectionMouvements } from "@/lib/filtre-mouvements";
import { DELAI_TOUT_LE_FILTRE, SELECT_SELECTION, resoudreSelectionMouvements } from "@/lib/selection-mouvements";
import { verrouillerMouvements } from "@/lib/validations-stock/verrou-suppression";
import { appliquerChangementDateSorties } from "@/lib/validations-stock/date-sortie";
import { StockInsuffisant, variationsStockTx } from "@/lib/validations-stock/stock-positif";
import { similairesEnStock } from "@/lib/article-proche";


/**
 * Mouvement de stock manuel (entrée ou sortie), multi-lignes. ENTRÉE incrémente l'inventaire,
 * SORTIE le décrémente. Trace un MouvementStock par ligne.
 *
 * Décision de Sacha (2026-10-07) : plus de validation par la Direction. Toute entrée/sortie manuelle,
 * quel que soit le motif, est écrite tout de suite pour tout compte Stock ; la Direction est
 * NOTIFIÉE du geste d'un autre compte (lib/validations-stock/mouvement.ts → appliquerMouvementManuel).
 */
export const mouvementManuel = actionLisible(async (formData: FormData): Promise<{ demande: false; message: string } | RefusStock> => {
  const user = await verifySession();
  requireModule(user, "stock");
  const m = lireMouvementSaisi(formData);
  let resultat: Awaited<ReturnType<typeof appliquerMouvementManuel>>;
  try {
    resultat = await appliquerMouvementManuel(user, m);
  } catch (e) {
    // Stock insuffisant (un stock ne passe jamais sous 0) : rien n'est écrit ; l'écran nomme chaque
    // article fautif avec son stock disponible et PROPOSE des articles proches qui en ont.
    if (e instanceof StockInsuffisant) return refusAvecProches(e);
    throw e;
  }
  const { demandesEnAttente, rattachementResto } = resultat;
  await apresCommit(() => journaliser(prisma, { entite: "MouvementStock", entiteId: `${m.lignes.length} ${m.type.toLowerCase()}(s)`, champ: m.type.toLowerCase(), nouvelleValeur: m.origine, userId: user.id }));
  revalidatePath("/stock/restaurant");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
  // Rattachement automatique au restaurant (sortie « Livraison restaurant ») : dit, jamais bloquant.
  const resume = rattachementResto ? resumeCompteRendu(rattachementResto) : "";
  if (rattachementResto && rattachementResto.rattaches.length + rattachementResto.crees.length > 0) revalidatePath("/stock/fiches");
  const rattache = rattachementResto?.erreur ? ` ${rattachementResto.erreur}` : resume ? ` Restaurant : ${resume}.` : "";
  const fait = (m.type === "ENTREE" ? "Entrée enregistrée : stock incrémenté." : "Sortie enregistrée : stock décrémenté.") + rattache;
  // Une ancienne demande en attente vise aussi ces articles : si c'est le même mouvement, la valider le compterait deux fois.
  const avertissement = demandesEnAttente.length
    ? ` Attention : une ancienne demande en attente de la Direction vise aussi ${demandesEnAttente.map((d) => `« ${d} »`).join(", ")}. S'il s'agit du même mouvement, retirez-la dans « Demandes à valider » (sinon elle serait comptée deux fois).`
    : "";
  return { demande: false, message: fait + avertissement };
});

/** Un article d'une sortie refusée faute de stock, et les articles proches qui en ont (« Utiliser … »). */
export type ArticleInsuffisant = {
  articleId: string; designation: string; unite: string | null; disponible: number; demande: number;
  proches: { id: string; designation: string; unite: string | null; disponible: number }[];
};
/** Refus d'une sortie : le message (lisible tel quel) et, par article fautif, ses remplaçants possibles. */
export type RefusStock = { erreur: string; insuffisants: ArticleInsuffisant[] };

async function refusAvecProches(e: StockInsuffisant): Promise<RefusStock> {
  const catalogue = (await prisma.articleStock.findMany({
    where: { actif: true },
    orderBy: { designation: "asc" },
    select: { id: true, designation: true, domaine: true, unite: true, actif: true, stock: { select: { quantite: true } } },
  })).map((a) => ({ id: a.id, designation: a.designation, domaine: a.domaine, unite: a.unite, actif: a.actif, quantite: Number(a.stock?.quantite ?? 0) }));
  const parId = new Map(catalogue.map((a) => [a.id, a]));
  return {
    erreur: e.message,
    insuffisants: e.manques.map((m) => {
      const art = parId.get(m.articleId) ?? { id: m.articleId, designation: m.designation, domaine: "", unite: m.unite };
      return {
        articleId: m.articleId, designation: m.designation, unite: m.unite, disponible: Number(m.disponible), demande: Number(m.demande),
        proches: similairesEnStock(art, catalogue).map((p) => ({ id: p.id, designation: p.designation, unite: p.unite, disponible: p.quantite })),
      };
    }),
  };
}

/**
 * Supprime un mouvement de stock et ANNULE son effet sur l'inventaire :
 * une ENTRÉE supprimée décrémente le stock, une SORTIE l'incrémente.
 * Un AJUSTEMENT n'enregistre pas son sens → on retire la ligne sans recalculer le stock.
 */
export const supprimerMouvement = actionLisible(async (id: string) => {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]); // seule la Direction peut supprimer

  // Ligne VERROUILLÉE avant d'être lue : deux suppressions simultanées du même mouvement n'appliquent
  // l'inverse sur le stock qu'une fois ; la seconde trouve la ligne partie et le dit.
  const m = await prisma.$transaction(async (tx) => {
    if ((await verrouillerMouvements(tx, [id])).size === 0) return null;
    const m = await tx.mouvementStock.findUniqueOrThrow({ where: { id } });
    await exigerPeriodeOuverte(new Date(m.date));
    // Par la porte unique : supprimer une ENTRÉE déjà consommée ferait passer le stock sous 0 → refus.
    if (m.type === "ENTREE") await variationsStockTx(tx, [{ articleId: m.articleId, delta: m.quantite.negated() }], { verbe: "à reprendre" });
    else if (m.type === "SORTIE") await variationsStockTx(tx, [{ articleId: m.articleId, delta: m.quantite }]);
    await tx.mouvementStock.delete({ where: { id } });
    return m;
  });
  if (!m) return { erreur: MESSAGE_DEJA_SUPPRIME("Ce mouvement") };

  await journaliser(prisma, { entite: "MouvementStock", entiteId: id, champ: "suppression", ancienneValeur: `${m.type} ${Number(m.quantite)} (${m.origine ?? ""})`, userId: user.id });
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/entree"); // l'historique de la liste d'achat affiche aussi ces mouvements
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
});

const MESSAGE_DEJA_SUPPRIME = (quoi: string) => `${quoi} a déjà été supprimé (par un autre onglet ou un autre clic) : son effet sur le stock a été annulé une seule fois. Rechargez la page.`;

/**
 * Supprime plusieurs mouvements d'un coup (Direction) — les id cochés ou tout le filtre d'une
 * colonne — et annule leur effet sur le stock, en une transaction. Chaque suppression est journalisée.
 * Les mouvements sont VERROUILLÉS avant d'être défaits : ceux qu'une autre suppression a emportés
 * entre-temps ne sont pas repris une seconde fois (compte `dejaSupprimes`).
 */
export const supprimerMouvementsEnLot = actionLisible(async (selection: SelectionMouvements) => {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  if (Array.isArray(selection) && selection.filter(Boolean).length === 0) return;
  const r = await prisma.$transaction(async (tx) => {
    const res = await resoudreSelectionMouvements(tx, selection, "mouvements", "Cochez au moins un mouvement.");
    if ("erreur" in res) return res;
    // Verrou, puis relecture des seuls mouvements encore présents : l'effet sur le stock n'est appliqué
    // QUE pour les lignes que CETTE transaction supprime.
    const vivants = await verrouillerMouvements(tx, res.mvs.map((m) => m.id));
    const dejaSupprimes = res.mvs.length - vivants.size;
    if (vivants.size === 0) return { erreur: res.mvs.length > 1 ? "Ces mouvements ont déjà été supprimés (par un autre onglet ou un autre clic) : leur effet sur le stock a été annulé une seule fois. Rechargez la page." : MESSAGE_DEJA_SUPPRIME("Ce mouvement") };
    const mvs = await tx.mouvementStock.findMany({ where: { id: { in: [...vivants] } }, select: SELECT_SELECTION });
    await exigerPeriodesOuvertes(mvs.map((m) => new Date(m.date)));
    // Effet sur le stock, cumulé par article (en décimal exact) : une ENTRÉE supprimée décrémente,
    // une SORTIE incrémente ; un AJUSTEMENT n'enregistre pas son sens → la ligne part sans recalcul.
    const deltas = new Map<string, Prisma.Decimal>();
    for (const m of mvs) {
      if (m.type === "AJUSTEMENT") continue;
      const d = deltas.get(m.articleId) ?? new Prisma.Decimal(0);
      deltas.set(m.articleId, m.type === "ENTREE" ? d.minus(m.quantite) : d.plus(m.quantite));
    }
    // Porte unique : une entrée supprimée qui ferait passer un article sous 0 refuse tout le lot.
    await variationsStockTx(tx, [...deltas].map(([articleId, delta]) => ({ articleId, delta })), { verbe: "à reprendre" });
    await tx.mouvementStock.deleteMany({ where: { id: { in: mvs.map((m) => m.id) } } });
    await journaliserPlusieurs(tx, mvs.map((m) => ({
      entite: "MouvementStock", entiteId: m.id, champ: "suppression", ancienneValeur: `${m.type} ${Number(m.quantite)} (${m.origine ?? ""})`, userId: user.id,
    })));
    return dejaSupprimes > 0 ? { n: mvs.length, dejaSupprimes } : { n: mvs.length }; // `dejaSupprimes` seulement s'il y en a (réponse inchangée sinon)
  }, { timeout: DELAI_TOUT_LE_FILTRE });
  if ("erreur" in r) return r;
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/entree"); // l'historique de la liste d'achat affiche aussi ces mouvements
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
  return r;
});

// ─── Requalifier le motif des sorties (action groupée, Direction) ────────────

type MotifSortie = "LIVRAISON_RESTAURANT" | "PERTE" | null;

/** Libellé posé automatiquement par la saisie manuelle d'une sortie (même règle que `mouvementManuel`). */
const origineAutomatique = (motif: MotifSortie, raison: string | null) =>
  motif === "PERTE" ? `Perte${raison ? ` — ${raison}` : ""}` : motif === "LIVRAISON_RESTAURANT" ? "Livraison restaurant" : "Sortie / consommation";
/** Vrai si le libellé est l'un de ces libellés automatiques (et non un texte saisi ou importé). */
const estOrigineAutomatique = (o: string | null) =>
  o === null || o === "Livraison restaurant" || o === "Sortie / consommation" || o === "Perte" || o.startsWith("Perte — ");
const libelleMotif = (motif: string | null, raison: string | null) => `${motif ?? "sans motif"}${raison ? ` (${raison})` : ""}`;

/**
 * Change le motif des SORTIES sélectionnées (id cochés, ou tout le filtre de la colonne Sorties) : « Livraison restaurant » ou « Perte » (raison
 * obligatoire). Plus jamais « sans motif » (motif obligatoire depuis le 2026-10-07). Une REQUALIFICATION, pas un mouvement : ni la quantité ni
 * `Stock.quantite` ne bougent. Chaque changement est journalisé. Période clôturée : refus lisible.
 * Le libellé d'origine n'est réécrit que s'il était le libellé automatique d'une saisie manuelle.
 */
export const requalifierSorties = actionLisible(async (selection: SelectionMouvements, motif: string, raison?: string) => {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]); // décision de la Direction
  // Motif OBLIGATOIRE pour toute sortie (décision du 2026-10-07) : on ne requalifie plus « sans motif ».
  // Les anciennes sorties sans motif restent visibles (filtre « Sorties : sans motif ») pour être requalifiées.
  if (motif === "") return { erreur: MESSAGE_MOTIF_SORTIE };
  const cible: MotifSortie | undefined = estMotifSortie(motif) ? motif : undefined;
  if (cible === undefined) return { erreur: "Motif inconnu." };
  const raisonPerte = cible === "PERTE" ? (raison ?? "").trim() || null : null;
  if (cible === "PERTE" && !raisonPerte) return { erreur: "Indiquez la raison de la perte." };
  if (!Array.isArray(selection) && selection?.colonne !== "SORTIES") {
    return { erreur: "Seules les sorties ont un motif : décochez les entrées et ajustements." };
  }

  const r = await prisma.$transaction(async (tx) => {
    const res = await resoudreSelectionMouvements(tx, selection, "sorties", "Cochez au moins une sortie.");
    if ("erreur" in res) return res;
    const { mvs } = res;
    if (mvs.length !== res.nbDemandes) return { erreur: "Certaines sorties n'existent plus : rechargez la page." };
    if (mvs.some((m) => m.type !== "SORTIE")) return { erreur: "Seules les sorties ont un motif : décochez les entrées et ajustements." };

    const paires = [...new Set(mvs.map((m) => `${m.date.getUTCFullYear()}-${m.date.getUTCMonth() + 1}`))]
      .map((k) => { const [annee, mois] = k.split("-").map(Number); return { annee: annee!, mois: mois! }; });
    const cloture = await tx.clotureStock.findFirst({ where: { OR: paires }, orderBy: [{ annee: "asc" }, { mois: "asc" }] });
    if (cloture) {
      return { erreur: `La période ${String(cloture.mois).padStart(2, "0")}/${cloture.annee} est clôturée : le motif de ses sorties ne peut plus être changé. (Direction : Paramètres → Clôture mensuelle pour la rouvrir.)` };
    }

    const aChanger = mvs.filter((m) => m.categorieSortie !== cible || (m.raisonSortie ?? null) !== raisonPerte);
    if (aChanger.length > 0) {
      const auto = aChanger.filter((m) => estOrigineAutomatique(m.origine)).map((m) => m.id);
      const saisis = aChanger.filter((m) => !estOrigineAutomatique(m.origine)).map((m) => m.id);
      if (auto.length) await tx.mouvementStock.updateMany({ where: { id: { in: auto } }, data: { categorieSortie: cible, raisonSortie: raisonPerte, origine: origineAutomatique(cible, raisonPerte) } });
      if (saisis.length) await tx.mouvementStock.updateMany({ where: { id: { in: saisis } }, data: { categorieSortie: cible, raisonSortie: raisonPerte } });
      await journaliserPlusieurs(tx, aChanger.map((m) => ({
        entite: "MouvementStock", entiteId: m.id, champ: "categorieSortie",
        ancienneValeur: libelleMotif(m.categorieSortie, m.raisonSortie), nouvelleValeur: libelleMotif(cible, raisonPerte), userId: user.id,
      })));
    }
    return { n: aChanger.length };
  }, { timeout: DELAI_TOUT_LE_FILTRE });
  if ("erreur" in r) return r;
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/journalier");
  revalidatePath("/stock/restaurant");
  revalidatePath("/stock/fiches");
  return r;
});

// ─── Changer la date des sorties (à l'unité ou en lot, comptes Stock) ───────

/**
 * Change la date des SORTIES sélectionnées (une ligne, les id cochés, ou tout le filtre de la colonne
 * Sorties) — demande de Sacha du 2026-10-08. Droit OUVERT au responsable du stock (décision Direction
 * du 2026-10-08, même jour) : tout compte de l'espace Stock, mêmes comptes que la saisie d'une sortie
 * manuelle (`mouvementManuel`) ; le geste d'un compte non-Direction est NOTIFIÉ à la Direction (cœur).
 * La requalification du MOTIF, elle, reste réservée à la Direction.
 * Une CORRECTION de date : ni la quantité, ni le motif, ni le stock du dépôt ne bougent. Contrôles,
 * écriture, journal et notification : `lib/validations-stock/date-sortie.ts`.
 * Les écrans qui lisent les sorties par jour (Conso. journalière, Comparaison, rapport journalier,
 * tableau de bord) relisent la date en base à chaque affichage : rien d'autre à recalculer.
 */
export const changerDateSorties = actionLisible(async (selection: SelectionMouvements, nouvelleDate: string) => {
  const user = await verifySession();
  requireModule(user, "stock"); // mêmes comptes que la saisie d'une sortie (décision du 2026-10-08)
  const r = await appliquerChangementDateSorties(user, selection, nouvelleDate);
  if ("erreur" in r) return r;
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/journalier");
  revalidatePath("/stock/restaurant");
  revalidatePath("/stock/fiches");
  revalidatePath("/stock");
  return r;
});
