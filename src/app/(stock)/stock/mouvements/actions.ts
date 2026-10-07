"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser, journaliserPlusieurs } from "@/lib/audit";
import { exigerPeriodeOuverte, exigerPeriodesOuvertes } from "@/lib/cloture-stock";
import { appliquerMouvementManuel, lireMouvementSaisi } from "@/lib/validations-stock/mouvement";
import { apresCommit } from "@/lib/validations-stock/demandes";
import { Prisma } from "@prisma/client";
import { MESSAGE_MOTIF_SORTIE, estMotifSortie } from "@/lib/motif-sortie";
import { BORNE_TOUT_LE_FILTRE, lireFiltreMouvements, whereColonne, type ColonneMouvements, type SelectionMouvements } from "@/lib/filtre-mouvements";


/**
 * Mouvement de stock manuel (entrée ou sortie), multi-lignes. ENTRÉE incrémente l'inventaire,
 * SORTIE le décrémente. Trace un MouvementStock par ligne.
 *
 * Décision de Sacha (2026-10-07) : plus de validation par la Direction. Toute entrée/sortie manuelle,
 * quel que soit le motif, est écrite tout de suite pour tout compte Stock ; la Direction est
 * NOTIFIÉE du geste d'un autre compte (lib/validations-stock/mouvement.ts → appliquerMouvementManuel).
 */
export const mouvementManuel = actionLisible(async (formData: FormData): Promise<{ demande: false; message: string }> => {
  const user = await verifySession();
  requireModule(user, "stock");
  const m = lireMouvementSaisi(formData);
  await appliquerMouvementManuel(user, m);
  await apresCommit(() => journaliser(prisma, { entite: "MouvementStock", entiteId: `${m.lignes.length} ${m.type.toLowerCase()}(s)`, champ: m.type.toLowerCase(), nouvelleValeur: m.origine, userId: user.id }));
  revalidatePath("/stock/restaurant");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
  return { demande: false, message: m.type === "ENTREE" ? "Entrée enregistrée : stock incrémenté." : "Sortie enregistrée : stock décrémenté." };
});

/**
 * Supprime un mouvement de stock et ANNULE son effet sur l'inventaire :
 * une ENTRÉE supprimée décrémente le stock, une SORTIE l'incrémente.
 * Un AJUSTEMENT n'enregistre pas son sens → on retire la ligne sans recalculer le stock.
 */
export const supprimerMouvement = actionLisible(async (id: string) => {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]); // seule la Direction peut supprimer

  const m = await prisma.mouvementStock.findUniqueOrThrow({ where: { id } });
  await exigerPeriodeOuverte(new Date(m.date));
  const q = Number(m.quantite);
  await prisma.$transaction(async (tx) => {
    if (m.type === "ENTREE") {
      await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { decrement: q } } });
    } else if (m.type === "SORTIE") {
      await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { increment: q } } });
    }
    await tx.mouvementStock.delete({ where: { id } });
  });

  await journaliser(prisma, { entite: "MouvementStock", entiteId: id, champ: "suppression", ancienneValeur: `${m.type} ${q} (${m.origine ?? ""})`, userId: user.id });
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/entree"); // l'historique de la liste d'achat affiche aussi ces mouvements
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
});

// ─── Sélection d'une action groupée : les id cochés, ou TOUT le filtre (décision du 2026-09-29) ──

const SELECT_SELECTION = {
  id: true, type: true, date: true, articleId: true, quantite: true, categorieSortie: true, raisonSortie: true, origine: true,
} satisfies Prisma.MouvementStockSelect;
type MvtSelection = Prisma.MouvementStockGetPayload<{ select: typeof SELECT_SELECTION }>;
type SelectionResolue = { mvs: MvtSelection[]; nbDemandes: number } | { erreur: string; nouveauNombre?: number };

/** Délai de la transaction : une action « tout le filtre » peut toucher jusqu'à BORNE_TOUT_LE_FILTRE lignes. */
const DELAI_TOUT_LE_FILTRE = 60_000;

