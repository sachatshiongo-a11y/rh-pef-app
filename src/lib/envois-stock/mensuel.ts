import "server-only";

import { prisma } from "@/lib/prisma";
import { indicateursStock, type IndicateursStock, type PartConso } from "@/lib/indicateurs/stock";
import { chargerEcartsVentesPeriode } from "@/app/(stock)/stock/journalier/ecarts-data";
import { NOM_ESPACE, texteFenetre, texteQuantiteEcart, texteTotalDevise, texteValeurEcart } from "@/lib/ecarts-ventes-presentation";
import { chargerHausses } from "@/lib/inventaire-export";
import { chargerLiensFournisseurs, chargerPrixParFournisseur } from "@/lib/article-fournisseurs";
import { LIBELLE_ORIGINE } from "@/lib/prix-fournisseurs";
import { formaterPrix } from "@/lib/prix-article";
import { WHERE_ACHATS_LISTE, jjmmaaaa } from "@/lib/achats-liste";
import { additionnerTotaux, ajouterAuTotal, equivalentSomme, libelleSomme, libelleTotal, totalVide, type TotalDevises } from "@/lib/facture-devise";
import { contientFrancsConvertis, inventaireFige } from "@/lib/cloture-inventaire";
import { mentionSansPrix } from "@/lib/valeur-stock";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";
import { formaterUSD, montantSigne } from "@/lib/montant";
import { MOIS_FR_MAJ, lundiDe, moisAdjacent } from "@/lib/dates-fr";
import { dateHeureGenerationKinshasa, jourCourantKinshasaISO, moisCourantKinshasa } from "@/lib/heure-kinshasa";
import { LIENS } from "./liens";
import { plafonner, rendreCourriel, type Groupe, type Ligne, type Rubrique } from "./texte";

// RAPPORT MENSUEL DU STOCK (Direction, 2026-10-12) — le 1er du mois, sur le MOIS ÉCOULÉ.
//
// Six rubriques. Chaque chiffre vient de la fonction qui alimente l'écran correspondant du Stock (aucun calcul
// réécrit ici) :
//   1. achats par fournisseur     → factures du mois (`totalFactures`, devise de chaque facture) + achats directs de la
//                                   Liste d'achat (`WHERE_ACHATS_LISTE`, devise de saisie de chaque ligne)
//   2. consommation               → `indicateursStock(…, { mois })` : sorties, livraisons au restaurant, pertes (carte « Conso. du mois » de l'accueil)
//   3. valeur du stock            → `indicateursStock` (carte « Valeur du stock »), ou l'instantané figé à la clôture du mois (`inventaireFige`)
//   4. écarts ventes / consommation → `chargerEcartsVentesPeriode` (l'écran « Écarts », sur le mois au lieu de la semaine)
//   5. prix                       → `chargerHausses` (badge de hausse du catalogue), `chargerPrixParFournisseur` (onglet Fournisseurs de la fiche article)
//   6. factures à payer           → `indicateursStock` (cartes « Factures à payer » et « Factures échues »)
//
// RÈGLES DE MONNAIE : le dollar et le franc sont additionnés SÉPARÉMENT, jamais l'un dans l'autre. Seule contre-valeur
// montrée : celle qui existe déjà dans le code et que l'écran affiche — l'équivalent « ≈ » au taux du jour des factures
// (`equivalentSomme`), et l'équivalent en dollars FIGÉ à la saisie d'un achat de la Liste d'achat (`montantUSD`), dit
// comme tel. Un prix, un montant ou une valeur inconnus s'écrivent « — » ou « partiel », jamais 0.
//
// LECTURE SEULE : rien n'est écrit en base.

export type RapportMensuel = { sujet: string; corps: string; rubriques: Rubrique[]; mois: MoisRapport };

export type MoisRapport = {
  annee: number;
  /** 1 à 12. */
  mois: number;
  /** « AAAA-MM » : la valeur du sélecteur de mois de l'accueil. */
  cle: string;
  /** Premier et dernier jour du mois (dates pures AAAA-MM-JJ, bornes incluses). */
  debut: string;
  fin: string;
  /** « Septembre 2026 ». */
  libelle: string;
};

