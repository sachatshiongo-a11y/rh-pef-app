import "server-only";
import type { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { montantsFacture } from "@/lib/facture-devise";
import { chercherDoublonFacture, type DoublonFacture, type FactureComparable, type FactureExistante } from "@/lib/facture-doublon";

type Client = Prisma.TransactionClient | typeof prisma;

const jour = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Les factures du fournisseur (par identifiant, par nom, ou sans fournisseur rattaché) — de quoi comparer. */
export async function facturesDuFournisseur(client: Client, f: { fournisseurId: string | null; fournisseurNom: string }): Promise<FactureExistante[]> {
  const lignes = await client.factureFournisseur.findMany({
    where: { OR: [...(f.fournisseurId ? [{ fournisseurId: f.fournisseurId }] : []), { fournisseurId: null }, { fournisseurNom: { equals: f.fournisseurNom, mode: "insensitive" as const } }] },
    select: { id: true, fournisseurId: true, fournisseurNom: true, numero: true, date: true, annee: true, mois: true, devise: true, montantUSD: true, montantCDF: true, montantRegleUSD: true, montantRegleCDF: true, resteAPayerUSD: true, resteAPayerCDF: true },
  });
  return lignes.map((l) => ({
    id: l.id, fournisseurId: l.fournisseurId, fournisseurNom: l.fournisseurNom, numero: l.numero, date: jour(l.date), annee: l.annee, mois: l.mois,
    devise: l.devise, montant: montantsFacture(l).montant,
  }));
}

/** Cherche, en base, une facture déjà saisie pour ce fournisseur qui ressemble à `nouvelle` (voir `chercherDoublonFacture`). */
export async function trouverDoublonFacture(client: Client, nouvelle: FactureComparable): Promise<DoublonFacture | null> {
  return chercherDoublonFacture(nouvelle, await facturesDuFournisseur(client, nouvelle));
}
