import "server-only";

import { prisma } from "@/lib/prisma";
import { indicateursStock } from "@/lib/indicateurs/stock";
import { dlcProches, DLC_HORIZON_JOURS } from "@/lib/dlc-stock";
import { libelleTotal, formaterMontantFacture, montantsFacture, totalFactures } from "@/lib/facture-devise";
import { estEchue, whereAEcheanceAvant } from "@/lib/facture-echue";
import { filtrerArticles } from "@/lib/inventaire-export";
import { FILTRE_INVENTAIRE_VIDE } from "@/lib/filtre-inventaire";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";
import { formaterUSD, normaliserEspaces } from "@/lib/montant";
import { ALERTE_LABEL, DOMAINE_LABEL, STATUT_BC_LABEL, qte } from "@/lib/stock";
import { NATURE_LIBELLE, type NatureDemande } from "@/lib/validations-stock/charge";
import { bonDeListe, compterSansPrixBon, deviseBon, libelleTotalListe } from "@/lib/bon-commande-devise";
import { appliquerReception } from "@/lib/reception-bc";
import { joursAvantDlc, libelleJoursDlc } from "@/lib/achats-doublons";
import { jjmmaaaa } from "@/lib/achats-liste";
import { jourCourantKinshasaISO, jourKinshasa } from "@/lib/heure-kinshasa";
import { LIENS, type DomaineStock } from "./liens";
import { aCommander, libelleEcheance, prevoir, COUVERTURE_JOURS, FENETRE_JOURS, HORIZON_JOURS, JOURS_SORTIE_MIN, type Prevision } from "./prevision";
import { plafonner, rendreCourriel, type Groupe, type Ligne, type Rubrique } from "./texte";

// COURRIEL QUOTIDIEN DU STOCK (Direction, 2026-10-12) — 7 h à Kinshasa, SEULEMENT s'il y a quelque chose à signaler.
//
// Sept rubriques. Chaque chiffre vient de la fonction qui alimente l'écran correspondant du Stock (aucun calcul
// réécrit ici) :
//   1. articles en rupture / sous le seuil / urgents, par domaine   → `indicateursStock` (accueil Stock : mêmes articles actifs, même règle `niveauAlerte`)
//   1 bis. articles consommés en rupture ou à commander d'ici 3 jours (consommation × délai fournisseur) → `prevoir` (prevision.ts, règle unique)
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

// ── 1 bis. Articles à commander (date limite tirée de la consommation et du délai du fournisseur) ───

