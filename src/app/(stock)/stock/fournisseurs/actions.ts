"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import type { Prisma } from "@prisma/client";
import { cleAlnum } from "@/lib/texte";
import { type DoublonFournisseur } from "@/lib/fournisseur-doublon";
import { refusCreationFournisseur, verrouillerNomFournisseur } from "@/lib/fournisseur-doublon-serveur";
import { reporterArticlesDuFournisseurTx } from "@/lib/article-fournisseurs";

const CHAMPS = ["nom", "produits", "telephone", "ville", "pays", "adresse", "rccm", "idNational", "email", "contactNom", "delaiPaiement", "delaiLivraison", "modePaiement"] as const;

// La gestion des fournisseurs (ajout / modification / suppression) est réservée à la Direction.
async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  return user;
}

/**
 * Crée un fournisseur. ANTI-DOUBLON (audit du 10/10/2026), comme « Ajouter un article » : un nom IDENTIQUE à un
 * fournisseur existant (accents, casse, ponctuation près) est refusé ; un nom PROCHE (« Kathy » / « Maison
 * Kathy ») aussi, tant que la saisie ne revient pas avec `creerQuandMeme` = « 1 » (« Créer quand même »).
 * Rien n'est créé dans ces deux cas : la réponse montre les fournisseurs existants.
 */
export const creerFournisseur = actionLisible(async (formData: FormData): Promise<DoublonFournisseur | void> => {
  const user = await garde();
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom est requis.");
  if (!cleAlnum(nom)) throw new Error("Le nom du fournisseur doit comporter des lettres ou des chiffres.");
  const creerQuandMeme = String(formData.get("creerQuandMeme") ?? "") === "1";

  const data: Prisma.FournisseurCreateInput = { nom };
  for (const c of CHAMPS) {
    if (c === "nom") continue;
    const v = String(formData.get(c) ?? "").trim();
    if (v) (data as Record<string, unknown>)[c] = v;
  }
  // Verrou sur la clé du nom puis relecture : deux créations simultanées du même nom ne font qu'un fournisseur.
  const r = await prisma.$transaction(async (tx) => {
    await verrouillerNomFournisseur(tx, nom);
    const refus = await refusCreationFournisseur(tx, nom, { creerQuandMeme });
    if (refus) return { refus } as const;
    return { f: await tx.fournisseur.create({ data }) } as const;
  });
  if ("refus" in r) return r.refus;
  await journaliser(prisma, { entite: "Fournisseur", entiteId: r.f.id, champ: "creation", nouvelleValeur: creerQuandMeme ? `${nom} (créé quand même, proche d'un fournisseur existant)` : nom, userId: user.id });
  revalidatePath("/stock/fournisseurs");
});

/** Modifie un ou plusieurs champs d'un fournisseur. */
export const modifierFournisseur = actionLisible(async (id: string, formData: FormData) => {
  const user = await garde();
  const data: Prisma.FournisseurUpdateInput = {};
  for (const c of CHAMPS) {
    if (!formData.has(c)) continue;
    const v = String(formData.get(c)).trim();
    if (c === "nom") { if (v) data.nom = v; }
    else (data as Record<string, string | null>)[c] = v || null;
  }
  if (Object.keys(data).length === 0) return;
  await prisma.fournisseur.update({ where: { id }, data });
  await journaliser(prisma, { entite: "Fournisseur", entiteId: id, champ: "modification", userId: user.id });
  revalidatePath("/stock/fournisseurs");
  revalidatePath(`/stock/fournisseurs/${id}`);
});

/**
 * Fusionne deux fournisseurs : réaffecte articles, bons de commande et factures du
 * fournisseur `sourceId` vers `cibleId`, complète les coordonnées manquantes de la cible
 * avec celles de la source, puis supprime la source. Direction uniquement.
 */