/** Le mois écoulé, vu de Kinshasa : le rapport part le 1er au matin, il parle du mois qui vient de finir. */
export function moisEcoule(maintenant: Date): MoisRapport {
  const cle = moisAdjacent(moisCourantKinshasa(maintenant), -1);
  const annee = Number(cle.slice(0, 4)), mois = Number(cle.slice(5, 7));
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return { annee, mois, cle, debut: `${cle}-01`, fin: `${cle}-${String(dernier).padStart(2, "0")}`, libelle: `${MOIS_FR_MAJ[mois - 1]} ${annee}` };
}

const bornes = (m: MoisRapport) => ({ gte: new Date(`${m.debut}T00:00:00.000Z`), lt: new Date(Date.UTC(m.annee, m.mois, 1)) });
const dollars = (n: number | null) => (n === null ? "—" : formaterUSD(n));
const isoPur = (d: Date) => d.toISOString().slice(0, 10); // colonne @db.Date : date PURE

// ── 1. Achats par fournisseur ────────────────────────────────────────────────────────────────────

type Cumul = { id: string | null; nom: string; factures: TotalDevises; achats: TotalDevises; nbFactures: number; nbAchats: number; sansMontant: number };

export async function rubriqueAchats(m: MoisRapport, ind: IndicateursStock): Promise<Rubrique> {
  const [factures, achats] = await Promise.all([
    // Les factures du mois (champs `mois` / `annee`, comme le rapport « Factures fournisseurs » et le rapport RH du 1er).
    prisma.factureFournisseur.findMany({
      where: { annee: m.annee, mois: m.mois },
      select: { fournisseurId: true, fournisseurNom: true, fournisseur: { select: { id: true, nom: true } }, devise: true, montantUSD: true, montantCDF: true },
    }),
    // Les achats DIRECTS du mois : la Liste d'achat, sans facture ni réception (WHERE_ACHATS_LISTE : la règle de son écran).
    prisma.mouvementStock.findMany({
      where: { AND: [WHERE_ACHATS_LISTE, { date: bornes(m) }] },
      select: { fournisseurId: true, fournisseur: { select: { id: true, nom: true } }, devise: true, montantOrigine: true, montantUSD: true },
    }),
  ]);
  const parFournisseur = new Map<string, Cumul>();
  const cumul = (cle: string, id: string | null, nom: string): Cumul => {
    let c = parFournisseur.get(cle);
    if (!c) { c = { id, nom, factures: totalVide(), achats: totalVide(), nbFactures: 0, nbAchats: 0, sansMontant: 0 }; parFournisseur.set(cle, c); }
    return c;
  };
  // Montant d'une facture dans SA devise (jamais l'autre colonne, nulle par construction).
  for (const f of factures) {
    const c = f.fournisseur ? cumul(f.fournisseur.id, f.fournisseur.id, f.fournisseur.nom) : cumul(`libre:${f.fournisseurNom.trim().toLowerCase()}`, null, f.fournisseurNom);
    const montant = Number((f.devise === "CDF" ? f.montantCDF : f.montantUSD) ?? 0);
    c.factures = ajouterAuTotal(c.factures, f.devise === "CDF" ? "CDF" : "USD", montant);
    c.nbFactures++;
  }
  // Montant d'un achat direct dans sa devise de SAISIE ; sans montant : compté à part, jamais 0.
  let contreValeurUSD = 0, avecFrancs = false;
  for (const a of achats) {
    const c = a.fournisseur ? cumul(a.fournisseur.id, a.fournisseur.id, a.fournisseur.nom) : cumul("sans-fournisseur", null, "Sans fournisseur renseigné");
    const enFrancs = a.devise === "CDF";
    const montant = enFrancs ? a.montantOrigine : (a.montantOrigine ?? a.montantUSD);
    if (enFrancs) avecFrancs = true;
    if (a.montantUSD !== null) contreValeurUSD += Number(a.montantUSD);
    if (montant === null) { c.sansMontant++; c.nbAchats++; continue; }
    c.achats = ajouterAuTotal(c.achats, enFrancs ? "CDF" : "USD", Number(montant));
    c.nbAchats++;
  }

  const cumuls = [...parFournisseur.values()].sort((x, y) => x.nom.localeCompare(y.nom, "fr"));
  const lignes: Ligne[] = cumuls.map((c) => {
    const total = additionnerTotaux(c.factures, c.achats);
    const detail = [c.nbFactures > 0 ? `${c.nbFactures} facture(s)` : "", c.nbAchats > 0 ? `${c.nbAchats} achat(s) direct(s)` : ""].filter(Boolean).join(", ");
    const partiel = c.sansMontant > 0 ? ` · partiel : ${c.sansMontant} achat(s) sans montant` : "";
    const lien = c.id ? LIENS.fournisseur(c.id) : c.nbFactures > 0 ? LIENS.factures() : LIENS.listeAchat();
    return { texte: `${c.nom} — ${libelleTotal(total, "—", formaterUSD)} (${detail})${partiel}`, lien };
  });

  const totalFacturesMois = [...parFournisseur.values()].reduce((t, c) => additionnerTotaux(t, c.factures), totalVide());
  const totalAchatsMois = [...parFournisseur.values()].reduce((t, c) => additionnerTotaux(t, c.achats), totalVide());
  const total = additionnerTotaux(totalFacturesMois, totalAchatsMois);
  const sansMontant = [...parFournisseur.values()].reduce((t, c) => t + c.sansMontant, 0);
  const resume = [
    lignes.length === 0 ? `Aucun achat enregistré en ${m.libelle.toLowerCase()}.` : `Total du mois : ${libelleTotal(total, "—", formaterUSD)} (factures ${libelleTotal(totalFacturesMois, "—", formaterUSD)} · achats directs ${libelleTotal(totalAchatsMois, "—", formaterUSD)}). Dollars et francs sont additionnés séparément, jamais convertis.`,
    sansMontant > 0 ? `Partiel : ${sansMontant} achat(s) direct(s) sans montant saisi ne sont pas comptés (leur montant est inconnu, pas nul).` : "",
    avecFrancs ? `Pour mémoire, la Liste d'achat vaut ${formaterUSD(contreValeurUSD)} en équivalent dollars figé à la saisie (le chiffre de son écran et du rapport « Achats ») ; ce n'est pas additionné aux totaux ci-dessus.` : "",
  ].filter(Boolean).join("\n");

  const groupes: Groupe[] = [];
  if (lignes.length > 0) groupes.push(plafonner(lignes, LIENS.fournisseurs(), 60));
  // Légumes frais : achats sans fournisseur, même carte que l'accueil.
  const legumes = ind.legumesMois.nb === 0 ? "aucun achat" : `${dollars(ind.legumesMois.montant)} · ${ind.legumesMois.nb} achat(s)`;
  groupes.push({ titre: "Autres achats", lignes: [{ texte: `Légumes frais (sans fournisseur) : ${legumes}`, lien: LIENS.legumes() }] });
  return { cle: "achats", titre: "Achats par fournisseur", resume, groupes, suite: { libelle: "Voir les factures", lien: LIENS.factures() } };
}

