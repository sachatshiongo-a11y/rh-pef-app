"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
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

/** Valide un bon de commande (brouillon → validé). Condition pour l'export/l'envoi. */
export async function validerBonCommande(id: string, _formData: FormData) {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // seule la Direction valide un bon de commande
  const bc = await prisma.bonDeCommande.findUniqueOrThrow({ where: { id } });
  if (bc.statut !== "BROUILLON") throw new Error("Ce bon de commande est déjà validé.");
  await prisma.bonDeCommande.update({ where: { id }, data: { statut: "VALIDE" } });
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: id, champ: "statut", nouvelleValeur: "VALIDE", userId: user.id });
  revalidatePath("/stock/commandes");
  revalidatePath(`/stock/commandes/${id}`);
}

/** Supprime un bon de commande (réservé à la Direction). Les lignes sont supprimées en cascade ;
 * réceptions et factures liées sont détachées (les entrées de stock déjà faites restent). */
export async function supprimerBonCommande(id: string, _formData: FormData) {
  const user = await garde();
  requireRole(user, ["ADMIN"]);
  const bc = await prisma.bonDeCommande.findUniqueOrThrow({ where: { id } });
  await prisma.bonDeCommande.delete({ where: { id } });
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: id, champ: "suppression", ancienneValeur: bc.numero, userId: user.id });
  revalidatePath("/stock/commandes");
  redirect("/stock/commandes");
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

/**
 * Réceptionne un bon de commande : pour chaque ligne d'article reçue, crée une entrée de stock
 * (MouvementStock ENTRÉE reliée à une Réception) et incrémente l'inventaire. Met le statut à
 * REÇU si tout est reçu, sinon REÇU PARTIEL. Les quantités reçues sont saisies par ligne.
 */
export async function receptionnerBonCommande(bcId: string, formData: FormData) {
  const user = await garde();
  const bc = await prisma.bonDeCommande.findUniqueOrThrow({ where: { id: bcId }, include: { lignes: true } });

  const ligneIds = formData.getAll("recu_ligneId").map(String);
  const qtes = formData.getAll("recu_quantite").map(dec);
  const recu = new Map<string, number>();
  ligneIds.forEach((lid, i) => recu.set(lid, qtes[i] ?? 0));

  const aRecevoir = bc.lignes.filter((l) => l.articleId && (recu.get(l.id) ?? 0) > 0);
  if (aRecevoir.length === 0) throw new Error("Renseignez au moins une quantité reçue (sur une ligne liée à un article).");

  await prisma.$transaction(async (tx) => {
    const rec = await tx.reception.create({ data: { bonDeCommandeId: bcId, creeParId: user.id } });
    for (const l of aRecevoir) {
      const q = recu.get(l.id)!;
      await tx.mouvementStock.create({
        data: {
          articleId: l.articleId!, type: "ENTREE", quantite: q,
          origine: `Réception BC ${bc.numero}`, receptionId: rec.id,
          montantUSD: Number(l.prixUnitaireUSD) * q, creeParId: user.id,
        },
      });
      await tx.stock.upsert({
        where: { articleId: l.articleId! },
        update: { quantite: { increment: q } },
        create: { articleId: l.articleId!, quantite: q },
      });
    }
    const articleLines = bc.lignes.filter((l) => l.articleId);
    const complet = articleLines.every((l) => (recu.get(l.id) ?? 0) >= Number(l.quantite));
    await tx.bonDeCommande.update({ where: { id: bcId }, data: { statut: complet ? "RECU" : "RECU_PARTIEL" } });
  });

  await journaliser(prisma, { entite: "BonDeCommande", entiteId: bcId, champ: "reception", nouvelleValeur: `${aRecevoir.length} ligne(s)`, userId: user.id });
  revalidatePath(`/stock/commandes/${bcId}`);
  revalidatePath("/stock/commandes");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
}
