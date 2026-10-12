import "server-only";

import { prisma } from "@/lib/prisma";
import { indicateursStock } from "@/lib/indicateurs/stock";
import { dlcProches, DLC_HORIZON_JOURS } from "@/lib/dlc-stock";
import { libelleTotal, formaterMontantFacture, montantsFacture, totalFactures } from "@/lib/facture-devise";
import { estEchue, whereAEcheanceAvant } from "@/lib/facture-echue";
import { filtrerArticles } from "@/lib/inventaire-export";
import { FILTRE_INVENTAIRE_VIDE } from "@/lib/filtre-inventaire";
import { libelleArticle } from "@/lib/libelle-article";
import { formaterUSD, normaliserEspaces } from "@/lib/montant";
import { ALERTE_LABEL, DOMAINE_LABEL, STATUT_BC_LABEL, qte } from "@/lib/stock";
import { NATURE_LIBELLE, type NatureDemande } from "@/lib/validations-stock/charge";
import { bonDeListe, compterSansPrixBon, deviseBon, libelleTotalListe } from "@/lib/bon-commande-devise";
import { appliquerReception } from "@/lib/reception-bc";
import { joursAvantDlc, libelleJoursDlc } from "@/lib/achats-doublons";
import { jjmmaaaa } from "@/lib/achats-liste";
import { jourCourantKinshasaISO, jourKinshasa } from "@/lib/heure-kinshasa";
import { LIENS, type DomaineStock } from "./liens";
import { plafonner, rendreCourriel, type Groupe, type Ligne, type Rubrique } from "./texte";

// COURRIEL QUOTIDIEN DU STOCK (Direction, 2026-10-12) — 7 h à Kinshasa, SEULEMENT s'il y a quelque chose à signaler.
//
// Six rubriques. Chaque chiffre vient de la fonction qui alimente l'écran correspondant du Stock (aucun calcul
// réécrit ici) :
//   1. articles en rupture / sous le seuil / urgents, par domaine   → `indicateursStock` (accueil Stock : mêmes articles actifs, même règle `niveauAlerte`)
//   2. factures échues ou à échéance sous 7 jours                    → `whereAEcheanceAvant` (la règle de l'alerte de l'accueil), `estEchue`, `montantsFacture`
//   3. DLC dans les 7 jours                                          → `dlcProches` (bloc « DLC proches » de l'accueil Stock)
//   4. demandes en attente de la Direction                           → les mêmes demandes que le compteur « À valider » (`chargerAValiderStock`)
//   5. bons de commande validés, non reçus ou reçus en partie        → statuts du filtre de l'écran Bons de commande, `appliquerReception`
//   6. stocks négatifs                                               → `filtrerArticles(…, manque: "negatif")` (filtre « stock négatif » du catalogue)
//
// LECTURE SEULE : rien n'est écrit en base. L'envoi lui-même (courriel, notification) est fait par la route.

export type EnvoiQuotidien = { sujet: string; corps: string; rubriques: Rubrique[]; nombre: number };

const nombre = (v: number) => normaliserEspaces(qte(v));
const DOMAINES: DomaineStock[] = ["NOURRITURE", "BOISSON", "AUTRE"];

/** `AAAA-MM-JJ` décalé de `jours` jours (date PURE, minuit UTC). */
function decaler(iso: string, jours: number): Date {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d;
}
const isoPur = (d: Date) => d.toISOString().slice(0, 10); // colonne @db.Date : date PURE

// ── 1. Articles en rupture ou sous le seuil ──────────────────────────────────────────────────────

