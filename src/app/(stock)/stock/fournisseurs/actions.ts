"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const CHAMPS = ["nom", "produits", "telephone", "ville", "pays", "adresse", "rccm", "idNational", "email", "contactNom", "delaiPaiement", "delaiLivraison", "modePaiement"] as const;

// La gestion des fournisseurs (ajout / modification / suppression) est réservée à la Direction.
async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  return user;
}

/** Crée un fournisseur. */
export async function creerFournisseur(formData: FormData) {
  const user = await garde();
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom est requis.");

  const data: Prisma.FournisseurCreateInput = { nom };
  for (const c of CHAMPS) {
    if (c === "nom") continue;
    const v = String(formData.get(c) ?? "").trim();
    if (v) (data as Record<string, unknown>)[c] = v;
  }
  const f = await prisma.fournisseur.create({ data });
  await journaliser(prisma, { entite: "Fournisseur", entiteId: f.id, champ: "creation", nouvelleValeur: nom, userId: user.id });
  revalidatePath("/stock/fournisseurs");
}

/** Modifie un ou plusieurs champs d'un fournisseur. */
export async function modifierFournisseur(id: string, formData: FormData) {
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
}

/**
 * Fusionne deux fournisseurs : réaffecte articles, bons de commande et factures du
 * fournisseur `sourceId` vers `cibleId`, complète les coordonnées manquantes de la cible
 * avec celles de la source, puis supprime la source. Direction uniquement.
 */
export async function fusionnerFournisseurs(sourceId: string, cibleId: string) {
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

  await prisma.$transaction([
    prisma.articleStock.updateMany({ where: { fournisseurId: sourceId }, data: { fournisseurId: cibleId } }),
    prisma.bonDeCommande.updateMany({ where: { fournisseurId: sourceId }, data: { fournisseurId: cibleId } }),
    // Factures reliées par identifiant OU par libellé figé (import) portant le nom de la source.
    prisma.factureFournisseur.updateMany({ where: { fournisseurId: sourceId }, data: { fournisseurId: cibleId, fournisseurNom: cible.nom } }),
    prisma.factureFournisseur.updateMany({ where: { fournisseurId: null, fournisseurNom: source.nom }, data: { fournisseurId: cibleId, fournisseurNom: cible.nom } }),
    ...(Object.keys(majCible).length ? [prisma.fournisseur.update({ where: { id: cibleId }, data: majCible })] : []),
    prisma.fournisseur.delete({ where: { id: sourceId } }),
  ]);

  await journaliser(prisma, { entite: "Fournisseur", entiteId: cibleId, champ: "fusion", ancienneValeur: source.nom, nouvelleValeur: cible.nom, userId: user.id });
  revalidatePath("/stock/fournisseurs");
  revalidatePath("/stock/factures");
  revalidatePath("/stock/commandes");
}

/** Supprime un fournisseur (les articles/factures/BC liés sont simplement détachés — FK SET NULL). */
export async function supprimerFournisseur(id: string) {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // suppression réservée à la Direction
  const f = await prisma.fournisseur.findUniqueOrThrow({ where: { id } });
  await prisma.fournisseur.delete({ where: { id } });
  await journaliser(prisma, { entite: "Fournisseur", entiteId: id, champ: "suppression", ancienneValeur: f.nom, userId: user.id });
  revalidatePath("/stock/fournisseurs");
}
