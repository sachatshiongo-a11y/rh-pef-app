"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

const dec = (v: FormDataEntryValue | null): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};
const AUJ = () => new Date().toISOString().slice(0, 10);

function statutDe(reste: number, echeanceISO: string | null): "REGLEE" | "A_REGLER" | "ECHUE_NON_REGLEE" {
  if (reste <= 0.001) return "REGLEE";
  if (echeanceISO && echeanceISO < AUJ()) return "ECHUE_NON_REGLEE";
  return "A_REGLER";
}

async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/** Ajoute une facture fournisseur individuellement (via le formulaire). */
export async function creerFacture(formData: FormData) {
  const user = await garde();
  const fournisseurNom = String(formData.get("fournisseurNom") ?? "").trim();
  const montantUSD = dec(formData.get("montantUSD"));
  const dateStr = String(formData.get("date") ?? "").trim() || null;
  if (!fournisseurNom) throw new Error("Le fournisseur est requis.");
  if (montantUSD <= 0) throw new Error("Le montant doit être supérieur à 0.");

  const fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;
  const echeanceStr = String(formData.get("dateEcheance") ?? "").trim() || null;
  const montantRegleUSD = dec(formData.get("montantRegleUSD"));
  const reste = Math.max(0, montantUSD - montantRegleUSD);
  const ref = dateStr ?? echeanceStr ?? AUJ();
  const d = new Date(ref);

  const bonDeCommandeId = String(formData.get("bonDeCommandeId") ?? "").trim() || null;
  const fac = await prisma.factureFournisseur.create({
    data: {
      fournisseurId, fournisseurNom, bonDeCommandeId,
      numero: String(formData.get("numero") ?? "").trim() || null,
      date: dateStr ? new Date(dateStr) : null,
      dateEcheance: echeanceStr ? new Date(echeanceStr) : null,
      montantUSD, montantRegleUSD, resteAPayerUSD: reste,
      statut: statutDe(reste, echeanceStr),
      modePaiement: String(formData.get("modePaiement") ?? "").trim() || null,
      mois: d.getUTCMonth() + 1, annee: d.getUTCFullYear(),
    },
  });
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: fac.id, champ: "creation", nouvelleValeur: `${fournisseurNom} — ${montantUSD} USD`, userId: user.id });
  revalidatePath("/stock/factures");
}

/** Marque une facture comme réglée (solde le reste à payer) et enregistre le mode de paiement. */
export async function marquerPayee(id: string, formData: FormData) {
  const user = await garde();
  const f = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id } });
  const modePaiement = String(formData.get("modePaiement") ?? "").trim() || f.modePaiement || null;
  await prisma.factureFournisseur.update({
    where: { id },
    data: { montantRegleUSD: f.montantUSD, resteAPayerUSD: 0, statut: "REGLEE", datePaiement: new Date(), modePaiement },
  });
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: id, champ: "statut", nouvelleValeur: `RÉGLÉE${modePaiement ? ` (${modePaiement})` : ""}`, userId: user.id });
  revalidatePath("/stock/factures");
}