/**
 * Résout la sélection DANS la transaction d'écriture. Liste d'id : les mouvements existants.
 * Filtre : le `where` est RECONSTRUIT par la même fonction que la page (`whereColonne`), puis
 * RECOMPTÉ : au-delà de la borne, refus ; si le nombre diffère de celui que la Direction a confirmé,
 * rien n'est écrit et le nouveau nombre revient pour une nouvelle confirmation.
 */
async function resoudreSelection(tx: Prisma.TransactionClient, selection: SelectionMouvements, nom: string, videMsg: string): Promise<SelectionResolue> {
  if (Array.isArray(selection)) {
    const uniq = [...new Set(selection.map(String))].filter(Boolean);
    if (uniq.length === 0) return { erreur: videMsg };
    return { mvs: await tx.mouvementStock.findMany({ where: { id: { in: uniq } }, select: SELECT_SELECTION }), nbDemandes: uniq.length };
  }
  if (!selection || typeof selection !== "object") return { erreur: "Sélection invalide : rechargez la page." };
  const { attendu } = selection;
  const colonne: ColonneMouvements | null = selection.colonne === "SORTIES" || selection.colonne === "ENTREES" ? selection.colonne : null;
  if (!colonne || !Number.isInteger(attendu) || attendu <= 0) return { erreur: "Sélection invalide : rechargez la page." };
  const where = whereColonne(lireFiltreMouvements(selection.filtre, new Date()), colonne);
  const n = await tx.mouvementStock.count({ where });
  if (n > BORNE_TOUT_LE_FILTRE) {
    return { erreur: `Le filtre compte ${n} ${nom} : au-delà de ${BORNE_TOUT_LE_FILTRE}, une action groupée est refusée. Affinez par mois, produit ou motif.` };
  }
  const recompte = (k: number) => ({
    erreur: `Le filtre compte maintenant ${k} ${nom}, et non ${attendu} comme confirmé : rien n'a été modifié. Vérifiez, puis confirmez à nouveau.`,
    nouveauNombre: k,
  });
  if (n !== attendu) return recompte(n);
  const mvs = await tx.mouvementStock.findMany({ where, select: SELECT_SELECTION, take: BORNE_TOUT_LE_FILTRE + 1 });
  if (mvs.length !== attendu) return recompte(mvs.length); // écrit entre le comptage et la lecture
  return { mvs, nbDemandes: attendu };
}

/**
 * Supprime plusieurs mouvements d'un coup (Direction) — les id cochés ou tout le filtre d'une
 * colonne — et annule leur effet sur le stock, en une transaction. Chaque suppression est journalisée.
 */
export const supprimerMouvementsEnLot = actionLisible(async (selection: SelectionMouvements) => {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  if (Array.isArray(selection) && selection.filter(Boolean).length === 0) return;
  const r = await prisma.$transaction(async (tx) => {
    const res = await resoudreSelection(tx, selection, "mouvements", "Cochez au moins un mouvement.");
    if ("erreur" in res) return res;
    const { mvs } = res;
    await exigerPeriodesOuvertes(mvs.map((m) => new Date(m.date)));
    // Effet sur le stock, cumulé par article (en décimal exact) : une ENTRÉE supprimée décrémente,
    // une SORTIE incrémente ; un AJUSTEMENT n'enregistre pas son sens → la ligne part sans recalcul.
    const deltas = new Map<string, Prisma.Decimal>();
    for (const m of mvs) {
      if (m.type === "AJUSTEMENT") continue;
      const d = deltas.get(m.articleId) ?? new Prisma.Decimal(0);
      deltas.set(m.articleId, m.type === "ENTREE" ? d.minus(m.quantite) : d.plus(m.quantite));
    }
    for (const [articleId, delta] of deltas) {
      if (!delta.isZero()) await tx.stock.updateMany({ where: { articleId }, data: { quantite: { increment: delta } } });
    }
    await tx.mouvementStock.deleteMany({ where: { id: { in: mvs.map((m) => m.id) } } });
    await journaliserPlusieurs(tx, mvs.map((m) => ({
      entite: "MouvementStock", entiteId: m.id, champ: "suppression", ancienneValeur: `${m.type} ${Number(m.quantite)} (${m.origine ?? ""})`, userId: user.id,
    })));
    return { n: mvs.length };
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
    const res = await resoudreSelection(tx, selection, "sorties", "Cochez au moins une sortie.");
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