export async function rubriqueAlertes(maintenant: Date): Promise<Rubrique | null> {
  // Toutes les alertes (pas les 5 ou 8 premières) : le courriel dit tout ce que l'accueil compte.
  const ind = await indicateursStock(maintenant, { nbAlertes: Number.MAX_SAFE_INTEGER });
  if (ind.alertes.length === 0) return null;
  const groupes: Groupe[] = [];
  for (const dom of DOMAINES) {
    const duDomaine = ind.alertes
      .filter((a) => a.domaine === dom)
      .sort((x, y) => (x.niveau === y.niveau ? 0 : x.niveau === "URGENT" ? -1 : 1) || x.designation.localeCompare(y.designation, "fr"));
    if (duDomaine.length === 0) continue;
    const lignes: Ligne[] = duDomaine.map((a) => {
      const etat = a.quantite <= 0 ? "EN RUPTURE" : ALERTE_LABEL[a.niveau].toUpperCase();
      const seuil = a.stockMinimum > 0 ? ` · seuil minimum ${nombre(a.stockMinimum)}${a.unite ? ` ${a.unite}` : ""}` : "";
      return { texte: `${a.designation} — ${nombre(a.quantite)}${a.unite ? ` ${a.unite}` : ""} · ${etat}${seuil}`, lien: LIENS.article(a.articleId) };
    });
    const urgents = duDomaine.filter((a) => a.niveau === "URGENT").length;
    groupes.push({
      titre: `${DOMAINE_LABEL[dom]} (${duDomaine.length}${urgents > 0 ? `, dont ${urgents} urgent(s)` : ""})`,
      ...plafonner(lignes, LIENS.alertesCatalogue(urgents > 0 ? "URGENT" : "APPRO", dom)),
    });
  }
  return {
    cle: "alertes", titre: "Articles en rupture ou sous le seuil", nombre: ind.alertes.length,
    resume: `${ind.nbUrgent} urgent(s) · ${ind.nbAppro} à réapprovisionner (articles actifs, comme l'accueil du Stock).`,
    groupes, suite: { libelle: "Voir l'inventaire", lien: LIENS.alertesCatalogue("URGENT") },
  };
}

// ── 2. Factures échues ou à échéance sous 7 jours ────────────────────────────────────────────────

export async function rubriqueFactures(maintenant: Date): Promise<Rubrique | null> {
  const auj = jourCourantKinshasaISO(maintenant);
  const factures = await prisma.factureFournisseur.findMany({
    where: whereAEcheanceAvant(decaler(auj, 7)),
    select: {
      id: true, numero: true, fournisseurNom: true, fournisseur: { select: { nom: true } },
      devise: true, montantUSD: true, resteAPayerUSD: true, montantCDF: true, resteAPayerCDF: true, statut: true, dateEcheance: true,
    },
    orderBy: [{ dateEcheance: "asc" }, { createdAt: "asc" }],
  });
  if (factures.length === 0) return null;
  const echues = factures.filter((f) => estEchue(f, auj)).length; // jugée à la lecture (échéance dépassée), pas sur le statut stocké
  const lignes: Ligne[] = factures.map((f) => {
    const m = montantsFacture(f);
    const echeance = isoPur(f.dateEcheance as Date); // non nulle par le filtre
    const j = joursAvantDlc(echeance, auj);
    const quand = j < 0 ? `ÉCHUE depuis ${-j} j` : j === 0 ? "échéance AUJOURD'HUI" : `échéance dans ${j} j`;
    return { texte: `${f.fournisseur?.nom ?? f.fournisseurNom} — facture ${f.numero ? `n° ${f.numero}` : "sans numéro"} · reste ${formaterMontantFacture(m.reste, m.devise)} · ${quand} (${jjmmaaaa(echeance)})`, lien: LIENS.facture(f.id) };
  });
  return {
    cle: "factures", titre: "Factures fournisseurs échues ou à échéance sous 7 jours", nombre: factures.length,
    // Dollars et francs à part, jamais additionnés (facture-devise.ts) : le même total que l'alerte de l'accueil.
    resume: `${factures.length} facture(s)${echues > 0 ? `, dont ${echues} échue(s)` : ""} — reste à payer : ${libelleTotal(totalFactures(factures, "reste"), undefined, formaterUSD)}.`,
    groupes: [plafonner(lignes, LIENS.facturesADevoir())], suite: { libelle: "Voir les factures à payer", lien: LIENS.facturesADevoir() },
  };
}

// ── 3. DLC dans les 7 jours ──────────────────────────────────────────────────────────────────────

