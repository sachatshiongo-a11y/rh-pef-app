"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { decSaisi, decSaisiOptionnel } from "@/lib/nombre";
import { cleAlnum as normNom } from "@/lib/texte";
import { MOIS_FR } from "@/lib/dates-fr";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { notifierGesteStock } from "@/lib/validations-stock/geste-notifie";
import { journaliser } from "@/lib/audit";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { exigerDirectionPourSupprimer } from "@/lib/suppression-direction";
import { envoyerPush } from "@/lib/push";
import { creerNotification, supprimerNotificationsPour } from "@/lib/notifications";
import { libelleTotalBon } from "@/lib/bon-commande-devise";
import { refusCreationFournisseur, verrouillerNomFournisseur } from "@/lib/fournisseur-doublon-serveur";
import { extraireBonCommandePDF, type DeviseBon, type LigneBonLue } from "@/lib/import-bc-pdf";
import { appliquerReception, exigerBonReceptionnable, lireQuantitesRecues } from "@/lib/reception-bc";
import { anneeCouranteKinshasa, jourCivilKinshasa } from "@/lib/heure-kinshasa";


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
  return `/fichiers/${dest}`; // bucket privé — servi derrière session
}

/**
 * Importe des bons de commande depuis leurs PDF (texte). Direction uniquement. Chaque BC est créé
 * avec son PDF joint (source de vérité) ; les numéros en collision sont suffixés, les doublons ignorés.
 */
