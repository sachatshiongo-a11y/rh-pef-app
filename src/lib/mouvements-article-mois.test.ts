import { describe, it, expect } from "vitest";
import {
  anneeMoisDe, anneesDesMouvements, bornesPeriode, consommationDuMois, effectifsParAnnee, effectifsPeriode, groupesParMois, libelleMoisAnnee,
  lienPdfArticle, lireMoisMouvements, moisAvecMouvements, moisEnCours, nbDuMois, periodeDeRequete, totauxDuMois, type AgregatMouvement,
} from "./mouvements-article-mois";
import { lienFicheArticle } from "./fiche-article";
import { valeurEnUSD } from "./prix-article";

// MOUVEMENTS D'UN ARTICLE PAR ANNÉE ET PAR MOIS (Direction, 2026-10-12) : les règles pures. Le rendu de la page est
// tenu par mouvements-par-mois.integration.test.ts (fiche réelle sur base éphémère).

const j = (iso: string) => new Date(`${iso}T00:00:00Z`);
const g = (date: string, type: string, quantite: number, categorieSortie: string | null = null, nb = 1): AgregatMouvement => ({ date: j(date), type, categorieSortie, nb, quantite });

const JEU: AgregatMouvement[] = [
  g("2026-10-01", "ENTREE", 10, null, 2),
  g("2026-10-05", "SORTIE", 3, "LIVRAISON_RESTAURANT"),
  g("2026-10-06", "SORTIE", 1, "PERTE"),
  g("2026-10-07", "SORTIE", 2, null),
  g("2026-10-08", "AJUSTEMENT", 4),
  g("2026-09-30", "SORTIE", 5, "LIVRAISON_RESTAURANT"),
  g("2026-09-02", "ENTREE", 20),
  g("2025-12-31", "ENTREE", 7),
  g("2025-12-15", "SORTIE", 6, "PERTE"),
  g("2025-03-10", "AJUSTEMENT", 1),
];

describe("année et mois d'un mouvement", () => {
  it("se lisent sur la date pure (UTC) : le 1er du mois est dans son mois, le dernier jour dans le sien", () => {
    expect(anneeMoisDe(j("2026-10-01"))).toEqual({ annee: 2026, mois: 10 });
    expect(anneeMoisDe(j("2026-09-30"))).toEqual({ annee: 2026, mois: 9 });
    expect(anneeMoisDe(j("2025-12-31"))).toEqual({ annee: 2025, mois: 12 });
    expect(anneeMoisDe(j("2026-01-01"))).toEqual({ annee: 2026, mois: 1 });
  });
  it("le mois EN COURS suit l'horloge de Kinshasa : le 30/09 à 23 h 30 UTC, il est déjà le 1er octobre à Kinshasa", () => {
    expect(moisEnCours(new Date("2026-09-30T23:30:00Z"))).toEqual({ annee: 2026, mois: 10 });
    expect(moisEnCours(new Date("2026-09-30T22:59:00Z"))).toEqual({ annee: 2026, mois: 9 });
    expect(moisEnCours(new Date("2026-12-31T23:30:00Z"))).toEqual({ annee: 2027, mois: 1 });
  });
  it("un mouvement du 1er à 00 h 30 de Kinshasa (écrit comme jour civil de Kinshasa) appartient à ce mois, et à la consommation de ce mois", () => {
    // Instant : 30/09 23 h 30 UTC = 1er/10 00 h 30 à Kinshasa → la colonne date porte le 1er octobre.
    const { annee, mois } = moisEnCours(new Date("2026-09-30T23:30:00Z"));
    const vendredi = [g("2026-10-01", "SORTIE", 4)];
    expect(consommationDuMois(vendredi, annee, mois).total).toBe(4);
    expect(consommationDuMois(vendredi, 2026, 9).total).toBe(0);
  });
});

