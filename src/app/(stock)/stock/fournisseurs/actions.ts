"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const CHAMPS = ["nom", "produits", "telephone", "ville", "pays", "adresse", "rccm", "idNational", "email", "contactNom", "delaiPaiement", "delaiLivraison", "modePaiement"] as const;

async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
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