export const importerBonsCommandePDF = actionLisible(async (formData: FormData): Promise<{ importes: number; ignores: number; fournisseursCrees: string[]; erreurs: string[] }> => {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);

  const fichiers = formData.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) return { importes: 0, ignores: 0, fournisseursCrees: [], erreurs: ["Aucun fichier."] };

  // LA DEVISE LUE FAIT FOI (audit du 10/10/2026) : un bon en francs reste en francs, jamais converti au taux du jour.
  const erreurs: string[] = [];
  const extraits: { file: File; numero: string; sequence: number; mois: number; annee: number; fournisseur: string; date: string | null; devise: DeviseBon; total: number; lignes: LigneBonLue[] }[] = [];
  for (const f of fichiers) {
    try {
      const e = await extraireBonCommandePDF(await f.arrayBuffer());
      if (!e.numero || !e.fournisseur) { erreurs.push(`${f.name} : numéro/fournisseur introuvable`); continue; }
      extraits.push({ file: f, numero: e.numero, sequence: e.sequence, mois: e.mois ?? 1, annee: e.annee ?? anneeCouranteKinshasa(), fournisseur: e.fournisseur, date: e.date, devise: e.devise, total: e.total, lignes: e.lignes });
    } catch (err) {
      erreurs.push(`${f.name} : ${err instanceof Error ? err.message : "illisible"}`);
    }
  }
  if (extraits.length === 0) return { importes: 0, ignores: 0, fournisseursCrees: [], erreurs: erreurs.length ? erreurs : ["Aucun bon de commande lisible."] };

  const fours = await prisma.fournisseur.findMany({ select: { id: true, nom: true } });
  const parNom = new Map(fours.map((x) => [normNom(x.nom), x.id]));
  const fournisseursCrees: string[] = [];
  const refuses = new Set<string>(); // nom de fournisseur refusé (proche d'un existant) : ses bons ne sont pas importés
  for (const nom of [...new Set(extraits.map((e) => e.fournisseur))]) {
    if (parNom.has(normNom(nom))) continue;
    // ANTI-DOUBLON DE FOURNISSEUR (audit du 10/10/2026) : un import ne peut pas demander « Utiliser / Créer quand
    // même » ; un nom qui ressemble à un fournisseur existant n'est donc pas créé en silence — les bons de ce
    // fournisseur sont écartés et la Direction est renvoyée vers l'écran Fournisseurs (choix explicite).
    const refus = await prisma.$transaction(async (tx) => {
      await verrouillerNomFournisseur(tx, nom);
      const r = await refusCreationFournisseur(tx, nom);
      if (r) return r;
      const c = await tx.fournisseur.create({ data: { nom, pays: "République démocratique du Congo" } });
      parNom.set(normNom(nom), c.id);
      return null;
    });
    if (refus) { refuses.add(nom); erreurs.push(`Fournisseur « ${nom} » non créé : ${refus.message.replace(/ Rien n'a été créé\.$/, "")} Créez-le (ou choisissez l'existant) dans Fournisseurs, puis réimportez ses bons.`); continue; }
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
    if (refuses.has(e.fournisseur)) continue; // déjà signalé ci-dessus
    if (sigExist.has(sigDe(e.numero, e.fournisseur, e.date))) { ignores++; continue; }
    // Numéro unique : suffixe si le numéro existe pour un AUTRE bon.
    let numero = e.numero, k = 1;
    while (numExist.has(numero)) { k++; numero = `${e.numero}-${k}`; if (k > 30) break; }
    if (numExist.has(numero)) { ignores++; continue; }
    try {
      const url = await televerserBC(e.file, `bons-commande/${slugBC(e.fournisseur)}-${slugBC(numero)}-${Date.now().toString(36)}.pdf`);
      // Total : préférer la somme des lignes si l'en-tête n'a rien donné.
      const totalLignes = e.lignes.reduce((t, l) => t + l.totalLigne, 0);
      const total = e.total > 0 ? e.total : Math.round(totalLignes * 100) / 100;
      const enFrancs = e.devise === "CDF";
      await prisma.bonDeCommande.create({
        data: { numero, sequence: e.sequence, annee: e.annee, mois: e.mois, date: e.date ? new Date(e.date) : jourCivilKinshasa(new Date()),
          fournisseurId: parNom.get(normNom(e.fournisseur)) ?? null, statut: "VALIDE", devise: e.devise,
          // Dollars : comme avant. Francs : le total lu, tel quel ; aucun total en dollars (contrainte en base).
          totalUSD: enFrancs ? null : total, ...(enFrancs ? { totalCDF: total } : {}),
          documentUrl: url, creeParId: user.id,
          lignes: { create: e.lignes.map((l) => ({ designation: l.designation, unite: l.unite, quantite: l.quantite,
            ...(enFrancs ? { prixUnitaireCDF: l.prixUnitaire, totalLigneCDF: l.totalLigne } : { prixUnitaireUSD: l.prixUnitaire, totalLigneUSD: l.totalLigne }) })) } },
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
});
/** Une colonne de nombres d'un tableau de lignes : illisible → refus lisible qui nomme la colonne et la ligne. */
const colonne = (fd: FormData, nom: string, libelle: string) => fd.getAll(nom).map((v, i) => decSaisi(v, `${libelle}, ligne ${i + 1}`));
/** Idem, mais une case VIDE reste vide (null) : une ligne sans prix n'a pas un prix de 0. */
const colonneOptionnelle = (fd: FormData, nom: string, libelle: string) => fd.getAll(nom).map((v, i) => decSaisiOptionnel(v, `${libelle}, ligne ${i + 1}`));
/** Total d'une ligne ; null sans prix. Total du bon = somme des lignes CHIFFRÉES (le bon est annoncé incomplet sinon). */
const totalLigne = (quantite: number, prix: number | null) => (prix === null ? null : quantite * prix);
const totalDesLignes = (ls: { quantite: number; prixUnitaireUSD: number | null }[]) => ls.reduce((t, l) => t + (l.prixUnitaireUSD === null ? 0 : l.quantite * l.prixUnitaireUSD), 0);
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
export const creerBonCommande = actionLisible(async (formData: FormData) => {
  const user = await garde();
  const fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;

  const ids = formData.getAll("ligne_articleId").map(String);
  const desigs = formData.getAll("ligne_designation").map((v) => String(v).trim());
  const qtes = colonne(formData, "ligne_quantite", "quantité");
  const prixs = colonneOptionnelle(formData, "ligne_prix", "prix");
  const cartons = colonne(formData, "ligne_uniteParCarton", "unités par carton");

  const lignes = desigs
    .map((designation, i) => ({
      articleId: ids[i] || null,
      designation,
      quantite: qtes[i] ?? 0,
      prixUnitaireUSD: prixs[i] ?? null, // vide = SANS PRIX (null), jamais 0
      uniteParCarton: cartons[i] || null,
    }))
    .filter((l) => l.designation && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (désignation + quantité).");

  const totalUSD = totalDesLignes(lignes);
  const nbSansPrix = lignes.filter((l) => l.prixUnitaireUSD === null).length;
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = config ? Number(config.tauxChangeCDF) : null;

  const now = jourCivilKinshasa(new Date()); // le numéro du bon suit le mois de Kinshasa
  const annee = now.getUTCFullYear();
  const mois = now.getUTCMonth() + 1;

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
    const numero = `${String(sequence).padStart(3, "0")}/PEF/${tag ? `${tag}/` : ""}${MOIS_FR[mois - 1].toUpperCase()}/${String(annee).slice(-2)}`;
    return tx.bonDeCommande.create({
      data: {
        numero, sequence, annee, mois,
        date: now, // jour civil de Kinshasa, explicite : le défaut de la base (now() UTC) daterait la veille
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
            totalLigneUSD: totalLigne(l.quantite, l.prixUnitaireUSD),
          })),
        },
      },
    });
  });

  await journaliser(prisma, { entite: "BonDeCommande", entiteId: bc.id, champ: "creation", nouvelleValeur: bc.numero, userId: user.id });

  // Cloche TOUJOURS émise (choix client : trace visible de chaque bon, même auto-validé) :
  // « à valider » quand un autre rôle l'émet, « créé et validé » quand la Direction auto-valide.
  if (autoValide) {
    await creerNotification({ domaine: "STOCK", type: "AUTRE", message: `Bon de commande ${bc.numero}${four ? ` — ${four.nom}` : ""} créé et validé (${libelleTotalBon({ totalUSD }, nbSansPrix, lignes.length)})`, lien: `/stock/commandes/${bc.id}`, refId: bc.id });
  } else if (user.role !== "ADMIN") {
    await creerNotification({ domaine: "STOCK", type: "AUTRE", message: `Nouveau bon de commande ${bc.numero}${four ? ` — ${four.nom}` : ""} à valider (${libelleTotalBon({ totalUSD }, nbSansPrix, lignes.length)})`, lien: "/stock/a-valider", refId: bc.id });
  }

  revalidatePath("/stock/commandes");
  revalidatePath("/stock/a-valider");
  redirect(`/stock/commandes/${bc.id}`);
});

