// La fiche salarié sur plusieurs années + l'onglet « Fin de contrat » fondu dans « Contrats » (2026-10-12).
// Ce que le rendu seul ne dit pas : le câblage de la page serveur (qui ne se monte pas sans base).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { redirectionAncienOnglet } from "@/lib/fiche-annees";

const lire = (f: string) => readFileSync(path.join(__dirname, f), "utf8");
const page = lire("page.tsx");
const dossier = lire("dossier.tsx");

describe("fiche salarié — six onglets, l'ancien « Fin de contrat » redirige", () => {
  const cles = [...page.matchAll(/\{ cle: "([a-z]+)", label: "([^"]+)" \}/g)].map((m) => m[1]);

  it("Aperçu, Temps de travail, Congés & absences, Paie, Contrats, Dossier — plus de « Fin de contrat »", () => {
    expect(cles).toEqual(["apercu", "temps", "conges", "paie", "contrats", "dossier"]);
    expect(page).not.toMatch(/label: "Fin de contrat"/);
  });

  it("la page redirige l'ancien paramètre avant tout rendu, vers l'ancre de la section", () => {
    expect(page).toMatch(/redirectionAncienOnglet\(tab\)/);
    expect(page).toMatch(/redirect\(`\/employes\/\$\{id\}\?\$\{ancienOnglet\}`\)/);
    expect(redirectionAncienOnglet("fin")).toBe("tab=contrats#fin-de-contrat");
  });

  it("la section Fin de contrat est dans la vue Contrats, avec l'ancre #fin-de-contrat, et plus de vue « fin »", () => {
    expect(dossier).toMatch(/vue: "contrats" \| "dossier"/);
    expect(dossier).not.toMatch(/vue === "fin"/);
    const debutContrats = dossier.indexOf('vue === "contrats"');
    const debutDossier = dossier.indexOf('vue === "dossier"');
    const section = dossier.indexOf('<Section id="fin-de-contrat"');
    expect(section).toBeGreaterThan(debutContrats);
    expect(section).toBeLessThan(debutDossier);
  });

  it("les données de la section (fins de contrat, reprises du solde, paramètres de départ) se chargent avec l'onglet Contrats", () => {
    expect(page).not.toMatch(/tab === "fin"/);
    expect(page).toMatch(/const finContrats =\s+tab === "contrats"/);
    expect(page).toMatch(/const reprisesSolde = tab === "contrats"/);
    expect(page).toMatch(/const paramsDepart =\s+tab === "contrats"/);
  });
});

describe("fiche salarié — Paie et Congés se lisent par année (?annee=)", () => {
  it("l'année vient de l'adresse, l'année en cours (horloge de Kinshasa, pas Config) par défaut", () => {
    expect(page).toMatch(/searchParams: Promise<\{[^}]*annee\?: string[^}]*page\?: string[^}]*par\?: string/);
    expect(page).toMatch(/const anneeHorloge = anneeCouranteKinshasa\(\)/);
    expect(page).toMatch(/lireAnneeFiche\(sp\.annee, anneesAvecDonnees\(.*\), anneeHorloge, true\)/); // Paie : « toutes » admis
    // Congés : une année. Par défaut l'année en cours — ou, pour un salarié parti, l'année de sa sortie (dernière année du bilan).
    expect(page).toMatch(/: anneeHorloge;\s+const anneeVueConges = congesAnnees \? lireAnneeFiche\(sp\.annee, anneesDeConges\(.*\), anneeFinConges\)/);
  });

  it("la Paie passe par HistoriquePaie (tous les bulletins, page et taille lues dans l'adresse)", () => {
    expect(page).toMatch(/<HistoriquePaie\b/);
    expect(page).toMatch(/lirePagination\(sp\)/);
    expect(page).not.toMatch(/payrollLines\.map\(\(l\) => \(\s*<tr/); // plus de tableau fait à la main
  });

  it("les Congés passent par CongesParAnnee, alimenté par la source du solde (aucun recalcul dans la page)", () => {
    expect(page).toMatch(/<CongesParAnnee\b/);
    expect(page).toMatch(/chargerCongesParAnnee\(prisma, id\)/);
    expect(page).not.toMatch(/calculerSoldeAnneeCivile|repartirCongeParJour|congeDeductibleDuSolde/);
  });
});