describe("années, mois et effectifs", () => {
  it("années avec mouvements, de la plus récente à la plus ancienne ; mois de l'année choisie, du plus récent au plus ancien", () => {
    expect(anneesDesMouvements(JEU)).toEqual([2026, 2025]);
    expect(moisAvecMouvements(JEU, 2026)).toEqual([10, 9]);
    expect(moisAvecMouvements(JEU, 2025)).toEqual([12, 3]);
    expect(moisAvecMouvements(JEU, 2024)).toEqual([]);
  });
  it("?mois= : un mois qui a des mouvements est retenu, le reste retombe sur « tous les mois » (null)", () => {
    expect(lireMoisMouvements("10", [10, 9])).toBe(10);
    expect(lireMoisMouvements("8", [10, 9])).toBeNull();
    expect(lireMoisMouvements("abc", [10, 9])).toBeNull();
    expect(lireMoisMouvements(undefined, [10, 9])).toBeNull();
    expect(lireMoisMouvements(["9", "10"], [10, 9])).toBe(9);
  });
  it("les compteurs des pastilles de type suivent l'année et le mois choisis", () => {
    expect(effectifsPeriode(JEU, { annee: "toutes", mois: null })).toEqual({ entrees: 4, sorties: 5, ajustements: 2, tous: 11 });
    expect(effectifsPeriode(JEU, { annee: 2026, mois: null })).toEqual({ entrees: 3, sorties: 4, ajustements: 1, tous: 8 });
    expect(effectifsPeriode(JEU, { annee: 2026, mois: 10 })).toEqual({ entrees: 2, sorties: 3, ajustements: 1, tous: 6 });
    expect(effectifsPeriode(JEU, { annee: 2025, mois: 12 })).toEqual({ entrees: 1, sorties: 1, ajustements: 0, tous: 2 });
    expect(effectifsPeriode(JEU, { annee: 2024, mois: null }).tous).toBe(0);
  });
  it("effectifs des pastilles d'année : par année, et « toutes » = le total de l'article", () => {
    expect(effectifsParAnnee(JEU, [2026, 2025, 2024])).toEqual({ toutes: 11, "2026": 8, "2025": 3, "2024": 0 });
  });
  it("nbDuMois suit le filtre de type", () => {
    expect(nbDuMois(JEU, 2026, 10, "sorties")).toBe(3);
    expect(nbDuMois(JEU, 2026, 10, "tous")).toBe(6);
  });
});

describe("totaux d'un mois", () => {
  it("entrées, sorties et consommation du mois ENTIER ; l'ajustement ne compte ni en entrée ni en sortie", () => {
    const t = totauxDuMois(JEU, 2026, 10);
    expect(t.entrees).toBe(10);
    expect(t.sorties).toBe(6); // 3 livraison + 1 perte + 2 sans motif
    expect(t.consommation).toEqual({ total: 6, pertes: 1 });
    expect(t.nb).toBe(6);
  });
  it("la consommation compte toutes les sorties, pertes et sorties sans motif comprises, et jamais les entrées", () => {
    expect(consommationDuMois(JEU, 2026, 9)).toEqual({ total: 5, pertes: 0 });
    expect(consommationDuMois(JEU, 2025, 12)).toEqual({ total: 6, pertes: 6 });
    expect(consommationDuMois(JEU, 2026, 8)).toEqual({ total: 0, pertes: 0 });
  });
  it("les groupes de plusieurs jours / motifs d'un même mois s'additionnent", () => {
    expect(consommationDuMois([g("2026-10-01", "SORTIE", 1.5), g("2026-10-02", "SORTIE", 2.25, "PERTE"), g("2026-10-02", "SORTIE", 1, "LIVRAISON_RESTAURANT")], 2026, 10)).toEqual({ total: 4.75, pertes: 2.25 });
  });
  it("la valeur : quantité × prix de référence ; sans prix (ou franc sans taux) elle est INCONNUE (null), jamais 0", () => {
    const c = consommationDuMois(JEU, 2026, 10).total; // 6
    expect(valeurEnUSD({ prixUnitaireUSD: "2.5", prixUnitaireCDF: null, devisePrix: "USD" }, c, null)?.valeur).toBe(15);
    expect(valeurEnUSD({ prixUnitaireUSD: null, prixUnitaireCDF: null, devisePrix: "USD" }, c, 2800)).toBeNull();
    expect(valeurEnUSD({ prixUnitaireUSD: null, prixUnitaireCDF: "7000", devisePrix: "CDF" }, c, null)).toBeNull();
    expect(valeurEnUSD({ prixUnitaireUSD: null, prixUnitaireCDF: "7000", devisePrix: "CDF" }, c, 2800)?.valeur).toBe(15);
  });
});

