"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { dec } from "@/lib/nombre";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser, journaliserPlusieurs } from "@/lib/audit";
import { exigerPeriodeOuverte, exigerPeriodesOuvertes } from "@/lib/cloture-stock";
import { niveauxActuels, notifierNouvellesAlertes } from "@/lib/alerte-stock";


/**
 * Mouvement de stock manuel (entrée ou sortie), multi-lignes. ENTRÉE incrémente l'inventaire,
 * SORTIE le décrémente. Trace un MouvementStock par ligne.
 */
export const mouvementManuel = actionLisible(async (formData: FormData) => {
  const user = await verifySession();
  requireModule(user, "stock");

  const type = String(formData.get("type") ?? "SORTIE") === "ENTREE" ? "ENTREE" : "SORTIE";
  const ids = formData.getAll("articleId").map(String);
  const qtes = formData.getAll("quantite").map(dec);
  const dateStr = String(formData.get("date") ?? "").trim();
  const date = dateStr ? new Date(dateStr) : new Date();
  await exigerPeriodeOuverte(date);

  // Pour une SORTIE : motif (PERTE | LIVRAISON_RESTAURANT). La perte exige une explication.
  let categorieSortie: string | null = null;
  let raisonSortie: string | null = null;
  let origine = String(formData.get("origine") ?? "").trim();
  if (type === "SORTIE") {
    const cat = String(formData.get("categorieSortie") ?? "").trim();
    categorieSortie = cat === "PERTE" || cat === "LIVRAISON_RESTAURANT" ? cat : null;
    raisonSortie = String(formData.get("raisonSortie") ?? "").trim() || null;
    if (categorieSortie === "PERTE" && !raisonSortie) throw new Error("Indiquez la raison de la perte.");
    origine = origine || (categorieSortie === "PERTE" ? `Perte${raisonSortie ? ` — ${raisonSortie}` : ""}` : categorieSortie === "LIVRAISON_RESTAURANT" ? "Livraison restaurant" : "Sortie / consommation");
  } else {
    origine = origine || "Entrée manuelle";
  }

  const lignes = ids
    .map((articleId, i) => ({ articleId, quantite: qtes[i] ?? 0 }))
    .filter((l) => l.articleId && l.quantite > 0);
  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (article + quantité).");

  // Niveaux d'alerte AVANT la sortie, pour ne notifier que les articles qui viennent de passer bas.
  const idsLignes = lignes.map((l) => l.articleId);
  const niveauxAvant = type === "SORTIE" ? await niveauxActuels(idsLignes) : new Map();

  await prisma.$transaction(async (tx) => {
    for (const l of lignes) {
      await tx.mouvementStock.create({ data: { articleId: l.articleId, type, quantite: l.quantite, origine, date, categorieSortie, raisonSortie, creeParId: user.id } });
      await tx.stock.upsert({
        where: { articleId: l.articleId },
        update: { quantite: type === "ENTREE" ? { increment: l.quantite } : { decrement: l.quantite } },
        create: { articleId: l.articleId, quantite: type === "ENTREE" ? l.quantite : -l.quantite },
      });
    }
  });

  if (type === "SORTIE") await notifierNouvellesAlertes(idsLignes, niveauxAvant);

  await journaliser(prisma, { entite: "MouvementStock", entiteId: `${lignes.length} ${type.toLowerCase()}(s)`, champ: type.toLowerCase(), nouvelleValeur: origine, userId: user.id });
  revalidatePath("/stock/restaurant");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
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

/** Supprime plusieurs mouvements d'un coup (Direction) — annule leur effet sur le stock. */
export const supprimerMouvementsEnLot = actionLisible(async (ids: string[]) => {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  const mvs = await prisma.mouvementStock.findMany({ where: { id: { in: uniq } } });
  await exigerPeriodesOuvertes(mvs.map((m) => new Date(m.date)));
  await prisma.$transaction(async (tx) => {
    for (const m of mvs) {
      const q = Number(m.quantite);
      if (m.type === "ENTREE") await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { decrement: q } } });
      else if (m.type === "SORTIE") await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { increment: q } } });
    }
    await tx.mouvementStock.deleteMany({ where: { id: { in: uniq } } });
  });
  await journaliser(prisma, { entite: "MouvementStock", entiteId: "lot", champ: "suppression", nouvelleValeur: `${mvs.length} mouvement(s)`, userId: user.id });
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/entree"); // l'historique de la liste d'achat affiche aussi ces mouvements
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
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
 * Change le motif des SORTIES sélectionnées : « Livraison restaurant », « Perte » (raison
 * obligatoire) ou sans motif (`""`). Une REQUALIFICATION, pas un mouvement : ni la quantité ni
 * `Stock.quantite` ne bougent. Chaque changement est journalisé. Période clôturée : refus lisible.
 * Le libellé d'origine n'est réécrit que s'il était le libellé automatique d'une saisie manuelle.
 */
