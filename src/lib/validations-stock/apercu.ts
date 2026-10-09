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
import { dollarsPourReste, francsPourReste, imputation } from "./conversion-francs";
import { ajouterAuTotal, formaterMontantFacture, montantsFacture, totalVide, type DeviseFacture, type TotalDevises } from "@/lib/facture-devise";

/** Restes dans la devise de la facture (`devise`, absente = USD). */
export type ApercuFacture = { id: string; nom: string; numero: string | null; resteDemande: number; resteActuel: number | null; reglee: boolean; devise?: DeviseFacture };
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
    mode: "SOLDE" | "LOT" | "REGLEMENT"; date: string;
    /** Total des restes demandés EN DOLLARS (lot de factures en dollars) ; null s'il compte des factures en francs. */
    total: number | null;
    /** Total des restes demandés, par devise (« 100,00 $ + 280 000 FC »). */
    totalDevises?: TotalDevises;
    factures: ApercuFacture[];
    /**
     * Règlement (« + Paiement / Avoir ») : `verse` = devise du montant versé ; `deviseFacture` = celle
     * de la facture. Facture en dollars : `montantUSD` = imputé, `montantCDF` = francs versés (s'il y a
     * lieu). Facture en francs : `montantCDF` = imputé, `montantUSD` = dollars versés (s'il y a lieu).
     * Imputé converti au taux des Paramètres d'AUJOURD'HUI (`tauxActuel`, null s'il manque) — celui
     * qui sera appliqué si la Direction valide maintenant. `resteApres` : dans la devise de la facture.
     */
    reglement: null | { type: string; montantUSD: number | null; montantCDF: number | null; tauxActuel: number | null; mode: string | null; note: string | null; resteApres: number | null; verse?: DeviseFacture; deviseFacture?: DeviseFacture };
    /**
     * LOT payé dans une autre devise que celle de ses factures : ce qui sera versé, au taux
     * d'AUJOURD'HUI (null sans taux) — celui de la validation s'il a lieu maintenant.
     */
    lot: null | { verse: "USD" | "CDF" | "SA_DEVISE"; totalVerse: TotalDevises | null; tauxActuel: number | null; conversion: boolean };
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
/** Montant d'une alerte : « 100.00 $ » (forme d'avant, inchangée) ou « 280 000 FC ». */
const texteAlerte = (n: number, d: DeviseFacture) => (d === "USD" ? `${n.toFixed(2)} $` : formaterMontantFacture(n, "CDF"));

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
      const actuelles = new Map((await prisma.factureFournisseur.findMany({ where: { id: { in: charge.factures.map((f) => f.id) } }, select: { id: true, statut: true, devise: true, resteAPayerUSD: true, resteAPayerCDF: true } })).map((f) => [f.id, f]));
      const factures: ApercuFacture[] = charge.factures.map((f) => {
        const a = actuelles.get(f.id);
        const nom = `${f.numero ? `N° ${f.numero}` : "Sans numéro"} — ${f.fournisseurNom}`;
        const devise: DeviseFacture = f.devise === "CDF" ? "CDF" : "USD";
        const resteVu = f.devise === "CDF" ? f.resteCDF : f.resteUSD;
        const m = a ? montantsFacture(a) : null;
        if (!a || !m) base.alertes.push(`${nom} : facture supprimée depuis la demande.`);
        else if (a.statut === "REGLEE" || m.reste <= 0.001) base.alertes.push(`${nom} : déjà réglée depuis la demande.`);
        else if (m.devise !== devise) base.alertes.push(`${nom} : la devise de la facture a changé depuis la demande.`);
        else if (!new Decimal(m.resteTexte).equals(new Decimal(resteVu))) base.alertes.push(`${nom} : le reste à payer a changé depuis la demande.`);
        return { id: f.id, nom: f.fournisseurNom, numero: f.numero, resteDemande: Number(resteVu), resteActuel: m ? m.reste : null, reglee: a ? a.statut === "REGLEE" : false, ...(devise === "CDF" ? { devise } : {}) };
      });
      const tauxDuJourLu = async () => { const config = await prisma.config.findUnique({ where: { id: "singleton" }, select: { tauxChangeCDF: true } }); return Number(config?.tauxChangeCDF ?? 0) || null; };
      const r = charge.reglement;
      let reglement: NonNullable<ApercuDemande["paiement"]>["reglement"] = null;
      if (r) {
        const deviseF: DeviseFacture = factures[0]?.devise ?? "USD";
        const verse = r.montantCDF !== null ? { devise: "CDF" as const, montant: Number(r.montantCDF) } : { devise: "USD" as const, montant: Number(r.montantUSD) };
        let tauxActuel: number | null = null;
        if (verse.devise !== deviseF) {
          tauxActuel = await tauxDuJourLu();
          if (!tauxActuel) base.alertes.push(`Taux de change non configuré (Paramètres) : le paiement en ${verse.devise === "CDF" ? "francs" : "dollars"} ne peut pas être converti.`);
        }
        const reste = factures[0]?.resteActuel;
        const imp = imputation(deviseF, verse, tauxActuel, reste ?? Number.POSITIVE_INFINITY);
        const impute = imp ? imp.impute : null;
        if (imp && reste !== null && reste !== undefined && imp.depasse) base.alertes.push(`Le montant dépasse aujourd'hui le reste à payer (${texteAlerte(imp.impute, deviseF)} > ${texteAlerte(reste, deviseF)}).`);
        const resteApres = impute !== null && reste !== null && reste !== undefined ? Math.max(0, Math.round((reste - impute) * 100) / 100) : null;
        reglement = {
          type: r.type,
          montantUSD: deviseF === "USD" ? impute : verse.devise === "USD" ? verse.montant : null,
          montantCDF: deviseF === "CDF" ? impute : verse.devise === "CDF" ? verse.montant : null,
          tauxActuel, mode: r.modePaiement, note: r.note, resteApres, verse: verse.devise, deviseFacture: deviseF,
        };
      }
      const totalDevises = factures.reduce((t, f) => ajouterAuTotal(t, f.devise ?? "USD", f.resteDemande), totalVide());
      let lot: NonNullable<ApercuDemande["paiement"]>["lot"] = null;
      if (charge.mode === "LOT") {
        const verseLot = charge.saDevise ? "SA_DEVISE" as const : charge.enFrancs ? "CDF" as const : "USD" as const;
        const verseDe = (d: DeviseFacture): DeviseFacture => (verseLot === "SA_DEVISE" ? d : verseLot);
        const conversion = factures.some((f) => verseDe(f.devise ?? "USD") !== (f.devise ?? "USD"));
        const t = conversion ? await tauxDuJourLu() : null;
        if (conversion && !t) base.alertes.push(`Taux de change non configuré (Paramètres) : le lot ${verseLot === "CDF" ? "en francs" : "en dollars"} ne peut pas être converti.`);
        // Ce qui sera VERSÉ, par devise : une facture dans la devise versée, son reste ; sinon, sa conversion.
        const totalVerse = conversion && !t ? null : factures.reduce((acc, f) => {
          const d = f.devise ?? "USD", v = verseDe(d);
          if (v === d) return ajouterAuTotal(acc, d, f.resteDemande);
          return ajouterAuTotal(acc, v, d === "USD" ? francsPourReste(f.resteDemande, t!) : dollarsPourReste(f.resteDemande, t!));
        }, totalVide());
        if (conversion || verseLot !== "USD") lot = { verse: verseLot, totalVerse, tauxActuel: t, conversion };
      }
      base.paiement = {
        mode: charge.mode, date: charge.date, factures, reglement, lot, totalDevises,
        total: reglement ? (reglement.deviseFacture === "CDF" ? null : reglement.montantUSD) : totalDevises.nbCDF > 0 ? null : totalDevises.usd,
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