/** Modifie un bon de commande encore à l'état BROUILLON (remplace ses lignes et son en-tête). */
export const modifierBonCommande = actionLisible(async (id: string, formData: FormData) => {
  const user = await garde();
  const bc = await prisma.bonDeCommande.findUniqueOrThrow({ where: { id }, select: { statut: true } });
  if (bc.statut !== "BROUILLON") throw new Error("Seul un brouillon peut être modifié.");

  const fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;
  const ids = formData.getAll("ligne_articleId").map(String);
  const desigs = formData.getAll("ligne_designation").map((v) => String(v).trim());
  const qtes = colonne(formData, "ligne_quantite", "quantité");
  const prixs = colonneOptionnelle(formData, "ligne_prix", "prix");
  const cartons = colonne(formData, "ligne_uniteParCarton", "unités par carton");

  const lignes = desigs
    .map((designation, i) => ({ articleId: ids[i] || null, designation, quantite: qtes[i] ?? 0, prixUnitaireUSD: prixs[i] ?? null, uniteParCarton: cartons[i] || null }))
    .filter((l) => l.designation && l.quantite > 0);
  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (désignation + quantité).");

  const totalUSD = totalDesLignes(lignes);
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = config ? Number(config.tauxChangeCDF) : null;

  // Les lignes sont REMPLACÉES (modification) ; mais un formulaire qui en compte MOINS en retire une :
  // c'est une suppression, réservée à la Direction (règle de Sacha, 2026-10-01), même sur un brouillon.
  const nbAvant = await prisma.ligneBonDeCommande.count({ where: { bonDeCommandeId: id } });
  if (lignes.length < nbAvant) {
    exigerDirectionPourSupprimer(user, "Retirer une ligne d'un bon de commande est réservé à la Direction : mettez sa quantité à jour, ou demandez à la Direction.");
  }

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
            totalLigneUSD: totalLigne(l.quantite, l.prixUnitaireUSD),
          })),
        },
      },
    });
  });

  await journaliser(prisma, { entite: "BonDeCommande", entiteId: id, champ: "modification", nouvelleValeur: `${lignes.length} ligne(s)`, userId: user.id });
  revalidatePath(`/stock/commandes/${id}`);
  revalidatePath("/stock/commandes");
  redirect(`/stock/commandes/${id}`);
});

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
  // Cloche « validé » TOUJOURS émise (choix client : trace visible même en auto-validation) + push à l'auteur.
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
  await supprimerNotificationsPour(id);
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: id, champ: "suppression", ancienneValeur: bc.numero, userId: user.id });
  revalidatePath("/stock/commandes");
  redirect("/stock/commandes");
}

