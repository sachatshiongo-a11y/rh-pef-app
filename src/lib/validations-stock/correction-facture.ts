import "server-only";

// CORRECTION D'UNE FACTURE FOURNISSEUR — « modifier l'en-tête » et « annuler ce paiement » (audit du
// 10/10/2026, constat 11 : une faute de frappe sur un numéro, une date, un fournisseur, ou un paiement
// enregistré par erreur ne se corrigeait que par suppression de la facture entière — avec reprise du stock).
//
// Réservé à la Direction (les actions serveur le gardent, ces fonctions n'en sont jamais exportées vers
// un fichier « use server »). Chaque correction :
//  - lit la facture SOUS VERROU (`FOR UPDATE`) et refuse si un paiement est déjà demandé à la Direction ;
//  - respecte la DEVISE de la facture (jamais convertie : le montant corrigé est dans sa devise) ;
//  - respecte la CLÔTURE du stock : la date d'une facture ne quitte ni n'entre dans un mois figé ; une facture
//    qui a fait entrer du stock garde sa date (la date d'un mouvement ne change que par le cœur des sorties) ;
//  - recalcule le reste à payer et le statut ;
//  - est journalisée AVANT → APRÈS, un champ par ligne de journal.
// Le montant n'est modifiable que si RIEN n'en dépend (ni ligne d'articles, ni entrée en stock) : sinon
// il resterait en désaccord avec ses lignes et son stock — le refus l'explique.

