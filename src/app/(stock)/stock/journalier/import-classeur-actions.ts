"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { normTexte } from "@/lib/texte";
import { analyserLignesClasseur, type LigneClasseur, type PropositionImport } from "@/lib/classeur-ventes";

// « Importer les lignes du classeur » (Conso. journalière → Ventes) : RÉSERVÉ À LA DIRECTION.
// Le fichier est lu dans le navigateur (seules les feuilles sont décompressées, jamais le logo) ;
// le serveur ne reçoit que les lignes lues, les compare aux fiches, puis applique ce que la
// Direction a coché. Rien n'est créé ni rattaché d'office ; tout est journalisé.

const MAX_LIGNES = 2000;
const MAX_TEXTE = 200;
const propre = (s: string) => s.replace(/\s+/g, " ").trim();
const cle = (s: string | null | undefined) => normTexte(propre(s ?? ""));

async function direction() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]); // la Direction crée les fiches, comme elle supprime
  return user;
}

function texte(v: unknown, champ: string): string {
  if (typeof v !== "string" || !propre(v) || propre(v).length > MAX_TEXTE) throw new Error(`Ligne du classeur illisible (${champ}).`);
  return propre(v);
}
const feuilleDe = (v: unknown) => {
  if (v !== "CUISINE" && v !== "BAR") throw new Error("Ligne du classeur illisible (feuille).");
  return v;
};
const rangDe = (v: unknown) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_LIGNES) throw new Error("Ligne du classeur illisible (rang).");
  return v;
};

function lireLignes(brut: unknown): LigneClasseur[] {
  if (!Array.isArray(brut) || brut.length === 0) throw new Error("Aucune ligne lue dans le classeur.");
  if (brut.length > MAX_LIGNES) throw new Error(`Trop de lignes (plus de ${MAX_LIGNES}) : ce n'est pas le classeur attendu.`);
  return brut.map((l: Record<string, unknown>) => ({ feuille: feuilleDe(l?.feuille), rubrique: texte(l?.rubrique, "rubrique"), nom: texte(l?.nom, "désignation"), rang: rangDe(l?.rang) }));
}

/** Compare les lignes lues aux fiches existantes : présentes, à créer, « proches ». */
export const analyserClasseurVentes = actionLisible(async (lignes: LigneClasseur[]) => {
  await direction();
  const ls = lireLignes(lignes);
  const [fiches, bar] = await Promise.all([
    prisma.ficheTechnique.findMany({ select: { id: true, nom: true, categorie: true, type: true, estSousRecette: true, libelleVente: true } }),
    prisma.articleResto.findMany({ where: { espace: "BAR" }, select: { designation: true } }),
  ]);
  return { ok: true as const, propositions: analyserLignesClasseur(ls, fiches, bar.map((a) => a.designation)) };
});

export type ChoixImport = {
  feuille: "CUISINE" | "BAR";
  nom: string;
  rubrique: string;
  rang: number;
  /** creer : nouvelle fiche sans recette ; rattacher / ordre : reprendre libellé et rang sur une fiche existante. */
  action: Exclude<PropositionImport["action"], "ignorer">;
  ficheId?: string | null;
};

/**
 * Applique la sélection de la Direction. IDEMPOTENT : une fiche du même type, du même nom (ou
 * libellé) et de la même rubrique n'est jamais recréée — relancer l'import ne fait aucun doublon.
 * Les fiches créées n'ont AUCUNE recette : la Direction la complète ensuite (coût « — »,
 * disponibilité « Recette à compléter », jamais un coût 0 ni « disponible »).
 */
export const appliquerImportClasseur = actionLisible(async (choix: ChoixImport[]) => {
  const user = await direction();
  if (!Array.isArray(choix) || choix.length === 0) throw new Error("Aucune ligne cochée.");
  if (choix.length > MAX_LIGNES) throw new Error("Sélection trop longue.");
  const lus = choix.map((c) => {
    const action = c?.action;
    if (action !== "creer" && action !== "rattacher" && action !== "ordre") throw new Error("Geste inconnu.");
    if (action !== "creer" && (typeof c.ficheId !== "string" || !c.ficheId)) throw new Error("Fiche à rattacher manquante.");
    return { feuille: feuilleDe(c.feuille), nom: texte(c.nom, "désignation"), rubrique: texte(c.rubrique, "rubrique"), rang: rangDe(c.rang), action, ficheId: c.ficheId ?? null };
  });

  const bilan = { crees: 0, reprises: 0, dejaPresentes: 0 };
  await prisma.$transaction(async (tx) => {
    const existantes = await tx.ficheTechnique.findMany({ where: { estSousRecette: false }, select: { id: true, nom: true, categorie: true, type: true, libelleVente: true, ordreVente: true } });
    const journal: EntreeJournal[] = [];
    const aCreer: { id: string; nom: string; categorie: string; type: "PLAT" | "BAR"; libelleVente: string; ordreVente: number }[] = [];
    for (const c of lus) {
      const type = c.feuille === "CUISINE" ? "PLAT" as const : "BAR" as const;
      if (c.action === "creer") {
        const deja = [...existantes, ...aCreer].some((f) =>
          f.type === type && (cle(f.nom) === cle(c.nom) || cle(f.libelleVente) === cle(c.nom)) && cle(f.categorie) === cle(c.rubrique));
        if (deja) { bilan.dejaPresentes++; continue; }
        const f = { id: randomUUID(), nom: c.nom, categorie: c.rubrique, type, libelleVente: c.nom, ordreVente: c.rang };
        aCreer.push(f);
        journal.push({ entite: "FicheTechnique", entiteId: f.id, champ: "creation", nouvelleValeur: `import du classeur des ventes : ${c.nom} (${c.rubrique}), sans recette`, userId: user.id });
      } else {
        const f = existantes.find((x) => x.id === c.ficheId);
        if (!f) throw new Error(`« ${c.nom} » : la fiche à rattacher n'existe plus (ou est une sous-recette). Relancez l'import.`);
        if (f.type !== type) throw new Error(`« ${c.nom} » : la fiche « ${f.nom} » n'est pas une fiche ${type === "PLAT" ? "« Plat vendu »" : "Bar"}.`);
        if (f.libelleVente === c.nom && f.ordreVente === c.rang) { bilan.dejaPresentes++; continue; }
        await tx.ficheTechnique.update({ where: { id: f.id }, data: { libelleVente: c.nom, ordreVente: c.rang } });
        journal.push({ entite: "FicheTechnique", entiteId: f.id, champ: "libelleVente", ancienneValeur: f.libelleVente ? `${f.libelleVente} (rang ${f.ordreVente ?? "—"})` : null, nouvelleValeur: `${c.nom} (rang ${c.rang})`, userId: user.id });
        f.libelleVente = c.nom; f.ordreVente = c.rang;
        bilan.reprises++;
      }
    }
    if (aCreer.length) await tx.ficheTechnique.createMany({ data: aCreer.map((f) => ({ ...f, nbPortions: 1 })) });
    bilan.crees = aCreer.length;
    await journaliserPlusieurs(tx, journal);
  }, { timeout: 60_000, maxWait: 15_000 });

  revalidatePath("/stock/journalier");
  revalidatePath("/stock/fiches");
  return { ok: true as const, ...bilan };
});