/** Change le statut d'un bon de commande. */
export async function changerStatutBonCommande(id: string, formData: FormData) {
  await formulaireLisible(`/stock/commandes/${id}`, async () => {
    const user = await garde();
    const statut = String(formData.get("statut") ?? "") as Statut;
    if (!STATUTS.includes(statut)) throw new Error("Statut invalide.");
    // ANNULER un bon le fait disparaître (archives, rattachement des factures, PDF) ; le REPASSER en
    // brouillon contourne sa validation par la Direction : l'un et l'autre lui sont réservés
    // (arbitrage du 2026-10-01). Les corrections de réception (envoyé, reçu…) restent ouvertes.
    const avant = await prisma.bonDeCommande.findUniqueOrThrow({ where: { id }, select: { statut: true } });
    if (statut === "ANNULE" || (statut === "BROUILLON" && avant.statut !== "BROUILLON")) {
      exigerDirectionPourSupprimer(user, "Annuler un bon de commande, ou le repasser en brouillon, est réservé à la Direction.");
    }
    await prisma.bonDeCommande.update({ where: { id }, data: { statut } });
    await journaliser(prisma, { entite: "BonDeCommande", entiteId: id, champ: "statut", ancienneValeur: avant.statut, nouvelleValeur: statut, userId: user.id });
    revalidatePath("/stock/commandes");
    revalidatePath(`/stock/commandes/${id}`);
  });
}

/**
 * Réceptionne un bon de commande : enregistre la réception (marchandise arrivée) PAR LIGNE. Les quantités
 * saisies s'ajoutent au cumul reçu de chaque ligne (`quantiteRecue`) ; le statut se calcule sur ce cumul —
 * « Reçu partiel » tant qu'une ligne n'est pas entièrement reçue, « Reçu » quand toutes le sont. Les lignes
 * libres (sans article du catalogue) se réceptionnent comme les autres : comptées, sans effet sur le stock.
 * NE TOUCHE PAS AU STOCK — l'entrée en stock se fait uniquement à l'enregistrement de la FACTURE fournisseur
 * (articles + quantités) ou via la liste d'achat (par la porte unique stock-positif.ts). La réception et
 * l'entrée en stock sont volontairement différenciées.
 *
 * Refusée sur un bon brouillon, annulé ou déjà entièrement reçu. Le bon est verrouillé le temps du calcul :
 * deux réceptions simultanées ne s'écrasent pas (le cumul reste exact).
 */