import type { Prisma } from "@prisma/client";
import { journaliser, journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { exigerPeriodesOuvertes } from "@/lib/cloture-stock";
import { formaterMontantFacture, montantsFacture } from "@/lib/facture-devise";
import { chercherDoublonFacture } from "@/lib/facture-doublon";
import { facturesDuFournisseur } from "@/lib/facture-doublon-serveur";
import { exigerAucunPaiementDemande } from "./demandes";
import { statutDe, verrouillerFacture } from "./reglement";
import { STATUT_FACTURE_LABEL } from "@/lib/stock";
import { alimenterFournisseursTx } from "@/lib/article-fournisseurs";

type Tx = Prisma.TransactionClient;

/** Ce que la personne a saisi : une clé absente = « je n'y touche pas » ; seules les VRAIES différences sont écrites. */
export type CorrectionEntete = {
  numero?: string | null;
  /** AAAA-MM-JJ ; chaîne vide ou null = pas de date. */
  date?: string | null;
  dateEcheance?: string | null;
  /** Identifiant d'un fournisseur existant. */
  fournisseurId?: string | null;
  /** Dans la devise de la facture (jamais convertie). */
  montant?: number | null;
};

const jjmmaaaa = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const arr2 = (n: number) => Math.round(n * 100) / 100;

function lireJour(v: string | null | undefined, quoi: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error(`${quoi} illisible : écrivez une date valide.`);
  return s;
}

export type ResultatCorrection = { changements: string[] };

/** Corrige l'en-tête d'une facture. Jette une `Error` au message lisible ; rien n'est écrit en cas de refus. */
export async function corrigerEnteteFactureTx(tx: Tx, userId: string, id: string, patch: CorrectionEntete): Promise<ResultatCorrection> {
  const f = await verrouillerFacture(tx, id);
  await exigerAucunPaiementDemande(tx, [id]);
  const m = montantsFacture(f);
  const dev = m.devise;
  const journal: EntreeJournal[] = [];
  const data: Prisma.FactureFournisseurUncheckedUpdateInput = {};
  const changements: string[] = [];
  const noter = (champ: string, avant: string | null, apres: string | null) => {
    journal.push({ entite: "FactureFournisseur", entiteId: id, champ: `correction ${champ}`, ancienneValeur: avant ?? "—", nouvelleValeur: apres ?? "—", userId });
    changements.push(`${champ} : ${avant ?? "—"} → ${apres ?? "—"}`);
  };

  // Ce dont dépend la facture : ses lignes d'articles, ses entrées en stock, ses paiements.
  const [nbLignes, entrees, paiements] = await Promise.all([
    tx.ligneFacture.count({ where: { factureId: id } }),
    tx.mouvementStock.findMany({ where: { factureId: id, type: "ENTREE" }, select: { id: true, date: true } }),
    tx.paiement.findMany({ where: { factureId: id }, select: { date: true } }),
  ]);

  // ── Fournisseur ──
  let fournisseurId = f.fournisseurId;
  let fournisseurNom = f.fournisseurNom;
  if (patch.fournisseurId !== undefined && patch.fournisseurId !== null && patch.fournisseurId !== "" && patch.fournisseurId !== f.fournisseurId) {
    const nouveau = await tx.fournisseur.findUnique({ where: { id: patch.fournisseurId }, select: { id: true, nom: true } });
    if (!nouveau) throw new Error("Ce fournisseur n'existe plus : choisissez-le à nouveau.");
    if (f.bonDeCommandeId) {
      const bc = await tx.bonDeCommande.findUnique({ where: { id: f.bonDeCommandeId }, select: { fournisseurId: true, numero: true } });
      if (bc?.fournisseurId && bc.fournisseurId !== nouveau.id) throw new Error(`Cette facture est liée au bon de commande ${bc.numero}, d'un autre fournisseur : détachez d'abord le bon de commande, puis changez le fournisseur.`);
    }
    noter("fournisseur", f.fournisseurNom, nouveau.nom);
    fournisseurId = nouveau.id; fournisseurNom = nouveau.nom;
    data.fournisseurId = nouveau.id; data.fournisseurNom = nouveau.nom;
  }

  // ── Numéro ──
  let numero = f.numero;
  if (patch.numero !== undefined) {
    const n = (patch.numero ?? "").trim() || null;
    if (n !== f.numero) { noter("numéro", f.numero, n); numero = n; data.numero = n; }
  }
  // Numéro ou fournisseur changés : le numéro reste unique chez son fournisseur (refus sec, comme à la saisie).
  if ((data.numero !== undefined || data.fournisseurId !== undefined) && numero) {
    const autres = (await facturesDuFournisseur(tx, { fournisseurId, fournisseurNom })).filter((x) => x.id !== id);
    const dbl = chercherDoublonFacture({ fournisseurId, fournisseurNom, numero, date: null, annee: f.annee, mois: f.mois, devise: dev, montant: -1 }, autres);
    if (dbl?.type === "MEME_NUMERO") throw new Error(`Ce fournisseur a déjà une facture n° ${dbl.facture.numero} : un numéro de facture est unique chez un fournisseur. Rien n'a été modifié.`);
  }

  // ── Date de la facture ──
  const dateAvant = iso(f.date);
  if (patch.date !== undefined) {
    const nouvelle = lireJour(patch.date, "La date de la facture");
    if (nouvelle !== dateAvant) {
      if (nouvelle) {
        const premier = paiements.map((p) => iso(p.date)!).sort()[0];
        if (premier && premier < nouvelle) throw new Error(`Un paiement est daté du ${jjmmaaaa(premier)} : la facture ne peut pas être datée après (${jjmmaaaa(nouvelle)}). Corrigez ou annulez d'abord ce paiement.`);
      }
      // Les entrées en stock portent la date de la facture, et la DATE d'un mouvement ne change que par le cœur
      // gardé des sorties (règle de la Direction du 2026-10-08, chemins-ecriture.garde-fou) : une facture qui a
      // fait entrer du stock garde donc sa date. Refus expliqué, jamais une date qui s'écarte de ses entrées.
      if (entrees.length > 0) {
        throw new Error(
          `Cette facture a fait entrer ${entrees.length} article(s) en stock à sa date (${jjmmaaaa(dateAvant)}) : la date d'un mouvement de stock ne se déplace pas (les consommations, comptages et clôtures s'appuient dessus). ` +
            `Pour la corriger, supprimez la facture (le stock entré est repris) et saisissez-la à nouveau. Rien n'a été modifié.`
        );
      }
      // Clôture : la date d'une facture ne quitte ni n'entre dans une période figée (l'instantané de clôture ne doit pas mentir).
      await exigerPeriodesOuvertes([...(dateAvant ? [new Date(dateAvant)] : []), ...(nouvelle ? [new Date(nouvelle)] : [])]);
      noter("date", dateAvant ? jjmmaaaa(dateAvant) : null, nouvelle ? jjmmaaaa(nouvelle) : null);
      data.date = nouvelle ? new Date(nouvelle) : null;
      if (nouvelle) { data.annee = Number(nouvelle.slice(0, 4)); data.mois = Number(nouvelle.slice(5, 7)); }
    }
  }

  // ── Échéance ──
  const echeanceAvant = iso(f.dateEcheance);
  let echeanceApres = echeanceAvant;
  if (patch.dateEcheance !== undefined) {
    const nouvelle = lireJour(patch.dateEcheance, "L'échéance");
    if (nouvelle !== echeanceAvant) {
      noter("échéance", echeanceAvant ? jjmmaaaa(echeanceAvant) : null, nouvelle ? jjmmaaaa(nouvelle) : null);
      echeanceApres = nouvelle;
      data.dateEcheance = nouvelle ? new Date(nouvelle) : null;
    }
  }

  // ── Montant (dans la devise de la facture) ──
  let reste = m.reste;
  if (patch.montant !== undefined && patch.montant !== null && Math.abs(patch.montant - m.montant) >= 0.005) {
    if (nbLignes > 0 || entrees.length > 0) {
      const dep = [nbLignes > 0 ? `${nbLignes} ligne(s) d'articles` : null, entrees.length > 0 ? `${entrees.length} entrée(s) en stock` : null].filter(Boolean).join(" et ");
      throw new Error(
        `Le montant de cette facture est la somme de ses lignes, et ${dep} en dépend${nbLignes > 0 && entrees.length > 0 ? "ent" : ""} : le modifier ici le laisserait en désaccord avec elles et avec le stock. ` +
          `Pour le corriger, supprimez la facture (le stock entré est repris) et saisissez-la à nouveau. Rien n'a été modifié.`
      );
    }
    const nouveau = arr2(patch.montant);
    if (!(nouveau > 0)) throw new Error("Le montant d'une facture doit être supérieur à 0.");
    if (nouveau < m.regle - 0.001) throw new Error(`Le nouveau montant (${formaterMontantFacture(nouveau, dev)}) est inférieur au déjà payé (${formaterMontantFacture(m.regle, dev)}) : annulez d'abord le paiement en trop.`);
    reste = Math.max(0, arr2(nouveau - m.regle));
    noter("montant", formaterMontantFacture(m.montant, dev), formaterMontantFacture(nouveau, dev));
    Object.assign(data, dev === "CDF" ? { montantCDF: nouveau, resteAPayerCDF: reste } : { montantUSD: nouveau, resteAPayerUSD: reste });
  }

  if (changements.length === 0) throw new Error("Aucune modification : les valeurs saisies sont celles de la facture.");

  // Reste et statut recalculés (échéance ou montant changés) ; une facture qui n'est plus soldée n'a plus de date de paiement.
  const ancienStatut = f.statut;
  const statut = statutDe(reste, echeanceApres);
  if (statut !== ancienStatut) data.statut = statut;
  if (reste > 0.001 && f.datePaiement) data.datePaiement = null;

  await tx.factureFournisseur.update({ where: { id }, data });
  // Fournisseur corrigé : le bon fournisseur rejoint la liste des articles facturés (fait constaté, sans validation).
  // L'ancien, saisi par erreur, n'est pas retiré en silence : la Direction le retire de la fiche de l'article si besoin.
  if (data.fournisseurId && fournisseurId) {
    const lignes = await tx.ligneFacture.findMany({ where: { factureId: id, articleId: { not: null } }, select: { articleId: true } });
    await alimenterFournisseursTx(tx, lignes.map((l) => ({ articleId: l.articleId, fournisseurId })), "FACTURE", userId);
  }
  if (statut !== ancienStatut) journal.push({ entite: "FactureFournisseur", entiteId: id, champ: "correction statut", ancienneValeur: STATUT_FACTURE_LABEL[ancienStatut], nouvelleValeur: STATUT_FACTURE_LABEL[statut], userId });
  await journaliserPlusieurs(tx, journal);
  return { changements };
}

/** Annule un paiement (ou un avoir) enregistré par erreur : la ligne disparaît, le réglé et le reste sont recalculés, dans la devise de la facture. */
export async function annulerPaiementTx(tx: Tx, userId: string, paiementId: string): Promise<{ factureId: string; resume: string }> {
  const trouve = await tx.paiement.findUnique({ where: { id: paiementId }, select: { factureId: true } });
  if (!trouve) throw new Error("Ce paiement n'existe plus (déjà annulé dans un autre onglet ?). Rechargez la page.");
  const f = await verrouillerFacture(tx, trouve.factureId);
  await exigerAucunPaiementDemande(tx, [f.id]);
  const p = await tx.paiement.findUnique({ where: { id: paiementId } });
  if (!p) throw new Error("Ce paiement vient d'être annulé par un autre geste. Rechargez la page.");
  const m = montantsFacture(f);
  const dev = m.devise;
  // Le montant IMPUTÉ est celui de la devise de la facture (l'autre colonne, s'il y en a une, est ce qui a été versé).
  const impute = Number(dev === "CDF" ? p.montantCDF : p.montantUSD);
  if (!Number.isFinite(impute)) throw new Error("Ce paiement n'a pas de montant dans la devise de la facture : impossible de l'annuler automatiquement.");
  // Décrément et non recalcul depuis les lignes de paiement : un réglé ancien sans ligne de paiement (import) ne s'efface pas.
  const regle = Math.max(0, arr2(m.regle - impute));
  const reste = Math.min(m.montant, Math.max(0, arr2(m.montant - regle)));
  const echeanceISO = iso(f.dateEcheance);
  const statut = statutDe(reste, echeanceISO);
  const restants = await tx.paiement.findMany({ where: { factureId: f.id, id: { not: paiementId } }, select: { date: true }, orderBy: { date: "desc" }, take: 1 });
  await tx.paiement.delete({ where: { id: paiementId } });
  await tx.factureFournisseur.update({
    where: { id: f.id },
    data: {
      ...(dev === "USD" ? { montantRegleUSD: regle, resteAPayerUSD: reste } : { montantRegleCDF: regle, resteAPayerCDF: reste }),
      statut,
      datePaiement: reste > 0.001 ? null : (restants[0]?.date ?? f.datePaiement),
    },
  });
  const quoi = `${p.type === "AVOIR" ? "avoir" : "paiement"} de ${formaterMontantFacture(impute, dev)} du ${jjmmaaaa(iso(p.date))}`;
  const resume = `${quoi} annulé — reste ${formaterMontantFacture(m.reste, dev)} → ${formaterMontantFacture(reste, dev)}, statut ${STATUT_FACTURE_LABEL[f.statut]} → ${STATUT_FACTURE_LABEL[statut]}`;
  await journaliser(tx, { entite: "FactureFournisseur", entiteId: f.id, champ: "annulation de paiement", ancienneValeur: quoi, nouvelleValeur: resume, userId });
  return { factureId: f.id, resume };
}
