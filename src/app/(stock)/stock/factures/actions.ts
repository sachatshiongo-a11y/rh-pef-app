"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

/**
 * Crée une facture fournisseur détaillée (avec ses lignes d'articles et quantités).
 * Le montant total est calculé à partir des lignes.
 */
export async function creerFactureAvecLignes(formData: FormData) {
  const user = await garde();
  const fournisseurNom = String(formData.get("fournisseurNom") ?? "").trim();
  if (!fournisseurNom) throw new Error("Le fournisseur est requis.");

  const ids = formData.getAll("ligne_articleId").map(String);
  const desigs = formData.getAll("ligne_designation").map((v) => String(v).trim());
  const unites = formData.getAll("ligne_unite").map((v) => String(v).trim());
  const qtes = formData.getAll("ligne_quantite").map(dec);
  const prixs = formData.getAll("ligne_prix").map(dec);

  const lignes = desigs
    .map((designation, i) => ({
      articleId: ids[i] || null,
      designation,
      unite: unites[i] || null,
      quantite: qtes[i] ?? 0,
      prixUnitaireUSD: prixs[i] ?? 0,
      totalLigneUSD: (qtes[i] ?? 0) * (prixs[i] ?? 0),
    }))
    .filter((l) => l.designation && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (désignation + quantité).");

  const montantUSD = lignes.reduce((t, l) => t + l.totalLigneUSD, 0);
  const dateStr = String(formData.get("date") ?? "").trim() || null;
  const echeanceStr = String(formData.get("dateEcheance") ?? "").trim() || null;
  const montantRegleUSD = dec(formData.get("montantRegleUSD"));
  const reste = Math.max(0, montantUSD - montantRegleUSD);
  const d = new Date(dateStr ?? echeanceStr ?? AUJ());
  const numero = String(formData.get("numero") ?? "").trim() || null;
  // C'est l'enregistrement de la facture (articles + quantités) qui fait entrer la marchandise
  // en stock — pas la réception du bon de commande (volontairement différenciés). Décochable
  // pour une facture purement financière sans mouvement de marchandise.
  const entrerEnStock = formData.get("entrerEnStock") != null; // case cochée ⇒ présente dans le FormData
  const origine = `Facture ${fournisseurNom}${numero ? ` ${numero}` : ""}`;

  const fac = await prisma.$transaction(async (tx) => {
    const f = await tx.factureFournisseur.create({
      data: {
        fournisseurId: String(formData.get("fournisseurId") ?? "").trim() || null,
        fournisseurNom,
        bonDeCommandeId: String(formData.get("bonDeCommandeId") ?? "").trim() || null,
        numero,
        date: dateStr ? new Date(dateStr) : null,
        dateEcheance: echeanceStr ? new Date(echeanceStr) : null,
        montantUSD, montantRegleUSD, resteAPayerUSD: reste,
        statut: statutDe(reste, echeanceStr),
        modePaiement: String(formData.get("modePaiement") ?? "").trim() || null,
        mois: d.getUTCMonth() + 1, annee: d.getUTCFullYear(),
        lignes: { create: lignes },
      },
    });
    if (entrerEnStock) {
      for (const l of lignes) {
        if (!l.articleId) continue; // seules les lignes reliées à un article du catalogue entrent en stock
        await tx.mouvementStock.create({
          data: {
            articleId: l.articleId, type: "ENTREE", quantite: l.quantite, date: d,
            origine, montantUSD: l.totalLigneUSD, factureId: f.id, creeParId: user.id,
          },
        });
        await tx.stock.upsert({
          where: { articleId: l.articleId },
          update: { quantite: { increment: l.quantite } },
          create: { articleId: l.articleId, quantite: l.quantite },
        });
      }
    }
    return f;
  });

  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: fac.id, champ: "creation", nouvelleValeur: `${fournisseurNom} — ${montantUSD} USD (${lignes.length} ligne(s))${entrerEnStock ? " · entrée stock" : ""}`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
  redirect(`/stock/factures/${fac.id}`);
}

/** Supprime une facture fournisseur et ANNULE ses entrées de stock (décrémente ce qu'elle avait fait entrer). */
export async function supprimerFacture(id: string) {
  const user = await garde();
  const f = await prisma.factureFournisseur.findUniqueOrThrow({
    where: { id },
    include: { mouvements: { where: { type: "ENTREE" } } },
  });
  await prisma.$transaction(async (tx) => {
    // Reprise du stock entré par cette facture, avant suppression (les mouvements passeront à factureId=null).
    for (const m of f.mouvements) {
      await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { decrement: Number(m.quantite) } } });
      await tx.mouvementStock.delete({ where: { id: m.id } });
    }
    await tx.factureFournisseur.delete({ where: { id } });
  });
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: id, champ: "suppression", ancienneValeur: `${f.fournisseurNom} — ${f.montantUSD}`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
}

/** Marque une facture comme réglée : solde le reste à payer et enregistre la date de paiement (aujourd'hui). */
export async function marquerPayee(id: string) {
  const user = await garde();
  const f = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id } });
  await prisma.factureFournisseur.update({
    where: { id },
    data: { montantRegleUSD: f.montantUSD, resteAPayerUSD: 0, statut: "REGLEE", datePaiement: new Date() },
  });
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: id, champ: "statut", nouvelleValeur: "RÉGLÉE", userId: user.id });
  revalidatePath("/stock/factures");
}