export const requalifierSorties = actionLisible(async (ids: string[], motif: string, raison?: string) => {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]); // décision de la Direction
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return { erreur: "Cochez au moins une sortie." };
  const cible: MotifSortie | undefined = motif === "LIVRAISON_RESTAURANT" || motif === "PERTE" ? motif : motif === "" ? null : undefined;
  if (cible === undefined) return { erreur: "Motif inconnu." };
  const raisonPerte = cible === "PERTE" ? (raison ?? "").trim() || null : null;
  if (cible === "PERTE" && !raisonPerte) return { erreur: "Indiquez la raison de la perte." };

  const mvs = await prisma.mouvementStock.findMany({
    where: { id: { in: uniq } },
    select: { id: true, type: true, date: true, categorieSortie: true, raisonSortie: true, origine: true },
  });
  if (mvs.length !== uniq.length) return { erreur: "Certaines sorties n'existent plus : rechargez la page." };
  if (mvs.some((m) => m.type !== "SORTIE")) return { erreur: "Seules les sorties ont un motif : décochez les entrées et ajustements." };

  const paires = [...new Set(mvs.map((m) => `${m.date.getUTCFullYear()}-${m.date.getUTCMonth() + 1}`))]
    .map((k) => { const [annee, mois] = k.split("-").map(Number); return { annee: annee!, mois: mois! }; });
  const cloture = await prisma.clotureStock.findFirst({ where: { OR: paires }, orderBy: [{ annee: "asc" }, { mois: "asc" }] });
  if (cloture) {
    return { erreur: `La période ${String(cloture.mois).padStart(2, "0")}/${cloture.annee} est clôturée : le motif de ses sorties ne peut plus être changé. (Direction : Paramètres → Clôture mensuelle pour la rouvrir.)` };
  }

  const aChanger = mvs.filter((m) => m.categorieSortie !== cible || (m.raisonSortie ?? null) !== raisonPerte);
  if (aChanger.length > 0) {
    const auto = aChanger.filter((m) => estOrigineAutomatique(m.origine)).map((m) => m.id);
    const saisis = aChanger.filter((m) => !estOrigineAutomatique(m.origine)).map((m) => m.id);
    await prisma.$transaction(async (tx) => {
      if (auto.length) await tx.mouvementStock.updateMany({ where: { id: { in: auto } }, data: { categorieSortie: cible, raisonSortie: raisonPerte, origine: origineAutomatique(cible, raisonPerte) } });
      if (saisis.length) await tx.mouvementStock.updateMany({ where: { id: { in: saisis } }, data: { categorieSortie: cible, raisonSortie: raisonPerte } });
      await journaliserPlusieurs(tx, aChanger.map((m) => ({
        entite: "MouvementStock", entiteId: m.id, champ: "categorieSortie",
        ancienneValeur: libelleMotif(m.categorieSortie, m.raisonSortie), nouvelleValeur: libelleMotif(cible, raisonPerte), userId: user.id,
      })));
    });
  }
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/journalier");
  revalidatePath("/stock/restaurant");
  revalidatePath("/stock/fiches");
  return { n: aChanger.length };
});
