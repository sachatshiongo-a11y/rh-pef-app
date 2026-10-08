import "server-only";

// APERÇU DES DEMANDES pour l'écran « Demandes à valider » : ce que la Direction doit voir pour
// décider (factures et restes, écarts de comptage et leur valeur, avant/après champ par champ) ET
// ce qui a changé depuis la demande (conflit prévisible), calculé avec les MÊMES règles que la
// validation (`etatLigneAValider`, `valeursEgales`) — l'écran n'annonce pas une validation que le
// serveur refuserait, ni l'inverse. Données simples et sérialisables (passées à un composant client).

import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CHAMPS_ARTICLE, cleArticle, cleFacture, libelleValeur, lireChargeOuNull, valeursEgales, type NatureDemande } from "./charge";
import { aUnEcart, etatLigneAValider, mouvementsDepuis } from "./comptage";
import { francsPourReste } from "./reglement";

export type ApercuFacture = { id: string; nom: string; numero: string | null; resteDemande: number; resteActuel: number | null; reglee: boolean };
export type ApercuLigneComptage = {
  articleId: string; designation: string; unite: string | null; explication: string;
  theorique: string; physique: string; ecart: string; valeur: number | null;
  actuel: string; final: string | null; etat: "inchange" | "mouvemente" | "conflit"; raison: string | null;
};
export type ApercuChangement = { libelle: string; avant: string; apres: string; actuel: string | null };
export type ApercuDemande = {
  id: string; nature: NatureDemande; statut: string; resume: string;
  /** Jeton de version (updatedAt ISO) : renvoyé à la décision, qui refuse une demande retouchée depuis. */
  version: string;
  auteurId: string; auteurNom: string; creeLe: string;
  decideurNom: string | null; decideLe: string | null; motifRefus: string | null;
  illisible: boolean;
  alertes: string[]; // ce qui empêchera la validation (constaté maintenant)
  paiement: null | {
    mode: "SOLDE" | "LOT" | "REGLEMENT"; date: string; total: number | null; factures: ApercuFacture[];
    /** En francs : `montantUSD` = équivalent au taux des Paramètres d'AUJOURD'HUI (`tauxActuel`, null s'il manque) — celui qui sera appliqué si la Direction valide maintenant. */
    reglement: null | { type: string; montantUSD: number | null; montantCDF: number | null; tauxActuel: number | null; mode: string | null; note: string | null; resteApres: number | null };
    /** LOT payé en francs : francs à verser au taux d'AUJOURD'HUI (null sans taux) — celui de la validation s'il a lieu maintenant. */
    lotFrancs: null | { totalCDF: number | null; tauxActuel: number | null };
  };
  comptage: null | { origine: string; nbLignes: number; valeurTotale: number | null; lignes: ApercuLigneComptage[] };
  article: null | { articles: { id: string; designation: string; changements: ApercuChangement[] }[] };
  mouvement: null | {
    type: "ENTREE" | "SORTIE"; origine: string; date: string;
    /** Articles sur lesquels un mouvement manuel du même sens a été saisi DEPUIS la demande (double saisie possible). */
    saisisDepuis: string[];
    lignes: { articleId: string; designation: string; unite: string | null; quantite: string; actuel: string; apres: string; valeur: number | null }[];
  };
};

const ISO = (d: Date) => d.toISOString();

