import "server-only";

import type { DomaineStock } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chargerEntreesStockResto } from "@/lib/stock-restaurant-charger";
import { consommationReelle, MOTIF_LIVRAISON_RESTAURANT } from "@/lib/stock-restaurant";
import { ficheAchatRemplie } from "@/lib/pdf/fiche-achat-legumes";
import { ficheCommandeJournaliere, ficheConsommationReelle, ficheRapportJournalier, type EspaceFiche, type Fiche, type LegumeCommande } from "@/lib/fiches-conso";
import { LEGUMES } from "../legumes/legumes-data";
import { chargerVentesSemaine } from "./ventes-data";

// Chargement des fiches de l'onglet Consommation (lecture seule, requêtes groupées).

const iso = (d: Date) => d.toISOString().slice(0, 10);
const jourPur = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * Domaines du catalogue repris sur la fiche d'un espace. Cuisine = nourriture ET « autre »
 * (le classeur range « Produits d'entretien & Autre non-alimentaire » dans la fiche cuisine) ;
 * Bar = boissons.
 */
export const DOMAINES_FICHE: Record<EspaceFiche, DomaineStock[]> = { CUISINE: ["NOURRITURE", "AUTRE"], BAR: ["BOISSON"] };

/** Rapport journalier — plats et boissons VENDUS (une fiche par espace) — de la semaine du `lundi`. */
export async function chargerRapportsJournaliers(lundi: Date, espaces: EspaceFiche[]): Promise<Fiche[]> {
  const v = await chargerVentesSemaine(lundi, espaces);
  return espaces.map((espace) => ficheRapportJournalier({ espace, jours: v.jours, lignes: v.lignes[espace], ventes: v.ventes }));
}

/** Consommation réelle des articles du restaurant (une fiche par espace) de la semaine du `lundi`. */
export async function chargerConsommationsReelles(lundi: Date, espaces: EspaceFiche[]): Promise<Fiche[]> {
  const jours = Array.from({ length: 7 }, (_, i) => { const d = new Date(lundi); d.setUTCDate(d.getUTCDate() + i); return iso(d); });
  const [articles, entrees] = await Promise.all([
    // Même ordre que l'écran « Stock restaurant » (et sa fiche d'inventaire).
    prisma.articleResto.findMany({
      where: { actif: true, espace: { in: espaces } },
      orderBy: [{ categorie: "asc" }, { ordre: "asc" }, { designation: "asc" }],
      select: { id: true, designation: true, unite: true, categorie: true, espace: true },
    }),
    chargerEntreesStockResto({ depuis: jours[0]!, jusquA: jours[6]! }),
  ]);
  return espaces.map((espace) =>
    ficheConsommationReelle({ espace, jours, articles: articles.filter((a) => a.espace === espace), conso: (id, j) => consommationReelle(entrees, id, j) }),
  );
}

/**
 * Fiche commande (une par espace) du jour `date` (AAAA-MM-JJ). `sansMotif` : sorties du jour sans
 * motif — elles ne sont PAS comptées comme livrées (jamais rangées d'office), la fiche le dit.
 */
export async function chargerCommandesJournalieres(date: string, espaces: EspaceFiche[]): Promise<{ fiches: Fiche[]; sansMotif: number }> {
  const jour = jourPur(date);
  const domaines = espaces.flatMap((e) => DOMAINES_FICHE[e]);
  const cuisine = espaces.includes("CUISINE");
  const [commandes, sorties, commandesLegumes, achatsLegumes] = await Promise.all([
    prisma.commandeResto.findMany({ where: { date: jour, article: { domaine: { in: domaines } } }, select: { articleId: true, quantite: true } }),
    prisma.mouvementStock.findMany({ where: { type: "SORTIE", date: jour, article: { domaine: { in: domaines } } }, select: { articleId: true, quantite: true, categorieSortie: true } }),
    cuisine ? prisma.commandeLegumeResto.findMany({ where: { date: jour }, select: { legume: true, quantite: true } }) : Promise.resolve([]),
    cuisine ? prisma.achatLegume.findMany({ where: { date: jour }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
  ]);

  const cmd = new Map<string, number>();
  for (const c of commandes) cmd.set(c.articleId, (cmd.get(c.articleId) ?? 0) + Number(c.quantite));
  const liv = new Map<string, number>();
  let sansMotif = 0;
  for (const s of sorties) {
    if (s.categorieSortie === MOTIF_LIVRAISON_RESTAURANT) liv.set(s.articleId, (liv.get(s.articleId) ?? 0) + Number(s.quantite));
    else if (s.categorieSortie !== "PERTE") sansMotif++;
  }

  // Articles actifs, plus ceux (désactivés depuis) qui ont une commande ou une livraison ce jour :
  // une quantité enregistrée n'est jamais cachée.
  const mouvementes = [...new Set([...cmd.keys(), ...liv.keys()])];
  const articles = await prisma.articleStock.findMany({
    where: { domaine: { in: domaines }, OR: [{ actif: true }, { id: { in: mouvementes } }] },
    orderBy: [{ categorie: { nom: "asc" } }, { designation: "asc" }],
    select: { id: true, designation: true, unite: true, domaine: true, categorie: { select: { nom: true } } },
  });
  const rang = (d: DomaineStock) => domaines.indexOf(d);

  // Légumes frais : commande saisie (libellé exact de la liste) ; livraison = achats du jour,
  // rapprochés de la liste comme sur la fiche d'achat (libellé sans accents ni casse, unité).
  let legumes: LegumeCommande[] = [];
  if (cuisine) {
    const cmdLeg = new Map(commandesLegumes.map((c) => [c.legume, Number(c.quantite)]));
    const achats = ficheAchatRemplie(
      LEGUMES,
      achatsLegumes.map((a) => ({ legume: a.legume, unite: a.unite, quantite: Number(a.quantite), montantCDF: null, montantUSD: null })),
      0,
    ).lignes;
    legumes = achats.map((l, i) => ({
      designation: l.designation,
      unite: l.unite || null,
      commande: i < LEGUMES.length ? cmdLeg.get(LEGUMES[i]!.nom) ?? null : null,
      livraison: l.quantite,
    }));
    // Commande saisie sous un libellé hors de la liste (renommé depuis) : ajoutée, jamais perdue.
    const connus = new Set(LEGUMES.map((l) => l.nom));
    for (const [nom, q] of cmdLeg) if (!connus.has(nom)) legumes.push({ designation: nom, unite: null, commande: q, livraison: null });
  }

  const fiches = espaces.map((espace) =>
    ficheCommandeJournaliere({
      espace,
      date,
      articles: articles
        .filter((a) => DOMAINES_FICHE[espace].includes(a.domaine))
        .sort((a, b) => rang(a.domaine) - rang(b.domaine))
        .map((a) => ({ id: a.id, designation: a.designation, unite: a.unite, categorie: a.categorie?.nom ?? null })),
      commandes: cmd,
      livraisons: liv,
      legumes: espace === "CUISINE" ? legumes : undefined,
    }),
  );
  return { fiches, sansMotif };
}