// ── 2. Consommation ──────────────────────────────────────────────────────────────────────────────

/** Une part de la consommation : le montant des sorties valorisées ; « — » quand TOUTES sont sans prix (jamais 0). */
function texteConso(p: PartConso): string {
  const sansPrix = p.nbSansPrix > 0 ? ` · partiel : ${p.nbSansPrix} sans prix` : "";
  if (p.nb === 0 && p.nbSansPrix === 0) return "aucune sortie";
  if (p.nb === 0) return `— (${p.nbSansPrix} sortie(s) sans prix)`;
  return `${formaterUSD(p.montant)} (${p.nb} sortie(s) valorisée(s)${sansPrix})`;
}

export function rubriqueConsommation(m: MoisRapport, ind: IndicateursStock): Rubrique {
  const c = ind.consoMois;
  const lignes: Ligne[] = [
    { texte: `Sorties du mois : ${c.nb === 0 && c.nbSansPrix > 0 ? "" : "≈ "}${texteConso(c)}`, lien: LIENS.mouvementsDuMois(m.annee, m.mois) },
    { texte: `dont livraisons au restaurant : ${texteConso(c.livraisons)}`, lien: LIENS.mouvementsDuMois(m.annee, m.mois, "livraison") },
    { texte: `dont pertes : ${texteConso(c.pertes)}`, lien: LIENS.mouvementsDuMois(m.annee, m.mois, "perte") },
  ];
  if (c.sansMotif.nb + c.sansMotif.nbSansPrix > 0) lignes.push({ texte: `dont sans motif : ${texteConso(c.sansMotif)}`, lien: LIENS.mouvementsDuMois(m.annee, m.mois) });
  return {
    cle: "consommation", titre: "Consommation du mois",
    resume: ind.consoFrancsSansTaux > 0 ? `${ind.consoFrancsSansTaux} sortie(s) d'articles en FC non valorisée(s) : taux du jour non défini.` : undefined,
    groupes: [{ lignes }],
  };
}