export async function rubriqueACommander(maintenant: Date): Promise<Rubrique | null> {
  const auj = jourCourantKinshasaISO(maintenant);
  // Sorties des 28 derniers jours, aujourd'hui exclu (journée en cours, incomplète), par article et par jour.
  const parJour = await prisma.mouvementStock.groupBy({
    by: ["articleId", "date"],
    where: { type: "SORTIE", date: { gte: decaler(auj, -FENETRE_JOURS), lt: decaler(auj, 0) } },
    _sum: { quantite: true },
  });
  const sorties = new Map<string, { total: number; jours: number }>();
  for (const g of parJour) {
    const s = sorties.get(g.articleId) ?? { total: 0, jours: 0 };
    s.total += Number(g._sum.quantite ?? 0);
    s.jours += 1;
    sorties.set(g.articleId, s);
  }
  const candidats = [...sorties].filter(([, s]) => s.jours >= JOURS_SORTIE_MIN).map(([id]) => id);
  if (candidats.length === 0) return null;

  const [articles, enCommande] = await Promise.all([
    prisma.articleStock.findMany({
      where: { id: { in: candidats }, actif: true, stock: { isNot: null } },
      select: {
        id: true, unite: true, ...CHAMPS_LIBELLE, stock: { select: { quantite: true } },
        fournisseurs: { where: { habituel: true }, select: { fournisseur: { select: { id: true, nom: true, delaiLivraison: true } } } },
      },
    }),
    // Déjà commandé : une ligne d'un bon validé, envoyé, ou reçu en partie et pas encore reçue en entier.
    prisma.ligneBonDeCommande.findMany({
      where: { articleId: { in: candidats }, bonDeCommande: { statut: { in: [...STATUTS_BON_EN_ATTENTE] } } },
      select: { articleId: true, quantite: true, quantiteRecue: true },
    }),
  ]);
  const dejaCommandes = new Set(
    enCommande.filter((l) => l.quantiteRecue === null || Number(l.quantiteRecue) < Number(l.quantite)).map((l) => l.articleId),
  );

  type Item = { articleId: string; libelle: string; unite: string | null; quantite: number; p: Prevision; fournisseur: { id: string; nom: string } | null };
  const items: Item[] = [];
  let ecartesCommandes = 0;
  for (const a of articles) {
    const s = sorties.get(a.id)!;
    const f = a.fournisseurs[0]?.fournisseur ?? null;
    const quantite = Number(a.stock!.quantite);
    const p = prevoir({ quantite, sorties: s.total, joursSortie: s.jours, delaiLivraison: f?.delaiLivraison }, auj);
    if (!aCommander(p)) continue;
    if (dejaCommandes.has(a.id)) { ecartesCommandes += 1; continue; }
    items.push({ articleId: a.id, libelle: libelleArticle(a), unite: a.unite, quantite, p, fournisseur: f ? { id: f.id, nom: f.nom } : null });
  }
  if (items.length === 0) return null;

  // Par fournisseur habituel (une commande = un fournisseur), le plus pressé d'abord ; sans fournisseur en dernier.
  const parFournisseur = new Map<string, Item[]>();
  for (const it of items) {
    const cle = it.fournisseur?.id ?? "";
    parFournisseur.set(cle, [...(parFournisseur.get(cle) ?? []), it]);
  }
  // Rang de tri : rupture d'abord, puis la date limite la plus proche.
  const rang = (i: Item) => (i.p.enRupture ? -1e9 : i.p.joursAvantCommande);
  const plusPresse = (l: Item[]) => Math.min(...l.map(rang));
  const ordre = [...parFournisseur].sort(([ca, a], [cb, b]) => (ca === "" ? 1 : 0) - (cb === "" ? 1 : 0) || plusPresse(a) - plusPresse(b));
  const u = (unite: string | null) => (unite ? ` ${unite}` : "");
  const groupes: Groupe[] = ordre.map(([cle, liste]) => {
    const tries = liste.sort((x, y) => rang(x) - rang(y) || x.libelle.localeCompare(y.libelle, "fr"));
    const f = tries[0]!.fournisseur;
    const lignes: Ligne[] = tries.map((i) => {
      const delai = i.p.delai === null ? "délai de livraison non renseigné (compté 0 j)" : `livraison ${i.p.delai} j`;
      const conso = `${nombre(Math.round(i.p.consoParJour * 100) / 100)}${u(i.unite)}/jour`;
      const suggere = `suggéré : ${nombre(i.p.quantiteSuggeree)}${u(i.unite)}`;
      return {
        texte: i.p.enRupture
          ? `${i.libelle} — EN RUPTURE (stock ${nombre(i.quantite)}${u(i.unite)}) · ${conso} · ${delai} · à commander AUJOURD'HUI · ${suggere}`
          : `${i.libelle} — stock ${nombre(i.quantite)}${u(i.unite)} · ${conso} · rupture vers le ${jjmmaaaa(i.p.ruptureISO)} · ${delai}`
            + ` · à commander avant le ${jjmmaaaa(i.p.commanderAvantISO)} (${libelleEcheance(i.p.joursAvantCommande)}) · ${suggere}`,
        lien: LIENS.article(i.articleId),
      };
    });
    return { titre: `${f ? f.nom : "Sans fournisseur habituel"} (${tries.length})`, ...plafonner(lignes, cle ? LIENS.fournisseur(cle) : LIENS.catalogue()) };
  });
  const enRupture = items.filter((i) => i.p.enRupture).length;
  const enRetard = items.filter((i) => !i.p.enRupture && i.p.joursAvantCommande < 0).length;
  const dont = [enRupture > 0 ? `${enRupture} déjà en rupture` : "", enRetard > 0 ? `${enRetard} en retard` : ""].filter(Boolean).join(" et ");
  return {
    cle: "a-commander", titre: `Articles à commander d'ici ${HORIZON_JOURS} jours`, nombre: items.length,
    resume: [
      `${items.length} article(s)${dont ? `, dont ${dont}` : ""}, par fournisseur habituel.`,
      `Calcul : sorties des ${FENETRE_JOURS} derniers jours ÷ ${FENETRE_JOURS} = consommation par jour ; date limite = rupture prévue − délai de livraison du fournisseur ;`
        + ` quantité suggérée = ${COUVERTURE_JOURS} jours de consommation après la livraison. Article à 0 mais consommé : EN RUPTURE, à commander aujourd'hui.`
        + ` Articles sortis moins de ${JOURS_SORTIE_MIN} jours sur la période`
        + `${ecartesCommandes > 0 ? ` ou déjà sur un bon de commande en cours (${ecartesCommandes})` : " ou déjà sur un bon de commande en cours"} : non repris.`,
      "Fiable seulement si les sorties et les réceptions sont saisies chaque jour.",
    ].join("\n"),
    groupes, suite: { libelle: "Voir les bons de commande", lien: LIENS.bons() },
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
    groupes: [plafonner(lignes, LIENS.bons())], suite: { libelle: "Voir les bons de commande", lien: LIENS.bons() },
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
  const negatifs = filtrerArticles(candidats, new Map(), { ...FILTRE_INVENTAIRE_VIDE, manque: "negatif", visibilite: "tous" });
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
 * Le courriel du matin, ou `null` quand il n'y a RIEN à signaler (rien n'est alors envoyé). Les sept rubriques se
 * lisent en parallèle : elles sont indépendantes et en lecture seule.
 */
export async function preparerEnvoiQuotidien(maintenant: Date): Promise<EnvoiQuotidien | null> {
  const resultats = await Promise.all([
    rubriqueAlertes(maintenant), rubriqueACommander(maintenant), rubriqueFactures(maintenant), rubriqueDlc(maintenant),
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
