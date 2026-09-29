"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { analyserLignesCommande, type LigneCommandeClasseur } from "@/lib/classeur-commande";
import { LEGUMES } from "../legumes/legumes-data";

// « Importer les lignes du classeur Commande journalière » (Conso. journalière → Commande) :
// RÉSERVÉ À LA DIRECTION. Le classeur est lu dans le navigateur ; le serveur reçoit les lignes,
// propose les articles, puis applique ce que la Direction a coché : l'article passe « Sur la fiche
// commande », au rang et sous la rubrique du classeur, et reçoit le nom du classeur comme NOM COURT
// si le sien est vide (un nom court existant n'est remplacé que sur case explicite). Aucun article
// n'est créé ; tout est journalisé.

const MAX_LIGNES = 2000;
const MAX_TEXTE = 200;
const propre = (s: string) => s.replace(/\s+/g, " ").trim();

async function direction() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  return user;
}

function texte(v: unknown, champ: string): string {
  if (typeof v !== "string" || !propre(v) || propre(v).length > MAX_TEXTE) throw new Error(`Ligne du classeur illisible (${champ}).`);
  return propre(v);
}
const feuilleDe = (v: unknown): "CUISINE" | "BAR" => {
  if (v !== "CUISINE" && v !== "BAR") throw new Error("Ligne du classeur illisible (feuille).");
  return v;
};
const rangDe = (v: unknown) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_LIGNES) throw new Error("Ligne du classeur illisible (rang).");
  return v;
};

/** Propose, pour chaque ligne du classeur, l'article correspondant (exact / proche / absent). */
export const analyserClasseurCommande = actionLisible(async (lignes: LigneCommandeClasseur[]) => {
  await direction();
  if (!Array.isArray(lignes) || lignes.length === 0) throw new Error("Aucune ligne lue dans le classeur.");
  if (lignes.length > MAX_LIGNES) throw new Error(`Trop de lignes (plus de ${MAX_LIGNES}) : ce n'est pas le classeur attendu.`);
  const ls = lignes.map((l: Record<string, unknown>) => ({
    feuille: feuilleDe(l?.feuille), rubrique: texte(l?.rubrique, "rubrique"), nom: texte(l?.nom, "désignation"),
    unite: typeof l?.unite === "string" ? propre(l.unite).slice(0, 40) || null : null, rang: rangDe(l?.rang),
  }));
  const articles = await prisma.articleStock.findMany({
    where: { actif: true },
    select: { id: true, designation: true, nomCourt: true, domaine: true, surFicheCommande: true, ordreCommande: true, rubriqueCommande: true },
  });
  return { ok: true as const, propositions: analyserLignesCommande(ls, articles, LEGUMES.map((l) => l.nom)) };
});

export type ChoixCommande = {
  articleId: string;
  feuille: "CUISINE" | "BAR";
  rubrique: string;
  rang: number;
  /** Désignation du classeur : devient le nom court si l'article n'en a pas. */
  nom: string;
  /** Remplacer un nom court DÉJÀ saisi (case explicite). */
  remplacerNomCourt?: boolean;
};

/**
 * Pose la sélection sur la fiche commande. IDEMPOTENT : un article déjà au même rang, sous la même
 * rubrique et avec son nom court n'est pas réécrit. Un même article coché deux fois : la première
 * ligne gagne, la seconde est comptée à part (jamais écrasée en silence).
 */
export const appliquerImportCommande = actionLisible(async (choix: ChoixCommande[]) => {
  const user = await direction();
  if (!Array.isArray(choix) || choix.length === 0) throw new Error("Aucune ligne cochée.");
  if (choix.length > MAX_LIGNES) throw new Error("Sélection trop longue.");
  const lus = choix.map((c) => {
    if (typeof c?.articleId !== "string" || !c.articleId) throw new Error("Article manquant : choisissez l'article du catalogue.");
    return { articleId: c.articleId, feuille: feuilleDe(c.feuille), rubrique: texte(c.rubrique, "rubrique"), rang: rangDe(c.rang), nom: texte(c.nom, "désignation"), remplacer: c.remplacerNomCourt === true };
  });

  const bilan = { places: 0, nomsCourts: 0, dejaAJour: 0, doublons: 0 };
  await prisma.$transaction(async (tx) => {
    const ids = [...new Set(lus.map((c) => c.articleId))];
    const articles = new Map((await tx.articleStock.findMany({
      where: { id: { in: ids } },
      select: { id: true, designation: true, nomCourt: true, domaine: true, actif: true, surFicheCommande: true, ordreCommande: true, rubriqueCommande: true },
    })).map((a) => [a.id, a]));
    const journal: EntreeJournal[] = [];
    const vus = new Set<string>();
    for (const c of lus) {
      if (vus.has(c.articleId)) { bilan.doublons++; continue; }
      vus.add(c.articleId);
      const a = articles.get(c.articleId);
      if (!a) throw new Error(`« ${c.nom} » : l'article choisi n'existe plus. Relancez l'import.`);
      const bar = a.domaine === "BOISSON";
      if (bar !== (c.feuille === "BAR")) throw new Error(`« ${c.nom} » : « ${a.designation} » n'est pas un article ${c.feuille === "BAR" ? "du bar" : "de la cuisine"}.`);
      const nomCourt = !a.nomCourt?.trim() || c.remplacer ? c.nom : a.nomCourt;
      if (a.surFicheCommande && a.ordreCommande === c.rang && a.rubriqueCommande === c.rubrique && a.nomCourt === nomCourt) { bilan.dejaAJour++; continue; }
      await tx.articleStock.update({ where: { id: a.id }, data: { surFicheCommande: true, ordreCommande: c.rang, rubriqueCommande: c.rubrique, nomCourt } });
      bilan.places++;
      if (nomCourt !== a.nomCourt) bilan.nomsCourts++;
      journal.push({
        entite: "ArticleStock", entiteId: a.id, champ: "ficheCommande",
        ancienneValeur: a.surFicheCommande ? `${a.rubriqueCommande ?? "—"} (rang ${a.ordreCommande ?? "—"}), nom court ${a.nomCourt ?? "—"}` : "hors fiche commande",
        nouvelleValeur: `${c.rubrique} (rang ${c.rang}), nom court ${nomCourt ?? "—"} — import du classeur Commande`,
        userId: user.id,
      });
    }
    await journaliserPlusieurs(tx, journal);
  }, { timeout: 60_000, maxWait: 15_000 });

  revalidatePath("/stock/journalier");
  revalidatePath("/stock/catalogue");
  return { ok: true as const, ...bilan };
});