// ── 3. Valeur du stock ───────────────────────────────────────────────────────────────────────────

export async function rubriqueValeur(m: MoisRapport, ind: IndicateursStock, maintenant: Date): Promise<Rubrique> {
  // Comme l'accueil Stock d'un mois passé : l'instantané figé à la clôture du mois s'il existe, sinon le stock d'aujourd'hui.
  const fige = await inventaireFige(m.annee, m.mois);
  const valeur = fige ? fige.valeurTotaleUSD : ind.valeurStock;
  const sansPrix = fige ? fige.nbSansPrix : ind.valeurStockSansPrix;
  const horsTaux = fige ? 0 : ind.articlesSansTaux;
  const approx = fige ? contientFrancsConvertis(fige) : ind.valeurStockApprox;
  // Rien de chiffrable (aucun article valorisé) : « — », jamais 0,00 $.
  const montant = valeur === 0 && (sansPrix > 0 || horsTaux > 0) ? "—" : `${approx ? "≈ " : ""}${montantSigne(valeur, "USD").texte}`;
  const mentions = [mentionSansPrix(sansPrix), horsTaux > 0 ? `hors ${horsTaux} article(s) en FC (taux du jour non défini)` : ""].filter(Boolean).join(" · ");
  const quand = fige
    ? `stock au ${fige.figeLe ? dateHeureGenerationKinshasa(fige.figeLe) : "moment de la clôture"} (figé à la clôture du mois)`
    : `stock d'aujourd'hui, ${jjmmaaaa(jourCourantKinshasaISO(maintenant))} (la clôture du mois n'est pas encore faite)`;
  return {
    cle: "valeur", titre: "Valeur du stock",
    groupes: [{ lignes: [{ texte: `${montant}${mentions ? ` — ${mentions}` : ""} · ${quand}`, lien: LIENS.catalogue() }] }],
  };
}

// ── 4. Écarts ventes / consommation ──────────────────────────────────────────────────────────────

export async function rubriqueEcarts(m: MoisRapport): Promise<Rubrique> {
  const { ecarts, espaces } = await chargerEcartsVentesPeriode(m.debut, m.fin, undefined);
  // L'écran lit une semaine à la fois : le lien ouvre la dernière semaine du mois (un lundi).
  const lundiISO = isoPur(lundiDe(new Date(`${m.fin}T00:00:00.000Z`)));
  const lien = LIENS.ecartsVentes(lundiISO);
  const groupes: Groupe[] = [];
  let nombreEcarts = 0;
  for (const esp of espaces) {
    const connus = ecarts[esp].filter((l) => l.periode.etat === "CONNUE" && Number(l.periode.ecart) !== 0);
    const inconnus = ecarts[esp].filter((l) => l.periode.etat === "INCONNUE").length;
    nombreEcarts += connus.length;
    const lignes: Ligne[] = connus.map((l) => {
      const p = l.periode as Extract<typeof l.periode, { etat: "CONNUE" }>;
      const u = l.unite ? ` ${l.unite}` : "";
      return { texte: `${l.designation} — écart ${texteQuantiteEcart(p.ecart, true)}${u} (réel ${texteQuantiteEcart(p.reelle)}, théorique ${texteQuantiteEcart(p.theorique)}, ${texteFenetre(p)}) · valeur ${l.valeur ? texteValeurEcart(l.valeur) : "sans prix"}`, lien };
    });
    const totaux = (["USD", "CDF"] as const).filter((d) => ecarts.totaux[esp][d] !== undefined).map((d) => texteTotalDevise(ecarts.totaux[esp][d]!, d));
    const notes = [
      totaux.length > 0 ? `total net des écarts valorisés : ${totaux.join(" + ")}` : "",
      inconnus > 0 ? `${inconnus} article(s) non comparable(s) (pas de comptage de début et de fin, ou ventes à vérifier) : écart inconnu, non compté` : "",
    ].filter(Boolean).join(" · ");
    groupes.push({ titre: `${NOM_ESPACE[esp]} (${connus.length} écart(s))${notes ? ` — ${notes}` : ""}`, ...(lignes.length > 0 ? plafonner(lignes, lien, 5) : { lignes: [] }) });
  }
  return {
    cle: "ecarts", titre: "Plus gros écarts entre ventes et consommation", nombre: nombreEcarts,
    resume: "Écart = consommation réelle (compté au début + reçu du dépôt − compté à la fin) moins consommation théorique (ventes × fiches techniques), entre deux comptages. Positif : consommé en plus de ce que les ventes expliquent. Signal seulement : aucun stock n'est corrigé. L'écran se lit par semaine ; le lien ouvre la dernière du mois.",
    groupes: groupes.filter((g) => g.lignes.length > 0 || g.titre),
  };
}