describe("classement par mois", () => {
  it("groupe les mouvements du plus récent au plus ancien, un groupe par mois (le 1er et le 31 aux bons endroits)", () => {
    const lignes = [{ date: j("2026-10-01") }, { date: j("2026-09-30") }, { date: j("2026-09-02") }, { date: j("2025-12-31") }];
    const groupes = groupesParMois(lignes);
    expect(groupes.map((x) => `${x.annee}-${x.mois}:${x.lignes.length}`)).toEqual(["2026-10:1", "2026-9:2", "2025-12:1"]);
  });
  it("en-tête « Octobre 2026 »", () => {
    expect(libelleMoisAnnee(2026, 10)).toBe("Octobre 2026");
    expect(libelleMoisAnnee(2026, 1)).toBe("Janvier 2026");
  });
});

describe("bornes de la période (requête)", () => {
  it("un mois : du 1er inclus au 1er du mois suivant exclu ; une année : idem ; toutes : pas de borne", () => {
    expect(bornesPeriode({ annee: 2026, mois: 10 })).toEqual({ gte: j("2026-10-01"), lt: j("2026-11-01") });
    expect(bornesPeriode({ annee: 2026, mois: 12 })).toEqual({ gte: j("2026-12-01"), lt: j("2027-01-01") });
    expect(bornesPeriode({ annee: 2025, mois: null })).toEqual({ gte: j("2025-01-01"), lt: j("2026-01-01") });
    expect(bornesPeriode({ annee: "toutes", mois: null })).toBeNull();
  });
});

describe("adresses", () => {
  it("l'année et le mois se combinent avec le filtre et sont gardés ; l'année « en cours » est écrite explicitement", () => {
    expect(lienFicheArticle("a1", "mouvements", { filtre: "sorties", annee: 2026, mois: 10 })).toBe("/stock/catalogue/a1?onglet=mouvements&annee=2026&mois=10&filtre=sorties");
    expect(lienFicheArticle("a1", "mouvements", { annee: "toutes", mois: 3 })).toBe("/stock/catalogue/a1?onglet=mouvements&annee=toutes");
    expect(lienFicheArticle("a1", "mouvements", { annee: 2025, mois: null, tousMouvements: true })).toBe("/stock/catalogue/a1?onglet=mouvements&annee=2025&mouvements=tous");
    expect(lienFicheArticle("a1", "mouvements")).toBe("/stock/catalogue/a1?onglet=mouvements");
    expect(lienFicheArticle("a1", "prix", { annee: 2025 })).toBe("/stock/catalogue/a1?onglet=prix");
  });
  it("l'export PDF suit l'année, le mois et le type ; la requête de la route les relit", () => {
    const u = lienPdfArticle("a1", { annee: 2026, mois: 10 }, "sorties");
    expect(u).toBe("/stock/catalogue/a1/pdf?annee=2026&mois=10&filtre=sorties");
    expect(periodeDeRequete(new URL(`http://x${u}`).searchParams)).toEqual({ annee: 2026, mois: 10 });
    expect(periodeDeRequete(new URLSearchParams("annee=toutes"))).toEqual({ annee: "toutes", mois: null });
    expect(periodeDeRequete(new URLSearchParams("annee=2026&mois=13"))).toEqual({ annee: 2026, mois: null });
    expect(periodeDeRequete(new URLSearchParams("annee=abc"))).toBeNull();
    expect(periodeDeRequete(new URLSearchParams(""))).toBeNull();
    expect(lienPdfArticle("a1", { annee: "toutes", mois: null }, "tous")).toBe("/stock/catalogue/a1/pdf?annee=toutes");
  });
});
