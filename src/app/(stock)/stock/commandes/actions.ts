"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

const MOIS_FR = ["JANVIER", "FÉVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOÛT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DÉCEMBRE"];
const dec = (v: FormDataEntryValue | undefined): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};
const STATUTS = ["BROUILLON", "ENVOYE", "RECU_PARTIEL", "RECU", "ANNULE"] as const;
type Statut = (typeof STATUTS)[number];

async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/** Crée un bon de commande avec numérotation NNN/PEF/MOIS/AA (séquence remise à zéro chaque année). */
export async function creerBonCommande(formData: FormData) {
  const user = await garde();
  const fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;

  const ids = formData.getAll("ligne_articleId").map(String);
  const desigs = formData.getAll("ligne_designation").map((v) => String(v).trim());
  const qtes = formData.getAll("ligne_quantite").map(dec);
  const prixs = formData.getAll("ligne_prix").map(dec);
  const cartons = formData.getAll("ligne_uniteParCarton").map(dec);

  const lignes = desigs
    .map((designation, i) => ({
      articleId: ids[i] || null,
      designation,
      quantite: qtes[i] ?? 0,
      prixUnitaireUSD: prixs[i] ?? 0,
      uniteParCarton: cartons[i] || null,
    }))
    .filter((l) => l.designation && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (désignation + quantité).");

  const totalUSD = lignes.reduce((t, l) => t + l.quantite * l.prixUnitaireUSD, 0);
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = config ? Number(config.tauxChangeCDF) : null;

  const now = new Date();
  const annee = now.getFullYear();
  const mois = now.getMonth() + 1;

  const bc = await prisma.$transaction(async (tx) => {
    const dernier = await tx.bonDeCommande.aggregate({ where: { annee }, _max: { sequence: true } });
    const sequence = (dernier._max.sequence ?? 0) + 1;
    const numero = `${String(sequence).padStart(3, "0")}/PEF/${MOIS_FR[mois - 1]}/${String(annee).slice(-2)}`;
    return tx.bonDeCommande.create({
      data: {
        numero, sequence, annee, mois,
        fournisseurId,
        delaiPaiement: String(formData.get("delaiPaiement") ?? "").trim() || null,
        modePaiement: String(formData.get("modePaiement") ?? "").trim() || null,
        commentaire: String(formData.get("commentaire") ?? "").trim() || null,
        totalUSD,
        totalCDF: taux ? totalUSD * taux : null,
        tauxChangeUtilise: taux,
        creeParId: user.id,
        lignes: {
          create: lignes.map((l) => ({
            articleId: l.articleId,
            designation: l.designation,
            quantite: l.quantite,
            prixUnitaireUSD: l.prixUnitaireUSD,
            uniteParCarton: l.uniteParCarton,
            nbCartons: l.uniteParCarton ? l.quantite / l.uniteParCarton : null,
            totalLigneUSD: l.quantite * l.prixUnitaireUSD,
          })),
        },
      },
    });
  });

  await journaliser(prisma, { entite: "BonDeCommande", entiteId: bc.id, champ: "creation", nouvelleValeur: bc.numero, userId: user.id });
  revalidatePath("/stock/commandes");
  redirect(`/stock/commandes/${bc.id}`);
}

/** Change le statut d'un bon de commande. */
export async function changerStatutBonCommande(id: string, formData: FormData) {
  const user = await garde();
  const statut = String(formData.get("statut") ?? "") as Statut;
  if (!STATUTS.includes(statut)) throw new Error("Statut invalide.");
  await prisma.bonDeCommande.update({ where: { id }, data: { statut } });
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: id, champ: "statut", nouvelleValeur: statut, userId: user.id });
  revalidatePath("/stock/commandes");
  revalidatePath(`/stock/commandes/${id}`);
}