// ── 5. Prix : hausses et fournisseur le moins cher ───────────────────────────────────────────────

export async function rubriquePrix(m: MoisRapport): Promise<Rubrique> {
  const taux = await tauxDuJour();
  const [hausses, achatsFactures, achatsDirects, liensArticles, fournisseurs] = await Promise.all([
    chargerHausses(),
    prisma.ligneFacture.findMany({ where: { articleId: { not: null }, facture: { date: bornes(m) } }, select: { articleId: true } }),
    prisma.mouvementStock.findMany({ where: { type: "ENTREE", factureId: null, montantUSD: { not: null }, date: bornes(m) }, select: { articleId: true } }),
    chargerLiensFournisseurs(),
    prisma.fournisseur.findMany({ select: { id: true, nom: true } }),
  ]);
  const nomFournisseur = new Map(fournisseurs.map((f) => [f.id, f.nom]));

  // Hausses : celles du badge 📈 du catalogue (`chargerHausses`), pour les articles ACHETÉS dans le mois.
  const achetes = new Set([...achatsFactures, ...achatsDirects].map((x) => x.articleId).filter((id): id is string => id !== null));
  const idsHausse = [...hausses.keys()].filter((id) => achetes.has(id));
  const nbParArticle = new Map<string, number>();
  for (const l of liensArticles) nbParArticle.set(l.articleId, (nbParArticle.get(l.articleId) ?? 0) + 1);
  const habituels = new Map(liensArticles.filter((l) => l.habituel).map((l) => [l.articleId, l.fournisseurId]));
  const idsComparables = [...nbParArticle].filter(([, n]) => n >= 2).map(([id]) => id);

  const articles = await prisma.articleStock.findMany({
    where: { id: { in: [...new Set([...idsHausse, ...idsComparables])] } },
    select: { id: true, ...CHAMPS_LIBELLE, actif: true, unite: true, uniteParCarton: true, contenance: true, contenanceUnite: true },
  });
  const parId = new Map(articles.map((a) => [a.id, a]));

  const lignesHausse: Ligne[] = idsHausse
    .filter((id) => parId.has(id))
    .sort((x, y) => hausses.get(y)! - hausses.get(x)! || libelleArticle(parId.get(x)!).localeCompare(libelleArticle(parId.get(y)!), "fr"))
    .map((id) => ({ texte: `${libelleArticle(parId.get(id)!)} — dernier prix d'achat en hausse de +${Math.round(hausses.get(id)!)} % par rapport à la moyenne des achats précédents`, lien: LIENS.articlePrix(id) }));

  // Le fournisseur le moins cher, pour chaque article qui en a au moins deux avec un prix comparable (même calcul que la fiche article).
  type Moins = { id: string; ecartMax: number; ligne: Ligne };
  const moinsChers: Moins[] = [];
  const aComparer = idsComparables.filter((id) => parId.get(id)?.actif);
  for (let i = 0; i < aComparer.length; i += 5) {
    const lot = await Promise.all(aComparer.slice(i, i + 5).map(async (id) => {
      const a = parId.get(id)!;
      return { a, cmp: await chargerPrixParFournisseur(id, { unite: a.unite, uniteParCarton: a.uniteParCarton, contenance: a.contenance, contenanceUnite: a.contenanceUnite }, taux) };
    }));
    for (const { a, cmp } of lot) {
      const mc = cmp.lignes.find((l) => l.moinsCher);
      if (cmp.etat !== "COMPARE" || !mc || mc.prix === null) continue;
      const autres = cmp.lignes.filter((l) => !l.moinsCher && l.ecartPct !== null).sort((x, y) => (y.ecartPct ?? 0) - (x.ecartPct ?? 0));
      const devises = new Set(cmp.lignes.filter((l) => l.prix !== null).map((l) => l.devise));
      const unite = a.unite?.trim() ? ` / ${a.unite.trim()}` : "";
      const habituel = habituels.get(a.id);
      const autresTxt = autres.map((l) => `${nomFournisseur.get(l.fournisseurId) ?? "—"}${l.fournisseurId === habituel ? " (habituel)" : ""} +${Math.round(l.ecartPct!)} %`).join(", ");
      moinsChers.push({
        id: a.id, ecartMax: autres[0]?.ecartPct ?? 0,
        ligne: {
          texte: `${libelleArticle(a)} — le moins cher : ${nomFournisseur.get(mc.fournisseurId) ?? "—"} à ${formaterPrix(Number(mc.prix), mc.devise)}${unite} (${LIBELLE_ORIGINE[mc.origine]} du ${jjmmaaaa(isoPur(mc.date))})${autresTxt ? ` ; les autres : ${autresTxt}` : ""}${devises.size > 1 ? " [devises mêlées : comparaison « ≈ » au taux du jour]" : ""}`,
          lien: LIENS.articleFournisseurs(a.id),
        },
      });
    }
  }
  moinsChers.sort((x, y) => y.ecartMax - x.ecartMax || x.id.localeCompare(y.id));

  const groupes: Groupe[] = [
    { titre: `Hausses de prix d'achat (${lignesHausse.length})`, ...(lignesHausse.length > 0 ? plafonner(lignesHausse, LIENS.hausses(), 15) : { lignes: [{ texte: `Aucune hausse anormale sur les achats de ${m.libelle.toLowerCase()}.`, lien: LIENS.hausses() }] }) },
    { titre: `Fournisseur le moins cher par article (${moinsChers.length})`, ...(moinsChers.length > 0 ? plafonner(moinsChers.map((x) => x.ligne), LIENS.catalogue(), 15) : { lignes: [{ texte: "Aucun article n'a deux fournisseurs avec un prix comparable.", lien: LIENS.catalogue() }] }) },
  ];
  return {
    cle: "prix", titre: "Prix des fournisseurs",
    resume: "Dernier prix de chaque fournisseur (factures, Liste d'achat, bons engagés), ramené à l'unité de l'article, dans la devise de saisie.",
    groupes,
  };
}