export async function rubriqueDlc(maintenant: Date): Promise<Rubrique | null> {
  const dlc = await dlcProches(maintenant, 30);
  if (dlc.total === 0) return null;
  const lignes: Ligne[] = dlc.lignes.map((l) => ({
    texte: `${l.designation} — +${nombre(l.quantite)}${l.unite ? ` ${l.unite}` : ""} entré le ${jjmmaaaa(l.dateEntreeISO)} · DLC ${jjmmaaaa(l.dlcISO)} (${libelleJoursDlc(l.jours)})`,
    lien: LIENS.article(l.articleId),
  }));
  return {
    cle: "dlc", titre: `Produits dont la DLC tombe dans les ${DLC_HORIZON_JOURS} jours ou est passée`, nombre: dlc.total,
    resume: "Indicatif : le logiciel ne suit pas les lots, la quantité entrée n'est peut-être plus en stock.",
    groupes: [{ lignes, ...(dlc.total > lignes.length ? { omises: { nombre: dlc.total - lignes.length, lien: LIENS.listeAchat() } } : {}) }],
    suite: { libelle: "Voir la Liste d'achat", lien: LIENS.listeAchat() },
  };
}

// ── 4. Demandes en attente de la Direction ───────────────────────────────────────────────────────

export async function rubriqueDemandes(): Promise<Rubrique | null> {
  // Les demandes que compte le badge « À valider » pour la Direction (`chargerAValiderStock`) : toutes celles en attente.
  const demandes = await prisma.demandeValidationStock.findMany({
    where: { statut: "EN_ATTENTE" },
    select: { id: true, nature: true, resume: true, auteurNom: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (demandes.length === 0) return null;
  const groupes: Groupe[] = [];
  for (const nature of [...new Set(demandes.map((d) => d.nature))]) {
    const duGenre = demandes.filter((d) => d.nature === nature);
    const lignes: Ligne[] = duGenre.map((d) => ({ texte: `${d.resume} — demandé par ${d.auteurNom} le ${jourKinshasa(d.createdAt)}`, lien: LIENS.aValider() }));
    groupes.push({ titre: `${NATURE_LIBELLE[nature as NatureDemande] ?? nature} (${duGenre.length})`, ...plafonner(lignes, LIENS.aValider()) });
  }
  return {
    cle: "demandes", titre: "Demandes du Stock en attente de validation", nombre: demandes.length,
    groupes, suite: { libelle: "Tout traiter", lien: LIENS.aValider() },
  };
}

// ── 5. Bons de commande validés, non (ou partiellement) réceptionnés ─────────────────────────────

/** Les états d'un bon qui attend sa marchandise : validé, envoyé, reçu en partie (filtre « État » de l'écran Bons de commande). */
export const STATUTS_BON_EN_ATTENTE = ["VALIDE", "ENVOYE", "RECU_PARTIEL"] as const;

export async function rubriqueBons(maintenant: Date): Promise<Rubrique | null> {
  const auj = jourCourantKinshasaISO(maintenant);
  const bons = await prisma.bonDeCommande.findMany({
    where: { statut: { in: [...STATUTS_BON_EN_ATTENTE] } },
    orderBy: [{ date: "asc" }, { sequence: "asc" }],
    select: {
      id: true, numero: true, date: true, statut: true, devise: true, totalUSD: true, totalCDF: true, fournisseur: { select: { nom: true } },
      lignes: { select: { id: true, designation: true, quantite: true, quantiteRecue: true, prixUnitaireUSD: true, totalLigneUSD: true, prixUnitaireCDF: true, totalLigneCDF: true, article: { select: { contenance: true, contenanceUnite: true } } } },
    },
  });
  if (bons.length === 0) return null;
  const lignes: Ligne[] = bons.map((b) => {
    const jour = isoPur(b.date);
    const attente = joursAvantDlc(auj, jour); // jours écoulés depuis la date du bon
    const total = libelleTotalListe(bonDeListe(b, compterSansPrixBon(b.lignes, deviseBon(b)), b.lignes.length), formaterUSD);
    // Reçu en partie : ce qui reste à recevoir, avec la règle de la réception (`appliquerReception`).
    const restes = b.statut === "RECU_PARTIEL" ? appliquerReception(b.lignes, new Map()).restes : [];
    const reste = restes.length > 0 ? ` · reste à recevoir : ${restes.length} ligne(s)` : "";
    return { texte: `${b.numero} · ${b.fournisseur?.nom ?? "—"} · ${STATUT_BC_LABEL[b.statut]} · du ${jjmmaaaa(jour)} (${attente <= 0 ? "aujourd'hui" : `il y a ${attente} j`}) · ${total}${reste}`, lien: LIENS.bon(b.id) };
  });
  const parStatut = STATUTS_BON_EN_ATTENTE.map((s) => ({ s, n: bons.filter((b) => b.statut === s).length })).filter((x) => x.n > 0);
  return {
    cle: "bons", titre: "Bons de commande à réceptionner", nombre: bons.length,
    resume: parStatut.map((x) => `${x.n} ${STATUT_BC_LABEL[x.s].toLowerCase()}`).join(" · ") + ".",
    groupes: [plafonner(lignes, LIENS.bonsValides())], suite: { libelle: "Voir les bons validés", lien: LIENS.bonsValides() },
  };
}

// ── 6. Stocks négatifs ───────────────────────────────────────────────────────────────────────────

export async function rubriqueNegatifs(): Promise<Rubrique | null> {
  // Le filtre « stock négatif » du catalogue (`manqueDe(…, "negatif")`) : la requête ne fait que réduire ce qu'on charge.
  const candidats = await prisma.articleStock.findMany({
    where: { stock: { quantite: { lt: 0 } } },
    include: { stock: true, _count: { select: { fournisseurs: true } } },
    orderBy: { designation: "asc" },
  });
  const negatifs = filtrerArticles(candidats, new Map(), { ...FILTRE_INVENTAIRE_VIDE, manque: "negatif" });
  if (negatifs.length === 0) return null;
  const lignes: Ligne[] = negatifs.map((a) => ({
    texte: `${libelleArticle(a)} — ${nombre(Number(a.stock!.quantite))}${a.unite ? ` ${a.unite}` : ""}${a.actif ? "" : " (article désactivé)"}`,
    lien: LIENS.article(a.id),
  }));
  return {
    cle: "negatifs", titre: "Stocks négatifs", nombre: negatifs.length,
    resume: "Un stock ne descend jamais sous 0 : une sortie ou une livraison a été saisie avant l'entrée correspondante, ou un comptage manque.",
    groupes: [plafonner(lignes, LIENS.stocksNegatifs())], suite: { libelle: "Voir les stocks négatifs", lien: LIENS.stocksNegatifs() },
  };
}

// ── Assemblage ───────────────────────────────────────────────────────────────────────────────────

/**
 * Le courriel du matin, ou `null` quand il n'y a RIEN à signaler (rien n'est alors envoyé). Les six rubriques se
 * lisent en parallèle : elles sont indépendantes et en lecture seule.
 */
export async function preparerEnvoiQuotidien(maintenant: Date): Promise<EnvoiQuotidien | null> {
  const resultats = await Promise.all([
    rubriqueAlertes(maintenant), rubriqueFactures(maintenant), rubriqueDlc(maintenant),
    rubriqueDemandes(), rubriqueBons(maintenant), rubriqueNegatifs(),
  ]);
  const rubriques = resultats.filter((r): r is Rubrique => r !== null);
  if (rubriques.length === 0) return null;
  const total = rubriques.reduce((t, r) => t + (r.nombre ?? 0), 0);
  const auj = jourCourantKinshasaISO(maintenant);
  return {
    sujet: `Pâtes en Folie · Stock : ${total} point(s) à signaler`,
    corps: rendreCourriel(`Voici ce que le Stock demande à voir ce ${jjmmaaaa(auj)} :`, rubriques),
    rubriques, nombre: total,
  };
}
