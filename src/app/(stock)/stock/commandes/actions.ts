"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { envoyerPush } from "@/lib/push";
import { creerNotification, supprimerNotificationsPour } from "@/lib/notifications";
import { usd } from "@/lib/stock";
import { extraireBonCommandePDF, type LigneBonCommande } from "@/lib/import-bc-pdf";

const MOIS_FR = ["JANVIER", "FÉVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOÛT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DÉCEMBRE"];

const normNom = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slugBC = (s: string) => normNom(s).slice(0, 40) || "bc";

async function televerserBC(file: File, dest: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/storage/v1/object/employes/${dest}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/pdf", "x-upsert": "true" },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) throw new Error(`téléversement PDF (${res.status})`);
  return `${base}/storage/v1/object/public/employes/${dest}`;
}

/**
 * Importe des bons de commande depuis leurs PDF (texte). Direction uniquement. Chaque BC est créé
 * avec son PDF joint (source de vérité) ; les numéros en collision sont suffixés, les doublons ignorés.
 */
export async function importerBonsCommandePDF(formData: FormData): Promise<{ importes: number; ignores: number; fournisseursCrees: string[]; erreurs: string[] }> {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);

  const fichiers = formData.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) return { importes: 0, ignores: 0, fournisseursCrees: [], erreurs: ["Aucun fichier."] };

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = Number(config?.tauxChangeCDF ?? 2300) || 2300;

  const erreurs: string[] = [];
  const extraits: { file: File; numero: string; sequence: number; mois: number; annee: number; fournisseur: string; date: string | null; total: number; lignes: LigneBonCommande[] }[] = [];
  for (const f of fichiers) {
    try {
      const e = await extraireBonCommandePDF(await f.arrayBuffer(), taux);
      if (!e.numero || !e.fournisseur) { erreurs.push(`${f.name} : numéro/fournisseur introuvable`); continue; }
      extraits.push({ file: f, numero: e.numero, sequence: e.sequence, mois: e.mois ?? 1, annee: e.annee ?? new Date().getFullYear(), fournisseur: e.fournisseur, date: e.date, total: e.total, lignes: e.lignes });
    } catch (err) {
      erreurs.push(`${f.name} : ${err instanceof Error ? err.message : "illisible"}`);
    }
  }
  if (extraits.length === 0) return { importes: 0, ignores: 0, fournisseursCrees: [], erreurs: erreurs.length ? erreurs : ["Aucun bon de commande lisible."] };

  const fours = await prisma.fournisseur.findMany({ select: { id: true, nom: true } });
  const parNom = new Map(fours.map((x) => [normNom(x.nom), x.id]));
  const fournisseursCrees: string[] = [];
  for (const nom of [...new Set(extraits.map((e) => e.fournisseur))]) {
    if (parNom.has(normNom(nom))) continue;
    const c = await prisma.fournisseur.create({ data: { nom, pays: "République démocratique du Congo" } });
    parNom.set(normNom(nom), c.id);
    fournisseursCrees.push(nom);
  }

  const existants = await prisma.bonDeCommande.findMany({ select: { numero: true, date: true, fournisseur: { select: { nom: true } } } });
  const numExist = new Set(existants.map((x) => x.numero));
  const dateISO = (d: Date | null | string) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const sigDe = (num: string, four: string, date: Date | string | null) => `${num}|${normNom(four)}|${dateISO(date)}`;
  // Un BC identique (même numéro d'origine + fournisseur + date) est ignoré (ré-import).
  const sigExist = new Set(existants.map((x) => sigDe(x.numero.replace(/-\d+$/, ""), x.fournisseur?.nom ?? "", x.date)));

  let importes = 0, ignores = 0;
  for (const e of extraits) {
    if (sigExist.has(sigDe(e.numero, e.fournisseur, e.date))) { ignores++; continue; }
    // Numéro unique : suffixe si le numéro existe pour un AUTRE bon.
    let numero = e.numero, k = 1;
    while (numExist.has(numero)) { k++; numero = `${e.numero}-${k}`; if (k > 30) break; }
    if (numExist.has(numero)) { ignores++; continue; }
    try {
      const url = await televerserBC(e.file, `bons-commande/${slugBC(e.fournisseur)}-${slugBC(numero)}-${Date.now().toString(36)}.pdf`);
      // Total : préférer la somme des lignes si l'en-tête n'a rien donné.
      const totalLignes = e.lignes.reduce((t, l) => t + l.totalLigneUSD, 0);
      const total = e.total > 0 ? e.total : Math.round(totalLignes * 100) / 100;
      await prisma.bonDeCommande.create({
        data: { numero, sequence: e.sequence, annee: e.annee, mois: e.mois, date: e.date ? new Date(e.date) : new Date(),
          fournisseurId: parNom.get(normNom(e.fournisseur)) ?? null, statut: "VALIDE", totalUSD: total, documentUrl: url, creeParId: user.id,
          lignes: { create: e.lignes.map((l) => ({ designation: l.designation, unite: l.unite, quantite: l.quantite, prixUnitaireUSD: l.prixUnitaireUSD, totalLigneUSD: l.totalLigneUSD })) } },
      });
      numExist.add(numero);
      sigExist.add(sigDe(e.numero, e.fournisseur, e.date));
      importes++;
    } catch (err) {
      erreurs.push(`${e.file.name} : ${err instanceof Error ? err.message : "échec"}`);
    }
  }

  if (importes > 0) await journaliser(prisma, { entite: "BonDeCommande", entiteId: "import", champ: "import PDF", nouvelleValeur: `${importes} BC`, userId: user.id });
  revalidatePath("/stock/commandes");
  return { importes, ignores, fournisseursCrees, erreurs };
}
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

  // La Direction n'a pas à valider ses propres bons : créé directement VALIDÉ (prêt à exporter/envoyer),
  // sauf si elle coche « Enregistrer comme brouillon ». Le circuit brouillon → validation ne
  // s'applique qu'aux autres rôles (ex. responsable stock).
  const autoValide = user.role === "ADMIN" && formData.get("enregistrerBrouillon") == null;

  const bc = await prisma.$transaction(async (tx) => {
    const dernier = await tx.bonDeCommande.aggregate({ where: { annee }, _max: { sequence: true } });
    const sequence = (dernier._max.sequence ?? 0) + 1;
    const numero = `${String(sequence).padStart(3, "0")}/PEF/${tag ? `${tag}/` : ""}${MOIS_FR[mois - 1]}/${String(annee).slice(-2)}`;
    return tx.bonDeCommande.create({
      data: {
        numero, sequence, annee, mois,
        ...(autoValide ? { statut: "VALIDE" as const } : {}),
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

  // Un bon émis par un autre rôle attend la validation Direction : cloche + push/e-mail.
  // Un bon créé par la Direction (validé d'office ou gardé en brouillon volontaire) : rien à envoyer.
  if (user.role !== "ADMIN") {
    await creerNotification({ domaine: "STOCK", type: "AUTRE", message: `Nouveau bon de commande ${bc.numero}${four ? ` — ${four.nom}` : ""} à valider (${usd(totalUSD)})`, lien: "/stock/a-valider", refId: bc.id });
  }

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

/** Supprime TOUS les bons de commande (Direction uniquement). Lignes en cascade, factures détachées. */
export async function supprimerTousBonsCommande() {
  const user = await garde();
  requireRole(user, ["ADMIN"]);
  const { count } = await prisma.bonDeCommande.deleteMany({});
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: "tous", champ: "suppression groupée", nouvelleValeur: `${count} BC`, userId: user.id });
  revalidatePath("/stock/commandes");
}

/** Valide un bon de commande (brouillon → validé). Condition pour l'export/l'envoi. */
export async function validerBonCommande(id: string, _formData: FormData) {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // seule la Direction valide un bon de commande
  const bc = await prisma.bonDeCommande.findUniqueOrThrow({ where: { id } });
  if (bc.statut !== "BROUILLON") throw new Error("Ce bon de commande est déjà validé.");
  await prisma.bonDeCommande.update({ where: { id }, data: { statut: "VALIDE" } });
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: id, champ: "statut", nouvelleValeur: "VALIDE", userId: user.id });

  // La demande « à valider » est traitée → sa notification disparaît.
  await supprimerNotificationsPour(id);
  // Notifie l'auteur du BC que sa demande est validée (cloche + push) — SAUF si le validateur
  // est l'auteur lui-même : la Direction validant son propre bon n'a pas à se notifier.
  if (bc.creeParId && bc.creeParId !== user.id) {
    await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `Bon de commande ${bc.numero} validé`, lien: `/stock/commandes/${id}`, refId: id } });
    await envoyerPush([bc.creeParId], { title: "Bon de commande validé", body: `${bc.numero} a été validé.`, url: `/stock/commandes/${id}`, tag: `bc-val-${id}` });
  }

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
  await supprimerNotificationsPour(id);
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