// ── 6. Factures à payer ──────────────────────────────────────────────────────────────────────────

export async function rubriqueFacturesAPayer(ind: IndicateursStock): Promise<Rubrique> {
  const taux = await tauxDuJour();
  const { facturesAPayer: due, facturesEchues: echues } = ind;
  const ligne = (s: IndicateursStock["facturesAPayer"]) => `${libelleSomme(s.montant, s.montantCDF, dollars)} — ${s.nb} facture(s)${equivalentSomme(s.montant, s.montantCDF, taux) ? ` · ${equivalentSomme(s.montant, s.montantCDF, taux)}` : ""}`;
  const lignes: Ligne[] = due.nb === 0
    ? [{ texte: "Aucune facture à payer.", lien: LIENS.factures() }]
    : [
      { texte: `À payer : ${ligne(due)}`, lien: LIENS.facturesADevoir() },
      ...(echues.nb > 0 ? [{ texte: `dont échues : ${ligne(echues)}`, lien: LIENS.facturesEchues() }] : []),
    ];
  return { cle: "factures-a-payer", titre: "Factures à payer", nombre: due.nb, resume: "Situation à l'ouverture du rapport (dollars et francs à part).", groupes: [{ lignes }] };
}

// ── Assemblage ───────────────────────────────────────────────────────────────────────────────────

export async function preparerRapportMensuel(maintenant: Date): Promise<RapportMensuel> {
  const m = moisEcoule(maintenant);
  // Consommation et légumes : le mois écoulé ; valeur, alertes, factures : l'état d'aujourd'hui (comme l'accueil à ce mois).
  const ind = await indicateursStock(maintenant, { nbAlertes: 0, mois: m.cle });
  const rubriques = await Promise.all([
    rubriqueAchats(m, ind), Promise.resolve(rubriqueConsommation(m, ind)), rubriqueValeur(m, ind, maintenant),
    rubriqueEcarts(m), rubriquePrix(m), rubriqueFacturesAPayer(ind),
  ]);
  return {
    sujet: `Pâtes en Folie · Stock : rapport de ${m.libelle}`,
    corps: rendreCourriel(`Voici la synthèse du Stock pour ${m.libelle} :`, rubriques),
    rubriques, mois: m,
  };
}
