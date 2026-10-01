import { describe, it, expect } from "vitest";
import { StatutBonCommande, StatutFacture } from "@prisma/client";
import {
  lireOnglet, lireFiltreFactures, lireFiltreBons, statutsFactures, statutsBons, lienFiche, lireRetourFiche, suffixeRetour,
  grouperFacturesParMois, STATUTS_FACTURE_A_REGLER, STATUTS_BC_EN_COURS, ONGLETS_FOURNISSEUR,
} from "./fiche-fournisseur";

const ID = "11111111-2222-3333-4444-555555555555";
const AUTRE = "99999999-2222-3333-4444-555555555555";

describe("onglet de la fiche fournisseur (?onglet=)", () => {
  it("Factures par défaut : absent, vide ou inconnu", () => {
    expect(lireOnglet(undefined)).toBe("factures");
    expect(lireOnglet("")).toBe("factures");
    expect(lireOnglet("nimporte-quoi")).toBe("factures");
    expect(lireOnglet("BONS")).toBe("factures"); // la casse compte : une valeur inconnue reste inconnue
    expect(lireOnglet("__proto__")).toBe("factures");
  });
  it("accepte les cinq onglets, et la première valeur d'un paramètre répété", () => {
    for (const o of ONGLETS_FOURNISSEUR) expect(lireOnglet(o)).toBe(o);
    expect(lireOnglet(["bons", "achats"])).toBe("bons");
    expect(lireOnglet(["zzz", "bons"])).toBe("factures");
  });
});

describe("filtres (?filtre=)", () => {
  it("factures : À régler par défaut, valeur inconnue → À régler", () => {
    expect(lireFiltreFactures(undefined)).toBe("a-regler");
    expect(lireFiltreFactures("en-cours")).toBe("a-regler"); // un filtre de l'autre onglet n'a pas de sens ici
    expect(lireFiltreFactures("payees")).toBe("payees");
    expect(lireFiltreFactures("toutes")).toBe("toutes");
  });
  it("bons : En cours par défaut, valeur inconnue → En cours", () => {
    expect(lireFiltreBons(undefined)).toBe("en-cours");
    expect(lireFiltreBons("payees")).toBe("en-cours");
    expect(lireFiltreBons("recus")).toBe("recus");
    expect(lireFiltreBons("tous")).toBe("tous");
  });
});

describe("ce que veulent dire les filtres", () => {
  it("« À régler » = tout sauf Réglée (les statuts du filtre « À payer » de l'écran Factures)", () => {
    expect([...STATUTS_FACTURE_A_REGLER].sort()).toEqual(Object.values(StatutFacture).filter((s) => s !== "REGLEE").sort());
    expect(statutsFactures("a-regler")).toEqual(["A_REGLER", "ECHUE_NON_REGLEE"]);
    expect(statutsFactures("payees")).toEqual(["REGLEE"]);
    expect(statutsFactures("toutes")).toBeUndefined();
  });
  it("chaque statut de bon est classé : en cours, reçu ou annulé — un nouveau statut doit être tranché ici", () => {
    const classes = [...STATUTS_BC_EN_COURS, "RECU", "ANNULE"].sort();
    expect(classes).toEqual(Object.values(StatutBonCommande).sort());
  });
  it("En cours : brouillon, validé, envoyé, reçu partiel — ni reçu, ni annulé ; Reçus : reçus en totalité ; Tous : sans restriction", () => {
    expect(statutsBons("en-cours")).toEqual(["BROUILLON", "VALIDE", "ENVOYE", "RECU_PARTIEL"]);
    expect(statutsBons("en-cours")).not.toContain("ANNULE");
    expect(statutsBons("recus")).toEqual(["RECU"]);
    expect(statutsBons("tous")).toBeUndefined();
  });
});

describe("adresses stables", () => {
  it("l'onglet est toujours explicite ; le filtre n'apparaît que s'il n'est pas le défaut", () => {
    expect(lienFiche(ID, "factures")).toBe(`/stock/fournisseurs/${ID}?onglet=factures`);
    expect(lienFiche(ID, "factures", "a-regler")).toBe(`/stock/fournisseurs/${ID}?onglet=factures`);
    expect(lienFiche(ID, "factures", "payees")).toBe(`/stock/fournisseurs/${ID}?onglet=factures&filtre=payees`);
    expect(lienFiche(ID, "bons", "tous")).toBe(`/stock/fournisseurs/${ID}?onglet=bons&filtre=tous`);
    expect(lienFiche(ID, "articles")).toBe(`/stock/fournisseurs/${ID}?onglet=articles`);
  });
});

describe("lien de retour d'une facture / d'un bon (?retour=)", () => {
  it("retrouve l'onglet et le filtre d'où l'on vient", () => {
    expect(lireRetourFiche(lienFiche(ID, "factures", "payees"), ID)).toBe(`/stock/fournisseurs/${ID}?onglet=factures&filtre=payees`);
    expect(lireRetourFiche(lienFiche(ID, "bons"), ID)).toBe(`/stock/fournisseurs/${ID}?onglet=bons`);
  });
  it("revient de l'aller-retour par l'URL (suffixeRetour encode, la page décode)", () => {
    const lien = lienFiche(ID, "factures", "toutes");
    const q = new URLSearchParams(suffixeRetour(lien).slice(1));
    expect(lireRetourFiche(q.get("retour") ?? undefined, ID)).toBe(lien);
  });
  it("refuse tout ce qui n'est pas un onglet de la fiche de CE fournisseur", () => {
    for (const mauvais of [
      undefined, "", null as unknown as string,
      "https://faux-site.example/stock/fournisseurs/" + ID + "?onglet=factures",
      "//faux-site.example",
      "/stock/factures",
      `/stock/fournisseurs/${AUTRE}?onglet=factures`, // autre fiche
      `/stock/fournisseurs/${ID}`, // sans onglet
      `/stock/fournisseurs/${ID}?onglet=inconnu`,
      `/stock/fournisseurs/${ID}?onglet=factures&filtre=en-cours`, // filtre d'un autre onglet
      `/stock/fournisseurs/${ID}?onglet=achats&filtre=tous`, // pas de filtre sur cet onglet
      "javascript:alert(1)",
    ]) expect(lireRetourFiche(mauvais, ID), String(mauvais)).toBeNull();
    expect(lireRetourFiche(lienFiche(ID, "factures"), null)).toBeNull(); // facture sans fournisseur
  });
  it("ne renvoie jamais la chaîne d'origine : elle est reconstruite (rien de plus que onglet + filtre)", () => {
    expect(lireRetourFiche(`/stock/fournisseurs/${ID}?onglet=factures&x=<script>`, ID)).toBe(`/stock/fournisseurs/${ID}?onglet=factures`);
  });
});

describe("regroupement des factures par mois", () => {
  it("un groupe par mois de la facture, l'ordre d'entrée (le plus récent d'abord) est conservé", () => {
    const fs = [
      { id: "a", annee: 2026, mois: 9 }, { id: "b", annee: 2026, mois: 9 },
      { id: "c", annee: 2026, mois: 8 }, { id: "d", annee: 2025, mois: 12 },
    ];
    const g = grouperFacturesParMois(fs);
    expect(g.map((x) => x.titre)).toEqual(["Septembre 2026", "Août 2026", "Décembre 2025"]);
    expect(g[0].items.map((x) => x.id)).toEqual(["a", "b"]);
    expect(g.map((x) => x.cle)).toEqual(["2026-09", "2026-08", "2025-12"]);
  });
  it("aucune facture : aucun groupe", () => {
    expect(grouperFacturesParMois([])).toEqual([]);
  });
});