export const receptionnerBonCommande = actionLisible(async (bcId: string, formData: FormData) => {
  const user = await garde();
  const ligneIds = formData.getAll("recu_ligneId").map(String);
  const qtes = formData.getAll("recu_quantite").map((v, i) => decSaisi(v, `quantité reçue, ligne ${i + 1}`)); // illisible : refus lisible

  const r = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "stock"."BonDeCommande" WHERE "id" = ${bcId} FOR UPDATE`;
    const bc = await tx.bonDeCommande.findUnique({ where: { id: bcId }, include: { lignes: true, fournisseur: { select: { nom: true } } } });
    if (!bc) throw new Error("Bon de commande introuvable : il a peut-être été supprimé.");
    exigerBonReceptionnable(bc.statut);
    const recu = lireQuantitesRecues(ligneIds, qtes, bc.lignes);
    const calcul = appliquerReception(bc.lignes, recu);
    for (const m of calcul.maj) await tx.ligneBonDeCommande.update({ where: { id: m.id }, data: { quantiteRecue: m.quantiteRecue } });
    await tx.reception.create({ data: { bonDeCommandeId: bcId, date: jourCivilKinshasa(new Date()), creeParId: user.id } }); // date explicite : le défaut de la base est le jour UTC
    await tx.bonDeCommande.update({ where: { id: bcId }, data: { statut: calcul.complet ? "RECU" : "RECU_PARTIEL" } });
    return { bc, nb: calcul.maj.length, complet: calcul.complet, restes: calcul.restes };
  });

  // Arrivée de marchandise par un compte non-Direction : notifiée à la Direction (2026-10-07), jamais bloquante.
  await notifierGesteStock(user, { genre: "RECEPTION", bonDeCommandeId: bcId, numero: r.bc.numero, fournisseurNom: r.bc.fournisseur?.nom ?? null, nbLignes: r.nb, complete: r.complet });
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: bcId, champ: "reception", nouvelleValeur: `${r.nb} ligne(s)${r.complet ? " — bon reçu en totalité" : ` — reste à recevoir : ${r.restes.length} ligne(s)`}`, userId: user.id });
  revalidatePath(`/stock/commandes/${bcId}`);
  revalidatePath("/stock/commandes");
});

/** Valide plusieurs bons de commande à l'état BROUILLON d'un coup (Direction). */
export const validerBonsEnLot = actionLisible(async (ids: string[]) => {
  const user = await garde();
  requireRole(user, ["ADMIN"]);
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  const bcs = await prisma.bonDeCommande.findMany({ where: { id: { in: uniq }, statut: "BROUILLON" }, select: { id: true, numero: true, creeParId: true } });
  if (bcs.length === 0) return;
  await prisma.bonDeCommande.updateMany({ where: { id: { in: bcs.map((b) => b.id) } }, data: { statut: "VALIDE" } });
  for (const b of bcs) {
    await supprimerNotificationsPour(b.id);
    // Cloche « validé » TOUJOURS émise (choix client : trace visible même en auto-validation).
    await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `Bon de commande ${b.numero} validé`, lien: `/stock/commandes/${b.id}`, refId: b.id } });
  }
  await journaliser(prisma, { entite: "BonDeCommande", entiteId: "lot", champ: "statut", nouvelleValeur: `${bcs.length} validé(s)`, userId: user.id });
  revalidatePath("/stock/commandes");
  revalidatePath("/stock/a-valider");
  revalidatePath("/stock");
});

/** Supprime plusieurs bons de commande d'un coup (Direction). */
export const supprimerBonsEnLot = actionLisible(async (ids: string[]) => {
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
});