export const fusionnerFournisseurs = actionLisible(async (sourceId: string, cibleId: string) => {
  const user = await garde();
  if (!sourceId || !cibleId || sourceId === cibleId) throw new Error("Choisissez deux fournisseurs différents.");
  const [source, cible] = await Promise.all([
    prisma.fournisseur.findUnique({ where: { id: sourceId } }),
    prisma.fournisseur.findUnique({ where: { id: cibleId } }),
  ]);
  if (!source) throw new Error("Fournisseur à fusionner introuvable.");
  if (!cible) throw new Error("Fournisseur cible introuvable.");

  // Coordonnées : on garde celles de la cible et on complète les champs vides avec la source.
  const COORD = ["produits", "telephone", "ville", "pays", "adresse", "rccm", "idNational", "email", "contactNom", "delaiPaiement", "delaiLivraison", "modePaiement"] as const;
  const majCible: Prisma.FournisseurUpdateInput = {};
  for (const c of COORD) {
    const actuel = (cible as Record<string, unknown>)[c];
    const remplacant = (source as Record<string, unknown>)[c];
    if ((actuel == null || actuel === "") && remplacant) (majCible as Record<string, unknown>)[c] = remplacant;
  }

  const bilan = await prisma.$transaction(async (tx) => {
    // Fournisseurs des articles (2026-10-16) : les liens de la source passent à la cible, sans doublon de couple ;
    // un article qui avait les deux garde un seul lien (habituel si l'un des deux l'était). Avant la suppression.
    const liens = await reporterArticlesDuFournisseurTx(tx, sourceId, cibleId);
    await tx.articleStock.updateMany({ where: { fournisseurId: sourceId }, data: { fournisseurId: cibleId } });
    await tx.bonDeCommande.updateMany({ where: { fournisseurId: sourceId }, data: { fournisseurId: cibleId } });
    // Achats DIRECTS de la Liste d'achat : sans ce report, la suppression de la source les
    // détacherait en silence (FK SET NULL) et ils disparaîtraient de la fiche du fournisseur.
    await tx.mouvementStock.updateMany({ where: { fournisseurId: sourceId }, data: { fournisseurId: cibleId } });
    // Factures reliées par identifiant OU par libellé figé (import) portant le nom de la source.
    await tx.factureFournisseur.updateMany({ where: { fournisseurId: sourceId }, data: { fournisseurId: cibleId, fournisseurNom: cible.nom } });
    await tx.factureFournisseur.updateMany({ where: { fournisseurId: null, fournisseurNom: source.nom }, data: { fournisseurId: cibleId, fournisseurNom: cible.nom } });
    if (Object.keys(majCible).length) await tx.fournisseur.update({ where: { id: cibleId }, data: majCible });
    await tx.fournisseur.delete({ where: { id: sourceId } });
    return liens;
  });

  await journaliser(prisma, { entite: "Fournisseur", entiteId: cibleId, champ: "fusion", ancienneValeur: source.nom, nouvelleValeur: `${cible.nom}${bilan.repointes + bilan.fusionnes > 0 ? ` · ${bilan.repointes + bilan.fusionnes} article(s) (dont ${bilan.fusionnes} qui avaient déjà les deux)` : ""}`, userId: user.id });
  revalidatePath("/stock/fournisseurs");
  revalidatePath("/stock/factures");
  revalidatePath("/stock/commandes");
});

/**
 * Supprime un fournisseur (les articles/factures/BC liés sont simplement détachés — FK SET NULL).
 * REFUSÉE s'il porte des achats directs de la Liste d'achat : ils perdraient leur fournisseur en
 * silence. La fusion, elle, les reporte sur un autre fournisseur.
 */
export const supprimerFournisseur = actionLisible(async (id: string) => {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // suppression réservée à la Direction
  const f = await prisma.fournisseur.findUniqueOrThrow({ where: { id } });
  const nbAchatsDirects = await prisma.mouvementStock.count({ where: { fournisseurId: id } });
  if (nbAchatsDirects > 0) {
    throw new Error(`Suppression impossible : ${nbAchatsDirects} achat(s) direct(s) de la Liste d'achat sont rattachés à « ${f.nom} ». Fusionnez-le plutôt avec un autre fournisseur, qui reprendra ces achats.`);
  }
  await prisma.fournisseur.delete({ where: { id } });
  await journaliser(prisma, { entite: "Fournisseur", entiteId: id, champ: "suppression", ancienneValeur: f.nom, userId: user.id });
  revalidatePath("/stock/fournisseurs");
});