/** Aperçus des demandes (ordre conservé). `detail` : calcule l'état actuel (demandes en attente). */
export async function apercusDemandes(where: Prisma.DemandeValidationStockWhereInput, opts: { take?: number; detail?: boolean } = {}): Promise<ApercuDemande[]> {
  const demandes = await prisma.demandeValidationStock.findMany({ where, orderBy: { createdAt: opts.detail ? "asc" : "desc" }, take: opts.take });
  const res: ApercuDemande[] = [];
  for (const d of demandes) {
    const base: ApercuDemande = {
      id: d.id, nature: d.nature, statut: d.statut, resume: d.resume, version: ISO(d.updatedAt), auteurId: d.auteurId, auteurNom: d.auteurNom, creeLe: ISO(d.createdAt),
      decideurNom: d.decideurNom, decideLe: d.decideLe ? ISO(d.decideLe) : null, motifRefus: d.motifRefus,
      illisible: false, alertes: [], paiement: null, comptage: null, article: null, mouvement: null,
    };
    const charge = lireChargeOuNull(d.nature, d.charge);
    if (!charge) { res.push({ ...base, illisible: true, alertes: ["Demande illisible : elle ne peut pas être exécutée — refusez-la."] }); continue; }
    if (!opts.detail) { res.push(base); continue; }

    if (d.nature === "PAIEMENT_FACTURE" && "mode" in charge) {
      const actuelles = new Map((await prisma.factureFournisseur.findMany({ where: { id: { in: charge.factures.map((f) => f.id) } }, select: { id: true, statut: true, resteAPayerUSD: true } })).map((f) => [f.id, f]));
      const factures = charge.factures.map((f) => {
        const a = actuelles.get(f.id);
        const nom = `${f.numero ? `N° ${f.numero}` : "Sans numéro"} — ${f.fournisseurNom}`;
        if (!a) base.alertes.push(`${nom} : facture supprimée depuis la demande.`);
        else if (a.statut === "REGLEE" || Number(a.resteAPayerUSD) <= 0.001) base.alertes.push(`${nom} : déjà réglée depuis la demande.`);
        else if (!new Decimal(a.resteAPayerUSD.toString()).equals(new Decimal(f.resteUSD))) base.alertes.push(`${nom} : le reste à payer a changé depuis la demande.`);
        return { id: f.id, nom: f.fournisseurNom, numero: f.numero, resteDemande: Number(f.resteUSD), resteActuel: a ? Number(a.resteAPayerUSD) : null, reglee: a ? a.statut === "REGLEE" : false };
      });
      const r = charge.reglement;
      let reglement: NonNullable<ApercuDemande["paiement"]>["reglement"] = null;
      if (r) {
        const cdf = r.montantCDF === null ? null : Number(r.montantCDF);
        let tauxActuel: number | null = null, usd: number | null = r.montantUSD === null ? null : Number(r.montantUSD);
        if (cdf !== null) {
          const config = await prisma.config.findUnique({ where: { id: "singleton" }, select: { tauxChangeCDF: true } });
          tauxActuel = Number(config?.tauxChangeCDF ?? 0) || null;
          usd = tauxActuel ? Math.round((cdf / tauxActuel) * 100) / 100 : null;
          if (!tauxActuel) base.alertes.push("Taux de change non configuré (Paramètres) : le paiement en francs ne peut pas être converti.");
        }
        const reste = factures[0]?.resteActuel;
        if (usd !== null && reste !== null && reste !== undefined && usd > reste + 0.009) base.alertes.push(`Le montant dépasse aujourd'hui le reste à payer (${usd.toFixed(2)} $ > ${reste.toFixed(2)} $).`);
        const resteApres = usd !== null && reste !== null && reste !== undefined ? Math.max(0, Math.round((reste - usd) * 100) / 100) : null;
        reglement = { type: r.type, montantUSD: usd, montantCDF: cdf, tauxActuel, mode: r.modePaiement, note: r.note, resteApres };
      }
      let lotFrancs: NonNullable<ApercuDemande["paiement"]>["lotFrancs"] = null;
      if (charge.enFrancs) {
        const config = await prisma.config.findUnique({ where: { id: "singleton" }, select: { tauxChangeCDF: true } });
        const t = Number(config?.tauxChangeCDF ?? 0) || null;
        if (!t) base.alertes.push("Taux de change non configuré (Paramètres) : le lot en francs ne peut pas être converti.");
        lotFrancs = { tauxActuel: t, totalCDF: t ? factures.reduce((x, f) => x + francsPourReste(f.resteDemande, t), 0) : null };
      }
      base.paiement = {
        mode: charge.mode, date: charge.date, factures, reglement, lotFrancs,
        total: reglement ? reglement.montantUSD : factures.reduce((t, f) => t + f.resteDemande, 0),
      };
    } else if (d.nature === "MOUVEMENT_MANUEL" && "type" in charge) {
      const ids = charge.lignes.map((l) => l.articleId);
      const [stocks, existants] = await Promise.all([
        prisma.stock.findMany({ where: { articleId: { in: ids } }, select: { articleId: true, quantite: true } }),
        prisma.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true } }),
      ]);
      const actuel = new Map(stocks.map((x) => [x.articleId, new Decimal(x.quantite.toString())]));
      const vivants = new Set(existants.map((a) => a.id));
      const signe = charge.type === "ENTREE" ? 1 : -1;
      // Depuis le 2026-10-07 le demandeur saisit en direct : il a peut-être ressaisi ce même mouvement.
      const depuis = await prisma.mouvementStock.findMany({ where: { articleId: { in: ids }, type: charge.type, createdAt: { gt: d.createdAt }, factureId: null }, select: { articleId: true }, distinct: ["articleId"] });
      const saisisDepuis = charge.lignes.filter((l) => depuis.some((x) => x.articleId === l.articleId)).map((l) => l.designation);
      base.mouvement = {
        type: charge.type, origine: charge.origine, date: charge.date, saisisDepuis,
        lignes: charge.lignes.map((l) => {
          if (!vivants.has(l.articleId)) base.alertes.push(`« ${l.designation} » n'existe plus.`);
          const a = actuel.get(l.articleId) ?? new Decimal(0);
          const q = new Decimal(l.quantite);
          return {
            articleId: l.articleId, designation: l.designation, unite: l.unite, quantite: l.quantite,
            actuel: a.toString(), apres: a.plus(q.times(signe)).toString(),
            valeur: l.prixUnitaireUSD === null ? null : q.times(signe).times(new Decimal(l.prixUnitaireUSD)).toNumber(),
          };
        }),
      };
    } else if (d.nature === "RECONCILIATION" && "lignes" in charge && !("type" in charge)) {
      const ecarts = charge.lignes.filter((l) => aUnEcart({ ecart: Number(l.physique) - Number(l.theorique) }));
      const ids = ecarts.map((l) => l.articleId);
      const [stocks, existants, depuis] = await Promise.all([
        prisma.stock.findMany({ where: { articleId: { in: ids } }, select: { articleId: true, quantite: true } }),
        prisma.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true } }),
        mouvementsDepuis(prisma, ids, d.createdAt),
      ]);
      const actuel = new Map(stocks.map((s) => [s.articleId, new Decimal(s.quantite.toString())]));
      const vivants = new Set(existants.map((a) => a.id));
      let valeurTotale: number | null = 0;
      const lignes: ApercuLigneComptage[] = ecarts.map((l) => {
        const ecart = new Decimal(l.physique).minus(new Decimal(l.theorique));
        const valeur = l.prixUnitaireUSD === null ? null : ecart.times(new Decimal(l.prixUnitaireUSD)).toNumber();
        if (valeur === null) valeurTotale = null; else if (valeurTotale !== null) valeurTotale += valeur;
        const a = actuel.get(l.articleId) ?? new Decimal(0);
        if (!vivants.has(l.articleId)) {
          base.alertes.push(`« ${l.designation} » n'existe plus.`);
          return { ...l, ecart: ecart.toString(), valeur, actuel: a.toString(), final: null, etat: "conflit" as const, raison: "article supprimé ou fusionné" };
        }
        const e = etatLigneAValider(l, a, depuis.get(l.articleId)!);
        if (e.etat === "conflit") base.alertes.push(`« ${l.designation} » : ${e.raison} — à recompter.`);
        return { ...l, ecart: ecart.toString(), valeur, actuel: a.toString(), final: e.etat === "conflit" ? null : e.final.toString(), etat: e.etat, raison: e.etat === "conflit" ? e.raison : null };
      });
      base.comptage = { origine: charge.origine, nbLignes: charge.lignes.length, valeurTotale, lignes };
    } else if ("articles" in charge) {
      const ids = charge.articles.map((a) => a.id);
      const [arts, cats, fours] = await Promise.all([
        prisma.articleStock.findMany({ where: { id: { in: ids } }, include: { stock: true } }),
        prisma.categorieStock.findMany({ select: { id: true, nom: true } }),
        prisma.fournisseur.findMany({ select: { id: true, nom: true } }),
      ]);
      const parId = new Map(arts.map((a) => [a.id, a]));
      const catNom = new Map(cats.map((c) => [c.id, c.nom]));
      const fourNom = new Map(fours.map((f) => [f.id, f.nom]));
      const dec = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString());
      base.article = {
        articles: charge.articles.map((a) => {
          const art = parId.get(a.id);
          if (!art) base.alertes.push(`« ${a.designation} » n'existe plus.`);
          const valeurs: Record<string, string | boolean | null> | null = art ? {
            code: art.code, designation: art.designation, nomCourt: art.nomCourt, unite: art.unite,
            contenance: dec(art.contenance), contenanceUnite: art.contenanceUnite, devisePrix: art.devisePrix, prixUnitaireUSD: dec(art.prixUnitaireUSD), prixUnitaireCDF: dec(art.prixUnitaireCDF),
            uniteParCarton: dec(art.uniteParCarton), categorieId: art.categorieId, fournisseurId: art.fournisseurId,
            actif: art.actif, surFicheCommande: art.surFicheCommande,
            stockMinimum: dec(art.stock?.stockMinimum) ?? "0", seuilUrgent: dec(art.stock?.seuilUrgent) ?? "0", quantite: dec(art.stock?.quantite) ?? "0",
          } : null;
          return {
            id: a.id, designation: a.designation,
            changements: a.changements.map((c) => {
              let actuel: string | null = null;
              if (valeurs && !valeursEgales(c.champ, valeurs[c.champ], c.avant)) {
                const v = valeurs[c.champ];
                actuel = c.champ === "categorieId" ? (v ? catNom.get(String(v)) ?? "?" : "— à classer —") : c.champ === "fournisseurId" ? (v ? fourNom.get(String(v)) ?? "?" : "—") : libelleValeur(c.champ, v);
                base.alertes.push(`« ${a.designation} » — ${CHAMPS_ARTICLE[c.champ].libelle} a changé depuis la proposition.`);
              }
              return { libelle: CHAMPS_ARTICLE[c.champ].libelle, avant: c.avantLibelle, apres: c.apresLibelle, actuel };
            }),
          };
        }),
      };
    }
    res.push(base);
  }
  return res;
}

/** Ids des factures dont un paiement est demandé, et des articles qui ont une proposition en attente. */
export async function ciblesEnAttente(): Promise<{ factures: Set<string>; articles: Set<string> }> {
  const cibles = await prisma.cibleDemandeStock.findMany({ where: { OR: [{ cle: { startsWith: cleFacture("") } }, { cle: { startsWith: cleArticle("") } }] }, select: { cle: true } });
  const factures = new Set<string>(), articles = new Set<string>();
  for (const { cle } of cibles) {
    if (cle.startsWith(cleFacture(""))) factures.add(cle.slice(cleFacture("").length));
    else articles.add(cle.slice(cleArticle("").length));
  }
  return { factures, articles };
}

/** La demande en attente qui vise cette cible (fiche facture / fiche article), s'il y en a une. */
export async function demandeSurCible(cle: string) {
  const c = await prisma.cibleDemandeStock.findUnique({ where: { cle }, select: { demandeId: true } });
  if (!c) return null;
  const [a] = await apercusDemandes({ id: c.demandeId, statut: "EN_ATTENTE" }, { detail: true });
  return a ?? null;
}
