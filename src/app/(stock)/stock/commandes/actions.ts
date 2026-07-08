"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { envoyerPush } from "@/lib/push";
import { creerNotification } from "@/lib/notifications";
import { usd } from "@/lib/stock";

const MOIS_FR = ["JANVIER", "FÉVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOÛT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DÉCEMBRE"];
const dec = (v: FormDataEntryValue | undefined): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};
const STATUTS = ["BROUILLON", "ENVOYE", "RECU_PARTIEL", "RECU", "ANNULE"] as const;
type Statut = (typeof STATUTS)[number];

// Étiquette courte du fournisseur pour le numéro de BC (mot significatif, sans forme juridique).
const MOTS_VIDES = new Set(["ETS", "STE", "STÉ", "SARL", "SA", "SPRL", "SAS", "EARL", "LA", "LE", "LES", "DE", "DU", "MAISON"]);
function tagFournisseur(nom: string): string {
  const mots = nom.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^A-Z0-9]+/).filter(Boolean);
  const signifiant = mots.find((m) => !MOTS_VIDES.has(m)) ?? mots[0] ?? "FRN";
  return signifiant.slice(0, 6);
}

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

  // Étiquette fournisseur intégrée au numéro pour compiler/identifier plus vite (ex. « 001/PEF/SENEVE/JUIN/26 »).
  const four = fournisseurId ? await prisma.fournisseur.findUnique({ where: { id: fournisseurId }, select: { nom: true } }) : null;
  const tag = four ? tagFournisseur(four.nom) : "";

  const bc = await prisma.$transaction(async (tx) => {
    const dernier = await tx.bonDeCommande.aggregate({ where: { annee }, _max: { sequence: true } });
    const sequence = (dernier._max.sequence ?? 0) + 1;
    const numero = `${String(sequence).padStart(3, "0")}/PEF/${tag ? `${tag}/` : ""}${MOIS_FR[mois - 1]}/${String(annee).slice(-2)}`;
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

  // Un bon de commande vient d'être émis (à valider) : cloche + push/e-mail à la Direction.
  await creerNotification({ domaine: "STOCK", type: "AUTRE", message: `Nouveau bon de commande ${bc.numero}${four ? ` — ${four.nom}` : ""} à valider (${usd(totalUSD)})`, lien: "/stock/a-valider", refId: bc.id });

  revalidatePath("/stock/commandes");
  revalidatePath("/stock/a-valider");
  redirect(`/stock/commandes/${bc.id}`);
}

/** Modifie un bon de commande encore à l'état BROUILLON (remplace ses lignes et son en-tête). */
export async function modifierBonCommande(id: string, formData: FormData) {
  const user = await garde();
  const bc = await prisma.bonDeCommande.findUniqueOrThrow({ where: { id }, select: { statut: true } });
  if (bc.statut !== "BROUILLON") throw new Error("Seul un brouillon peut être modifié.");

  const fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;
  const ids = formData.getAll("ligne_articleId").map(String);
  const desigs = formData.getAll("ligne_designation").map((v) => String(v).trim());
  const qtes = formData.getAll("ligne_quantite").map(dec);
  const prixs = formData.getAll("ligne_prix").map(dec);
  const cartons = formData.getAll("ligne_uniteParCarton").map(dec);

  const lignes = desigs
    .map((designation, i) => ({ articleId: ids[i] || null, designation, quantite: qtes[i] ?? 0, prixUnitaireUSD: prixs[i] ?? 0, uniteParCarton: cartons[i] || null }))
    .filter((l) => l.designation && l.quantite > 0);
  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (désignation + quantité).");

  const totalUSD = lignes.reduce((t, l) => t + l.quantite * l.prixUnitaireUSD, 0);
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = config ? Number(config.tauxChangeCDF) : null;

  await prisma.$transaction(async (tx) => {
    await tx.ligneBonDeCommande.deleteMany({ where: { bonDeCommandeId: id } });
    await tx.bonDeCommande.update({
      where: { id },
      data: {
        fournisseurId,
        delaiPaiement: String(formData.get("delaiPaiement") ?? "").trim() || null,
        modePaiement: String(formData.get("modePaiement") ?? "").trim() || null,
        commentaire: String(formData.get("commentaire") ?? "").trim() || null,
        totalUSD, totalCDF: taux ? totalUSD * taux : null, tauxChangeUtilise: taux,
        lignes: {
          create: lignes.map((l) => ({
            articleId: l.articleId, designation: l.designation, quantite: l.quantite,
            prixUnitaireUSD: l.prixUnitaireUSD, uniteParCarton: l.uniteParCarton,
            nbCartons: l.uniteParCarton ? l.quantite / l.uniteParCarton : null,
            totalLigneUSD: l.quantite * l.prixUnitaireUSD,
          })),
        },
      },
    });
  });

  await journaliser(prisma, { entite: "BonDeCommande", entiteId: id, champ: "modification", nouvelleValeur: `${lignes.length} ligne(s)`, userId: user.id });
  revalidatePath(`/stock/commandes/${id}`);
  revalidatePath("/stock/commandes");
  redirect(`/stock/commandes/${id}`);
}

/** Valide un bon de commande (brouillon → validé). Condition pour l'export/l'envoi. */
export async function validerBonCommande(id: string, _formData: FormData) {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // seule la Direction valide un bon de commande
  const bc = await prisma.bonDeCommande.findUniqueOrThrow({ where: { id } });
  if (bc.statut !== "BROUILLON") throw new Error("Ce bon de commande est déjà validé.");
  await prisma.bonDeCommande.update({ where: { id }, data: { statut: "VALIDE" } });
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: id, champ: "statut", nouvelleValeur: "VALIDE", userId: user.id });

  // Notifie l'auteur du BC que sa demande est validée (cloche pour tous + push à l'auteur).
  await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `Bon de commande ${bc.numero} validé`, lien: `/stock/commandes/${id}`, refId: id } });
  if (bc.creeParId) await envoyerPush([bc.creeParId], { title: "Bon de commande validé", body: `${bc.numero} a été validé.`, url: `/stock/commandes/${id}`, tag: `bc-val-${id}` });

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
 * Réceptionne un bon de commande : enregistre la réception (marchandise arrivée) et met le
 * statut à REÇU / REÇU PARTIEL selon les quantités saisies. NE TOUCHE PAS AU STOCK — l'entrée
 * en stock se fait uniquement à l'enregistrement de la FACTURE fournisseur (articles + quantités)
 * ou via la liste d'achat. La réception et l'entrée en stock sont volontairement différenciées.
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
    await tx.reception.create({ data: { bonDeCommandeId: bcId, creeParId: user.id } });
    const articleLines = bc.lignes.filter((l) => l.articleId);
    const complet = articleLines.every((l) => (recu.get(l.id) ?? 0) >= Number(l.quantite));
    await tx.bonDeCommande.update({ where: { id: bcId }, data: { statut: complet ? "RECU" : "RECU_PARTIEL" } });
  });

  await journaliser(prisma, { entite: "BonDeCommande", entiteId: bcId, champ: "reception", nouvelleValeur: `${aRecevoir.length} ligne(s)`, userId: user.id });
  revalidatePath(`/stock/commandes/${bcId}`);
  revalidatePath("/stock/commandes");
}