/** Valide plusieurs bons de commande à l'état BROUILLON d'un coup (Direction). */
export async function validerBonsEnLot(ids: string[]) {
  const user = await garde();
  requireRole(user, ["ADMIN"]);
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  const bcs = await prisma.bonDeCommande.findMany({ where: { id: { in: uniq }, statut: "BROUILLON" }, select: { id: true, numero: true, creeParId: true } });
  if (bcs.length === 0) return;
  await prisma.bonDeCommande.updateMany({ where: { id: { in: bcs.map((b) => b.id) } }, data: { statut: "VALIDE" } });
  for (const b of bcs) {
    await supprimerNotificationsPour(b.id);
    // Cloche « validé » réservée aux bons créés par quelqu'un d'autre : la Direction qui valide
    // ses propres brouillons n'a pas à se notifier elle-même.
    if (b.creeParId && b.creeParId !== user.id) {
      await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `Bon de commande ${b.numero} validé`, lien: `/stock/commandes/${b.id}`, refId: b.id } });
    }
  }
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: "lot", champ: "statut", nouvelleValeur: `${bcs.length} validé(s)`, userId: user.id });
  revalidatePath("/stock/commandes");
  revalidatePath("/stock/a-valider");
  revalidatePath("/stock");
}

/** Supprime plusieurs bons de commande d'un coup (Direction). */
export async function supprimerBonsEnLot(ids: string[]) {
  const user = await garde();
  requireRole(user, ["ADMIN"]);
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  for (const id of uniq) await supprimerNotificationsPour(id);
  const n = await prisma.bonDeCommande.deleteMany({ where: { id: { in: uniq } } });
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: "lot", champ: "suppression", nouvelleValeur: `${n.count} BC`, userId: user.id });
  revalidatePath("/stock/commandes");
  revalidatePath("/stock/a-valider");
  revalidatePath("/stock");
}
